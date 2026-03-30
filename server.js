import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";
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
const CACHE_TTL_MS = 30000;
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

    const result = { ok: res.ok, status: res.status, json };
    setCache(key, result);
    return result;
  } catch (err) {
    console.error("❌ Fetch error:", err);
    return { ok: false, status: 0, json: null };
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
/* RANK SYSTEM */
/* ============================= */
const TIERS = [
  "COPPER","BRONZE","SILVER","GOLD",
  "PLATINUM","EMERALD","DIAMOND","CHAMPION"
];

function getRankFromMMR(mmr) {
  if (!mmr || mmr <= 0) return "UNRANKED";

  let tier = Math.floor((mmr - 1000) / 500);
  tier = Math.max(0, Math.min(tier, TIERS.length - 1));

  if (TIERS[tier] === "CHAMPION") return "CHAMPION";

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);
  return `${TIERS[tier]} ${division}`;
}

/* ============================= */
/* 💾 PEAK DATABASE */
/* ============================= */
const DB_FILE = "./peaks.json";

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return {};
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch {
    return {};
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getKey(username, platform) {
  return `${username}_${platform}`;
}

function updatePeak(username, platform, mmr) {
  const db = loadDB();
  const key = getKey(username, platform);

  if (!db[key] || mmr > db[key].mmr) {
    db[key] = {
      mmr,
      rank: getRankFromMMR(mmr),
      updatedAt: new Date().toISOString(),
    };
    saveDB(db);
  }

  return db[key];
}

function getStoredPeak(username, platform) {
  const db = loadDB();
  return db[getKey(username, platform)] || null;
}

/* ============================= */
/* 🔥 MANUAL PEAK IMPORT (TRACKER) */
/* ============================= */
app.post("/api/setPeak", (req, res) => {
  const { username, platform, mmr } = req.body;

  if (!username || !platform || !mmr) {
    return res.status(400).json({ error: "Missing data" });
  }

  const peak = updatePeak(username, platform, mmr);

  res.json({
    success: true,
    peak,
  });
});

/* ============================= */
/* PARSE STATS */
/* ============================= */
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

    const statsUrl = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${platform}&platform_families=${family}`;

    const statsRes = await fetchJson(
      statsUrl,
      `stats:${nameOnPlatform}:${platform}`
    );

    if (!statsRes.ok || !statsRes.json) {
      return res.json({ ranked: null, casual: null });
    }

    const statsData = statsRes.json;

    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsData);

    const currentMMR = rankedProfile.rank_points || 0;
    const currentRank = getRankFromMMR(currentMMR);

    /* ============================= */
    /* 🔥 FINAL PEAK SYSTEM */
/* ============================= */

    // API Peak (falls vorhanden)
    const apiPeak = rankedProfile.max_rank_points || 0;

    // gespeicherter Peak
    const stored = getStoredPeak(nameOnPlatform, platform);

    // aktueller Run → DB updaten
    const updated = updatePeak(nameOnPlatform, platform, currentMMR);

    // FINAL BEST VALUE
    const finalMMR = Math.max(
      currentMMR,
      apiPeak,
      stored?.mmr || 0,
      updated?.mmr || 0
    );

    const finalRank = getRankFromMMR(finalMMR);

    const ranked = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      kills: rankedStats.kills ?? rankedProfile.kills ?? 0,
      deaths: rankedStats.deaths ?? rankedProfile.deaths ?? 0,
      kd:
        rankedStats.kills && rankedStats.deaths
          ? (rankedStats.kills / rankedStats.deaths).toFixed(2)
          : null,

      wins: rankedStats.match_outcomes?.wins ?? rankedProfile.wins ?? 0,
      losses: rankedStats.match_outcomes?.losses ?? rankedProfile.losses ?? 0,

      rank: currentRank,
      mmr: currentMMR,

      /* 🔥 FINAL CORRECT PEAK */
      bestRank: finalRank,
      bestMMR: finalMMR,
    };

    const casual = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      kills: casualStats.kills ?? casualProfile.kills ?? 0,
      deaths: casualStats.deaths ?? casualProfile.deaths ?? 0,
      kd:
        casualStats.kills && casualStats.deaths
          ? (casualStats.kills / casualStats.deaths).toFixed(2)
          : null,

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
