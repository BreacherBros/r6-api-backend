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
   R6DATA API (FINAL FIXED 🔥)
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

    const profile = data?.profiles?.[0];

    if (!profile) {
      return res.status(404).json({ error: "Player not found" });
    }

    const username =
      profile?.platformInfo?.platformUserHandle || nameOnPlatform;

    /* =========================
       🔥 BOARD DATA (PRIMARY)
    ========================= */
    const root = data?.platform_families_full_profiles?.[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b => b.board_id === "pvp_ranked");
    const casualBoard = boards.find(b => b.board_id === "pvp_casual");

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile;
    const casualProfile = casualBoard?.full_profiles?.[0]?.profile;

    /* =========================
       🔥 FALLBACK (IMMER DA)
    ========================= */
    const stats = profile?.stats || {};

    const get = (key) => stats?.[key]?.value ?? null;

    /* =========================
       HELPER
    ========================= */
    const calcKD = (k, d) =>
      (k && d && d !== 0) ? (k / d).toFixed(2) : null;

    /* =========================
       CASUAL
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
       RANKED
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

      rank: rankedProfile?.rank ?? "UNRANKED",
      mmr: rankedProfile?.rank_points ?? null
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
