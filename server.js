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
   R6DATA API (FINAL 🔥 STABLE)
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
       🔥 BOARD DATA
    ========================= */
    const root = data?.platform_families_full_profiles?.[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b => b.board_id === "pvp_ranked");
    const casualBoard = boards.find(b => b.board_id === "pvp_casual");

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile || null;
    const casualProfile = casualBoard?.full_profiles?.[0]?.profile || null;

    /* =========================
       🔥 FALLBACK STATS
    ========================= */
    const stats = profile?.stats || {};

    const get = (key) => stats?.[key]?.value ?? null;

    /* =========================
       HELPERS
    ========================= */
    const calcKD = (k, d) => {
      if (k === null || d === null) return null;
      if (d === 0) return null;
      return (k / d).toFixed(2);
    };

    const getRankName = (rank) => {
      if (!rank) return "UNRANKED";
      if (rank >= 25) return "CHAMPION";
      if (rank >= 20) return "DIAMOND";
      if (rank >= 15) return "EMERALD";
      if (rank >= 10) return "PLATINUM";
      if (rank >= 5) return "GOLD";
      return "SILVER";
    };

    /* =========================
       CASUAL DATA
    ========================= */
    const casualKills = casualProfile?.kills ?? get("kills");
    const casualDeaths = casualProfile?.deaths ?? get("deaths");

    const casual = {
      username,
      platform: platformType.toUpperCase(),

      kills: casualKills,
      deaths: casualDeaths,
      kd: calcKD(casualKills, casualDeaths),

      wins: casualProfile?.wins ?? get("matchesWon"),
      losses: casualProfile?.losses ?? get("matchesLost"),
      level: get("level"),

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       RANKED DATA
    ========================= */
    const rankedKills = rankedProfile?.kills ?? null;
    const rankedDeaths = rankedProfile?.deaths ?? null;

    const ranked = {
      username,
      platform: platformType.toUpperCase(),

      kills: rankedKills,
      deaths: rankedDeaths,
      kd: calcKD(rankedKills, rankedDeaths),

      wins: rankedProfile?.wins ?? null,
      losses: rankedProfile?.losses ?? null,

      rank: getRankName(rankedProfile?.rank),
      mmr: rankedProfile?.rank_points ?? 0
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
