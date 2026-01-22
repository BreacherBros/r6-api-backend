import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Tracker.gg API backend running on port", PORT);
});
