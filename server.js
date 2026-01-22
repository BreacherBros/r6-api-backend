import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const RAPID_KEY = process.env.RAPIDAPI_KEY;

// Base URL der richtigen API (WIRD ANGEPASST NACH API WAHL)
const API_HOST = "rainbow-six-api.p.rapidapi.com";
const API_BASE = "https://rainbow-six-api.p.rapidapi.com";

app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;

    if (!platform || !name) {
      return res.status(400).json({ error: "Missing platform or name" });
    }

    const url = `${API_BASE}/player/${platform}/${encodeURIComponent(name)}`;

    const response = await fetch(url, {
      headers: {
        "x-rapidapi-key": RAPID_KEY,
        "x-rapidapi-host": API_HOST
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "API Error", details: data });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server Error", details: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("R6 API Backend Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API running on port", PORT));
