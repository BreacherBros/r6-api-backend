import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";
const app = express();

/* =========================
   GLOBAL CORS (FULL OPEN)
========================= */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization", "TRN-Api-Key"]
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
   R6 TRACKER API
========================= */
const TRN_API_KEY = process.env.TRN_API_KEY;
const BASE_URL = "https://public-api.tracker.gg/v2/r6siege/standard/profile";

/**
 * Example:
 * /player?platform=psn&name=Pater_Odor
 * /player?platform=psn&name=SomaRay_Jr
 */
app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;

    if (!platform || !name) {
      return res.status(400).json({ error: "Missing platform or name" });
    }

    const url = `${BASE_URL}/${platform}/${encodeURIComponent(name)}`;

    const response = await fetch(url, {
      headers: {
        "TRN-Api-Key": TRN_API_KEY,
        "accept": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "Tracker API error", details: data });
    }

    // --------- Mapping ---------
    const segments = data.data.segments;

    const overview = segments.find(s => s.type === "overview");
    const ranked = segments.find(s => s.type === "ranked");

    const val = (obj, key) =>
      obj?.stats?.[key]?.displayValue ||
      obj?.stats?.[key]?.value ||
      0;

    const result = {
      username: data.data.platformInfo.platformUserHandle,
      level: val(overview, "level"),
      kd: val(overview, "kd"),
      wins: val(overview, "wins"),
      losses: val(overview, "losses"),
      kills: val(overview, "kills"),
      deaths: val(overview, "deaths"),
      headshots: val(overview, "headshots"),
      rank: val(ranked, "rankName"),
      mmr: val(ranked, "rating")
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
