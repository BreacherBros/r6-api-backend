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
   R6DATA API (SEASONAL FIX)
========================= */
const API_KEY = process.env.API_KEY;

app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const url = `https://r6data.eu/api/stats?type=seasonal&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${platformType}&platform_families=console`;

    const response = await fetch(url, {
      headers: {
        "api-key": API_KEY
      }
    });

  const text = await response.text();

let data;
try {
  data = JSON.parse(text);
} catch (e) {
  console.error("❌ API gibt HTML zurück:");
  console.log(text);

  return res.status(500).json({
    error: "API returned invalid JSON",
    raw: text.substring(0, 200)
  });
}
     console.log("R6DATA RESPONSE:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      return res.status(500).json({
        error: "R6Data API error",
        details: data
      });
    }

    const profile = data?.profiles?.[0];

    /* =========================
       HELPER
    ========================= */
    const get = (obj, key) =>
      obj?.[key]?.value ??
      obj?.[key]?.displayValue ??
      null;

    /* =========================
       CASUAL (GLOBAL STATS)
    ========================= */
    const baseStats = profile?.stats || {};

    const kills = get(baseStats, "kills");
    const deaths = get(baseStats, "deaths");

    const casual = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills,
      deaths,
      kd: (kills && deaths && deaths !== 0)
        ? (kills / deaths).toFixed(2)
        : null,

      wins: get(baseStats, "matchesWon"),
      losses: get(baseStats, "matchesLost"),
      level: get(baseStats, "level"),

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       RANKED (SEASONAL!)
    ========================= */
    const seasons = profile?.seasons || [];

    // 👉 aktuelle Season = erste
    const latest = seasons[0];

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

    if (latest && latest.stats) {
      const s = latest.stats;

      const rKills = get(s, "kills");
      const rDeaths = get(s, "deaths");

      ranked = {
        username: nameOnPlatform,
        platform: platformType.toUpperCase(),

        kills: rKills,
        deaths: rDeaths,
        kd: (rKills && rDeaths && rDeaths !== 0)
          ? (rKills / rDeaths).toFixed(2)
          : null,

        wins: get(s, "matchesWon"),
        losses: get(s, "matchesLost"),

        rank: get(s, "rankName") || "UNRANKED",
        mmr: get(s, "mmr")
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
