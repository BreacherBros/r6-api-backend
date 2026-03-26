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

    console.log("REQUEST:", nameOnPlatform, apiPlatform);

    const response = await fetch(
      `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${apiPlatform}&platform_families=${isPC ? "pc" : "console"}`,
      {
        headers: { "api-key": API_KEY }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "API error",
        details: data
      });
    }

    /* =========================
       ROOT
    ========================= */

    const root = data?.platform_families_full_profiles?.[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b =>
      b.board_id === "pvp_ranked" || b.board_id === "ranked"
    );

    const casualBoard = boards.find(b =>
      b.board_id === "pvp_casual" || b.board_id === "standard"
    );

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile;
    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics;

    const casualProfile = casualBoard?.full_profiles?.[0]?.profile;
    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics;

    const profile = data?.profiles?.[0];
    const stats = profile?.stats || {};

    const get = (key) => stats?.[key]?.value ?? null;

    /* =========================
       HELPERS
    ========================= */

    const calcKD = (k, d) => {
      if (!k || !d || d === 0) return null;
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
       🎮 CASUAL (HYBRID)
    ========================= */

    const casualKills = isPC
      ? casualStats?.kills
      : casualProfile?.kills ?? get("kills");

    const casualDeaths = isPC
      ? casualStats?.deaths
      : casualProfile?.deaths ?? get("deaths");

    const casualWins = isPC
      ? casualStats?.match_outcomes?.wins
      : casualProfile?.wins ?? get("matchesWon");

    const casualLosses = isPC
      ? casualStats?.match_outcomes?.losses
      : casualProfile?.losses ?? get("matchesLost");

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
       🏆 RANKED (HYBRID)
    ========================= */

    const rankedKills = isPC
      ? rankedStats?.kills
      : rankedProfile?.kills;

    const rankedDeaths = isPC
      ? rankedStats?.deaths
      : rankedProfile?.deaths;

    const rankedWins = isPC
      ? rankedStats?.match_outcomes?.wins
      : rankedProfile?.wins;

    const rankedLosses = isPC
      ? rankedStats?.match_outcomes?.losses
      : rankedProfile?.losses;

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
