import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const DATASET_URL =
  "https://api.apify.com/v2/datasets/Ik271gPsA3xT88xc3/items?clean=true&format=json&limit=50";

router.get("/tiktok-latest", async (req, res) => {
  try {
    const response = await fetch(DATASET_URL);
    if (!response.ok) throw new Error(`Apify request failed: ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: "No TikTok videos found" });
    }

    const video = data[data.length - 1];

    const videoUrl =
      video.videoUrl ||
      video.videoMeta?.playAddr ||
      video.videoMeta?.downloadAddr ||
      video.webVideoUrl ||
      null;

    res.setHeader("Cache-Control", "no-store");

    res.json({
      id: video.id ?? null,
      caption: video.text ?? "",
      videoUrl,
      thumbnail: video.videoMeta?.coverUrl ?? null
    });

  } catch (err) {
    res.status(500).json({
      error: "TikTok API error",
      details: err.message
    });
  }
});

export default router;
