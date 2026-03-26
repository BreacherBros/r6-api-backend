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
       🔥 SAFE ROOT
    ========================= */

    let root;

    if (isPC) {
      root = data?.platform_families_full_profiles?.find(p => p.platform_family === "pc");
    } else {
      root = data?.platform_families_full_profiles?.find(p => p.platform_family === "console");
    }

    if (!root) {
      return res.status(404).json({ error: "No platform data" });
    }

    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b =>
      b.board_id === "pvp_ranked" || b.board_id === "ranked"
    );

    const casualBoard = boards.find(b =>
      b.board_id === "pvp_casual" || b.board_id === "standard"
    );

    /* =========================
       🔥 SAFE ACCESS
    ========================= */

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile;
    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics;

    const casualProfile = casualBoard?.full_profiles?.[0]?.profile;
    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics;

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
       🎮 CASUAL
    ========================= */

    const casual = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: casualStats?.kills ?? null,
      deaths: casualStats?.deaths ?? null,
      kd: calcKD(casualStats?.kills, casualStats?.deaths),

      wins: casualStats?.match_outcomes?.wins ?? null,
      losses: casualStats?.match_outcomes?.losses ?? null,

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       🏆 RANKED
    ========================= */

    const ranked = {
      username: nameOnPlatform,
      platform: platformType.toUpperCase(),

      kills: rankedStats?.kills ?? null,
      deaths: rankedStats?.deaths ?? null,
      kd: calcKD(rankedStats?.kills, rankedStats?.deaths),

      wins: rankedStats?.match_outcomes?.wins ?? null,
      losses: rankedStats?.match_outcomes?.losses ?? null,

      rank: getRankName(rankedProfile?.rank),
      mmr: rankedProfile?.rank_points ?? 0
    };

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
