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
/* PEAK FROM R6DATA HISTORY */
/* ============================= */
function getHighestRank(historyJson) {
  if (!historyJson) return null;

  let historyArray = [];

  // 🔥 alle möglichen Formate abfangen
  if (Array.isArray(historyJson?.data?.history?.data)) {
    historyArray = historyJson.data.history.data;
  } else if (Array.isArray(historyJson?.data?.history)) {
    historyArray = historyJson.data.history;
  } else if (Array.isArray(historyJson?.history?.data)) {
    historyArray = historyJson.history.data;
  } else if (Array.isArray(historyJson?.history)) {
    historyArray = historyJson.history;
  } else if (Array.isArray(historyJson)) {
    historyArray = historyJson;
  }

  console.log("👉 FINAL HISTORY ARRAY:", historyArray);

  if (!historyArray.length) return null;

  let best = null;

  for (const entry of historyArray) {
    // 🔥 sowohl [timestamp, payload] als auch direkt payload
    const payload = Array.isArray(entry) ? entry[1] : entry;

    const value =
      payload?.value ??
      payload?.mmr ??
      payload?.rank_points ??
      payload?.rating;

    if (typeof value !== "number") continue;

    if (!best || value > best.mmr) {
      best = {
        mmr: value,
        rank:
          payload?.metadata?.rank ||
          payload?.rank ||
          "UNKNOWN",
        image: payload?.metadata?.imageUrl || null,
        color: payload?.metadata?.color || "#ffd700",
      };
    }
  }

  return best;
}
/* ============================= */
/* HELPERS */
/* ============================= */
const calcKD = (k, d) => {
  if (k == null || d == null || d === 0) return null;
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

  const historyUrl = `https://r6data.eu/api/stats?type=seasonalStats&nameOnPlatform=${encodeURIComponent(
  nameOnPlatform
)}&platformType=${apiPlatform}`;

    const [statsRes, historyRes] = await Promise.all([
      fetch(statsUrl, { headers: { "api-key": API_KEY } }),
      fetch(historyUrl, { headers: { "api-key": API_KEY } }).catch(() => null),
    ]);

    const statsData = await statsRes.json();

    if (!statsRes.ok || !statsData?.platform_families_full_profiles) {
      return res.json({ ranked: null, casual: null });
    }

    /* ============================= */
    /* PEAK */
    /* ============================= */
    let bestRank = null;

    if (historyRes) {
      try {
        console.log("🔥 HISTORY STATUS:", historyRes?.status);
        const historyJson = await historyRes.json();
        console.log("🔥 RAW HISTORY FULL:", JSON.stringify(historyJson, null, 2));

        bestRank = getHighestRank(historyJson);
        console.log("🔥 PEAK:", bestRank);
      } catch (e) {
        console.log("⚠️ History parsing failed:", e?.message || e);
      }
    }

    /* ============================= */
    /* PARSE DATA */
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

      bestRank: bestRank?.rank || null,
      bestMMR: bestRank?.mmr || null,
      bestRankImg: bestRank?.image || null,
      bestRankColor: bestRank?.color || null,
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
/* START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
