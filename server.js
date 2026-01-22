import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const R6DATA_KEY = process.env.R6DATA_KEY; // API KEY aus ENV
const BASE_URL = "https://api.r6data.eu";

app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;

    if (!platform || !name) {
      return res.status(400).json({ error: "Missing platform or name" });
    }

    let platformType = platform.toUpperCase();
    let platformFamilies = "console";

    if (platformType === "PC") platformFamilies = "pc";
    if (platformType === "PSN") platformFamilies = "console";
    if (platformType === "XBOX") platformFamilies = "console";

    const url = `https://api.r6data.eu/api/stats` +
      `?nameOnPlatform=${encodeURIComponent(name)}` +
      `&platformType=${platformType}` +
      `&platform_families=${platformFamilies}` +
      `&type=stats`;

    const response = await fetch(url, {
      headers: {
        "api-key": process.env.R6DATA_KEY,
        "accept": "application/json"
      }
    });

    const raw = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "R6DATA API error", details: raw });
    }

    // --------- MAPPING ---------
    const family = raw.platform_families_full_profiles?.[0];
    const boards = family?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b => b.board_id === "ranked");
    const standardBoard = boards.find(b => b.board_id === "standard");

    const rankedProfile = rankedBoard?.full_profiles?.[0];
    const standardProfile = standardBoard?.full_profiles?.[0];

    const rankedStats = rankedProfile?.season_statistics || {};
    const rankedProfileInfo = rankedProfile?.profile || {};

    const kills = rankedStats.kills || 0;
    const deaths = rankedStats.deaths || 0;
    const wins = rankedStats.match_outcomes?.wins || 0;
    const losses = rankedStats.match_outcomes?.losses || 0;

    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills;

    const data = {
      username: name,
      kills,
      deaths,
      wins,
      losses,
      kd,
      rank: rankedProfileInfo.rank || 0,
      mmr: rankedProfileInfo.rank_points || 0,
      maxRank: rankedProfileInfo.max_rank || 0,
      maxMmr: rankedProfileInfo.max_rank_points || 0
    };

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("R6 API running on port", PORT));
