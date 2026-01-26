import express from "express";
import fetch from "node-fetch";

const router = express.Router();

/* =========================
   Apify Dataset API URL
========================= */
const DATASET_URL = "https://api.apify.com/v2/datasets/Ik271gPsA3xT88xc3/items?clean=true&format=json";

/* =========================
   Latest TikTok
========================= */
router.get("/tiktok-latest", async (req, res) => {
  try {
    const r = await fetch(DATASET_URL);
    const data = await r.json();

    console.log("TIKTOK RAW:", data);

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({
        error: "No TikTok videos found",
        rawType: typeof data,
        raw: data
      });
    }

    // Neuestes Video (erstes Element)
    const video = data[0];

    const result = {
      id: video.id || null,
      caption: video.text || "",
      thumbnail: video.videoMeta?.coverUrl || null,
      permalink: video.webVideoUrl || null
    };

    res.json(result);

  } catch (err) {
    res.status(500).json({
      error: "TikTok API error",
      details: err.message
    });
  }
});

export default router;
