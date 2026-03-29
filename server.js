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

/* Current-rank mapping wie Frontend */
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

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "api-key": API_KEY },
    });

    const json = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      error,
    };
  }
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
  Ziel:
  - History-Einträge mit metadata.rank bevorzugen
  - MMR als Sortierwert nehmen
  - bei fehlendem Rank-Text nur dann auf MMR-Mapping zurückfallen
*/
function extractPeakCandidate(source) {
  const historyArray = normalizeHistoryArray(source);
  if (!historyArray.length) return null;

  let best = null;

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

    const label = firstString(
      payload?.metadata?.rank,
      payload?.rank,
      payload?.rank_name,
      payload?.rankName
    );

    const color = firstString(
      payload?.metadata?.color,
      payload?.color
    );

    const image = firstString(
      payload?.metadata?.imageUrl,
      payload?.imageUrl,
      payload?.image
    );

    if (!best || mmr > best.mmr) {
      best = {
        mmr,
        rank: label,
        color,
        image,
      };
    }
  }

  return best;
}

function getBestPeakFromBundles(bundles) {
  let best = null;

  for (const bundle of bundles) {
    const candidates = [
      extractPeakCandidate(bundle?.historyJson),
      extractPeakCandidate(bundle?.seasonalJson),
      extractPeakCandidate(bundle?.statsJson),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (!best || candidate.mmr > best.mmr) {
        best = candidate;
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
    /* FETCH ALL PLATFORMS */
    /* ============================= */
    const bundles = await Promise.all(
      PLATFORM_PROBES.map(async ({ platformType: plat }) => {
        const [statsResp, seasonalResp, historyResp] = await Promise.all([
          fetchJson(buildStatsUrl(plat)),
          fetchJson(buildSeasonalUrl(plat)),
          fetchJson(buildHistoryUrl(plat)),
        ]);

        return {
          platformType: plat,
          statsOk: statsResp.ok,
          statsJson: statsResp.json,
          seasonalJson: seasonalResp.json,
          historyJson: historyResp.json,
        };
      })
    );

    const selectedBundle = bundles.find((b) => b.platformType === apiPlatform);

    if (!selectedBundle?.statsOk || !selectedBundle.statsJson?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    /* ============================= */
    /* CURRENT DATA (SELECTED PLATFORM) */
    /* ============================= */
    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseBoardProfiles(selectedBundle.statsJson);

    const currentRank = getRankFromMMR(rankedProfile.rank_points ?? 0);

    /* ============================= */
    /* PEAK (ACROSS ALL PLATFORMS + HISTORY FIRST) */
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
        };
      }
    }

    const peakMMR = peakCandidate?.mmr ?? null;
    const peakRankMeta = peakCandidate?.rank ?? null;
    const peakRankFromMMR = peakMMR ? getRankFromMMR(peakMMR) : { name: "UNRANKED", color: "#888" };

    const bestRank = peakRankMeta || peakRankFromMMR.name;
    const bestRankColor = peakCandidate?.color || peakRankFromMMR.color;
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
