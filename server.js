import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

/* ============================= */
/* 🔥 CORS-Setup */
/* ============================= */
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = ["https://breacherbros.com", "https://www.breacherbros.com"];
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
  console.error("❌ ERROR: API_KEY is not set.");
  // Ohne API-Key können wir keine API-Calls machen.
}

/* ============================= */
/* 🔥 CACHE (In-Memory, TTL) */
/* ============================= */
const CACHE = new Map();
const TTL = 30000; // 30 Sekunden

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

/**
 * fetchCached: Ruft URL ab, nutzt Cache wenn vorhanden.
 * Key ist z.B. "stats-<name>-<platform>" oder "hist-<name>-<platform>".
 */
async function fetchCached(url, key) {
  const cached = getCache(key);
  if (cached) {
    return cached;
  }
  try {
    const res = await fetch(url, { headers: { "api-key": API_KEY } });
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
/* 🔥 Plattform-Mapping */
/* ============================= */
/* PSN -> psn, Xbox -> xbl, PC/Uplay -> uplay */
const PLATFORM_MAP = {
  psn: "psn",
  xbox: "xbl",
  xbl: "xbl",
  pc: "uplay",
  uplay: "uplay",
};
const ALL_PLATFORMS = ["psn", "xbl", "uplay"];

/* ============================= */
/* 🔥 Helfer-Funktionen */
/* ============================= */
// K/D Ratio berechnen
const calcKD = (kills, deaths) => {
  if (!kills || !deaths || deaths === 0) return null;
  return (kills / deaths).toFixed(2);
};

// MMR -> Rang (Name & Farbe)
const getRankFromMMR = (mmr) => {
  if (!mmr || mmr <= 0) {
    return { name: "UNRANKED", color: "#888" };
  }
  const tiers = ["COPPER","BRONZE","SILVER","GOLD","PLATINUM","EMERALD","DIAMOND","CHAMPION"];
  let tier = Math.floor((mmr - 1000) / 500);
  tier = Math.max(0, Math.min(tier, tiers.length - 1));
  // Champion (höchster Rang) Sonderfall
  if (tiers[tier] === "CHAMPION") {
    return { name: "CHAMPION", color: "#ff0000" };
  }
  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);
  return { name: `${tiers[tier]} ${division}`, color: "#fff" };
};

/**
 * rankScore: Bewertet einen Rangstring als Zahl für Sortierung.
 * Z.B. "EMERALD 2" bekommt höhere Punktzahl als "EMERALD 5".
 * Bei fehlendem Label wird reiner MMR-Rang genutzt.
 */
function rankScore(label, mmr) {
  if (!label) {
    // Fall back auf Rang aus MMR
    return rankScore(getRankFromMMR(mmr).name, mmr);
  }
  const tiers = ["COPPER","BRONZE","SILVER","GOLD","PLATINUM","EMERALD","DIAMOND","CHAMPION"];
  const m = label.toUpperCase().match(/([A-Z]+)\s?([1-5])?/);
  if (!m) return 0;
  const idx = tiers.indexOf(m[1]);
  if (idx < 0) return 0;
  if (m[1] === "CHAMPION") return 1000;
  const divScore = m[2] ? (5 - Number(m[2])) : 0;
  return idx * 10 + divScore;
}

/* ============================= */
/* 🔥 Parsing der Statistiken */
/* ============================= */
function parseStats(data) {
  const root = data?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];
  const ranked = boards.find(b => ["pvp_ranked","ranked"].includes(b.board_id));
  const casual = boards.find(b => ["pvp_casual","standard"].includes(b.board_id));
  return {
    rankedProfile: ranked?.full_profiles?.[0]?.profile || {},
    rankedStats:   ranked?.full_profiles?.[0]?.season_statistics || {},
    casualProfile: casual?.full_profiles?.[0]?.profile || {},
    casualStats:   casual?.full_profiles?.[0]?.season_statistics || {},
  };
}

/* ============================= */
/* 🔥 Peak-Rang Logik */
/* ============================= */
function extractHistoryArray(historyJson) {
  return historyJson?.data?.history?.data 
         || historyJson?.history?.data 
         || historyJson?.history 
         || [];
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
  // 1) Verlaufshistorie durchgehen (falls vorhanden)
  for (const entry of extractHistoryArray(historyJson)) {
    const p = Array.isArray(entry) ? entry[1] : entry;
    check(p?.value || p?.mmr || p?.rank_points, p?.metadata?.rank || p?.rank);
  }
  // 2) Fallback: Alle Season-Profile in statsJson prüfen
  const root = statsJson?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];
  for (const board of boards) {
    if (!["pvp_ranked","ranked"].includes(board.board_id)) continue;
    for (const profile of board.full_profiles || []) {
      const p = profile.profile;
      check(p?.max_rank_points || p?.rank_points, p?.max_rank_name || p?.rank_name);
    }
  }
  return best;
}

/* ============================= */
/* 🔥 API: /api/stats */
/* ============================= */
app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;
    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const selectedPlatform = PLATFORM_MAP[platformType.toLowerCase()];
    if (!selectedPlatform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    // 🔥 API-URLs zusammensetzen
    const family = (selectedPlatform === "uplay") ? "pc" : "console";
    // Paralleles Abrufen für alle Plattformen
    const results = await Promise.all(
      ALL_PLATFORMS.map(async (plat) => {
        const fam = (plat === "uplay") ? "pc" : "console";
        const statsUrl = `https://api.r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${plat}&platform_families=${fam}`;
        const historyUrl = `https://api.r6data.eu/api/stats?type=history&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${plat}`;
        const [statsRes, historyRes] = await Promise.all([
          fetchCached(statsUrl,  `stats-${nameOnPlatform}-${plat}`),
          fetchCached(historyUrl, `hist-${nameOnPlatform}-${plat}`),
        ]);
        return {
          platform: plat,
          stats: statsRes.json,
          history: historyRes.json,
        };
      })
    );

    // Daten der gewählten Plattform herausfiltern
    const selectedData = results.find(r => r.platform === selectedPlatform);
    if (!selectedData?.stats?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    //  Ausgewählte Stats parsen
    const { rankedProfile, rankedStats, casualProfile, casualStats } = parseStats(selectedData.stats);
    const currentMMR = rankedProfile.rank_points || 0;
    const currentRank = getRankFromMMR(currentMMR);

    // 🔥 PEAK (nur der ausgewählten Plattform)
    let peak = getPeak(selectedData.history, selectedData.stats, selectedPlatform);
    const peakMMR = peak?.mmr || rankedProfile.max_rank_points || currentMMR;
    const peakRank = peak?.rank || getRankFromMMR(peakMMR).name;

    // ================================
    // Ergebnis-Objekte zusammenstellen
    // ================================
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
      bestRankImg: peak?.image || null,
      bestRankColor: peak?.color || null,
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

    res.setHeader("Cache-Control", "no-store");
    res.json({ ranked, casual });
  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================= */
/* 🔥 SERVER START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
