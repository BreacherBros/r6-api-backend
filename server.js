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
  if (kills == null || deaths == null || deaths === 0) return null;
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

const RANK_COLORS = {
  COPPER: "#a52019",
  BRONZE: "#a97142",
  SILVER: "#c0c0c0",
  GOLD: "#ffd700",
  PLATINUM: "#4fc3f7",
  EMERALD: "#00ff88",
  DIAMOND: "#00e5ff",
  CHAMPION: "#ff0000",
};

function getRankFromMMR(mmr) {
  if (mmr == null || mmr <= 0) return { name: "UNRANKED", color: "#888" };

  let tierIndex = Math.floor((mmr - 1000) / 500);
  tierIndex = Math.max(0, Math.min(tierIndex, RANK_ORDER.length - 1));

  if (RANK_ORDER[tierIndex] === "CHAMPION") {
    return { name: "CHAMPION", color: RANK_COLORS.CHAMPION };
  }

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);

  return {
    name: `${RANK_ORDER[tierIndex]} ${division}`,
    color: RANK_COLORS[RANK_ORDER[tierIndex]] || "#fff",
  };
}

function parseRankLabel(label) {
  if (typeof label !== "string") return null;

  const clean = label.trim().toUpperCase();
  const match = clean.match(
    /^(COPPER|BRONZE|SILVER|GOLD|PLATINUM|EMERALD|DIAMOND|CHAMPION)\s*([1-5])?$/
  );

  if (!match) return null;

  return {
    tier: match[1],
    division: match[2] ? Number(match[2]) : null,
  };
}

function formatRankLabel(label, mmr) {
  const parsed = parseRankLabel(label);
  if (parsed) {
    if (parsed.tier === "CHAMPION") return "CHAMPION";
    if (parsed.division == null) return parsed.tier;
    return `${parsed.tier} ${parsed.division}`;
  }

  if (typeof label === "string" && label.trim()) {
    return label.trim().toUpperCase();
  }

  return getRankFromMMR(mmr).name;
}

function rankScoreFromLabel(label) {
  const parsed = parseRankLabel(label);
  if (!parsed) return null;

  const tierIndex = RANK_ORDER.indexOf(parsed.tier);
  if (tierIndex < 0) return null;

  if (parsed.tier === "CHAMPION") return 1000;

  const divisionScore = parsed.division ? 5 - parsed.division : 0;
  return tierIndex * 10 + divisionScore;
}

function rankColorFromLabel(label) {
  const parsed = parseRankLabel(label);
  if (!parsed) return null;
  return RANK_COLORS[parsed.tier] || null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
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
    rankedBoard,
    casualBoard,
  };
}

/* ============================= */
/* PEAK SOURCES */
/* ============================= */
function extractHistoryArray(historyJson) {
  if (!historyJson) return [];

  if (Array.isArray(historyJson)) return historyJson;
  if (Array.isArray(historyJson?.data?.history?.data)) return historyJson.data.history.data;
  if (Array.isArray(historyJson?.data?.history)) return historyJson.data.history;
  if (Array.isArray(historyJson?.history?.data)) return historyJson.history.data;
  if (Array.isArray(historyJson?.history)) return historyJson.history;

  return [];
}

function extractPeakCandidatesFromHistory(historyJson, platform) {
  const candidates = [];

  for (const entry of extractHistoryArray(historyJson)) {
    const p = Array.isArray(entry) ? entry?.[1] : entry;
    if (!p || typeof p !== "object") continue;

    const mmr = firstNumber(
      p?.value,
      p?.mmr,
      p?.rank_points,
      p?.rankPoints,
      p?.max_rank_points,
      p?.maxRankPoints,
      p?.peak_mmr,
      p?.peakMmr,
      p?.elo
    );

    if (mmr == null || mmr <= 0) continue;

    const label = formatRankLabel(
      firstString(
        p?.metadata?.rank,
        p?.rank_name,
        p?.rankName,
        p?.rank
      ),
      mmr
    );

    const score =
      rankScoreFromLabel(label) ??
      rankScoreFromLabel(getRankFromMMR(mmr).name) ??
      0;

    candidates.push({
      mmr,
      rank: label,
      score,
      color:
        firstString(p?.metadata?.color, p?.color) ||
        rankColorFromLabel(label) ||
        getRankFromMMR(mmr).color,
      image:
        firstString(p?.metadata?.imageUrl, p?.imageUrl, p?.image) || null,
      platform,
    });
  }

  return candidates;
}

