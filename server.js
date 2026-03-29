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

async function fetchJsonCached(url, cacheKey) {
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(url, {
      headers: { "api-key": API_KEY },
    });

    const json = await response.json().catch(() => null);

    const result = {
      ok: response.ok,
      status: response.status,
      json,
    };

    setCache(cacheKey, result);
    return result;
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      error,
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

const PLATFORM_PROBES = [
  { platformType: "psn", family: "console" },
  { platformType: "xbl", family: "console" },
  { platformType: "uplay", family: "pc" },
];

/* ============================= */
/* HELPERS */
/* ============================= */
const calcKD = (k, d) => {
  if (k == null || d == null || d === 0) return null;
  return (k / d).toFixed(2);
};

/* Current Rank wie dein Frontend */
const getRankFromMMR = (mmr) => {
  if (!mmr || mmr <= 0) return { name: "UNRANKED", color: "#888" };

  const tiers = [
    { name: "COPPER", color: "#a52019" },
    { name: "BRONZE", color: "#a97142" },
    { name: "SILVER", color: "#c0c0c0" },
    { name: "GOLD", color: "#ffd700" },
    { name: "PLATINUM", color: "#4fc3f7" },
    { name: "EMERALD", color: "#00ff88" },
    { name: "DIAMOND", color: "#00e5ff" },
    { name: "CHAMPION", color: "#ff0000" },
  ];

  let tierIndex = Math.floor((mmr - 1000) / 500);
  tierIndex = Math.max(0, Math.min(tierIndex, tiers.length - 1));

  const division =
    tierIndex === tiers.length - 1
      ? ""
      : ` ${5 - Math.floor(((mmr - 1000) % 500) / 100)}`;

  return {
    name: `${tiers[tierIndex].name}${division}`,
    color: tiers[tierIndex].color,
  };
};

const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const RANK_TIERS = [
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

  const tierIndex = RANK_TIERS.indexOf(parsed.tier);
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

function parseBoardProfiles(statsJson) {
  const root = statsJson?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];

  const rankedBoard = boards.find((b) =>
    ["pvp_ranked", "ranked"].includes(b.board_id)
  );

  const casualBoard = boards.find((b) =>
    ["pvp_casual", "standard"].includes(b.board_id)
  );

  return {
    rankedBoard,
    casualBoard,
    rankedProfile: rankedBoard?.full_profiles?.[0]?.profile || {},
    rankedStats: rankedBoard?.full_profiles?.[0]?.season_statistics || {},
    casualProfile: casualBoard?.full_profiles?.[0]?.profile || {},
    casualStats: casualBoard?.full_profiles?.[0]?.season_statistics || {},
  };
}

function normalizeHistoryArray(historyJson) {
  if (!historyJson) return [];

  if (Array.isArray(historyJson)) return historyJson;
  if (Array.isArray(historyJson?.data?.history?.data)) return historyJson.data.history.data;
  if (Array.isArray(historyJson?.data?.history)) return historyJson.data.history;
  if (Array.isArray(historyJson?.history?.data)) return historyJson.history.data;
  if (Array.isArray(historyJson?.history)) return historyJson.history;

  return [];
}

/* ============================= */
/* PEAK EXTRACTION */
/* ============================= */
/*
  Peak wird nach Rank-HIERARCHIE gewählt:
  - Emerald 2 schlägt Emerald 5
  - Emerald schlägt Platinum
  - Diamond schlägt Emerald
  - Wenn Rank-Text fehlt, fällt der Code auf MMR zurück
*/
function extractPeakCandidate(source) {
  if (!source) return null;

  const historyArray = normalizeHistoryArray(source);
  const candidates = [];

  const pushCandidate = (candidate) => {
    if (!candidate) return;
    candidates.push(candidate);
  };

  const scanHistoryArray = (arr) => {
    for (const entry of arr) {
      const payload = Array.isArray(entry) ? entry?.[1] : entry;
      if (!payload || typeof payload !== "object") continue;

      const mmr =
        payload?.value ??
        payload?.mmr ??
        payload?.rank_points ??
        payload?.rankPoints ??
        payload?.max_rank_points ??
        payload?.max_mmr ??
        payload?.peak_mmr ??
        payload?.elo ??
        null;

      if (!Number.isFinite(mmr)) continue;

      const label = firstString(
        payload?.metadata?.rank,
        payload?.rank,
        payload?.rank_name,
        payload?.rankName
      );

      const score =
        rankScoreFromLabel(label) ??
        rankScoreFromLabel(getRankFromMMR(mmr).name) ??
        0;

      pushCandidate({
        mmr,
        rank: label,
        score,
        color: payload?.metadata?.color ?? payload?.color ?? null,
        image: payload?.metadata?.imageUrl ?? payload?.imageUrl ?? payload?.image ?? null,
      });
    }
  };

  const scanStatsBoards = (statsJson) => {
    const root = statsJson?.platform_families_full_profiles?.[0];
    const boards = root?.board_ids_full_profiles || [];

    for (const board of boards) {
      if (!["pvp_ranked", "ranked"].includes(board.board_id)) continue;

      for (const season of board.full_profiles || []) {
        const profile = season?.profile || {};

        const mmr =
          profile?.max_rank_points ??
          profile?.max_mmr ??
          profile?.rank_points ??
          profile?.rankPoints ??
          null;

        if (!Number.isFinite(mmr)) continue;

        const label = firstString(
          profile?.max_rank_name,
          profile?.maxRankName,
          profile?.max_rank,
          profile?.rank_name,
          profile?.rankName
        );

        const score =
          rankScoreFromLabel(label) ??
          rankScoreFromLabel(getRankFromMMR(mmr).name) ??
          0;

        pushCandidate({
          mmr,
          rank: label,
          score,
          color: profile?.color ?? null,
          image: profile?.imageUrl ?? null,
        });
      }
    }
  };

  if (historyArray.length) {
    scanHistoryArray(historyArray);
  } else if (source?.platform_families_full_profiles) {
    scanStatsBoards(source);
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.mmr || 0) - (a.mmr || 0);
  });

  return candidates[0];
}

