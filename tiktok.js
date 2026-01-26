import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// 🔥 HIER deine echte Dataset JSON API URL rein
const DATASET_URL = "https://api.apify.com/v2/datasets/DEINE_DATASET_ID/items?clean=true&format=json";

router.get("/tiktok-latest", async (req, res) => {
  try {
    const r = await fetch(DATASET_URL);
    const data = await r.json();

    console.log("TIKTOK ARRAY:", Array.isArray(data), data.length);

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ 
        error: "No TikTok videos found",
        raw: data
      });
    }

    const video = data[0];

    const id = video.id;
    const caption = video.text || "";
    const thumbnail = video.videoMeta?.coverUrl || null;
    const permalink = video.webVideoUrl || `https://www.tiktok.com/@breacherbros/video/${id}`;

    res.json({
      id,
      caption,
      thumbnail,
      permalink
    });

  } catch (err) {
    res.status(500).json({
      error: "TikTok API error",
      details: err.message
    });
  }
});

export default router;
