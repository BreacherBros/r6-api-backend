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

if (!API_KEY) {
  console.error("❌ ERROR: API_KEY missing");
}

/* ============================= */
/* CACHE */
/* ============================= */
const CACHE = new Map();
const TTL = 30000;

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
  CACHE.set(key, { data, exp: Date.now() + TTL });
}

async function fetchJson(url, key) {
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
  } catch (err) {
    console.error("❌ Fetch error:", err);
    return { ok: false, json: null };
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
const calcKD = (k, d) => {
  if (!k || !d || d === 0) return null;
  return (k / d).toFixed(2);
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

function getRankFromMMR(mmr) {
  if (!mmr || mmr <= 0) return { name: "UNRANKED", color: "#888" };

  let tier = Math.floor((mmr - 1000) / 500);
  tier = Math.max(0, Math.min(tier, TIERS.length - 1));

  if (TIERS[tier] === "CHAMPION") {
    return { name: "CHAMPION", color: "#ff0000" };
  }

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);

  return {
    name: `${TIERS[tier]} ${division}`,
    color: "#fff",
  };
}

function rankScore(label) {
  if (!label) return 0;

  const match = label.match(/([A-Z]+)\s?([1-5])?/);
  if (!match) return 0;

  const tierIndex = TIERS.indexOf(match[1]);
  if (tierIndex < 0) return 0;

  if (match[1] === "CHAMPION") return 1000;

  const div = match[2] ? 5 - Number(match[2]) : 0;
  return tierIndex * 10 + div;
}

/* ============================= */
/* PARSE STATS */
/* ============================= */
function parseStats(data) {
  const root = data?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];

  const ranked = boards.find((b) =>
    ["pvp_ranked", "ranked"].includes(b.board_id)
  );

  const casual = boards.find((b) =>
    ["pvp_casual", "standard"].includes(b.board_id)
  );

  return {
    rankedProfile: ranked?.full_profiles?.[0]?.profile || {},
    rankedStats: ranked?.full_profiles?.[0]?.season_statistics || {},
    casualProfile: casual?.full_profiles?.[0]?.profile || {},
    casualStats: casual?.full_profiles?.[0]?.season_statistics || {},
  };
}

/* ============================= */
/* 🔥 PEAK FIX (FINAL) */
/* ============================= */
function getPeak(historyData, statsData, platform) {
  let best = null;

  const update = (mmr) => {
    if (!mmr || mmr < 1000) return;

    const rank = getRankFromMMR(mmr).name;
    const score = rankScore(rank);

    if (
      !best ||
      score > best.score ||
      (score === best.score && mmr > best.mmr)
    ) {
      best = {
        mmr,
        rank,
        score,
        platform,
      };
    }
  };

  /* 🔥 HISTORY ONLY (ECHTE DATEN) */
  const history =
    historyData?.data?.history?.data ||
    historyData?.history?.data ||
    [];

  for (const entry of history) {
    const p = Array.isArray(entry) ? entry[1] : entry;
    if (typeof p?.value === "number") {
      update(p.value);
    }
  }

  /* 🔥 FALLBACK */
  const profile =
    statsData?.platform_families_full_profiles?.[0]
      ?.board_ids_full_profiles?.find(b =>
        ["pvp_ranked", "ranked"].includes(b.board_id)
      )
      ?.full_profiles?.[0]?.profile || {};

  if (profile?.max_rank_points) {
    update(profile.max_rank_points);
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
      return res.status(400).json({ error: "Missing params" });
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

    const [statsRes, historyRes] = await Promise.all([
      fetchJson(statsUrl, `stats-${nameOnPlatform}-${platform}`),
      fetchJson(historyUrl, `hist-${nameOnPlatform}-${platform}`),
    ]);

    if (!statsRes.ok || !statsRes.json) {
      return res.json({ ranked: null, casual: null });
    }

    const statsData = statsRes.json;
    const historyData = historyRes.json;

    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsData);

    const currentMMR = rankedProfile.rank_points || 0;
    const currentRank = getRankFromMMR(currentMMR);

    /* 🔥 FIXED PEAK */
    const peak = getPeak(historyData, statsData, platform);

    const peakMMR =
      peak?.mmr ||
      rankedProfile.max_rank_points ||
      currentMMR;

    const peakRank =
      peak?.rank ||
      getRankFromMMR(peakMMR).name;

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
  console.log("Backend running on port", PORT);
});
