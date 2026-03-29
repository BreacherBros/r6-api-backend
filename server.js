import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = [
        "https://breacherbros.com",
        "https://www.breacherbros.com",
      ];

      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        console.log("❌ Blocked by CORS:", origin);
        callback(null, true);
      }
    },
  })
);

app.use(express.json());

app.use("/api", youtubeRoutes);
app.use("/api", tiktokRoutes);

app.get("/", (req, res) => {
  res.send("Backend running");
});

const API_KEY = process.env.API_KEY;

/* ============================= */
/* HELPERS */
/* ============================= */
const calcKD = (k, d) => {
  if (!k || !d || d === 0) return null;
  return (k / d).toFixed(2);
};

const getRankName = (rank) => {
  if (rank == null) return "UNRANKED";
  if (rank >= 25) return "CHAMPION";
  if (rank >= 20) return "DIAMOND";
  if (rank >= 15) return "EMERALD";
  if (rank >= 10) return "PLATINUM";
  if (rank >= 5) return "GOLD";
  return "SILVER";
};

const getRankFromMMR = (mmr) => {
  if (!mmr) return { name: "UNRANKED", color: "#888" };

  if (mmr >= 5000) return { name: "CHAMPION", color: "#ff0000" };
  if (mmr >= 4500) return { name: "DIAMOND", color: "#b9f2ff" };
  if (mmr >= 4000) return { name: "EMERALD", color: "#50c878" };
  if (mmr >= 3500) return { name: "PLATINUM", color: "#00bfff" };
  if (mmr >= 3000) return { name: "GOLD", color: "#ffd700" };
  if (mmr >= 2500) return { name: "SILVER", color: "#c0c0c0" };

  return { name: "BRONZE", color: "#cd7f32" };
};

/* ============================= */
/* API */
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
      uplay: "uplay",
    };

    const apiPlatform = platformMap[platformType.toLowerCase()];
    if (!apiPlatform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    const isPC = apiPlatform === "uplay";

    const statsUrl = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${apiPlatform}&platform_families=${isPC ? "pc" : "console"}`;

    const rankUrl = `https://r6data.eu/api/ranks?nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${apiPlatform}`;

    /* 🔥 WICHTIG: beide Requests */
    const [statsRes, rankRes] = await Promise.all([
      fetch(statsUrl, { headers: { "api-key": API_KEY } }),
      fetch(rankUrl, { headers: { "api-key": API_KEY } }),
    ]);

    const statsData = await statsRes.json();
    const rankData = await rankRes.json();

    console.log("🔥 RANK DATA:", rankData);

    if (!statsRes.ok || !statsData?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    /* ============================= */
    /* PARSE */
    /* ============================= */
    const root = statsData.platform_families_full_profiles[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find((b) =>
      ["pvp_ranked", "ranked"].includes(b.board_id)
    );

    const casualBoard = boards.find((b) =>
      ["pvp_casual", "standard"].includes(b.board_id)
    );

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile || {};
    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics || {};

    const casualProfile = casualBoard?.full_profiles?.[0]?.profile || {};
    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics || {};

    /* ============================= */
    /* 🔥 PEAK (ECHT FIX) */
    /* ============================= */
    let peakMMR = null;

    if (Array.isArray(rankData?.data)) {
      peakMMR = Math.max(...rankData.data.map(r => r.max_mmr || 0));
    }

    const peakRank = getRankFromMMR(peakMMR);

    /* ============================= */
    /* OUTPUT */
    /* ============================= */
    const ranked = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),

      kills: rankedStats.kills ?? rankedProfile.kills ?? 0,
      deaths: rankedStats.deaths ?? rankedProfile.deaths ?? 0,
      kd: calcKD(
        rankedStats.kills ?? rankedProfile.kills,
        rankedStats.deaths ?? rankedProfile.deaths
      ),

      wins: rankedStats.match_outcomes?.wins ?? rankedProfile.wins ?? 0,
      losses: rankedStats.match_outcomes?.losses ?? rankedProfile.losses ?? 0,

      rank: getRankName(rankedProfile.rank),
      mmr: rankedProfile.rank_points ?? 0,

      bestRank: peakRank.name,
      bestMMR: peakMMR,
      bestRankColor: peakRank.color,
    };

    const casual = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),

      kills: casualStats.kills ?? casualProfile.kills ?? 0,
      deaths: casualStats.deaths ?? casualProfile.deaths ?? 0,
      kd: calcKD(
        casualStats.kills ?? casualProfile.kills,
        casualStats.deaths ?? casualProfile.deaths
      ),

      wins: casualStats.match_outcomes?.wins ?? casualProfile.wins ?? 0,
      losses: casualStats.match_outcomes?.losses ?? casualProfile.losses ?? 0,

      rank: "UNRANKED",
      mmr: null,
    };

    res.setHeader("Cache-Control", "no-store");
    res.json({ ranked, casual });

  } catch (err) {
    console.error("❌ BACKEND CRASH:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
