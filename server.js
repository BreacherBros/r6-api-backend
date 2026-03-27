import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const delay = (ms) => new Promise(res => setTimeout(res, ms));
await delay(300);

const app = express();

// 🔥 CORS FIX
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

    const response = await fetch(url, {
      headers: { "api-key": API_KEY }
    });

    const text = await response.text();
    const data = JSON.parse(text);

    if (!response.ok || !data?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null, error: true });
    }

    const root = data.platform_families_full_profiles[0];
    const boards = root?.board_ids_full_profiles || [];

    const rankedBoard = boards.find(b =>
      b.board_id === "pvp_ranked" || b.board_id === "ranked"
    );

    const casualBoard = boards.find(b =>
      b.board_id === "pvp_casual" || b.board_id === "standard"
    );

    const rankedProfile = rankedBoard?.full_profiles?.[0]?.profile || {};
    const rankedStats = rankedBoard?.full_profiles?.[0]?.season_statistics || {};

    const casualProfile = casualBoard?.full_profiles?.[0]?.profile || {};
    const casualStats = casualBoard?.full_profiles?.[0]?.season_statistics || {};

    const profile = data?.profiles?.[0];
    const stats = profile?.stats || {};

    const get = (key) => stats?.[key]?.value ?? null;

    const calcKD = (k, d) => (!k || !d ? null : (k / d).toFixed(2));
    const calcRate = (a, b) => (!a || !b ? null : ((a / b) * 100).toFixed(1));
    const calcPerMatch = (v, m) => (!v || !m ? null : (v / m).toFixed(2));

    // 🔥 GLOBAL STATS
    const headshots = get("headshots");
    const killsGlobal = get("kills");

    // ---------- CASUAL ----------
    const casualKills = casualStats?.kills ?? casualProfile?.kills ?? get("kills");
    const casualDeaths = casualStats?.deaths ?? casualProfile?.deaths ?? get("deaths");
    const casualWins = casualStats?.match_outcomes?.wins ?? casualProfile?.wins ?? get("matchesWon");
    const casualLosses = casualStats?.match_outcomes?.losses ?? casualProfile?.losses ?? get("matchesLost");

    const casualMatches = (casualWins ?? 0) + (casualLosses ?? 0);

    const casual = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),

      kills: casualKills,
      deaths: casualDeaths,
      kd: calcKD(casualKills, casualDeaths),

      wins: casualWins,
      losses: casualLosses,

      matches: casualMatches,
      kpm: calcPerMatch(casualKills, casualMatches),
      hsRate: calcRate(headshots, killsGlobal),

      rank: "UNRANKED",
      mmr: null
    };

    // ---------- RANKED ----------
    const rankedKills = rankedStats?.kills ?? rankedProfile?.kills;
    const rankedDeaths = rankedStats?.deaths ?? rankedProfile?.deaths;
    const rankedWins = rankedStats?.match_outcomes?.wins ?? rankedProfile?.wins;
    const rankedLosses = rankedStats?.match_outcomes?.losses ?? rankedProfile?.losses;

    const rankedMatches = (rankedWins ?? 0) + (rankedLosses ?? 0);

    const ranked = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),

      kills: rankedKills,
      deaths: rankedDeaths,
      kd: calcKD(rankedKills, rankedDeaths),

      wins: rankedWins,
      losses: rankedLosses,

      matches: rankedMatches,
      kpm: calcPerMatch(rankedKills, rankedMatches),
      hsRate: calcRate(headshots, killsGlobal),

      rank: getRankName(rankedProfile?.rank),
      mmr: rankedProfile?.rank_points ?? 0
    };

    res.setHeader("Cache-Control", "no-store");
    res.json({ ranked, casual });

  } catch (err) {
    console.error("❌ BACKEND CRASH:", err);
    res.status(500).json({ error: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
