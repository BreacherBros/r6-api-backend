import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

/* ============================= */
/* 🔥 CORS */
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

/* ============================= */
/* 🔥 CACHE */
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
  CACHE.set(key, {
    data,
    exp: Date.now() + TTL,
  });
}

async function fetchCached(url, key) {
  const cached = getCache(key);
  if (cached) return cached;

  try {
    const res = await fetch(url, {
      headers: { "api-key": API_KEY },
    });

    const json = await res.json().catch(() => null);

    const result = {
      ok: res.ok,
      json,
    };

    setCache(key, result);
    return result;
  } catch {
    return { ok: false, json: null };
  }
}

/* ============================= */
/* 🔥 PLATFORM */
/* ============================= */
const PLATFORM_MAP = {
  psn: "psn",
  xbox: "xbl",
  xbl: "xbl",
  pc: "uplay",
  uplay: "uplay",
};

/* ============================= */
/* 🔥 HELPERS */
/* ============================= */
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

  if (tiers[tierIndex] === "CHAMPION") {
    return { name: "CHAMPION", color: "#ff0000" };
  }

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);

  return {
    name: `${tiers[tierIndex]} ${division}`,
    color: "#fff",
  };
};

/* ============================= */
/* 🔥 RANK SCORE */
/* ============================= */
function parseRankLabel(label) {
  if (!label) return null;

  const m = label.toUpperCase().match(
    /(COPPER|BRONZE|SILVER|GOLD|PLATINUM|EMERALD|DIAMOND|CHAMPION)\s?([1-5])?/
  );

  if (!m) return null;

  return {
    tier: m[1],
    division: m[2] ? Number(m[2]) : null,
  };
}

function rankScore(label, mmr) {
  if (!label) label = getRankFromMMR(mmr).name;

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

  const parsed = parseRankLabel(label);
  if (!parsed) return 0;

  const tierIndex = tiers.indexOf(parsed.tier);
  if (tierIndex < 0) return 0;

  if (parsed.tier === "CHAMPION") return 1000;

  const divScore = parsed.division ? 5 - parsed.division : 0;

  return tierIndex * 10 + divScore;
}

/* ============================= */
/* 🔥 PARSE STATS */
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
/* 🔥 HISTORY */
/* ============================= */
function extractHistory(historyJson) {
  return (
    historyJson?.data?.history?.data ||
    historyJson?.history?.data ||
    historyJson?.history ||
    []
  );
}

/* ============================= */
/* 🔥 PEAK LOGIC (FINAL FIX) */
/* ============================= */
function getPeak(historyJson, statsJson, platform) {
  let best = null;

  const check = (mmr, rank) => {
    if (!mmr || !Number.isFinite(mmr)) return;

    const score = rankScore(rank, mmr);

    if (
      !best ||
      score > best.score ||
      (score === best.score && mmr > best.mmr)
    ) {
      best = {
        mmr,
        rank: rank || getRankFromMMR(mmr).name,
        score,
        platform,
      };
    }
  };

  /* 🔥 HISTORY FIRST */
  for (const entry of extractHistory(historyJson)) {
    const p = Array.isArray(entry) ? entry[1] : entry;

    check(
      p?.value ?? p?.mmr ?? p?.rank_points,
      p?.metadata?.rank ?? p?.rank
    );
  }

  /* 🔥 FALLBACK (nur wenn kein History Peak existiert) */
  if (!best) {
    const root = statsJson?.platform_families_full_profiles?.[0];
    const boards = root?.board_ids_full_profiles || [];

    for (const b of boards) {
      if (!["pvp_ranked", "ranked"].includes(b.board_id)) continue;

      for (const s of b.full_profiles || []) {
        const p = s.profile;

        check(
          p?.max_rank_points ?? p?.rank_points,
          p?.max_rank_name ?? p?.rank_name
        );
      }
    }
  }

  return best;
}

/* ============================= */
/* 🔥 API */
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
      fetchCached(statsUrl, `stats-${nameOnPlatform}-${platform}`),
      fetchCached(historyUrl, `hist-${nameOnPlatform}-${platform}`),
    ]);

    if (!statsRes?.json?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsRes.json);

    const currentMMR = rankedProfile.rank_points || 0;
    const currentRank = getRankFromMMR(currentMMR);

    /* 🔥 PEAK FIXED */
    const peak = getPeak(historyRes.json, statsRes.json, platform);

    const peakMMR =
      peak?.mmr ||
      rankedProfile.max_rank_points ||
      currentMMR;

    const peakRank =
      peak?.rank || getRankFromMMR(peakMMR).name;

    const ranked = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      kills: rankedStats.kills ?? rankedProfile.kills ?? 0,
      deaths: rankedStats.deaths ?? rankedProfile.deaths ?? 0,
      kd: calcKD(
        rankedStats.kills ?? rankedProfile.kills,
        rankedStats.deaths ?? rankedProfile.deaths
      ),

      wins:
        rankedStats.match_outcomes?.wins ??
        rankedProfile.wins ??
        0,

      losses:
        rankedStats.match_outcomes?.losses ??
        rankedProfile.losses ??
        0,

      rank: currentRank.name,
      mmr: currentMMR,

      bestRank: peakRank,
      bestMMR: peakMMR,
      bestPlatform: platform,
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

      wins:
        casualStats.match_outcomes?.wins ??
        casualProfile.wins ??
        0,

      losses:
        casualStats.match_outcomes?.losses ??
        casualProfile.losses ??
        0,

      rank: "UNRANKED",
      mmr: null,
    };

    res.json({ ranked, casual });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================= */
/* 🔥 START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
