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

    // 🔥 Neuestes Video laut Dataset (append-only)
    const video = data[data.length - 1];

    const videoUrl =
      video.videoUrl ||
      video.videoMeta?.playAddr ||
      video.videoMeta?.downloadAddr ||
      null;

    if (!videoUrl) {
      return res.status(500).json({
        error: "No playable video URL found"
      });
    }

    // 🟢 Browser-optimierte Antwort
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");

    res.json({
      id: video.id ?? null,
      caption: video.text ?? "",
      videoUrl,                 // 🔥 direkt abspielbar
      thumbnail: video.videoMeta?.coverUrl ?? null,

      // ⬇️ Hinweise fürs Frontend (ohne Zwang)
      autoplay: true,
      muted: true,
      loop: true,
      preload: "none",

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
