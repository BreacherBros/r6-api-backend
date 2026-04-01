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
const safeNum = (v) => (typeof v === "number" ? v : 0);

const calcKD = (k, d) => {
  if (!k || !d || d === 0) return "0.00";
  return (k / d).toFixed(2);
};

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
    const historyData = historyRes?.json;

    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsData);

    /* ============================= */
    /* CORE STATS */
    /* ============================= */

    const kills = safeNum(
      rankedStats.kills ?? rankedProfile.kills
    );

    const deaths = safeNum(
      rankedStats.deaths ?? rankedProfile.deaths
    );

    const wins = safeNum(
      rankedStats.match_outcomes?.wins ?? rankedProfile.wins
    );

    const losses = safeNum(
      rankedStats.match_outcomes?.losses ?? rankedProfile.losses
    );

    const abandons = safeNum(
      rankedStats.match_outcomes?.abandons ?? rankedProfile.abandon
    );

    const matches = wins + losses;

    const kd = calcKD(kills, deaths);

    const winrate =
      matches > 0 ? ((wins / matches) * 100).toFixed(1) : "0.0";

    const wlRatio =
      losses > 0 ? (wins / losses).toFixed(2) : "0.00";

    const killsPerMatch =
      matches > 0 ? (kills / matches).toFixed(2) : "0.00";

    const deathsPerMatch =
      matches > 0 ? (deaths / matches).toFixed(2) : "0.00";

    const abandonRate =
      matches > 0
        ? ((abandons / matches) * 100).toFixed(1)
        : "0.0";

    const mmr = safeNum(rankedProfile.rank_points);

    /* ============================= */
    /* HISTORY (ULTRA SAFE) */
    /* ============================= */

    let mmrChange = 0;
    let form = "—";
    let last10 = { kd: "0.00", winrate: "0" };

    if (Array.isArray(historyData) && historyData.length > 0) {
      const sorted = historyData
        .filter((g) => g && g.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      if (sorted.length > 1) {
        mmrChange =
          safeNum(sorted.at(-1)?.mmr) -
          safeNum(sorted.at(0)?.mmr);
      }

      const lastGames = sorted.slice(-10);

      let k = 0;
      let d = 0;
      let w = 0;

      const formArray = [];

      for (const g of lastGames) {
        k += safeNum(g.kills);
        d += safeNum(g.deaths);

        if (g.result === "win") {
          w++;
          formArray.push("W");
        } else {
          formArray.push("L");
        }
      }

      form = formArray.join("");

      const total = lastGames.length;

      last10 = {
        kd: d > 0 ? (k / d).toFixed(2) : "0.00",
        winrate:
          total > 0
            ? ((w / total) * 100).toFixed(0)
            : "0",
      };
    }

    /* ============================= */
    /* RESPONSE */
    /* ============================= */

    const ranked = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      mmr,

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

      kills: safeNum(casualStats.kills ?? casualProfile.kills),
      deaths: safeNum(casualStats.deaths ?? casualProfile.deaths),
      kd: calcKD(
        safeNum(casualStats.kills ?? casualProfile.kills),
        safeNum(casualStats.deaths ?? casualProfile.deaths)
      ),

      wins: safeNum(
        casualStats.match_outcomes?.wins ?? casualProfile.wins
      ),
      losses: safeNum(
        casualStats.match_outcomes?.losses ?? casualProfile.losses
      ),

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
