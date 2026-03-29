import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

/* ============================= */
/* CORS */
/* ============================= */
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = [
        "https://breacherbros.com",
        "https://www.breacherbros.com",
      ];

      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        console.log("❌ Blocked by CORS:", origin);
        callback(null, true);
      }
    },
  })
);

app.use(express.json());
app.use("/api", youtubeRoutes);
app.use("/api", tiktokRoutes);

app.get("/", (req, res) => {
  res.send("Backend running");
});

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("❌ ERROR: API_KEY missing");
}

/* ============================= */
/* CACHE */
/* ============================= */
const CACHE_TTL_MS = 30_000;
const cache = new Map();

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCache(key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function fetchJson(url, key) {
  const cached = getCache(key);
  if (cached) return cached;

  try {
    const res = await fetch(url, {
      headers: { "api-key": API_KEY },
    });

    const json = await res.json().catch(() => null);

    const result = {
      ok: res.ok,
      status: res.status,
      json,
    };

    setCache(key, result);
    return result;
  } catch (err) {
    console.error("❌ Fetch error:", err);
    return { ok: false, status: 0, json: null, error: err };
  }
}

/* ============================= */
/* PLATFORM */
/* ============================= */
const PLATFORM_MAP = {
  psn: "psn",
  xbox: "xbl",
  xbl: "xbl",
  pc: "uplay",
  uplay: "uplay",
};

/* ============================= */
/* HELPERS */
/* ============================= */
const calcKD = (kills, deaths) => {
  if (kills == null || deaths == null || deaths === 0) return null;
  return (kills / deaths).toFixed(2);
};

const TIERS = [
  "COPPER",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "CHAMPION",
];

const RANK_COLORS = {
  COPPER: "#a52019",
  BRONZE: "#a97142",
  SILVER: "#c0c0c0",
  GOLD: "#ffd700",
  PLATINUM: "#4fc3f7",
  EMERALD: "#00ff88",
  DIAMOND: "#00e5ff",
  CHAMPION: "#ff0000",
};

function getRankFromMMR(mmr) {
  if (mmr == null || mmr <= 0) return { name: "UNRANKED", color: "#888" };

  let tier = Math.floor((mmr - 1000) / 500);
  tier = Math.max(0, Math.min(tier, TIERS.length - 1));

  if (TIERS[tier] === "CHAMPION") {
    return { name: "CHAMPION", color: RANK_COLORS.CHAMPION };
  }

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);

  return {
    name: `${TIERS[tier]} ${division}`,
    color: RANK_COLORS[TIERS[tier]] || "#fff",
  };
}

function parseRankLabel(label) {
  if (typeof label !== "string") return null;

  const clean = label.trim().toUpperCase();
  const match = clean.match(
    /^(COPPER|BRONZE|SILVER|GOLD|PLATINUM|EMERALD|DIAMOND|CHAMPION)\s*([1-5])?$/
  );

  if (!match) return null;

  return {
    tier: match[1],
    division: match[2] ? Number(match[2]) : null,
  };
}

function formatRankLabel(label, mmr) {
  const parsed = parseRankLabel(label);
  if (parsed) {
    if (parsed.tier === "CHAMPION") return "CHAMPION";
    if (parsed.division == null) return parsed.tier;
    return `${parsed.tier} ${parsed.division}`;
  }

  if (typeof label === "string" && label.trim()) {
    return label.trim().toUpperCase();
  }

  return getRankFromMMR(mmr).name;
}

function rankScoreFromLabel(label) {
  const parsed = parseRankLabel(label);
  if (!parsed) return null;

  const tierIndex = TIERS.indexOf(parsed.tier);
  if (tierIndex < 0) return null;

  if (parsed.tier === "CHAMPION") return 1000;

  const divisionScore = parsed.division ? 5 - parsed.division : 0;
  return tierIndex * 10 + divisionScore;
}

function rankColorFromLabel(label) {
  const parsed = parseRankLabel(label);
  if (!parsed) return null;
  return RANK_COLORS[parsed.tier] || null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseStats(data) {
  const root = data?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];

  const rankedBoard = boards.find((b) =>
    ["pvp_ranked", "ranked"].includes(b.board_id)
  );

  const casualBoard = boards.find((b) =>
    ["pvp_casual", "standard"].includes(b.board_id)
  );

  return {
    rankedProfile: rankedBoard?.full_profiles?.[0]?.profile || {},
    rankedStats: rankedBoard?.full_profiles?.[0]?.season_statistics || {},
    casualProfile: casualBoard?.full_profiles?.[0]?.profile || {},
    casualStats: casualBoard?.full_profiles?.[0]?.season_statistics || {},
  };
}

