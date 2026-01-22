import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const R6DATA_KEY = process.env.R6DATA_KEY;
const BASE_URL = "https://api.r6data.eu";

/**
 * Endpoint:
 * /player?platform=psn&name=Pater_Odor
 * /player?platform=psn&name=SomaRay_Jr
 */
app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;

    if (!platform || !name) {
      return res.status(400).json({ error: "Missing platform or name" });
    }

    // ---- r6data Parameter Mapping ----
    let platformType = platform.toUpperCase(); // PSN, XBOX, PC
    let platformFamilies = "console";          // default

    if (platformType === "PC") platformFamilies = "pc";
    if (platformType === "PSN") platformFamilies = "console";
    if (platformType === "XBOX") platformFamilies = "console";

    const url =
      `${BASE_URL}/api/stats` +
      `?nameOnPlatform=${encodeURIComponent(name)}` +
      `&platformType=${platformType}` +
      `&platform_families=${platformFamilies}` +
      `&type=stats`;

    const response = await fetch(url, {
      headers: {
        "api-key": R6DATA_KEY,
        "accept": "application/json"
      }
    });

    const raw = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "R6DATA API error",
        details: raw
      });
    }

    // --------- AGGREGATION LOGIC ---------
    const family = raw.platform_families_full_profiles?.[0];
    const boards = family?.board_ids_full_profiles || [];

    let kills = 0;
    let deaths = 0;
    let wins = 0;
    let losses = 0;
    let rank = 0;
    let mmr = 0;
    let maxRank = 0;
    let maxMmr = 0;

    for (const board of boards) {
      const profile = board.full_profiles?.[0];
      if (!profile) continue;

      const stats = profile.season_statistics || {};
      const prof = profile.profile || {};

      kills += stats.kills || 0;
      deaths += stats.deaths || 0;
      wins += stats.match_outcomes?.wins || 0;
      losses += stats.match_outcomes?.losses || 0;

      // Ranked specific data
      if (board.board_id === "ranked") {
        rank = prof.rank || 0;
        mmr = prof.rank_points || 0;
        maxRank = prof.max_rank || 0;
        maxMmr = prof.max_rank_points || 0;
      }
    }

    const kd = deaths > 0 ? Number((kills / deaths).toFixed(2)) : 0;

    // --------- FINAL CLEAN JSON ---------
    const data = {
      username: name,
      platform: platformType,
      kills,
      deaths,
      wins,
      losses,
      kd,
      rank,
      mmr,
      maxRank,
      maxMmr
    };

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
});

// ---- Server Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("R6 API backend running on port", PORT);
});
