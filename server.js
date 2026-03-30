import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import youtubeRoutes from "./youtube.js";
import tiktokRoutes from "./tiktok.js";

const app = express();

/* ============================= */
/* CORS */
/* ============================= */
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = [
        "https://breacherbros.com",
        "https://www.breacherbros.com",
      ];
      callback(null, !origin || allowed.includes(origin));
    },
  })
);

app.use(express.json());
app.use("/api", youtubeRoutes);
app.use("/api", tiktokRoutes);

app.get("/", (req, res) => {
  res.send("Backend running");
});

/* ============================= */
/* ENV */
/* ============================= */
const API_KEY = process.env.API_KEY;
const UBI_EMAIL = process.env.UBI_EMAIL;
const UBI_PASSWORD = process.env.UBI_PASSWORD;

/* ============================= */
/* UBISOFT AUTH */
/* ============================= */
let ubiSession = {
  ticket: null,
  expires: 0,
};

async function loginUbisoft() {
  try {
    const basic = Buffer.from(`${UBI_EMAIL}:${UBI_PASSWORD}`).toString("base64");

    const res = await fetch("https://public-ubiservices.ubi.com/v3/profiles/sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Ubi-AppId": "86263886-327a-4328-ac69-527f0d20a237",
        "Content-Type": "application/json",
      },
    });

    const json = await res.json();

    ubiSession.ticket = json.ticket;
    ubiSession.expires = Date.now() + 1000 * 60 * 30;

    console.log("✅ Ubisoft login success");
  } catch (err) {
    console.error("❌ Ubisoft login failed", err);
  }
}

async function getUbiSession() {
  if (!ubiSession.ticket || Date.now() > ubiSession.expires) {
    await loginUbisoft();
  }
  return ubiSession.ticket;
}

/* ============================= */
/* UBISOFT FETCH PEAK */
/* ============================= */
async function fetchUbisoftPeak(username, platform) {
  try {
    const ticket = await getUbiSession();
    if (!ticket) return null;

    // 1. Profil holen
    const profileRes = await fetch(
      `https://public-ubiservices.ubi.com/v2/profiles?nameOnPlatform=${username}&platformType=${platform}`,
      {
        headers: {
          Authorization: `Ubi_v1 t=${ticket}`,
          "Ubi-AppId": "86263886-327a-4328-ac69-527f0d20a237",
        },
      }
    );

    const profileJson = await profileRes.json();
    const profileId = profileJson?.profiles?.[0]?.profileId;

    if (!profileId) return null;

    // 2. Stats holen (inkl. Peak)
    const statsRes = await fetch(
      `https://public-ubiservices.ubi.com/v1/spaces/5172a3e5-9c42-4f7c-b79c-7a7b1c54c6b3/sandboxes/OSBOR_PC_LNCH_A/stats/playerstats2/stattypes/rankPoints?profileIds=${profileId}`,
      {
        headers: {
          Authorization: `Ubi_v1 t=${ticket}`,
          "Ubi-AppId": "86263886-327a-4328-ac69-527f0d20a237",
        },
      }
    );

    const statsJson = await statsRes.json();

    const stats = statsJson?.results?.[profileId];
    if (!stats) return null;

    const maxMMR =
      stats?.max_rank_points ||
      stats?.maxRankPoints ||
      null;

    return maxMMR;
  } catch (err) {
    console.error("❌ Ubisoft peak fetch failed", err);
    return null;
  }
}

/* ============================= */
/* RANK SYSTEM */
/* ============================= */
const TIERS = [
  "COPPER","BRONZE","SILVER","GOLD",
  "PLATINUM","EMERALD","DIAMOND","CHAMPION"
];

function getRankFromMMR(mmr) {
  if (!mmr || mmr <= 0) return "UNRANKED";

  let tier = Math.floor((mmr - 1000) / 500);
  tier = Math.max(0, Math.min(tier, TIERS.length - 1));

  if (TIERS[tier] === "CHAMPION") return "CHAMPION";

  const division = 5 - Math.floor(((mmr - 1000) % 500) / 100);
  return `${TIERS[tier]} ${division}`;
}

/* ============================= */
/* R6DATA FETCH */
/* ============================= */
async function fetchR6Data(name, platform) {
  try {
    const family = platform === "uplay" ? "pc" : "console";

    const url = `https://r6data.eu/api/stats?type=stats&nameOnPlatform=${encodeURIComponent(name)}&platformType=${platform}&platform_families=${family}`;

    const res = await fetch(url, {
      headers: { "api-key": API_KEY },
    });

    const json = await res.json();

    const profile =
      json?.platform_families_full_profiles?.[0]
        ?.board_ids_full_profiles?.find(b =>
          ["pvp_ranked", "ranked"].includes(b.board_id)
        )
        ?.full_profiles?.[0]?.profile || {};

    return {
      mmr: profile.rank_points || 0,
      kills: profile.kills || 0,
      deaths: profile.deaths || 0,
      wins: profile.wins || 0,
      losses: profile.losses || 0,
    };
  } catch {
    return null;
  }
}

/* ============================= */
/* API */
/* ============================= */
app.get("/api/stats", async (req, res) => {
  try {
    const { nameOnPlatform, platformType } = req.query;

    if (!nameOnPlatform || !platformType) {
      return res.status(400).json({ error: "Missing params" });
    }

    const platformMap = {
      psn: "psn",
      xbox: "xbl",
      pc: "uplay",
    };

    const platform = platformMap[platformType.toLowerCase()];
    if (!platform) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    /* 🔥 DATA */
    const r6 = await fetchR6Data(nameOnPlatform, platform);
    const ubiPeak = await fetchUbisoftPeak(nameOnPlatform, platform);

    const currentMMR = r6?.mmr || 0;
    const peakMMR = ubiPeak || currentMMR;

    const ranked = {
      username: nameOnPlatform,
      platform: platform.toUpperCase(),

      kills: r6?.kills,
      deaths: r6?.deaths,
      kd: r6?.deaths ? (r6.kills / r6.deaths).toFixed(2) : null,

      wins: r6?.wins,
      losses: r6?.losses,

      rank: getRankFromMMR(currentMMR),
      mmr: currentMMR,

      /* 💣 FINAL FIX */
      bestRank: getRankFromMMR(peakMMR),
      bestMMR: peakMMR,
    };

    res.json({ ranked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================= */
/* START */
/* ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🔥 Backend running on", PORT);
});
