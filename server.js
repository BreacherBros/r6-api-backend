
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

// =============================
// CORS
// =============================
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = [
        "https://breacherbros.com",
        "https://www.breacherbros.com",
      ];
      callback(null, !origin || allowed.includes(origin));
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

// =============================
// CACHE (TTL: 30s)
// =============================
const CACHE = new Map();
const TTL = 30000;

const getCache = (key) => {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    CACHE.delete(key);
    return null;
  }
  return entry.data;
};

const setCache = (key, data) => {
  CACHE.set(key, { data, exp: Date.now() + TTL });
};

async function fetchCached(url, key) {
  const cached = getCache(key);
  if (cached) return cached;

  try {
    const res = await fetch(url, {
      headers: { "api-key": API_KEY },
    });
    const json = await res.json().catch(() => null);
    const result = { ok: res.ok, json };
    setCache(key, result);
    return result;
  } catch {
    return { ok: false, json: null };
  }
}

// =============================
// PLATFORM MAPPING
// =============================
const PLATFORM_MAP = {
  psn: "psn",
  xbox: "xbl",
  xbl: "xbl",
  pc: "uplay",
  uplay: "uplay",
};
const ALL_PLATFORMS = ["psn", "xbl", "uplay"];

// =============================
// HELPER FUNCTIONS
// =============================
const calcKD = (k, d) => {
  if (!k || !d || d === 0) return null;
  return (k / d).toFixed(2);
};

const getRankFromMMR = (mmr) => {
  if (!mmr || mmr <= 0) return { name: "UNRANKED", color: "#888" };

  const tiers = [
    "COPPER",
    "BRONZE",
    "SILVER",
    "GOLD",
    "PLATINUM",
    "EMERALD",
    "DIAMOND",
    "CHAMPION",
  ];

  let tierIndex = Math.floor((mmr - 1000) / 500);
  tierIndex = Math.max(0, Math.min(tierIndex, tiers.length - 1));

  // Champion special
  if (tiers[tierIndex] === "CHAMPION") {
    return { name: "CHAMPION", color: "#ff0000" };
  }

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);
  return { name: `${tiers[tierIndex]} ${division}`, color: "#fff" };
};

function rankScore(label, mmr) {
  if (!label) return getRankFromMMR(mmr).name;
  const tiers = [
    "COPPER", "BRONZE", "SILVER", "GOLD",
    "PLATINUM", "EMERALD", "DIAMOND", "CHAMPION",
  ];
  const match = label.toUpperCase().match(/([A-Z]+)\s?([1-5])?/);
  if (!match) return 0;
  const tierIndex = tiers.indexOf(match[1]);
  if (tierIndex < 0) return 0;
  if (match[1] === "CHAMPION") return 1000;
  const div = match[2] ? 5 - Number(match[2]) : 0;
  return tierIndex * 10 + div;
}

// =============================
// PARSE STATS RESPONSE
// =============================
function parseStats(data) {
  const root = data?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];

  const rankedBoard = boards.find(b =>
    ["pvp_ranked", "ranked"].includes(b.board_id)
  );
  const casualBoard = boards.find(b =>
    ["pvp_casual", "standard"].includes(b.board_id)
  );

  return {
    rankedProfile: rankedBoard?.full_profiles?.[0]?.profile || {},
    rankedStats: rankedBoard?.full_profiles?.[0]?.season_statistics || {},
    casualProfile: casualBoard?.full_profiles?.[0]?.profile || {},
    casualStats: casualBoard?.full_profiles?.[0]?.season_statistics || {},
  };
}

// =============================
// PEAK RANK LOGIC
// =============================
function extractHistoryArray(historyJson) {
  return (
    historyJson?.data?.history?.data ||
    historyJson?.history?.data ||
    historyJson?.history ||
    []
  );
}

