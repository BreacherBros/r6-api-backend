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
const safeNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const calcKD = (k, d) => {
  if (!k || !d || d === 0) return "0.00";
  return (k / d).toFixed(2);
};

function parseStats(data) {
  const root = data?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];

  const ranked = boards.find((b) =>
    ["pvp_ranked", "ranked"].includes(String(b.board_id || "").toLowerCase())
  );

  const casual = boards.find((b) =>
    ["pvp_casual", "standard", "casual"].includes(
      String(b.board_id || "").toLowerCase()
    )
  );

  return {
    rankedProfile: ranked?.full_profiles?.[0]?.profile || {},
    rankedStats: ranked?.full_profiles?.[0]?.season_statistics || {},
    casualProfile: casual?.full_profiles?.[0]?.profile || {},
    casualStats: casual?.full_profiles?.[0]?.season_statistics || {},
    rankedBoard: ranked || null,
    casualBoard: casual || null,
  };
}

function extractHistoryArray(historyData) {
  if (Array.isArray(historyData)) return historyData;
  if (Array.isArray(historyData?.data)) return historyData.data;
  if (Array.isArray(historyData?.history)) return historyData.history;
  if (Array.isArray(historyData?.results)) return historyData.results;
  if (Array.isArray(historyData?.items)) return historyData.items;
  return null;
}

function getHistoryDate(entry) {
  return (
    entry?.date ||
    entry?.created_at ||
    entry?.played_at ||
    entry?.match_date ||
    null
  );
}

function getHistoryMMR(entry) {
  return safeNum(
    entry?.mmr ??
      entry?.rank_points ??
      entry?.rankPoints ??
      entry?.rp ??
      entry?.elo ??
      0
  );
}

function getHistoryKills(entry) {
  return safeNum(entry?.kills ?? entry?.kill_count ?? entry?.k ?? 0);
}

function getHistoryDeaths(entry) {
  return safeNum(entry?.deaths ?? entry?.death_count ?? entry?.d ?? 0);
}

function isHistoryWin(entry) {
  if (entry?.result === "win") return true;
  if (entry?.outcome === "win") return true;
  if (entry?.win === true) return true;
  if (entry?.won === true) return true;
  return false;
}

