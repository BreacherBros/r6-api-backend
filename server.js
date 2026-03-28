import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const delay = (ms) => new Promise(res => setTimeout(res, ms));
await delay(300);

const app = express();

/* ============================= */
/* 🔥 CORS */
/* ============================= */
app.use(cors({
  origin: function (origin, callback) {
    const allowed = [
      "https://breacherbros.com",
      "https://www.breacherbros.com"
    ];

    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      console.log("❌ Blocked by CORS:", origin);
      callback(null, true);
    }
  },
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

/* ============================= */
/* 🔥 HIGHEST RANK FUNCTION */
/* ============================= */
function getHighestRank(history) {
  if (!history || !Array.isArray(history)) return null;

  let best = null;

  for (const entry of history) {
    const data = entry[1];

    if (!data || typeof data.value !== "number") continue;

    if (!best || data.value > best.value) {
      best = data;
    }
  }

  if (!best) return null;

  return {
    mmr: best.value,
    rank: best.metadata?.rank || "UNKNOWN",
    image: best.metadata?.imageUrl || null,
    color: best.metadata?.color || "#fff"
  };
}

/* ============================= */
/* 🔥 API */
/* ============================= */
app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: "API KEY missing" });
    }

    const platformMap = {
      psn: "psn",
      xbox: "xbl",
      xbl: "xbl",
      pc: "uplay",
      uplay: "uplay"
    };

    const apiPlatform = platformMap[platformType.toLowerCase()];
    if (!apiPlatform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    const isPC = apiPlatform === "uplay";

    const url = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${apiPlatform}&platform_families=${isPC ? "pc" : "console"}`;

    /* ============================= */
    /* 🔥 MAIN STATS */
    /* ============================= */
    const response = await fetch(url, {
      headers: { "api-key": API_KEY }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(200).json({
        ranked: null,
        casual: null,
        error: "No data found"
      });
    }

    if (!data?.platform_families_full_profiles) {
      return res.status(200).json({
        ranked: null,
        casual: null,
        error: "Invalid API data"
      });
    }

    /* ============================= */
    /* 🔥 HISTORY (PEAK RANK) */
    /* ============================= */
    let bestRank = null;

    try {
const historyUrl = `https://r6data.eu/api/stats?type=history&nameOnPlatform=${encodeURIComponent(nameOnPlatform)}&platformType=${apiPlatform}&platform_families=${isPC ? "pc" : "console"}`;
      
      const historyRes = await fetch(historyUrl, {
        headers: { "api-key": API_KEY }
      });

      const historyJson = await historyRes.json();
     let historyArray = [];

if (historyJson?.data?.history?.data) {
  historyArray = historyJson.data.history.data;
} else if (Array.isArray(historyJson?.data)) {
  historyArray = historyJson.data;
} else {
  console.log("❌ NO HISTORY FOUND:", historyJson);
}
      console.log("HISTORY LENGTH:", historyArray.length);
console.log("FIRST ENTRY:", historyArray[0]);
      

      bestRank = getHighestRank(historyArray);

    } catch (err) {
      console.log("⚠️ History failed (ignore)");
    }

    /* ============================= */
    /* 🔥 DATA PARSING */
    /* ============================= */
    const root = data.platform_families_full_profiles[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b =>
      b.board_id === "pvp_ranked" || b.board_id === "ranked"
    );

    const casualBoard = boards.find(b =>
      b.board_id === "pvp_casual" || b.board_id === "standard"
    );

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile || null;
    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics || null;

    const casualProfile = casualBoard?.full_profiles?.[0]?.profile || null;
    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics || null;

    const calcKD = (k, d) => {
      if (!k || !d || d === 0) return null;
      return (k / d).toFixed(2);
    };

    const getRankName = (rank) => {
      if (rank === null || rank === undefined) return "UNRANKED";
      if (rank >= 25) return "CHAMPION";
      if (rank >= 20) return "DIAMOND";
      if (rank >= 15) return "EMERALD";
      if (rank >= 10) return "PLATINUM";
      if (rank >= 5) return "GOLD";
      return "SILVER";
    };

    /* ============================= */
    /* 🔥 OUTPUT */
    /* ============================= */

    const ranked = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),

      kills: rankedStats?.kills ?? rankedProfile?.kills,
      deaths: rankedStats?.deaths ?? rankedProfile?.deaths,
      kd: calcKD(
        rankedStats?.kills ?? rankedProfile?.kills,
        rankedStats?.deaths ?? rankedProfile?.deaths
      ),

      wins: rankedStats?.match_outcomes?.wins ?? rankedProfile?.wins,
      losses: rankedStats?.match_outcomes?.losses ?? rankedProfile?.losses,

      rank: getRankName(rankedProfile?.rank),
      mmr: rankedProfile?.rank_points ?? 0,

      /* 🔥 NEU: PEAK RANK */
   bestRank: bestRank?.rank || getRankName(rankedProfile?.rank),
bestMMR: bestRank?.mmr || rankedProfile?.rank_points || 0,
bestRankImg: bestRank?.image || null,
bestRankColor: bestRank?.color || "#ffffff"
    };

    const casual = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),

      kills: casualStats?.kills ?? casualProfile?.kills,
      deaths: casualStats?.deaths ?? casualProfile?.deaths,
      kd: calcKD(
        casualStats?.kills ?? casualProfile?.kills,
        casualStats?.deaths ?? casualProfile?.deaths
      ),

      wins: casualStats?.match_outcomes?.wins ?? casualProfile?.wins,
      losses: casualStats?.match_outcomes?.losses ?? casualProfile?.losses,

      rank: "UNRANKED",
      mmr: null
    };

    res.setHeader("Cache-Control", "no-store");

    res.json({ ranked, casual });

  } catch (err) {
    console.error("❌ BACKEND CRASH:", err);

    res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
});

/* ============================= */
/* 🔥 START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
