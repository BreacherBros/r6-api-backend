import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";   // <<< FIX
import cors from "cors";

const app = express();
app.use(cors());

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Accept: "text/html",
};

async function scrapePlayer(platform, name) {
  const url = `https://r6.tracker.network/profile/${platform}/${encodeURIComponent(name)}`;

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error("Tracker blocked request");

  const html = await res.text();
  const $ = cheerio.load(html);

  const grab = (label) => {
    const el = $(`div:contains("${label}")`).first().parent();
    if (!el || !el.text()) return null;
    return el.text().replace(label, "").trim();
  };

  const username =
    $('meta[property="og:title"]').attr("content")?.split(" | ")[0] ||
    $("h1").first().text().trim();

  const level = grab("Level");
  const rank = grab("Rank");
  const kd = grab("K/D");
  const wins = grab("Wins");
  const losses = grab("Losses");
  const kills = grab("Kills");
  const deaths = grab("Deaths");
  const headshots = grab("Headshots");

  return {
    username: username || name,
    level: level || "N/A",
    rank: rank || "Unranked",
    kd: kd || "0.00",
    wins: wins || "0",
    losses: losses || "0",
    kills: kills || "0",
    deaths: deaths || "0",
    headshots: headshots || "0",
    platform,
  };
}

app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;
    if (!platform || !name)
      return res.status(400).json({ error: "Missing platform or name" });

    const data = await scrapePlayer(platform, name);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Scrape failed", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("R6 Tracker Scraper running on", PORT));