function getPeak(historyJson, statsJson, platform) {
  let best = null;
  const check = (mmr, rank) => {
    if (!mmr) return;
    const score = rankScore(rank, mmr);
    if (!best || score > best.score || (score === best.score && mmr > best.mmr)) {
      best = { mmr, rank, score, platform };
    }
  };

  // 1) History first
  for (const entry of extractHistoryArray(historyJson)) {
    const p = Array.isArray(entry) ? entry[1] : entry;
    check(p?.value || p?.mmr || p?.rank_points, p?.metadata?.rank || p?.rank);
  }
  // 2) Fallback to stats
  const root = statsJson?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];
  for (const b of boards) {
    if (!["pvp_ranked", "ranked"].includes(b.board_id)) continue;
    for (const s of b.full_profiles || []) {
      const p = s.profile;
      check(p?.max_rank_points || p?.rank_points, p?.max_rank_name || p?.rank_name);
    }
  }
  return best;
}

// =============================
// API ENDPOINT
// =============================
app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;
    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    if (!API_KEY) {
      return res.status(500).json({ error: "API key missing" });
    }

    const selectedPlatform = PLATFORM_MAP[platformType.toLowerCase()];
    if (!selectedPlatform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    // 🔥 Fetch stats+history for all platforms in parallel
    const results = await Promise.all(
      ALL_PLATFORMS.map(async (plat) => {
        const family = plat === "uplay" ? "pc" : "console";
        const statsUrl = \`https://r6data.eu/api/stats?type=stats&nameOnPlatform=\${encodeURIComponent(nameOnPlatform)}&platformType=\${plat}&platform_families=\${family}\`;
        const historyUrl = \`https://r6data.eu/api/stats?type=history&nameOnPlatform=\${encodeURIComponent(nameOnPlatform)}&platformType=\${plat}\`;
        const [stats, history] = await Promise.all([
          fetchCached(statsUrl, \`stats-\${nameOnPlatform}-\${plat}\`),
          fetchCached(historyUrl, \`hist-\${nameOnPlatform}-\${plat}\`),
        ]);
        return { platform: plat, stats: stats.json, history: history.json };
      })
    );

    // Daten für ausgewählte Plattform nehmen
    const selected = results.find(r => r.platform === selectedPlatform);
    if (!selected?.stats?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    const { rankedProfile, rankedStats, casualProfile, casualStats } = parseStats(selected.stats);

    const currentMMR = rankedProfile.rank_points || 0;
    const currentRank = getRankFromMMR(currentMMR);

    /* 🔥 PEAK: NUR AUSGEWÄHLTE PLATTFORM */
    let peak = null;
    if (selected) {
      peak = getPeak(selected.history, selected.stats, selected.platform);
    }

    const peakMMR = peak?.mmr || rankedProfile.max_rank_points || currentMMR;
    const peakRank = peak?.rank || getRankFromMMR(peakMMR).name;

    // =============================
    // OUTPUT
    // =============================
    const ranked = {
      username: nameOnPlatform,
      platform: selectedPlatform.toUpperCase(),
      kills: rankedStats.kills || rankedProfile.kills || 0,
      deaths: rankedStats.deaths || rankedProfile.deaths || 0,
      kd: calcKD(rankedStats.kills, rankedStats.deaths),
      wins: rankedStats.match_outcomes?.wins || rankedProfile.wins || 0,
      losses: rankedStats.match_outcomes?.losses || rankedProfile.losses || 0,
      rank: currentRank.name,
      mmr: currentMMR,
      bestRank: peakRank,
      bestMMR: peakMMR,
      bestPlatform: peak?.platform || null,
    };

    const casual = {
      username: nameOnPlatform,
      platform: selectedPlatform.toUpperCase(),
      kills: casualStats.kills || casualProfile.kills || 0,
      deaths: casualStats.deaths || casualProfile.deaths || 0,
      kd: calcKD(casualStats.kills, casualStats.deaths),
      wins: casualStats.match_outcomes?.wins || casualProfile.wins || 0,
      losses: casualStats.match_outcomes?.losses || casualProfile.losses || 0,
      rank: "UNRANKED",
      mmr: null,
    };

    res.json({ ranked, casual });
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================= */
/* START SERVER */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
