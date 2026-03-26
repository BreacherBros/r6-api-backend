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
   🔥 R6DATA FINAL (CRASH SAFE)
========================= */
const API_KEY = process.env.API_KEY;

const safe = (v) => v ?? null;

app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: "API KEY missing" });
    }

    const url = `https://r6data.eu/api/stats?type=seasonal&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${platformType}&platform_families=console,pc`;

    const response = await fetch(url, {
      headers: { "api-key": API_KEY }
    });

    const data = await response.json();

    if (!response.ok) {
      console.log("API ERROR:", data);
      return res.status(500).json({ error: "R6Data API error" });
    }

    const profile = data?.profiles?.[0];

    const username =
      profile?.platformInfo?.platformUserHandle || nameOnPlatform;

    /* =========================
       🔥 SAFE BOARD HANDLING
    ========================= */

    const root = data?.platform_families_full_profiles?.[0] || {};
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b =>
      b.board_id === "ranked" || b.board_id === "pvp_ranked"
    );

    const casualBoard = boards.find(b =>
      b.board_id === "standard" || b.board_id === "pvp_casual"
    );

    /* =========================
       🔥 SAFE DATA EXTRACTION
    ========================= */

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile || {};
    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics || {};

    const casualProfile = casualBoard?.full_profiles?.[0]?.profile || {};
    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics || {};

    /* =========================
       HELPERS
    ========================= */

    const calcKD = (k, d) => {
      if (!k || !d || d === 0) return null;
      return (k / d).toFixed(2);
    };

    /* =========================
       🎮 CASUAL
    ========================= */

    const casual = {
      username,
      platform: platformType.toUpperCase(),

      kills: safe(casualStats.kills),
      deaths: safe(casualStats.deaths),
      kd: calcKD(casualStats.kills, casualStats.deaths),

      wins: safe(casualStats.match_outcomes?.wins),
      losses: safe(casualStats.match_outcomes?.losses),

      level: null,
      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       🏆 RANKED
    ========================= */

    const ranked = {
      username,
      platform: platformType.toUpperCase(),

      kills: safe(rankedStats.kills),
      deaths: safe(rankedStats.deaths),
      kd: calcKD(rankedStats.kills, rankedStats.deaths),

      wins: safe(rankedStats.match_outcomes?.wins),
      losses: safe(rankedStats.match_outcomes?.losses),

      rank: safe(rankedProfile.rank),
      mmr: safe(rankedProfile.rank_points)
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
    console.error("🔥 SERVER CRASH:", err);

    res.status(500).json({
      error: "Server crash",
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