/* ============================= */
/* PEAK EXTRACTION */
/* ============================= */
/*
  Priority:
  1) seasonalStats
  2) history
  3) stats fallback

  Important:
  - Only rank-related nodes are considered
  - No scanning of unrelated numbers like kills, damage, time played
  - Only selected platform is used
*/
function collectPeakCandidates(source, platform, sourceTag) {
  if (!source) return [];

  const candidates = [];
  const seen = new WeakSet();
  const sourceWeight =
    sourceTag === "seasonal" ? 3 : sourceTag === "history" ? 2 : 1;

  function isRankPointsNode(node) {
    const displayName = firstString(node?.displayName, node?.display_name);
    const metadataKey = firstString(node?.metadata?.key, node?.key);

    return (
      displayName === "Rank Points" ||
      metadataKey === "RankPoints" ||
      metadataKey === "rankpoints" ||
      Object.prototype.hasOwnProperty.call(node, "rank_points") ||
      Object.prototype.hasOwnProperty.call(node, "rankPoints") ||
      Object.prototype.hasOwnProperty.call(node, "max_rank_points") ||
      Object.prototype.hasOwnProperty.call(node, "maxRankPoints")
    );
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (isRankPointsNode(node)) {
      const mmr = firstNumber(
        node?.value,
        node?.mmr,
        node?.rank_points,
        node?.rankPoints,
        node?.max_rank_points,
        node?.maxRankPoints
      );

      if (mmr != null && mmr > 0) {
        const label = formatRankLabel(
          firstString(
            node?.metadata?.rank,
            node?.rank_name,
            node?.rankName,
            typeof node?.rank === "string" ? node.rank : null
          ),
          mmr
        );

        const score =
          rankScoreFromLabel(label) ??
          rankScoreFromLabel(getRankFromMMR(mmr).name) ??
          0;

        candidates.push({
          mmr,
          rank: label,
          score,
          color:
            firstString(node?.metadata?.color, node?.color) ||
            rankColorFromLabel(label) ||
            getRankFromMMR(mmr).color,
          image:
            firstString(node?.metadata?.imageUrl, node?.imageUrl, node?.image) ||
            null,
          platform,
          sourceWeight,
        });
      }
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(source);
  return candidates;
}

function getBestPeakFromSources(sources, platform) {
  const allCandidates = [];

  for (const { source, tag } of sources) {
    allCandidates.push(...collectPeakCandidates(source, platform, tag));
  }

  if (!allCandidates.length) return null;

  allCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sourceWeight !== a.sourceWeight) return b.sourceWeight - a.sourceWeight;
    return (b.mmr || 0) - (a.mmr || 0);
  });

  return allCandidates[0];
}

/* ============================= */
/* API */
/* ============================= */
app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing params" });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: "API KEY missing" });
    }

    const platform = PLATFORM_MAP[platformType.toLowerCase()];
    if (!platform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    const family = platform === "uplay" ? "pc" : "console";

    const statsUrl = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${platform}&platform_families=${family}`;

    const historyUrl = `https://r6data.eu/api/stats?type=history&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${platform}`;

    const seasonalUrl = `https://r6data.eu/api/stats?type=seasonalStats&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${platform}&platform_families=${family}`;

    const [statsRes, historyRes, seasonalRes] = await Promise.all([
      fetchJson(statsUrl, `stats:${nameOnPlatform}:${platform}`),
      fetchJson(historyUrl, `history:${nameOnPlatform}:${platform}`),
      fetchJson(seasonalUrl, `seasonal:${nameOnPlatform}:${platform}`),
    ]);

    if (!statsRes.ok || !statsRes.json) {
      return res.json({ ranked: null, casual: null });
    }

    const statsData = statsRes.json;
    const historyData = historyRes?.json || null;
    const seasonalData = seasonalRes?.json || null;

    if (!statsData?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    const topLevelStats = statsData?.profiles?.[0]?.stats || {};

    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsData);

    const currentMMR =
      rankedProfile.rank_points ??
      rankedProfile.rankPoints ??
      rankedProfile.elo ??
      topLevelStats.rankPoints ??
      topLevelStats.elo ??
      0;

    const currentRank = getRankFromMMR(currentMMR);

    const peak = getBestPeakFromSources(
      [
        { source: seasonalData, tag: "seasonal" },
        { source: historyData, tag: "history" },
        { source: statsData, tag: "stats" },
      ],
      platform
    );

    const peakMMR = peak?.mmr ?? null;
    const peakRank =
      peak?.rank || (peakMMR ? getRankFromMMR(peakMMR).name : "UNRANKED");

    const ranked = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      kills:
        rankedStats.kills ??
        rankedProfile.kills ??
        topLevelStats.kills ??
        0,
      deaths:
        rankedStats.deaths ??
        rankedProfile.deaths ??
        topLevelStats.deaths ??
        0,
      kd: calcKD(
        rankedStats.kills ?? rankedProfile.kills ?? topLevelStats.kills,
        rankedStats.deaths ?? rankedProfile.deaths ?? topLevelStats.deaths
      ),

      wins:
        rankedStats.match_outcomes?.wins ??
        rankedProfile.wins ??
        topLevelStats.matchesWon ??
        0,
      losses:
        rankedStats.match_outcomes?.losses ??
        rankedProfile.losses ??
        topLevelStats.matchesLost ??
        0,

      rank: currentRank.name,
      mmr: currentMMR,

      bestRank: peakRank,
      bestMMR: peakMMR,
      bestPlatform: peak?.platform || platform,
      bestRankImg: peak?.image || null,
      bestRankColor: peak?.color || currentRank.color,
    };

    const casual = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      kills: casualStats.kills ?? casualProfile.kills ?? 0,
      deaths: casualStats.deaths ?? casualProfile.deaths ?? 0,
      kd: calcKD(
        casualStats.kills ?? casualProfile.kills,
        casualStats.deaths ?? casualProfile.deaths
      ),

      wins: casualStats.match_outcomes?.wins ?? casualProfile.wins ?? 0,
      losses: casualStats.match_outcomes?.losses ?? casualProfile.losses ?? 0,

      rank: "UNRANKED",
      mmr: null,
    };

    res.setHeader("Cache-Control", "no-store");
    res.json({ ranked, casual });
  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================= */
/* START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
