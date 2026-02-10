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
   const getTimestamp = (video) => {
  if (video.createTimeISO) return new Date(video.createTimeISO).getTime();
  if (video.createTime) return video.createTime * 1000; // oft Unix seconds
  if (video.timestamp) return new Date(video.timestamp).getTime();
  if (video.collectedAt) return new Date(video.collectedAt).getTime();
  return 0;
};

const sorted = data
  .map(v => ({ ...v, _ts: getTimestamp(v) }))
  .sort((a, b) => b._ts - a._ts);

const video = sorted[0]; // 🔥 wirklich neuestes TikTok

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
