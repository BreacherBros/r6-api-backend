import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

app.use("/api", youtubeRoutes);
app.use("/api", tiktokRoutes);

app.get("/", (req, res) => {
  res.send("Backend running");
});

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

    const isPC = platformType === "uplay";
    const apiPlatform = isPC ? "pc" : platformType;

    const url = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${apiPlatform}&platform_families=console,pc`;

    console.log("REQUEST:", nameOnPlatform, apiPlatform);

    const response = await fetch(url, {
      headers: { "api-key": API_KEY }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Invalid JSON from API",
        preview: text.substring(0, 200)
      });
    }

    if (!response.ok) {
      return res.status(500).json({
        error: "API error",
        details: data
      });
    }

    /* =========================
       ROOT
    ========================= */

    let familyRoot;

    if (isPC) {
      familyRoot = data?.platform_families_full_profiles
        ?.find(p => p.platform_family === "pc");
    } else {
      familyRoot = data?.platform_families_full_profiles
        ?.find(p => p.platform_family === "console");
    }

    if (!familyRoot) {
      familyRoot = data?.platform_families_full_profiles?.[0];
    }

    const boards = familyRoot?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b =>
      b.board_id === "pvp_ranked" || b.board_id === "ranked"
    );

    const casualBoard = boards.find(b =>
      b.board_id === "pvp_casual" || b.board_id === "standard"
    );

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile || null;
    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics || null;

    const casualProfile = casualBoard?.full_profiles?.[0]?.profile || null;
    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics || null;

    const profile = data?.profiles?.[0];
    const stats = profile?.stats || {};

    const get = (key) => stats?.[key]?.value ?? null;

    /* =========================
       HELPERS
    ========================= */

    const calcKD = (k, d) => {
      if (k === null || d === null || d === 0) return null;
      return (k / d).toFixed(2);
    };

    const getRankName = (rank) => {
      if (!rank && rank !== 0) return "UNRANKED";
      if (rank >= 25) return "CHAMPION";
      if (rank >= 20) return "DIAMOND";
      if (rank >= 15) return "EMERALD";
      if (rank >= 10) return "PLATINUM";
      if (rank >= 5) return "GOLD";
      return "SILVER";
    };

    /* =========================
       🎮 CASUAL
    ========================= */

    let casualKills, casualDeaths, casualWins, casualLosses;

    if (isPC) {
      casualKills = casualStats?.kills ?? null;
      casualDeaths = casualStats?.deaths ?? null;
      casualWins = casualStats?.match_outcomes?.wins ?? null;
      casualLosses = casualStats?.match_outcomes?.losses ?? null;
    } else {
      casualKills = casualProfile?.kills ?? get("kills");
      casualDeaths = casualProfile?.deaths ?? get("deaths");
      casualWins = casualProfile?.wins ?? get("matchesWon");
      casualLosses = casualProfile?.losses ?? get("matchesLost");
    }

    const casual = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: casualKills,
      deaths: casualDeaths,
      kd: calcKD(casualKills, casualDeaths),

      wins: casualWins,
      losses: casualLosses,

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       🏆 RANKED
    ========================= */

    let rankedKills, rankedDeaths, rankedWins, rankedLosses;

    if (isPC) {
      rankedKills = rankedStats?.kills ?? null;
      rankedDeaths = rankedStats?.deaths ?? null;
      rankedWins = rankedStats?.match_outcomes?.wins ?? null;
      rankedLosses = rankedStats?.match_outcomes?.losses ?? null;
    } else {
      rankedKills = rankedProfile?.kills ?? null;
      rankedDeaths = rankedProfile?.deaths ?? null;
      rankedWins = rankedProfile?.wins ?? null;
      rankedLosses = rankedProfile?.losses ?? null;
    }

    const ranked = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: rankedKills,
      deaths: rankedDeaths,
      kd: calcKD(rankedKills, rankedDeaths),

      wins: rankedWins,
      losses: rankedLosses,

      rank: getRankName(rankedProfile?.rank),
      mmr: rankedProfile?.rank_points ?? 0
    };

    res.setHeader("Cache-Control", "no-store");

    res.json({ ranked, casual });

  } catch (err) {
    console.error("❌ BACKEND CRASH:", err);

    res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
