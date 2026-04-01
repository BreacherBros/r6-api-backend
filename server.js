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

async function fetchJson(url, cacheKey) {
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
    console.error("❌ Fetch error:", error);
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

/* ============================= */
/* HELPERS */
/* ============================= */
const calcKD = (kills, deaths) => {
  if (!kills || !deaths || deaths === 0) return null;
  return (kills / deaths).toFixed(2);
};

const RANK_ORDER = [
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
  if (mmr == null || mmr <= 0) return { name: "UNRANKED" };

  let tierIndex = Math.floor((mmr - 1000) / 500);
  tierIndex = Math.max(0, Math.min(tierIndex, RANK_ORDER.length - 1));

  if (RANK_ORDER[tierIndex] === "CHAMPION") {
    return { name: "CHAMPION" };
  }

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);

  return {
    name: `${RANK_ORDER[tierIndex]} ${division}`,
  };
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

/* ============================= */
/* API */
/* ============================= */
app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
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
      fetchJson(statsUrl, `stats:${nameOnPlatform}:${platform}`),
      fetchJson(historyUrl, `history:${nameOnPlatform}:${platform}`),
    ]);

    if (!statsRes.ok || !statsRes.json) {
      return res.json({ ranked: null, casual: null });
    }

    const statsData = statsRes.json;
    const historyData = historyRes?.json || null;

    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsData);

    const kills =
      rankedStats.kills ?? rankedProfile.kills ?? 0;

    const deaths =
      rankedStats.deaths ?? rankedProfile.deaths ?? 0;

    const wins =
      rankedStats.match_outcomes?.wins ??
      rankedProfile.wins ??
      0;

    const losses =
      rankedStats.match_outcomes?.losses ??
      rankedProfile.losses ??
      0;

    const abandons =
      rankedStats.match_outcomes?.abandons ??
      rankedProfile.abandon ??
      0;

    const matches = wins + losses;

    const kd = calcKD(kills, deaths);

    const winrate =
      matches > 0 ? ((wins / matches) * 100).toFixed(1) : null;

    const wlRatio =
      losses > 0 ? (wins / losses).toFixed(2) : null;

    const killsPerMatch =
      matches > 0 ? (kills / matches).toFixed(2) : null;

    const deathsPerMatch =
      matches > 0 ? (deaths / matches).toFixed(2) : null;

    const abandonRate =
      matches > 0 ? ((abandons / matches) * 100).toFixed(1) : null;

    const currentMMR = rankedProfile.rank_points ?? 0;
    const currentRank = getRankFromMMR(currentMMR);

    /* ============================= */
    /* HISTORY (PRO TRACKER CORE) */
    /* ============================= */

    let mmrChange = null;
    let form = "";
    let last10 = { kd: null, winrate: null };

    if (Array.isArray(historyData)) {
      const sorted = [...historyData].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );

      if (sorted.length > 1) {
        mmrChange =
          sorted[sorted.length - 1].mmr -
          sorted[0].mmr;
      }

      const lastGames = sorted.slice(-10);

      let k = 0;
      let d = 0;
      let w = 0;

      form = lastGames
        .map((g) => {
          if (g.kills) k += g.kills;
          if (g.deaths) d += g.deaths;
          if (g.result === "win") w++;
          return g.result === "win" ? "W" : "L";
        })
        .join("");

      const total = lastGames.length;

      last10 = {
        kd: d > 0 ? (k / d).toFixed(2) : null,
        winrate:
          total > 0 ? ((w / total) * 100).toFixed(0) : null,
      };
    }

    /* ============================= */
    /* RESPONSE */
    /* ============================= */

    const ranked = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      rank: currentRank.name,
      mmr: currentMMR,

      kills,
      deaths,
      kd,

      wins,
      losses,
      matches,
      winrate,

      wlRatio,
      killsPerMatch,
      deathsPerMatch,
      abandonRate,

      mmrChange,
      form,
      last10,
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
