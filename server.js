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

/* ============================= */
/* HELPERS */
/* ============================= */
const calcKD = (k, d) => {
  if (k == null || d == null || d === 0) return null;
  return (k / d).toFixed(2);
};

/* Rank-Mapping passend zu deinem Frontend */
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

/* ============================= */
/* PEAK EXTRACTION */
/* ============================= */
function extractPeakCandidate(source) {
  const candidates = [];
  const seen = new WeakSet();

  const numericKeys = [
    "max_rank_points",
    "maxRankPoints",
    "max_mmr",
    "maxMmr",
    "peak_mmr",
    "peakMmr",
    "seasonMaxMmr",
    "season_max_mmr",
    "rank_points",
    "rankPoints",
    "mmr",
    "elo",
  ];

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    let value = null;
    let hasRankishField = false;

    for (const key of numericKeys) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        hasRankishField = true;
        const v = node[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          value = v;
          break;
        }
      }
    }

    if (hasRankishField && value !== null) {
      const label =
        typeof node?.metadata?.rank === "string"
          ? node.metadata.rank
          : typeof node?.rank_name === "string"
          ? node.rank_name
          : typeof node?.rankName === "string"
          ? node.rankName
          : typeof node?.rank === "string"
          ? node.rank
          : null;

      candidates.push({
        mmr: value,
        rank: label,
        color: node?.metadata?.color || node?.color || null,
        image: node?.metadata?.imageUrl || node?.imageUrl || null,
      });
    }

    for (const child of Object.values(node)) {
      if (child && typeof child === "object") walk(child);
    }
  }

  walk(source);

  candidates.sort((a, b) => b.mmr - a.mmr);
  return candidates[0] || null;
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

    const platformMap = {
      psn: "psn",
      xbox: "xbl",
      xbl: "xbl",
      pc: "uplay",
      uplay: "uplay",
    };

    const apiPlatform = platformMap[platformType.toLowerCase()];
    if (!apiPlatform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    const isPC = apiPlatform === "uplay";

    const statsUrl = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${apiPlatform}&platform_families=${isPC ? "pc" : "console"}`;

    const seasonalUrl = `https://r6data.eu/api/stats?type=seasonalStats&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${apiPlatform}&platform_families=${isPC ? "pc" : "console"}`;

    const [statsRes, seasonalRes] = await Promise.all([
      fetch(statsUrl, { headers: { "api-key": API_KEY } }),
      fetch(seasonalUrl, { headers: { "api-key": API_KEY } }).catch(() => null),
    ]);

    const statsData = await statsRes.json();

    let seasonalData = null;
    if (seasonalRes && seasonalRes.ok) {
      try {
        seasonalData = await seasonalRes.json();
      } catch (e) {
        seasonalData = null;
      }
    }

    if (!statsRes.ok || !statsData?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    /* ============================= */
    /* CURRENT SEASON PARSE */
    /* ============================= */
    const root = statsData.platform_families_full_profiles[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find((b) =>
      ["pvp_ranked", "ranked"].includes(b.board_id)
    );

    const casualBoard = boards.find((b) =>
      ["pvp_casual", "standard"].includes(b.board_id)
    );

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile || {};
    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics || {};

    const casualProfile = casualBoard?.full_profiles?.[0]?.profile || {};
    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics || {};

    const currentRank = getRankFromMMR(rankedProfile.rank_points ?? 0);

    /* ============================= */
    /* PEAK FROM SEASONAL STATS */
    /* ============================= */
    const peakCandidate =
      extractPeakCandidate(seasonalData) || extractPeakCandidate(statsData);

    const peakMMR =
      peakCandidate?.mmr ??
      rankedProfile.max_rank_points ??
      rankedProfile.max_mmr ??
      rankedProfile.rank_points ??
      null;

    const peakRank = peakCandidate?.rank
      ? peakCandidate.rank
      : getRankFromMMR(peakMMR).name;

    const peakColor =
      peakCandidate?.color || getRankFromMMR(peakMMR).color || null;

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

      bestRank: peakRank,
      bestMMR: peakMMR,
      bestRankImg: peakCandidate?.image || null,
      bestRankColor: peakColor,
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
    console.log("🔥 PEAK:", ranked.bestRank, ranked.bestMMR);

    res.setHeader("Cache-Control", "no-store");
    res.json({ ranked, casual });
  } catch (err) {
    console.error("❌ BACKEND CRASH:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================= */
/* START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
