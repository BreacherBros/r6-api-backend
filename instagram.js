import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const ROOT = "https://ensembledata.com/apis";
const ENDPOINT = "/instagram/user/reels";

const INSTA_API_KEY = process.env.INSTA_API_KEY;

// BreacherBros Instagram User ID
const USER_ID = "18428658"; // aus deinem Beispiel

router.get("/instagram-latest", async (req, res) => {
  try {
    const params = new URLSearchParams({
      user_id: USER_ID,
      depth: "1",
      include_feed_video: "true",
      chunk_size: "10",
      token: INSTA_API_KEY
    });

    const url = `${ROOT}${ENDPOINT}?${params.toString()}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data?.data?.reels || data.data.reels.length === 0) {
      return res.status(404).json({ error: "No Instagram reels found" });
    }

    // Neuestes Reel
    const reel = data.data.reels[0];

    res.json({
      video_url: reel.video_url || null,
      thumbnail: reel.thumbnail_url || null,
      permalink: reel.permalink || null,
      caption: reel.caption || "",
      timestamp: reel.taken_at || null
    });

  } catch (err) {
    res.status(500).json({
      error: "Instagram API error",
      details: err.message
    });
  }
});

export default router;
