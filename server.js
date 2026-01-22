import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const R6DATA_KEY = process.env.R6DATA_KEY; // API KEY aus ENV
const BASE_URL = "https://api.r6data.eu";

app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;

    if (!platform || !name) {
      return res.status(400).json({ error: "Missing platform or name" });
    }

    // r6data parameter mapping
    let platformType = platform.toUpperCase(); // PSN, XBOX, PC
    let platformFamilies = "console";          // default

    if (platformType === "PC") platformFamilies = "pc";
    if (platformType === "PSN") platformFamilies = "console";
    if (platformType === "XBOX") platformFamilies = "console";

    const url = `https://api.r6data.eu/api/stats` +
      `?nameOnPlatform=${encodeURIComponent(name)}` +
      `&platformType=${platformType}` +
      `&platform_families=${platformFamilies}` +
      `&type=stats`;

    const response = await fetch(url, {
      headers: {
        "api-key": process.env.R6DATA_KEY,
        "accept": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "R6DATA API error", details: data });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("R6 API running on port", PORT));
