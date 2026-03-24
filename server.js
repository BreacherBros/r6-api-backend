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
   R6DATA API (RANKED + CASUAL)
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
    const segments = profile?.segments || [];

    const overview = segments.find(s => s.type === "overview");
    const ranked = segments.find(s => s.type === "ranked");

    const val = (obj, key) =>
      obj?.stats?.[key]?.value ??
      obj?.stats?.[key]?.displayValue ??
      null;

    /* =========================
       CASUAL (OVERVIEW)
    ========================= */
    const casualKills = val(overview, "kills");
    const casualDeaths = val(overview, "deaths");

    const casual = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: casualKills,
      deaths: casualDeaths,
      kd: (casualKills && casualDeaths)
        ? (casualKills / casualDeaths).toFixed(2)
        : null,

      wins: val(overview, "wins"),
      losses: val(overview, "losses"),
      level: val(overview, "level"),

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       RANKED
    ========================= */
    const rankedKills = val(ranked, "kills");
    const rankedDeaths = val(ranked, "deaths");

    const rankedData = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: rankedKills,
      deaths: rankedDeaths,
      kd: (rankedKills && rankedDeaths)
        ? (rankedKills / rankedDeaths).toFixed(2)
        : null,

      wins: val(ranked, "wins"),
      losses: val(ranked, "losses"),

      rank: val(ranked, "rankName") || "UNRANKED",
      mmr: val(ranked, "rating")
    };

    /* =========================
       NO CACHE
    ========================= */
    res.setHeader("Cache-Control", "no-store");

    res.json({
      ranked: rankedData,
      casual: casual
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
