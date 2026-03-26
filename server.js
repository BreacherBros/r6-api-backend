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

const calcKD = (k, d) => {
  if (!k || !d || d === 0) return null;
  return (k / d).toFixed(2);
};

app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const apiPlatform = platformType === "uplay" ? "pc" : platformType;
    const platformFamily = apiPlatform === "pc" ? "pc" : "console";

    const url = `https://r6data.eu/api/stats?type=seasonal&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${apiPlatform}&platform_families=${platformFamily}`;

    const response = await fetch(url, {
      headers: { "api-key": API_KEY }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "API error", details: data });
    }

    const profile = data?.profiles?.[0];
    const username =
      profile?.platformInfo?.platformUserHandle || nameOnPlatform;

    /* =========================
       🔥 PLATFORM ROOT FIX
    ========================= */

    const root = data?.platform_families_full_profiles
      ?.find(p => p.platform_family === platformFamily) || {};

    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b =>
      b.board_id === "ranked" || b.board_id === "pvp_ranked"
    );

    const casualBoard = boards.find(b =>
      b.board_id === "standard" || b.board_id === "pvp_casual"
    );

    /* =========================
       🔥 RANKED ONLY (NO MIX)
    ========================= */

    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics;
    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile;

    const ranked = {
      username,
      platform: platformType.toUpperCase(),

      kills: rankedStats?.kills ?? null,
      deaths: rankedStats?.deaths ?? null,
      kd: calcKD(rankedStats?.kills, rankedStats?.deaths),

      wins: rankedStats?.match_outcomes?.wins ?? null,
      losses: rankedStats?.match_outcomes?.losses ?? null,

      rank: rankedProfile?.rank ?? null,
      mmr: rankedProfile?.rank_points ?? null
    };

    /* =========================
       🔥 CASUAL ONLY
    ========================= */

    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics;

    const casual = {
      username,
      platform: platformType.toUpperCase(),

      kills: casualStats?.kills ?? null,
      deaths: casualStats?.deaths ?? null,
      kd: calcKD(casualStats?.kills, casualStats?.deaths),

      wins: casualStats?.match_outcomes?.wins ?? null,
      losses: casualStats?.match_outcomes?.losses ?? null,

      rank: "UNRANKED",
      mmr: null
    };

    res.json({ ranked, casual });

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
