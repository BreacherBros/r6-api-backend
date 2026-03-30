import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";
import dotenv from "dotenv";

dotenv.config();

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

/* ============================= */
/* ENV */
/* ============================= */
const API_KEY = process.env.API_KEY;
const TRN_API_KEY = process.env.TRN_API_KEY;
const UBI_MAIL = process.env.UBI_MAIL;
const UBI_PASSWORD = process.env.UBI_PASSWORD;

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
  CACHE.set(key, {
    data,
    exp: Date.now() + TTL,
  });
}

/* ============================= */
/* SAFE FETCH (mit Timeout) */
/* ============================= */
async function safeFetch(url, options = {}, timeoutMs = 2000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}

async function fetchJson(url, key, headers = {}) {
  const cached = getCache(key);
  if (cached) return cached;

  try {
    const res = await safeFetch(url, { headers }, 2000);
    if (!res) return { ok: false, json: null };

    const json = await res.json().catch(() => null);

    const result = { ok: res.ok, json };
    setCache(key, result);

    return result;
  } catch (err) {
    return { ok: false, json: null };
  }
}

/* ============================= */
/* 🔐 UBISOFT LOGIN */
/* ============================= */
async function ubiLogin() {
  if (!UBI_MAIL || !UBI_PASSWORD) return null;

  try {
    const res = await safeFetch(
      "https://public-ubiservices.ubi.com/v3/profiles/sessions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Ubi-AppId": "86263886-327a-4328-ac69-527f0d20a237",
          Authorization:
            "Basic " +
            Buffer.from(`${UBI_MAIL}:${UBI_PASSWORD}`).toString("base64"),
        },
      },
      3000
    );

    if (!res) return null;

    const json = await res.json().catch(() => null);
    if (!res.ok) return null;

    return {
      ticket: json?.ticket,
      profileId: json?.profileId,
    };
  } catch {
    return null;
  }
}

/* ============================= */
/* 🧪 DEBUG UBISOFT */
/* ============================= */
app.get("/api/test-ubi", async (req, res) => {
  const login = await ubiLogin();

  res.json({
    success: !!login,
    data: login,
  });
});

/* ============================= */
/* TRACKER PEAK */
/* ============================= */
async function getTrackerPeak(name, platform) {
  if (!TRN_API_KEY) return null;

  try {
    const res = await safeFetch(
      `https://api.tracker.gg/api/v2/r6siege/standard/profile/${platform}/${name}`,
      {
        headers: { "TRN-Api-Key": TRN_API_KEY },
      },
      1500
    );

    if (!res) return null;

    const json = await res.json().catch(() => null);
    if (!json) return null;

    const segments = json?.data?.segments || [];
    const overview = segments.find((s) => s.type === "overview");

    const peak = overview?.stats?.highestRank;
    if (!peak) return null;

    return {
      rank: peak.metadata?.rank || peak.displayValue,
      mmr: peak.value || null,
    };
  } catch {
    return null;
  }
}

/* ============================= */
/* R6DATA PEAK */
/* ============================= */
function getR6Peak(history) {
  let best = 0;

  const arr = history?.data?.history?.data || [];

  for (const entry of arr) {
    const val = entry?.[1]?.value;
    if (typeof val === "number" && val > best) {
      best = val;
    }
  }

  return best || null;
}

/* ============================= */
/* RANK CALC */
/* ============================= */
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
  if (!mmr || mmr <= 0) return "UNRANKED";

  let tier = Math.floor((mmr - 1000) / 500);
  tier = Math.max(0, Math.min(tier, TIERS.length - 1));

  if (TIERS[tier] === "CHAMPION") return "CHAMPION";

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);

  return `${TIERS[tier]} ${division}`;
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

    const platformMap = {
      psn: "psn",
      xbox: "xbl",
      pc: "uplay",
    };

    const platform = platformMap[platformType.toLowerCase()];
    if (!platform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    /* ============================= */
    /* FETCH (parallel + safe) */
/* ============================= */
    const statsUrl = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${platform}`;

    const historyUrl = `https://r6data.eu/api/stats?type=history&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${platform}`;

    const [statsRes, historyRes, trackerPeak] = await Promise.all([
      fetchJson(statsUrl, `stats-${nameOnPlatform}-${platform}`),
      fetchJson(historyUrl, `hist-${nameOnPlatform}-${platform}`),
      getTrackerPeak(nameOnPlatform, platform),
    ]);

    const stats = statsRes.json;
    const history = historyRes.json;

    const profile =
      stats?.platform_families_full_profiles?.[0]
        ?.board_ids_full_profiles?.find((b) =>
          ["pvp_ranked", "ranked"].includes(b.board_id)
        )
        ?.full_profiles?.[0]?.profile || {};

    const currentMMR =
      profile.rank_points ||
      profile.rankPoints ||
      profile.elo ||
      0;

    const currentRank = getRankFromMMR(currentMMR);

    /* ============================= */
    /* PEAK LOGIC (FINAL) */
/* ============================= */

    const r6Peak = getR6Peak(history);

    let bestMMR = Math.max(
      r6Peak || 0,
      trackerPeak?.mmr || 0
    );

    if (!bestMMR) bestMMR = currentMMR;

    const bestRank =
      trackerPeak?.rank ||
      getRankFromMMR(bestMMR);

    /* ============================= */
    /* RESPONSE */
/* ============================= */
    res.setHeader("Cache-Control", "no-store");

    res.json({
      ranked: {
        username: nameOnPlatform,
        platform: platform.toUpperCase(),

        mmr: currentMMR,
        rank: currentRank,

        bestMMR,
        bestRank,
        bestSource: trackerPeak ? "tracker" : "r6data",
      },
    });
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
  console.log(`🚀 Backend running on port ${PORT}`);
});
