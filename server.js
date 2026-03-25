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

    const url = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${platformType}&platform_families=console`;

    const response = await fetch(url, {
      headers: {
        "api-key": API_KEY
      }
    });

    const data = await response.json();

    const profile = data?.profiles?.[0];
    const username =
      profile?.platformInfo?.platformUserHandle || nameOnPlatform;

    /* =========================
       BOARD DATA (WICHTIG!)
    ========================= */
    const root = data?.platform_families_full_profiles?.[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b => b.board_id === "pvp_ranked");
    const casualBoard = boards.find(b => b.board_id === "pvp_casual");

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile;
    const casualProfile = casualBoard?.full_profiles?.[0]?.profile;

    const baseStats = profile?.stats || {};

    const calcKD = (k, d) =>
      (k && d && d !== 0) ? (k / d).toFixed(2) : null;

    /* =========================
       CASUAL
    ========================= */
    const casualKills = casualProfile?.kills ?? baseStats?.kills?.value;
    const casualDeaths = casualProfile?.deaths ?? baseStats?.deaths?.value;

    const casual = {
      username,
      platform: platformType.toUpperCase(),

      kills: casualKills,
      deaths: casualDeaths,
      kd: calcKD(casualKills, casualDeaths),

      wins: casualProfile?.wins ?? baseStats?.matchesWon?.value,
      losses: casualProfile?.losses ?? baseStats?.matchesLost?.value,
      level: baseStats?.level?.value,

      rank: "UNRANKED",
      mmr: null
    };

    /* =========================
       RANKED (DAS FUNKTIONIERT!)
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

      // 🔥 DAS IST WICHTIG
      mmr: rankedProfile?.rank_points ?? null,

      // optional
      rank: rankedProfile?.rank ?? null
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
