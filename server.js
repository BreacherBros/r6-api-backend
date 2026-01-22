import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

// ---------- Utils ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fake Browser Headers (Anti-Bot)
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://r6.tracker.network/"
};

// ---------- Cache ----------
const CACHE = {};
const CACHE_TIME = 30 * 1000; // 30 Sekunden

function getCache(key) {
  if (!CACHE[key]) return null;
  if (Date.now() - CACHE[key].time > CACHE_TIME) return null;
  return CACHE[key].data;
}

function setCache(key, data) {
  CACHE[key] = { time: Date.now(), data };
}

// ---------- Scraper ----------
async function scrapePlayer(platform, name) {
  const url = `https://r6.tracker.network/profile/${platform}/${encodeURIComponent(name)}`;

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error("Tracker blocked request");

  const html = await res.text();
  const $ = cheerio.load(html);

  // Username
  const username = $("h1").first().text().trim();

  // Level
  const level = $('div:contains("Level")').next().text().trim();

  // Rank + MMR
  const rankText = $('div:contains("Rank")').next().text().trim();

  // KD
  const kd = $('div:contains("K/D")').next().text().trim();

  // Wins / Losses
  const wl = $('div:contains("Wins")').next().text().trim();

  // Kills / Deaths
  const kdRaw = $('div:contains("Kills")').next().text().trim();

  // Headshots
  const hs = $('div:contains("Headshots")').next().text().trim();

  return {
    username,
    level,
    rank: rankText,
    kd,
    wins_losses: wl,
    kills_deaths: kdRaw,
    headshots: hs,
    platform
  };
}

// ---------- API ----------
app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;
    if (!platform || !name)
      return res.status(400).json({ error: "Missing platform or name" });

    const cacheKey = `${platform}:${name}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    await sleep(800); // Anti-ban delay

    const data = await scrapePlayer(platform, name);
    setCache(cacheKey, data);

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: "Scraper Error",
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log("R6 Scraper API running on port", PORT);
});
