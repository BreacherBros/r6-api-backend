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
   R6DATA API (FIXED FOR FRONTEND)
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
    const segments = profile?.segments || [];

    const overview = segments.find(s => s.type === "overview");
    const rankedSeg = segments.find(s => s.type === "ranked");

    const val = (obj, key) =>
      obj?.stats?.[key]?.displayValue ??
      obj?.stats?.[key]?.value ??
      null;

    /* =========================
       RESPONSE (MATCHT FRONTEND)
    ========================= */
    const result = {
      ranked: {
        username: profile?.platformInfo?.platformUserHandle,
        platform: platformType.toUpperCase(),

        kills: val(rankedSeg, "kills"),
        deaths: val(rankedSeg, "deaths"),
        kd: val(rankedSeg, "kd"),

        wins: val(rankedSeg, "wins"),
        losses: val(rankedSeg, "losses"),

        rank: val(rankedSeg, "rankName") || "UNRANKED",
        mmr: val(rankedSeg, "rating")
      },

      casual: {
        username: profile?.platformInfo?.platformUserHandle,
        platform: platformType.toUpperCase(),

        kills: val(overview, "kills"),
        deaths: val(overview, "deaths"),
        kd: val(overview, "kd"),

        wins: val(overview, "wins"),
        losses: val(overview, "losses"),
        level: val(overview, "level"),

        rank: "UNRANKED",
        mmr: null
      }
    };

    res.setHeader("Cache-Control", "no-store");

    res.json(result);

  } catch (err) {
    console.error("Backend Fehler:", err);

    res.status(500).json({
      error: "Server error"
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
