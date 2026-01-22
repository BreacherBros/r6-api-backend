import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

// Health check
app.get("/", (req, res) => {
  res.json({ status: "R6 API Backend running" });
});

// Player stats endpoint
app.get("/player", async (req, res) => {
  const { platform, name } = req.query;

  if (!platform || !name) {
    return res.status(400).json({ error: "Missing platform or name" });
  }

  try {
    const url = `https://rainbow-six-datahub.p.rapidapi.com/player/${platform}/${encodeURIComponent(name)}`;

    const response = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": 6a1c50517dmsh8b615905bae326ep13026fjsnb7ce03bf48e2,
        "X-RapidAPI-Host": "rainbow-six-datahub.p.rapidapi.com"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: "API Error", details: text });
    }

    const data = await response.json();

    // 🔥 Normalisierte Datenstruktur
    const normalized = {
      username: data.username,
      platform: data.platform,
      level: data.level,
      rank: data.rank?.name || "Unranked",
      rank_points: data.rank?.mmr || 0,
      kd: data.stats?.kd || 0,
      winrate: data.stats?.winrate || 0,
      matches: data.stats?.matches || 0,
      wins: data.stats?.wins || 0,
      losses: data.stats?.losses || 0,
      kills: data.stats?.kills || 0,
      deaths: data.stats?.deaths || 0,
      headshots: data.stats?.headshots || 0,
      time_played: data.stats?.timePlayed || 0,
      last_update: new Date().toISOString()
    };

    res.json(normalized);

  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`R6 API running on port ${PORT}`);
});
