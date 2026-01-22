import express from "express";
import cors from "cors";
import R6 from "r6s-stats-api";

const app = express();
app.use(cors());

app.get("/player", async (req, res) => {
  const { platform, name } = req.query;

  if (!platform || !name) {
    return res.status(400).json({ error: "Missing platform or name" });
  }

  try {
    const general = await R6.general(platform, name);

    const data = {
      name,
      platform,
      level: general.level,
      kd: general.kd,
      kills: general.kills,
      deaths: general.deaths,
      matches: general.matches_played,
      wins: general.wins,
      losses: general.losses,
      winrate: general.win_,
      time_played: general.time_played,
      rank: general.rank || "unranked",
      updated: new Date().toISOString()
    };

    res.json(data);
  } catch (e) {
    res.status(500).json({
      error: "Player not found or API error",
      details: e.toString()
    });
  }
});

app.get("/", (req,res)=>{
  res.send("R6 Stats API running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> {
  console.log("R6 API running on port", PORT);
});
