import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

/* =========================
   GLOBAL CORS
========================= */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

/* =========================
   ROUTES
========================= */
app.use("/api", youtubeRoutes);
app.use("/api", tiktokRoutes);

/* =========================
   ROOT TEST
========================= */
app.get("/", (req, res) => {
  res.send("Backend running");
});

/* =========================
   R6DATA API (SAFE + WORKING STYLE)
========================= */
const API_KEY = process.env.API_KEY;

const safe = (v, fallback = null) => (v !== undefined && v !== null ? v : fallback);

const getStatValue = (obj, key) =>
  obj?.[key]?.value ?? obj?.[key]?.displayValue ?? null;

const calcKD = (kills, deaths) => {
  if (kills === null || kills === undefined) return null;
  if (deaths === null || deaths === undefined) return null;
  if (deaths === 0) return null;
  return (kills / deaths).toFixed(2);
};

const pickBoard = (boards, ids) =>
  boards.find((b) => ids.includes(b?.board_id));

app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: "API KEY missing" });
    }

    // uplay -> pc, psn -> console
    const apiPlatformType = platformType === "uplay" ? "pc" : platformType;
    const platformFamily = apiPlatformType === "pc" ? "pc" : "console";

    // Wir bleiben bei der Struktur, bei der die Stats vorher kamen
    const url = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(
      nameOnPlatform
    )}&platformType=${apiPlatformType}&platform_families=${platformFamily}`;

    const response = await fetch(url, {
      headers: {
        "api-key": API_KEY,
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Invalid JSON from API",
        preview: text.slice(0, 250),
      });
    }

    if (!response.ok) {
      return res.status(500).json({
        error: "R6Data API error",
        details: data,
      });
    }

    const profile = data?.profiles?.[0];
    const username =
      profile?.platformInfo?.platformUserHandle || nameOnPlatform;

    // Top-Level Stats (wie in der funktionierenden Version)
    const baseStats = profile?.stats || {};

    // Richtige Plattform-Familie in der Antwort suchen
    const familyRoot =
      data?.platform_families_full_profiles?.find(
        (pf) => pf?.platform_family === platformFamily
      ) ||
      data?.platform_families_full_profiles?.[0] ||
      {};

    const boards = familyRoot?.board_ids_full_profiles || [];

    // Board-IDs flexibel abfangen (PSN + PC)
    const rankedBoard = pickBoard(boards, ["ranked", "pvp_ranked"]);
    const casualBoard = pickBoard(boards, ["standard", "pvp_casual", "living_game_mode"]);

    const rankedFull = rankedBoard?.full_profiles?.[0] || {};
    const casualFull = casualBoard?.full_profiles?.[0] || {};

    const rankedProfile = rankedFull?.profile || {};
    const rankedStats = rankedFull?.season_statistics || {};

    const casualProfile = casualFull?.profile || {};
    const casualStats = casualFull?.season_statistics || {};

    // --- CASUAL ---
    const casualKills = safe(
      casualStats?.kills ?? getStatValue(baseStats, "kills")
    );
    const casualDeaths = safe(
      casualStats?.deaths ?? getStatValue(baseStats, "deaths")
    );

    const casualWins = safe(
      casualStats?.match_outcomes?.wins ?? getStatValue(baseStats, "matchesWon")
    );
    const casualLosses = safe(
      casualStats?.match_outcomes?.losses ?? getStatValue(baseStats, "matchesLost")
    );

    const casual = {
      username,
      platform: platformType.toUpperCase(),

      kills: casualKills,
      deaths: casualDeaths,
      kd: calcKD(casualKills, casualDeaths),

      wins: casualWins,
      losses: casualLosses,
      level: safe(getStatValue(baseStats, "level")),

      rank: "UNRANKED",
      mmr: null,
    };

    // --- RANKED ---
    const rankedKills = safe(
      rankedStats?.kills ?? getStatValue(baseStats, "kills")
    );
    const rankedDeaths = safe(
      rankedStats?.deaths ?? getStatValue(baseStats, "deaths")
    );

    const rankedWins = safe(
      rankedStats?.match_outcomes?.wins ?? getStatValue(baseStats, "matchesWon")
    );
    const rankedLosses = safe(
      rankedStats?.match_outcomes?.losses ?? getStatValue(baseStats, "matchesLost")
    );

    const ranked = {
      username,
      platform: platformType.toUpperCase(),

      kills: rankedKills,
      deaths: rankedDeaths,
      kd: calcKD(rankedKills, rankedDeaths),

      wins: rankedWins,
      losses: rankedLosses,

      // Rank bleibt numerisch, MMR ist das, was dein Frontend braucht
      rank: safe(rankedProfile?.rank ?? getStatValue(baseStats, "rank")) ?? 0,
      mmr: safe(
        rankedProfile?.rank_points ??
          rankedProfile?.max_rank_points ??
          rankedProfile?.rating ??
          getStatValue(baseStats, "rankPoints") ??
          getStatValue(baseStats, "elo")
      ) ?? 0,
    };

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      ranked,
      casual,
    });
  } catch (err) {
    console.error("❌ Backend Fehler:", err);

    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
