import express from "express";
import fetch from "node-fetch";

const router = express.Router();

/* =========================
   Apify Dataset API URL
========================= */
const DATASET_URL =
  "https://api.apify.com/v2/datasets/Ik271gPsA3xT88xc3/items?clean=true&format=json&limit=50";

/* =========================
   Helper: Timestamp ermitteln
========================= */
const getTimestamp = (video) => {
  if (video.createTimeISO) return new Date(video.createTimeISO).getTime();
  if (video.createTime) return video.createTime * 1000; // Unix seconds
  if (video.timestamp) return new Date(video.timestamp).getTime();
  if (video.collectedAt) return new Date(video.collectedAt).getTime();
  return 0;
};

/* =========================
   Latest TikTok Endpoint
========================= */
router.get("/tiktok-latest", async (req, res) => {
  try {
    const response = await fetch(DATASET_URL);

    if (!response.ok) {
      throw new Error(`Apify request failed: ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({
        error: "No TikTok videos found"
      });
    }

    // 🔥 wirklich neuestes TikTok ermitteln
    const video = data.sort(
      (a, b) => getTimestamp(b) - getTimestamp(a)
    )[0];

    const result = {
      id: video.id ?? null,
      caption: video.text ?? "",
      thumbnail: video.videoMeta?.coverUrl ?? null,
      permalink: video.webVideoUrl ?? null,
      createdAt:
        video.createTimeISO ??
        (video.createTime ? new Date(video.createTime * 1000).toISOString() : null)
    };

    res.json(result);

  } catch (err) {
    console.error("TikTok API error:", err);

    res.status(500).json({
      error: "TikTok API error",
      details: err.message
    });
  }
});

export default router;
