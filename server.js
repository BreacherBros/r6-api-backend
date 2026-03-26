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

    const apiPlatform = platformType === "uplay" ? "pc" : platformType;

    const url = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${apiPlatform}&platform_families=console,pc`;

    const response = await fetch(url, {
      headers: { "api-key": API_KEY }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "R6Data API error", details: data });
    }

    const profile = data?.profiles?.[0];
    if (!profile) {
      return res.status(404).json({ error: "Player not found" });
    }

    const username =
      profile?.platformInfo?.platformUserHandle || nameOnPlatform;

    /* =========================
       🔥 PLATFORM FIX
    ========================= */

    const platformFamily = apiPlatform === "pc" ? "pc" : "console";

    const root = data?.platform_families_full_profiles
      ?.find(p => p.platform_family === platformFamily);

    const boards = root?.board_ids_full_profiles || [];

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

    /* =========================
       HELPERS
    ========================= */

    const calcKD = (k, d) => {
      if (!k || !d || d === 0) return null;
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
       🎮 CASUAL (FIXED)
    ========================= */

    const casualKills =
      apiPlatform === "pc"
        ? casualStats?.kills
        : casualProfile?.kills;

    const casualDeaths =
      apiPlatform === "pc"
        ? casualStats?.deaths
        : casualProfile?.deaths;

    const casual = {
      username,
      platform: platformType.toUpperCase(),

      kills: casualKills,
      deaths: casualDeaths,
      kd: calcKD(casualKills, casualDeaths),

      wins:
        apiPlatform === "pc"
          ? casualStats?.match_outcomes?.wins
          : casualProfile?.wins,

      losses:
        apiPlatform === "pc"
          ? casualStats?.match_outcomes?.losses
          : casualProfile?.losses,

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       🏆 RANKED (FIXED)
    ========================= */

    const rankedKills =
      apiPlatform === "pc"
        ? rankedStats?.kills
        : rankedProfile?.kills;

    const rankedDeaths =
      apiPlatform === "pc"
        ? rankedStats?.deaths
        : rankedProfile?.deaths;

    const ranked = {
      username,
      platform: platformType.toUpperCase(),

      kills: rankedKills,
      deaths: rankedDeaths,
      kd: calcKD(rankedKills, rankedDeaths),

      wins:
        apiPlatform === "pc"
          ? rankedStats?.match_outcomes?.wins
          : rankedProfile?.wins,

      losses:
        apiPlatform === "pc"
          ? rankedStats?.match_outcomes?.losses
          : rankedProfile?.losses,

      rank: getRankName(rankedProfile?.rank),
      mmr: rankedProfile?.rank_points ?? 0
    };

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
