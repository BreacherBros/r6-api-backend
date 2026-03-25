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
   R6DATA API (FINAL WORKING 🔥)
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
        "api-key": API_KEY
      }
    });

    const data = await response.json();

    const profile = data?.profiles?.[0];
    const username =
      profile?.platformInfo?.platformUserHandle || nameOnPlatform;

    /* =========================
       🔥 BOARD DATA (DAS WICHTIGE)
    ========================= */
    const root = data?.platform_families_full_profiles?.[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b => b.board_id === "pvp_ranked");
    const casualBoard = boards.find(b => b.board_id === "pvp_casual");

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile;
    const casualProfile = casualBoard?.full_profiles?.[0]?.profile;

    /* =========================
       HELPER
    ========================= */
    const calcKD = (k, d) =>
      (k && d && d !== 0) ? (k / d).toFixed(2) : null;

    /* =========================
       RESPONSE (FRONTEND READY)
    ========================= */
    const result = {
      ranked: {
        username,
        platform: platformType.toUpperCase(),

        kills: rankedProfile?.kills ?? null,
        deaths: rankedProfile?.deaths ?? null,
        kd: calcKD(rankedProfile?.kills, rankedProfile?.deaths),

        wins: rankedProfile?.wins ?? null,
        losses: rankedProfile?.losses ?? null,

        rank: rankedProfile?.rank ?? "UNRANKED",
        mmr: rankedProfile?.rank_points ?? null
      },

      casual: {
        username,
        platform: platformType.toUpperCase(),

        kills: casualProfile?.kills ?? null,
        deaths: casualProfile?.deaths ?? null,
        kd: calcKD(casualProfile?.kills, casualProfile?.deaths),

        wins: casualProfile?.wins ?? null,
        losses: casualProfile?.losses ?? null,

        level: null,

        rank: "UNRANKED",
        mmr: null
      }
    };

    res.setHeader("Cache-Control", "no-store");
    res.json(result);

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