function getBestPeakFromBundles(bundles) {
  let best = null;

  for (const bundle of bundles) {
    const sources = [bundle?.historyJson, bundle?.seasonalJson, bundle?.statsJson];

    for (const source of sources) {
      const candidate = extractPeakCandidate(source);
      if (!candidate) continue;

      if (!best) {
        best = { ...candidate, platform: bundle?.platformType || null };
        continue;
      }

      if (candidate.score > best.score) {
        best = { ...candidate, platform: bundle?.platformType || null };
        continue;
      }

      if (candidate.score === best.score && candidate.mmr > best.mmr) {
        best = { ...candidate, platform: bundle?.platformType || null };
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

    const apiPlatform = PLATFORM_MAP[platformType.toLowerCase()];
    if (!apiPlatform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    const isPC = apiPlatform === "uplay";
    const family = isPC ? "pc" : "console";

    const buildStatsUrl = (plat) =>
      `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(
        nameOnPlatform
      )}&platformType=${plat}&platform_families=${family}`;

    const buildSeasonalUrl = (plat) =>
      `https://r6data.eu/api/stats?type=seasonalStats&nameOnPlatform=${encodeURIComponent(
        nameOnPlatform
      )}&platformType=${plat}&platform_families=${family}`;

    const buildHistoryUrl = (plat) =>
      `https://r6data.eu/api/stats?type=history&nameOnPlatform=${encodeURIComponent(
        nameOnPlatform
      )}&platformType=${plat}`;

    /* ============================= */
    /* FAST PARALLEL FETCH */
    /* ============================= */
    const bundles = [];

    for (const { platformType: plat } of PLATFORM_PROBES) {
      const [statsResp, seasonalResp, historyResp] = await Promise.all([
        fetchJsonCached(
          buildStatsUrl(plat),
          `stats:${nameOnPlatform}:${plat}:${family}`
        ),
        fetchJsonCached(
          buildSeasonalUrl(plat),
          `seasonal:${nameOnPlatform}:${plat}:${family}`
        ),
        fetchJsonCached(
          buildHistoryUrl(plat),
          `history:${nameOnPlatform}:${plat}`
        ),
      ]);

      bundles.push({
        platformType: plat,
        statsOk: statsResp.ok,
        seasonalOk: seasonalResp.ok,
        historyOk: historyResp.ok,
        statsJson: statsResp.json,
        seasonalJson: seasonalResp.json,
        historyJson: historyResp.json,
      });

      await new Promise((r) => setTimeout(r, 80));
    }

    const selectedBundle = bundles.find((b) => b.platformType === apiPlatform);

    if (
      !selectedBundle?.statsOk ||
      !selectedBundle.statsJson?.platform_families_full_profiles
    ) {
      return res.json({ ranked: null, casual: null });
    }

    /* ============================= */
    /* CURRENT DATA (selected platform) */
    /* ============================= */
    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseBoardProfiles(selectedBundle.statsJson);

    const currentRank = getRankFromMMR(rankedProfile.rank_points ?? 0);

    /* ============================= */
    /* PEAK (all platforms + history first) */
    /* ============================= */
    let peakCandidate = getBestPeakFromBundles(bundles);

    if (!peakCandidate) {
      const fallbackMMR =
        rankedProfile.max_rank_points ??
        rankedProfile.rank_points ??
        0;

      if (fallbackMMR > 0) {
        peakCandidate = {
          mmr: fallbackMMR,
          rank: null,
          score: 0,
          color: null,
          image: null,
          platform: apiPlatform,
        };
      }
    }

    const peakMMR = peakCandidate?.mmr ?? null;
    const peakFromMMR = peakMMR
      ? getRankFromMMR(peakMMR)
      : { name: "UNRANKED", color: "#888" };

    const bestRank = peakCandidate?.rank || peakFromMMR.name;
    const bestRankColor =
      peakCandidate?.color ||
      rankColorFromLabel(bestRank) ||
      peakFromMMR.color;

    const bestRankImg = peakCandidate?.image || null;

    /* ============================= */
    /* OUTPUT */
    /* ============================= */
    const ranked = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),

      kills: rankedStats.kills ?? rankedProfile.kills ?? 0,
      deaths: rankedStats.deaths ?? rankedProfile.deaths ?? 0,
      kd: calcKD(
        rankedStats.kills ?? rankedProfile.kills,
        rankedStats.deaths ?? rankedProfile.deaths
      ),

      wins: rankedStats.match_outcomes?.wins ?? rankedProfile.wins ?? 0,
      losses: rankedStats.match_outcomes?.losses ?? rankedProfile.losses ?? 0,

      rank: currentRank.name,
      mmr: rankedProfile.rank_points ?? 0,

      bestRank,
      bestMMR: peakMMR,
      bestRankImg,
      bestRankColor,
      bestRankPlatform: peakCandidate?.platform || null,
    };

    const casual = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),

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

    console.log("🔥 CURRENT:", ranked.rank, ranked.mmr);
    console.log("🔥 PEAK:", ranked.bestRank, ranked.bestMMR, ranked.bestRankPlatform);

    res.setHeader("Cache-Control", "no-store");
    res.json({ ranked, casual });
  } catch (err) {
    console.error("❌ BACKEND CRASH:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================= */
/* START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
