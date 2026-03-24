import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

/* =========================
   GLOBAL CORS
========================= */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* =========================
   ROUTES
========================= */
app.use("/api", youtubeRoutes);
app.use("/api", tiktokRoutes);

/* =========================
   ROOT TEST
========================= */
app.get("/", (req, res) => {
  res.send("Backend running");
});

/* =========================
   R6DATA API (FIXED FINAL)
========================= */
const API_KEY = process.env.API_KEY;

app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const url = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${platformType}&platform_families=console`;

    const response = await fetch(url, {
      headers: {
        "api-key": API_KEY
      }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Invalid JSON from API",
        details: text.substring(0, 200)
      });
    }

    if (!response.ok) {
      return res.status(500).json({
        error: "R6Data API error",
        details: data
      });
    }

    const profile = data?.profiles?.[0];
    const stats = profile?.stats || {};
    const segments = profile?.segments || [];

    const rankedSeg = segments.find(s => s.type === "ranked");

    // 🔥 SAFE GET (funktioniert IMMER)
    const get = (obj, key) =>
      obj?.[key]?.value ??
      obj?.[key]?.displayValue ??
      null;

    /* =========================
       CASUAL (BASE = profile.stats)
    ========================= */
    const kills = get(stats, "kills");
    const deaths = get(stats, "deaths");

    const casual = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills,
      deaths,
      kd: (kills && deaths && deaths !== 0)
        ? (kills / deaths).toFixed(2)
        : null,

      wins: get(stats, "matchesWon"),
      losses: get(stats, "matchesLost"),
      level: get(stats, "level"),

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       RANKED (optional)
    ========================= */
    let ranked = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: null,
      deaths: null,
      kd: null,
      wins: null,
      losses: null,

      rank: "UNRANKED",
      mmr: null
    };

    if (rankedSeg && rankedSeg.stats) {
      const rk = rankedSeg.stats;

      const rKills = get(rk, "kills");
      const rDeaths = get(rk, "deaths");

      ranked = {
        username: nameOnPlatform,
        platform: platformType.toUpperCase(),

        kills: rKills,
        deaths: rDeaths,
        kd: (rKills && rDeaths && rDeaths !== 0)
          ? (rKills / rDeaths).toFixed(2)
          : null,

        wins: get(rk, "wins"),
        losses: get(rk, "losses"),

        rank: get(rk, "rankName") || "UNRANKED",
        mmr: get(rk, "rating")
      };
    }

    /* =========================
       NO CACHE
    ========================= */
    res.setHeader("Cache-Control", "no-store");

    res.json({
      ranked,
      casual
    });

  } catch (err) {
    console.error("Backend Fehler:", err);

    res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
