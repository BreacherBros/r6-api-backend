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
  if (cached) {
    return cached;
  }

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

/* Rank-System wie dein Frontend */
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
function extractPeakCandidate(source) {
  if (!source) return null;

  const candidates = [];

  const pushCandidate = (mmr, meta = {}) => {
    if (!Number.isFinite(mmr) || mmr <= 0) return;
    candidates.push({
      mmr,
      rank: firstString(meta.rank),
      color: firstString(meta.color),
      image: firstString(meta.image),
    });
  };

  const scanHistoryArray = (historyArray) => {
    for (const entry of historyArray) {
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

      const rankLabel = firstString(
        payload?.metadata?.rank,
        payload?.rank,
        payload?.rank_name,
        payload?.rankName
      );

      pushCandidate(mmr, {
        rank: rankLabel,
        color: payload?.metadata?.color ?? payload?.color,
        image: payload?.metadata?.imageUrl ?? payload?.imageUrl ?? payload?.image,
      });
    }
  };

  const scanBoards = (statsJson) => {
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

        pushCandidate(mmr, {
          rank: firstString(
            profile?.max_rank_name,
            profile?.maxRankName,
            profile?.max_rank,
            profile?.rank_name,
            profile?.rankName
          ),
          color: profile?.color ?? null,
          image: profile?.imageUrl ?? null,
        });
      }
    }
  };

  if (
    Array.isArray(source) ||
    Array.isArray(source?.data?.history?.data) ||
    Array.isArray(source?.data?.history) ||
    Array.isArray(source?.history?.data) ||
    Array.isArray(source?.history)
  ) {
    scanHistoryArray(normalizeHistoryArray(source));
  } else if (source?.platform_families_full_profiles) {
    scanBoards(source);
  } else if (source?.board_ids_full_profiles) {
    scanBoards({ platform_families_full_profiles: [{ board_ids_full_profiles: source.board_ids_full_profiles }] });
  }

  candidates.sort((a, b) => b.mmr - a.mmr);
  return candidates[0] || null;
}

function getBestPeakFromBundles(bundles) {
  let best = null;

  for (const bundle of bundles) {
    const sources = [bundle?.historyJson, bundle?.seasonalJson, bundle?.statsJson];

    for (const source of sources) {
      const candidate = extractPeakCandidate(source);
      if (!candidate) continue;

      if (!best || candidate.mmr > best.mmr) {
        best = {
          ...candidate,
          platform: bundle?.platformType || null,
        };
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
    const bundles = await Promise.all(
      PLATFORM_PROBES.map(async ({ platformType: plat }) => {
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

        return {
          platformType: plat,
          statsOk: statsResp.ok,
          seasonalOk: seasonalResp.ok,
          historyOk: historyResp.ok,
          statsJson: statsResp.json,
          seasonalJson: seasonalResp.json,
          historyJson: historyResp.json,
        };
      })
    );

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
    /* PEAK (all platforms, history first) */
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
          color: null,
          image: null,
          platform: apiPlatform,
        };
      }
    }

    const peakMMR = peakCandidate?.mmr ?? null;
    const peakFromMMR = peakMMR ? getRankFromMMR(peakMMR) : { name: "UNRANKED", color: "#888" };

    const bestRank = peakCandidate?.rank || peakFromMMR.name;
    const bestRankColor = peakCandidate?.color || peakFromMMR.color;
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
