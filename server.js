import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

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

/* Dein aktuelles Rank-Layout für die UI */
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

/* ============================= */
/* PEAK EXTRACTION */
/* ============================= */
/*
  Sucht nur rank-nahe Daten:
  - history payloads mit metadata.rank + value
  - profile Felder wie max_rank_points / max_mmr / rank_points
  - kein Kill/Death-Müll
*/
function extractPeakCandidate(source, platformType = null) {
  const candidates = [];
  const seen = new WeakSet();

  const pushCandidate = (mmr, meta = {}) => {
    if (!Number.isFinite(mmr) || mmr <= 0) return;

    candidates.push({
      mmr,
      rank: firstString(meta.rank),
      color: firstString(meta.color),
      image: firstString(meta.image),
      platform: platformType,
    });
  };

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        // History-Format: [timestamp, payload]
        if (Array.isArray(item) && item.length >= 2 && item[1] && typeof item[1] === "object") {
          const payload = item[1];
          const rankLabel = firstString(
            payload?.metadata?.rank,
            payload?.rank_name,
            payload?.rankName,
            payload?.season_rank
          );

          const value = payload?.value;
          if (Number.isFinite(value)) {
            pushCandidate(value, {
              rank: rankLabel,
              color: payload?.metadata?.color,
              image: payload?.metadata?.imageUrl,
            });
          }
        } else {
          walk(item);
        }
      }
      return;
    }

    const metaRank = firstString(
      node?.metadata?.rank,
      node?.rank_name,
      node?.rankName,
      node?.season_rank
    );

    const metaColor = firstString(node?.metadata?.color, node?.color);
    const metaImage = firstString(node?.metadata?.imageUrl, node?.imageUrl, node?.image);

    const rankLikeValue =
      (Number.isFinite(node?.max_rank_points) && node.max_rank_points) ||
      (Number.isFinite(node?.max_mmr) && node.max_mmr) ||
      (Number.isFinite(node?.peak_mmr) && node.peak_mmr) ||
      (Number.isFinite(node?.seasonMaxMmr) && node.seasonMaxMmr) ||
      (Number.isFinite(node?.season_max_mmr) && node.season_max_mmr) ||
      (Number.isFinite(node?.rankPoints) && node.rankPoints) ||
      (Number.isFinite(node?.rank_points) && node.rank_points) ||
      null;

    if (rankLikeValue !== null) {
      pushCandidate(rankLikeValue, {
        rank: metaRank,
        color: metaColor,
        image: metaImage,
      });
    }

    // Nur für echte Rank-Point-History-Objekte
    if (
      Number.isFinite(node?.value) &&
      (metaRank || node?.displayName === "Rank Points" || node?.displayType === "Number")
    ) {
      pushCandidate(node.value, {
        rank: metaRank,
        color: metaColor,
        image: metaImage,
      });
    }

    for (const child of Object.values(node)) {
      if (child && typeof child === "object") walk(child);
    }
  };

  walk(source);

  candidates.sort((a, b) => b.mmr - a.mmr);
  return candidates[0] || null;
}

function getBestPeakFromBundles(bundles) {
  let best = null;

  for (const bundle of bundles) {
    const sources = [bundle?.seasonalJson, bundle?.statsJson];

    for (const source of sources) {
      const candidate = extractPeakCandidate(source, bundle?.platformType);

      if (candidate && (!best || candidate.mmr > best.mmr)) {
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

    /* ============================= */
    /* FETCH ALL PLATFORMS FOR PEAK */
    /* ============================= */
    const bundles = await Promise.all(
      PLATFORM_PROBES.map(async ({ platformType: plat }) => {
        const [statsResp, seasonalResp] = await Promise.all([
          fetchJson(buildStatsUrl(plat)),
          fetchJson(buildSeasonalUrl(plat)),
        ]);

        return {
          platformType: plat,
          statsOk: statsResp.ok,
          seasonalOk: seasonalResp.ok,
          statsJson: statsResp.json,
          seasonalJson: seasonalResp.json,
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
    /* PEAK (ACROSS ALL PLATFORMS) */
    /* ============================= */
    let peakCandidate = getBestPeakFromBundles(bundles);

    // Letzter sauberer Fallback nur auf echte Rank-Daten des ausgewählten Profils
    if (!peakCandidate) {
      const fallbackMMR =
        rankedProfile.max_rank_points ??
        rankedProfile.rank_points ??
        0;

      if (fallbackMMR > 0) {
        const fallbackRank = getRankFromMMR(fallbackMMR);
        peakCandidate = {
          mmr: fallbackMMR,
          rank: fallbackRank.name,
          color: fallbackRank.color,
          image: null,
          platform: apiPlatform,
        };
      }
    }

    const peakMMR = peakCandidate?.mmr ?? null;
    const peakRankName =
      peakCandidate?.rank || (peakMMR ? getRankFromMMR(peakMMR).name : null);
    const peakColor =
      peakCandidate?.color || (peakMMR ? getRankFromMMR(peakMMR).color : null);

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

      // Current Rank bleibt wie im Frontend sichtbar korrekt.
      rank: currentRank.name,
      mmr: rankedProfile.rank_points ?? 0,

      // Peak Rank wird aus der besten echten API-Quelle genommen.
      bestRank: peakRankName,
      bestMMR: peakMMR,
      bestRankImg: peakCandidate?.image || null,
      bestRankColor: peakColor,
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
