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

/* ============================= */
/* CACHE */
/* ============================= */
const CACHE_TTL = 30000;
const cache = new Map();

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    exp: Date.now() + CACHE_TTL,
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
/* PLATFORM */
/* ============================= */
const PLATFORM_MAP = {
  psn: "psn",
  xbox: "xbl",
  xbl: "xbl",
  pc: "uplay",
  uplay: "uplay",
};

const ALL_PLATFORMS = ["psn", "xbl", "uplay"];

/* ============================= */
/* HELPERS */
/* ============================= */
const calcKD = (k, d) => {
  if (!k || !d || d === 0) return null;
  return (k / d).toFixed(2);
};

const getRankFromMMR = (mmr) => {
  if (!mmr) return { name: "UNRANKED", color: "#888" };

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

  let i = Math.floor((mmr - 1000) / 500);
  i = Math.max(0, Math.min(i, tiers.length - 1));

  const division =
    i === tiers.length - 1
      ? ""
      : ` ${5 - Math.floor(((mmr - 1000) % 500) / 100)}`;

  return {
    name: `${tiers[i].name}${division}`,
    color: tiers[i].color,
  };
};

const rankScore = (rank) => {
  if (!rank) return 0;

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

  const match = rank.match(/([A-Z]+)\s?([1-5])?/);
  if (!match) return 0;

  const tierIndex = tiers.indexOf(match[1]);
  if (tierIndex === -1) return 0;

  const division = match[2] ? 5 - Number(match[2]) : 0;

  return tierIndex * 10 + division;
};

/* ============================= */
/* PARSE */
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
/* PEAK SYSTEM (PERFEKT) */
/* ============================= */
function extractPeak(history, stats, platform) {
  let best = null;

  const check = (mmr, rank) => {
    if (!mmr) return;

    const score =
      rankScore(rank) ||
      rankScore(getRankFromMMR(mmr).name);

    if (
      !best ||
      score > best.score ||
      (score === best.score && mmr > best.mmr)
    ) {
      best = { mmr, rank, score, platform };
    }
  };

  /* HISTORY FIRST (WICHTIG!) */
  const arr =
    history?.data?.history?.data ||
    history?.history ||
    [];

  for (const e of arr) {
    const p = Array.isArray(e) ? e[1] : e;

    check(
      p?.value || p?.mmr || p?.rank_points,
      p?.metadata?.rank || p?.rank
    );
  }

  /* FALLBACK STATS */
  const root = stats?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];

  for (const b of boards) {
    if (!["pvp_ranked", "ranked"].includes(b.board_id)) continue;

    for (const s of b.full_profiles || []) {
      const p = s.profile;

      check(
        p?.max_rank_points || p?.rank_points,
        p?.max_rank_name || p?.rank_name
      );
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

    const selectedPlatform = PLATFORM_MAP[platformType.toLowerCase()];
    if (!selectedPlatform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    /* 🔥 PARALLEL FETCH */
    const results = await Promise.all(
      ALL_PLATFORMS.map(async (plat) => {
        const family = plat === "uplay" ? "pc" : "console";

        const statsUrl = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(
          nameOnPlatform
        )}&platformType=${plat}&platform_families=${family}`;

        const historyUrl = `https://r6data.eu/api/stats?type=history&nameOnPlatform=${encodeURIComponent(
          nameOnPlatform
        )}&platformType=${plat}`;

        const [stats, history] = await Promise.all([
          fetchCached(statsUrl, `s-${nameOnPlatform}-${plat}`),
          fetchCached(historyUrl, `h-${nameOnPlatform}-${plat}`),
        ]);

        return {
          platform: plat,
          stats: stats.json,
          history: history.json,
        };
      })
    );

    const selected = results.find(
      (r) => r.platform === selectedPlatform
    );

    if (!selected?.stats) {
      return res.json({ ranked: null, casual: null });
    }

    const parsed = parseStats(selected.stats);

    /* CURRENT */
    const currentMMR = parsed.rankedProfile.rank_points || 0;
    const currentRank = getRankFromMMR(currentMMR);

    /* PEAK GLOBAL */
    let peak = null;

    for (const r of results) {
      const p = extractPeak(r.history, r.stats, r.platform);
      if (!p) continue;

      if (
        !peak ||
        p.score > peak.score ||
        (p.score === peak.score && p.mmr > peak.mmr)
      ) {
        peak = p;
      }
    }

    const peakMMR = peak?.mmr || null;
    const peakRank =
      peak?.rank || getRankFromMMR(peakMMR).name;

    /* OUTPUT */
    const ranked = {
      username: nameOnPlatform,
      platform: selectedPlatform.toUpperCase(),

      kills: parsed.rankedStats.kills || 0,
      deaths: parsed.rankedStats.deaths || 0,
      kd: calcKD(
        parsed.rankedStats.kills,
        parsed.rankedStats.deaths
      ),

      wins: parsed.rankedStats.match_outcomes?.wins || 0,
      losses: parsed.rankedStats.match_outcomes?.losses || 0,

      rank: currentRank.name,
      mmr: currentMMR,

      bestRank: peakRank,
      bestMMR: peakMMR,
      bestPlatform: peak?.platform || null,
    };

    const casual = {
      username: nameOnPlatform,
      platform: selectedPlatform.toUpperCase(),

      kills: parsed.casualStats.kills || 0,
      deaths: parsed.casualStats.deaths || 0,
      kd: calcKD(
        parsed.casualStats.kills,
        parsed.casualStats.deaths
      ),

      wins: parsed.casualStats.match_outcomes?.wins || 0,
      losses: parsed.casualStats.match_outcomes?.losses || 0,

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
