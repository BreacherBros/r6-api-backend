import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const API_BASE = "https://api.henrikdev.xyz/r6/v1";

app.get("/player", async (req, res) => {
  try {
    const { platform, name } = req.query;

    if (!platform || !name) {
      return res.status(400).json({ error: "Missing platform or name" });
    }

    const url = `${API_BASE}/profile/${platform}/${encodeURIComponent(name)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "API Error", details: data });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server Error", details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("API running on port", PORT));
