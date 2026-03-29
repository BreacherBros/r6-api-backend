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
  console.error("❌ ERROR: API_KEY is not set.");
}

/* ============================= */
/* CACHE */
/* ============================= */
const CACHE = new Map();
const CACHE_TTL_MS = 30_000;

function getCache(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;

  if (Date.now() > entry.exp) {
    CACHE.delete(key);
    return null;
  }

  return entry.data;
}

function setCache(key, data) {
  CACHE.set(key, {
    data,
    exp: Date.now() + CACHE_TTL_MS,
  });
}

async function fetchCached(url, key) {
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
    return {
      ok: false,
      status: 0,
      json: null,
    };
  }
}

/* ============================= */
/* PLATFORM MAP */
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

const RANK_TIER_ORDER = [
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

  let tierIndex = Math.floor((mmr - 1000) / 500);
  tierIndex = Math.max(0, Math.min(tierIndex, RANK_TIER_ORDER.length - 1));

  if (RANK_TIER_ORDER[tierIndex] === "CHAMPION") {
    return { name: "CHAMPION", color: RANK_COLORS.CHAMPION };
  }

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);

  return {
    name: `${RANK_TIER_ORDER[tierIndex]} ${division}`,
    color: RANK_COLORS[RANK_TIER_ORDER[tierIndex]] || "#fff",
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

function rankScoreFromLabel(label) {
  const parsed = parseRankLabel(label);
  if (!parsed) return null;

  const tierIndex = RANK_TIER_ORDER.indexOf(parsed.tier);
  if (tierIndex < 0) return null;

  if (parsed.tier === "CHAMPION") return 1000;

  const divScore = parsed.division ? 5 - parsed.division : 0;
  return tierIndex * 10 + divScore;
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

function extractHistoryArray(historyJson) {
  if (!historyJson) return [];

  if (Array.isArray(historyJson)) return historyJson;
  if (Array.isArray(historyJson?.data?.history?.data)) return historyJson.data.history.data;
  if (Array.isArray(historyJson?.data?.history)) return historyJson.data.history;
  if (Array.isArray(historyJson?.history?.data)) return historyJson.history.data;
  if (Array.isArray(historyJson?.history)) return historyJson.history;
  if (Array.isArray(historyJson?.data)) return historyJson.data;

  return [];
}

/*
  Peak wird NUR für die ausgewählte Plattform berechnet.
  Wichtige Regel:
  - Rank-Label ist wichtiger als reine MMR
  - Emerald 2 schlägt Emerald 5
  - Wenn kein Rank-Label da ist, wird MMR als Fallback genutzt
*/
function getPeak(historyJson, statsJson, platform) {
  let best = null;

  const check = (mmr, rank, color, image) => {
    if (mmr == null || !Number.isFinite(mmr) || mmr <= 0) return;

    const rankLabel = rank || getRankFromMMR(mmr).name;
    const score =
      rankScoreFromLabel(rankLabel) ??
      rankScoreFromLabel(getRankFromMMR(mmr).name) ??
      0;

    if (
      !best ||
      score > best.score ||
      (score === best.score && mmr > best.mmr)
    ) {
      best = {
        mmr,
        rank: rankLabel,
        score,
        color: color || rankColorFromLabel(rankLabel) || getRankFromMMR(mmr).color,
        image: image || null,
        platform,
      };
    }
  };

  /* 1) HISTORY */
  for (const entry of extractHistoryArray(historyJson)) {
    const p = Array.isArray(entry) ? entry[1] : entry;
    if (!p || typeof p !== "object") continue;

    check(
      p?.value ?? p?.mmr ?? p?.rank_points ?? null,
      firstString(
        p?.metadata?.rank,
        p?.rank,
        p?.rank_name,
        p?.rankName
      ),
      p?.metadata?.color ?? p?.color ?? null,
      p?.metadata?.imageUrl ?? p?.imageUrl ?? p?.image ?? null
    );
  }

  /* 2) FALLBACK STATS */
  if (!best) {
    const root = statsJson?.platform_families_full_profiles?.[0];
    const boards = root?.board_ids_full_profiles || [];

    for (const board of boards) {
      if (!["pvp_ranked", "ranked"].includes(board.board_id)) continue;

      for (const season of board.full_profiles || []) {
        const p = season?.profile || {};

        check(
          p?.max_rank_points ?? p?.rank_points ?? null,
          firstString(
            p?.max_rank_name,
            p?.maxRankName,
            p?.max_rank,
            p?.rank_name,
            p?.rankName
          ),
          p?.color ?? null,
          p?.imageUrl ?? null
        );
      }
    }
  }

  return best;
}

/* ============================= */
/* API */
/* ============================= */
app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
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

    /* ============================= */
    /* FETCH */
    /* ============================= */
    const [statsRes, historyRes, seasonalRes] = await Promise.all([
      fetchCached(statsUrl, `stats-${nameOnPlatform}-${platform}`),
      fetchCached(historyUrl, `hist-${nameOnPlatform}-${platform}`),
      fetchCached(seasonalUrl, `seasonal-${nameOnPlatform}-${platform}`),
    ]);

    if (!statsRes?.json?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    const statsData = statsRes.json;
    const historyData = historyRes?.json || null;
    const seasonalData = seasonalRes?.json || null;

    /* ============================= */
    /* CURRENT STATS */
    /* ============================= */
    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsData);

    const currentMMR = rankedProfile.rank_points ?? 0;
    const currentRank = getRankFromMMR(currentMMR);

    /* ============================= */
    /* PEAK (selected platform only) */
    /* ============================= */
    let peak = getPeak(historyData, seasonalData, platform);

    if (!peak) {
      const fallbackMMR =
        rankedProfile.max_rank_points ??
        rankedProfile.rank_points ??
        0;

      if (fallbackMMR > 0) {
        const fallbackRank =
          firstString(
            rankedProfile.max_rank_name,
            rankedProfile.maxRankName,
            rankedProfile.max_rank,
            rankedProfile.rank_name,
            rankedProfile.rankName
          ) || getRankFromMMR(fallbackMMR).name;

        peak = {
          mmr: fallbackMMR,
          rank: fallbackRank,
          score: rankScoreFromLabel(fallbackRank) ?? 0,
          color: rankColorFromLabel(fallbackRank) || getRankFromMMR(fallbackMMR).color,
          image: null,
          platform,
        };
      }
    }

    const peakMMR = peak?.mmr ?? null;
    const peakRank = peak?.rank || (peakMMR ? getRankFromMMR(peakMMR).name : "UNRANKED");

    /* ============================= */
    /* OUTPUT */
    /* ============================= */
    const ranked = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      kills: rankedStats.kills ?? rankedProfile.kills ?? 0,
      deaths: rankedStats.deaths ?? rankedProfile.deaths ?? 0,
      kd: calcKD(
        rankedStats.kills ?? rankedProfile.kills,
        rankedStats.deaths ?? rankedProfile.deaths
      ),

      wins: rankedStats.match_outcomes?.wins ?? rankedProfile.wins ?? 0,
      losses: rankedStats.match_outcomes?.losses ?? rankedProfile.losses ?? 0,

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
