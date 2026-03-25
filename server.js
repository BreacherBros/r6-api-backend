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

    if (!API_KEY) {
      return res.status(500).json({ error: "API KEY missing" });
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
        error: "Invalid JSON",
        preview: text.substring(0, 200)
      });
    }

    if (!response.ok) {
      return res.status(500).json({
        error: "API error",
        details: data
      });
    }

    const profile = data?.profiles?.[0];
    const segments = profile?.segments || [];

    const overview = segments.find(s => s.type === "overview");
    const rankedSeg = segments.find(s => s.type === "ranked");

    // 🔥 KORRIGIERTER HELPER
    const get = (obj, key) =>
      obj?.stats?.[key]?.value ??
      obj?.stats?.[key]?.displayValue ??
      null;

    /* =========================
       CASUAL (overview)
    ========================= */
    const kills = get(overview, "kills");
    const deaths = get(overview, "deaths");

    const casual = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills,
      deaths,

      // 🔥 FIX
      kd: get(overview, "kdRatio"),

      wins: get(overview, "matchesWon"),
      losses: get(overview, "matchesLost"),
      level: get(overview, "level"),

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       RANKED
    ========================= */
    const rKills = get(rankedSeg, "kills");
    const rDeaths = get(rankedSeg, "deaths");

    const ranked = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: rKills,
      deaths: rDeaths,

      // 🔥 FIX
      kd: get(rankedSeg, "kdRatio"),

      wins: get(rankedSeg, "matchesWon"),
      losses: get(rankedSeg, "matchesLost"),

      rank: get(rankedSeg, "rankName") || "UNRANKED",
      mmr: get(rankedSeg, "rating")
    };

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