function buildStatsObject({
  username,
  platform,
  profile,
  stats,
  mmrValue,
  rankedMode,
  historySummary,
}) {
  const kills = safeNum(stats.kills ?? profile.kills);
  const deaths = safeNum(stats.deaths ?? profile.deaths);

  const wins = safeNum(
    stats.match_outcomes?.wins ??
      profile.wins ??
      profile.match_outcomes?.wins
  );

  const losses = safeNum(
    stats.match_outcomes?.losses ??
      profile.losses ??
      profile.match_outcomes?.losses
  );

  const abandons = safeNum(
    stats.match_outcomes?.abandons ??
      profile.abandon ??
      profile.match_outcomes?.abandons
  );

  const matches = wins + losses;
  const kd = calcKD(kills, deaths);
  const winrate = matches > 0 ? ((wins / matches) * 100).toFixed(1) : "0.0";
  const wlRatio = losses > 0 ? (wins / losses).toFixed(2) : "0.00";
  const killsPerMatch = matches > 0 ? (kills / matches).toFixed(2) : "0.00";
  const deathsPerMatch = matches > 0 ? (deaths / matches).toFixed(2) : "0.00";
  const abandonRate = matches > 0 ? ((abandons / matches) * 100).toFixed(1) : "0.0";

  return {
    username,
    platform: platform.toUpperCase(),

    rank: rankedMode
      ? mmrValue > 0
        ? `MMR ${mmrValue}`
        : "UNRANKED"
      : "UNRANKED",
    mmr: rankedMode ? mmrValue : null,

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

    mmrChange: historySummary?.mmrChange ?? 0,
    form: historySummary?.form ?? "—",
    last10: historySummary?.last10 ?? { kd: "0.00", winrate: "0" },
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

    const seasonalUrl = `https://r6data.eu/api/stats?type=seasonalStats&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${platform}&platform_families=${family}`;

    const [statsRes, historyRes, seasonalRes] = await Promise.all([
      fetchJson(statsUrl, `stats:${nameOnPlatform}:${platform}`),
      fetchJson(historyUrl, `history:${nameOnPlatform}:${platform}`),
      fetchJson(seasonalUrl, `seasonal:${nameOnPlatform}:${platform}`),
    ]);

    if (!statsRes.ok || !statsRes.json) {
      return res.json({ ranked: null, casual: null });
    }

    const statsData = statsRes.json;
    const historyData = historyRes?.json || null;
    const seasonalData = seasonalRes?.json || null;

    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsData);

    const currentMMR = safeNum(
      rankedProfile.rank_points ??
        rankedProfile.rankPoints ??
        rankedProfile.elo ??
        statsData?.profiles?.[0]?.stats?.rankPoints ??
        0
    );

    /* ============================= */
    /* HISTORY / FORM */
    /* ============================= */
    let historySummary = {
      mmrChange: 0,
      form: "—",
      last10: { kd: "0.00", winrate: "0" },
    };

    const historyArray = extractHistoryArray(historyData);

    if (historyArray && historyArray.length > 0) {
      const sorted = historyArray
        .filter((g) => g && getHistoryDate(g))
        .sort(
          (a, b) => new Date(getHistoryDate(a)) - new Date(getHistoryDate(b))
        );

      if (sorted.length > 1) {
        historySummary.mmrChange =
          getHistoryMMR(sorted.at(-1)) - getHistoryMMR(sorted[0]);
      }

      const lastGames = sorted.slice(-10);

      let k = 0;
      let d = 0;
      let w = 0;
      const formArray = [];

      for (const g of lastGames) {
        k += getHistoryKills(g);
        d += getHistoryDeaths(g);

        const win = isHistoryWin(g);
        if (win) {
          w++;
          formArray.push("W");
        } else {
          formArray.push("L");
        }
      }

      historySummary.form = formArray.join("");
      const total = lastGames.length;

      historySummary.last10 = {
        kd: d > 0 ? (k / d).toFixed(2) : "0.00",
        winrate: total > 0 ? ((w / total) * 100).toFixed(0) : "0",
      };
    }

    /* ============================= */
    /* OPTIONAL SEASONAL EXTRA */
    /* ============================= */
    const seasonalRoot =
      seasonalData?.platform_families_full_profiles?.[0] ||
      seasonalData?.profiles?.[0] ||
      null;

    const seasonalBoard =
      seasonalRoot?.board_ids_full_profiles?.find((b) =>
        ["ranked", "pvp_ranked", "standard", "pvp_casual", "casual"].includes(
          String(b.board_id || "").toLowerCase()
        )
      ) || null;

    const seasonalProfile = seasonalBoard?.full_profiles?.[0]?.profile || {};
    const seasonalStats =
      seasonalBoard?.full_profiles?.[0]?.season_statistics || {};

    /* ============================= */
    /* RESPONSE */
    /* ============================= */
    const ranked = buildStatsObject({
      username: nameOnPlatform,
      platform,
      profile: rankedProfile,
      stats: rankedStats,
      mmrValue: currentMMR,
      rankedMode: true,
      historySummary,
    });

    ranked.seasonal = {
      kills: safeNum(seasonalStats.kills ?? seasonalProfile.kills),
      deaths: safeNum(seasonalStats.deaths ?? seasonalProfile.deaths),
      wins: safeNum(seasonalStats.match_outcomes?.wins ?? seasonalProfile.wins),
      losses: safeNum(
        seasonalStats.match_outcomes?.losses ?? seasonalProfile.losses
      ),
      rankPoints: safeNum(
        seasonalProfile.rank_points ?? seasonalProfile.rankPoints
      ),
    };

    ranked.metrics = {
      matches: ranked.matches,
      kd: ranked.kd,
      winrate: ranked.winrate,
      wlRatio: ranked.wlRatio,
      killsPerMatch: ranked.killsPerMatch,
      deathsPerMatch: ranked.deathsPerMatch,
      abandonRate: ranked.abandonRate,
      mmrChange: ranked.mmrChange,
    };

    const casual = buildStatsObject({
      username: nameOnPlatform,
      platform,
      profile: casualProfile,
      stats: casualStats,
      mmrValue: 0,
      rankedMode: false,
      historySummary: {
        mmrChange: 0,
        form: "—",
        last10: { kd: "0.00", winrate: "0" },
      },
    });

    casual.metrics = {
      matches: casual.matches,
      kd: casual.kd,
      winrate: casual.winrate,
      wlRatio: casual.wlRatio,
      killsPerMatch: casual.killsPerMatch,
      deathsPerMatch: casual.deathsPerMatch,
      abandonRate: casual.abandonRate,
      mmrChange: 0,
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
