import express from "express";
import fetch from "node-fetch";

const router = express.Router();

/* =========================
   Apify Dataset API URL
========================= */
const DATASET_URL =
  "https://api.apify.com/v2/datasets/Ik271gPsA3xT88xc3/items?clean=true&format=json&limit=50";

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
      return res.status(404).json({ error: "No TikTok videos found" });
    }

    // ✅ letztes Item = zuletzt gescraped
    const video = data[data.length - 1];

    // ✅ robuste URL-Auswahl mit Fallback
    const videoUrl =
      video.videoUrl ||
      video.videoMeta?.playAddr ||
      video.videoMeta?.downloadAddr ||
      video.webVideoUrl ||          // 🔥 WICHTIGER FALLBACK
      null;

    if (!videoUrl) {
      return res.status(200).json({
        id: video.id ?? null,
        caption: video.text ?? "",
        error: "No video URL available"
      });
    }

    res.setHeader("Cache-Control", "no-store");

    res.json({
      id: video.id ?? null,
      caption: video.text ?? "",
      videoUrl,
      thumbnail: video.videoMeta?.coverUrl ?? null,
      collectedAt: video.collectedAt ?? null
    });

  } catch (err) {
    console.error("TikTok API error:", err);

    res.status(500).json({
      error: "TikTok API error",
      details: err.message
    });
  }
});

export default router;
