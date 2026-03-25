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
   R6DATA API (FINAL CORRECT 🔥)
========================= */
const API_KEY = process.env.API_KEY;

app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: "API KEY missing" });
    }

    // ✅ WICHTIG: SEASONAL
    const url = `https://r6data.eu/api/stats?type=seasonal&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${platformType}&platform_families=console`;

    const response = await fetch(url, {
      headers: {
        "api-key": API_KEY
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "R6Data API error",
        details: data
      });
    }

    const profile = data?.profiles?.[0];

    if (!profile) {
      return res.status(404).json({ error: "Player not found" });
    }

    const username =
      profile?.platformInfo?.platformUserHandle || nameOnPlatform;

    /* =========================
       🔥 SEASONAL (RICHTIG)
    ========================= */
    const seasons = profile?.seasons || [];
    const latest = seasons[0];
    const stats = latest?.stats || {};

    /* =========================
       GLOBAL (CASUAL)
    ========================= */
    const baseStats = profile?.stats || {};

    const get = (obj, key) =>
      obj?.[key]?.value ?? null;

    const calcKD = (k, d) => {
      if (k == null || d == null || d === 0) return null;
      return (k / d).toFixed(2);
    };

    /* =========================
       CASUAL
    ========================= */
    const casualKills = get(baseStats, "kills");
    const casualDeaths = get(baseStats, "deaths");

    const casual = {
      username,
      platform: platformType.toUpperCase(),

      kills: casualKills,
      deaths: casualDeaths,
      kd: calcKD(casualKills, casualDeaths),

      wins: get(baseStats, "matchesWon"),
      losses: get(baseStats, "matchesLost"),
      level: get(baseStats, "level"),

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       RANKED (ECHT)
    ========================= */
    const rankedKills = get(stats, "kills");
    const rankedDeaths = get(stats, "deaths");

    const ranked = {
      username,
      platform: platformType.toUpperCase(),

      kills: rankedKills,
      deaths: rankedDeaths,
      kd: get(stats, "kdRatio") ?? calcKD(rankedKills, rankedDeaths),

      wins: get(stats, "matchesWon"),
      losses: get(stats, "matchesLost"),

      // 🔥 DAS IST DER ECHTE RANK WERT
      mmr: get(stats, "elo"),

      // optional (nur Zahl)
      rank: get(stats, "rank") ?? "UNRANKED"
    };

    /* =========================
       RESPONSE
    ========================= */
    res.setHeader("Cache-Control", "no-store");

    res.json({
      ranked,
      casual
    });

  } catch (err) {
    console.error("❌ Backend Fehler:", err);

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