function extractPeakCandidatesFromSeasonBoards(statsJson, platform) {
  const candidates = [];

  const root = statsJson?.platform_families_full_profiles?.[0];
  const boards = root?.board_ids_full_profiles || [];

  const rankedBoard = boards.find((b) =>
    ["pvp_ranked", "ranked"].includes(b.board_id)
  );

  if (!rankedBoard?.full_profiles?.length) return candidates;

  for (const season of rankedBoard.full_profiles) {
    const p = season?.profile || {};
    if (!p || typeof p !== "object") continue;

    const mmr = firstNumber(
      p?.max_rank_points,
      p?.maxRankPoints,
      p?.rank_points,
      p?.rankPoints
    );

    if (mmr == null || mmr <= 0) continue;

    const label = formatRankLabel(
      firstString(
        p?.max_rank_name,
        p?.maxRankName,
        p?.rank_name,
        p?.rankName,
        p?.metadata?.rank
      ),
      mmr
    );

    const score =
      rankScoreFromLabel(label) ??
      rankScoreFromLabel(getRankFromMMR(mmr).name) ??
      0;

    candidates.push({
      mmr,
      rank: label,
      score,
      color:
        firstString(p?.metadata?.color, p?.color) ||
        rankColorFromLabel(label) ||
        getRankFromMMR(mmr).color,
      image:
        firstString(p?.metadata?.imageUrl, p?.imageUrl, p?.image) || null,
      platform,
    });
  }

  return candidates;
}

function extractPeakCandidatesFromTopLevelStats(statsJson, platform) {
  const candidates = [];

  const topLevelStats = statsJson?.profiles?.[0]?.stats || {};
  const mmr = firstNumber(
    topLevelStats?.maxRankPoints,
    topLevelStats?.max_rank_points,
    topLevelStats?.rankPoints,
    topLevelStats?.rank_points
  );

  if (mmr != null && mmr > 0) {
    const label = formatRankLabel(
      firstString(
        topLevelStats?.maxRankName,
        topLevelStats?.max_rank_name,
        topLevelStats?.rankName,
        topLevelStats?.rank_name
      ),
      mmr
    );

    const score =
      rankScoreFromLabel(label) ??
      rankScoreFromLabel(getRankFromMMR(mmr).name) ??
      0;

    candidates.push({
      mmr,
      rank: label,
      score,
      color:
        rankColorFromLabel(label) ||
        getRankFromMMR(mmr).color,
      image: null,
      platform,
    });
  }

  return candidates;
}

function getBestPeakFromSources(sources, platform) {
  const allCandidates = [];

  for (const source of sources) {
    if (!source) continue;

    allCandidates.push(
      ...extractPeakCandidatesFromHistory(source, platform),
      ...extractPeakCandidatesFromSeasonBoards(source, platform),
      ...extractPeakCandidatesFromTopLevelStats(source, platform)
    );
  }

  if (!allCandidates.length) return null;

  allCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.mmr || 0) - (a.mmr || 0);
  });

  return allCandidates[0];
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

    if (!statsData?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    const topLevelStats = statsData?.profiles?.[0]?.stats || {};

    const {
      rankedProfile,
      rankedStats,
      casualProfile,
      casualStats,
    } = parseStats(statsData);

    const currentMMR =
      rankedProfile.rank_points ??
      rankedProfile.rankPoints ??
      rankedProfile.elo ??
      topLevelStats.rankPoints ??
      0;

    const currentRank = getRankFromMMR(currentMMR);

    /* ============================= */
    /* PEAK: nur die gewählte Plattform */
    /* ============================= */
   

/* ============================= */
/* START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
