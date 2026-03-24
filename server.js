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
   R6DATA API (FIXED)
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
        "api-key": API_KEY,
        "Content-Type": "application/json"
      }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "API returned invalid JSON",
        details: text.substring(0, 200)
      });
    }

    if (!response.ok) {
      return res.status(500).json({
        error: "R6Data API error",
        details: data
      });
    }

    /* =========================
       OPTIONAL: CLEAN OUTPUT
    ========================= */
    const profile = data?.profiles?.[0];
    const stats = profile?.stats || {};

    const val = (key) =>
      stats?.[key]?.value ?? stats?.[key]?.displayValue ?? null;

    const result = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: val("kills"),
      deaths: val("deaths"),
      kd: val("kd"),

      wins: val("matchesWon"),
      losses: val("matchesLost"),
      level: val("level"),

      rank: val("rank"),
      mmr: val("mmr"),
      maxRank: val("maxRank"),
      maxMmr: val("maxMmr")
    };

    /* =========================
       NO CACHE
    ========================= */
    res.setHeader("Cache-Control", "no-store");

    res.json(result);

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
