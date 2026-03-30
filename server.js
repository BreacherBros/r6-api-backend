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
  const e = CACHE.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) {
    CACHE.delete(key);
    return null;
  }
  return e.data;
}

function setCache(key, data) {
  CACHE.set(key, { data, exp: Date.now() + TTL });
}

/* ============================= */
/* FETCH */
/* ============================= */
async function fetchJson(url, key, headers = {}) {
  const cached = getCache(key);
  if (cached) return cached;

  try {
    const res = await fetch(url, { headers });
    const json = await res.json().catch(() => null);

    const result = { ok: res.ok, json };
    setCache(key, result);

    return result;
  } catch {
    return { ok: false, json: null };
  }
}

/* ============================= */
/* TRACKER PEAK */
/* ============================= */
async function getTrackerPeak(name, platform) {
  if (!TRN_API_KEY) return null;

  try {
    const url = `https://api.tracker.gg/api/v2/r6siege/standard/profile/${platform}/${name}`;
    const res = await fetchJson(url, `trn-${name}`, {
      "TRN-Api-Key": TRN_API_KEY,
    });

    if (!res.ok || !res.json) return null;

    const segments = res.json?.data?.segments || [];

    const lifetime = segments.find((s) => s.type === "overview");

    const peak = lifetime?.stats?.highestRank;

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

  for (const e of arr) {
    const val = e?.[1]?.value;
    if (val > best) best = val;
  }

  return best || null;
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

    const platform = platformMap[platformType];

    /* ============================= */
    /* FETCH DATA */
/* ============================= */
    const statsUrl = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${nameOnPlatform}&platformType=${platform}`;
    const historyUrl = `https://r6data.eu/api/stats?type=history&nameOnPlatform=${nameOnPlatform}&platformType=${platform}`;

const [statsRes, historyRes] = await Promise.all([
  fetchJson(statsUrl, `stats-${nameOnPlatform}-${platform}`),
  fetchJson(historyUrl, `hist-${nameOnPlatform}-${platform}`),
]);

/* 🔥 Tracker NON-BLOCKING */
let trackerPeak = null;

try {
  trackerPeak = await Promise.race([
    getTrackerPeak(nameOnPlatform, platform),
    new Promise((resolve) => setTimeout(() => resolve(null), 1500)), // 1.5s timeout
  ]);
} catch {
  trackerPeak = null;
}

    const stats = statsRes.json;
    const history = historyRes.json;

    const profile =
      stats?.platform_families_full_profiles?.[0]
        ?.board_ids_full_profiles?.[0]?.full_profiles?.[0]?.profile || {};

    const currentMMR = profile.rank_points || 0;

    /* ============================= */
    /* PEAK LOGIC */
/* ============================= */

    const r6Peak = getR6Peak(history);

    let bestMMR = Math.max(r6Peak || 0, trackerPeak?.mmr || 0);

    if (!bestMMR) bestMMR = currentMMR;

    const bestRank =
      trackerPeak?.rank ||
      (bestMMR ? `MMR ${bestMMR}` : "UNRANKED");

    /* ============================= */
    /* RESPONSE */
/* ============================= */
    res.json({
      ranked: {
        username: nameOnPlatform,
        platform: platform.toUpperCase(),

        mmr: currentMMR,
        rank: `MMR ${currentMMR}`,

        bestMMR,
        bestRank,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================= */
/* START */
/* ============================= */
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
