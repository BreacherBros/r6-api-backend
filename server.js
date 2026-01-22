import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const RAPID_KEY = process.env.RAPIDAPI_KEY;

// ✅ richtige API
const API_HOST = "rainbow-six.p.rapidapi.com";
const API_BASE = "https://rainbow-six.p.rapidapi.com";

app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;

    if (!platform || !name) {
      return res.status(400).json({ error: "Missing platform or name" });
    }

    const url = `${API_BASE}/profile/${platform}/${encodeURIComponent(name)}`;

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

    // 🔎 DEBUG RAW
    console.log("RAW API DATA:", JSON.stringify(data, null, 2));

    res.json(data); // RAW JSON an Frontend
  } catch (err) {
    res.status(500).json({ error: "Server Error", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API running on port", PORT));
