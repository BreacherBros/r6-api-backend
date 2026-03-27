import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

// 🔥 CORS FIX (deine Domain + Debug fallback)
app.use(cors({
  origin: function (origin, callback) {
    const allowed = [
      "https://breacherbros.com",
      "https://www.breacherbros.com"
    ];

    // erlaubt auch direkte Aufrufe (Postman / Browser)
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      console.log("❌ Blocked by CORS:", origin);
      callback(null, true); // DEBUG: erstmal trotzdem erlauben
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

    // 🔥 Plattform Mapping (PC FIX)
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

    console.log("🔍 REQUEST:", {
      username: nameOnPlatform,
      platform: apiPlatform,
      url
    });

    const response = await fetch(url, {
      headers: { "api-key": API_KEY }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("❌ INVALID JSON:", text);
      return res.status(500).json({
        error: "Invalid API response",
        raw: text
      });
    }

    if (!response.ok) {
      console.error("❌ API ERROR:", response.status, data);
      return res.status(response.status).json({
        error: "API error",
        details: data
      });
    }

    // 🔥 Kein Crash bei leeren Daten (häufig bei PC)
    if (!data?.platform_families_full_profiles?.length) {
      return res.status(404).json({
        error: "No data found (player missing / private / no stats)"
      });
    }

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

    const profile = data?.profiles?.[0];
    const stats = profile?.stats || {};

    const get = (key) => stats?.[key]?.value ?? null;

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

    const casual = {
      username: nameOnPlatform,
      platform: apiPlatform.toUpperCase(),
      kills: casualStats?.kills ?? casualProfile?.kills ?? get("kills"),
      deaths: casualStats?.deaths ?? casualProfile?.deaths ?? get("deaths"),
      kd: calcKD(
        casualStats?.kills ?? casualProfile?.kills ?? get("kills"),
        casualStats?.deaths ?? casualProfile?.deaths ?? get("deaths")
      ),
      wins: casualStats?.match_outcomes?.wins ?? casualProfile?.wins ?? get("matchesWon"),
      losses: casualStats?.match_outcomes?.losses ?? casualProfile?.losses ?? get("matchesLost"),
      rank: "UNRANKED",
      mmr: null
    };

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
      mmr: rankedProfile?.rank_points ?? 0
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
