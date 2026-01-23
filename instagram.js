import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const INSTA_API_KEY = process.env.INSTA_API_KEY;
const ROOT = "https://ensembledata.com/apis";
const USERNAME = "breacherbros";
const USER_ID = "71865672761"; // aus deiner Response

// Test-Route
router.get("/insta-test", (req, res) => {
  res.json({ ok: true, msg: "instagram route works" });
});

// Latest Reel Route
router.get("/instagram-latest", async (req, res) => {
  try {
    const url = `${ROOT}/instagram/user/reels?user_id=${USER_ID}&depth=1&include_feed_video=true&chunk_size=5&token=${INSTA_API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data?.data?.reels || data.data.reels.length === 0) {
      return res.status(404).json({ error: "No Instagram reels found" });
    }

    const reel = data.data.reels[0]; // latest reel

    res.json({
      id: reel.id,
      video_url: reel.video_url || null,
      thumbnail: reel.image_versions2?.candidates?.[0]?.url || null,
      caption: reel.caption?.text || "",
      permalink: `https://www.instagram.com/reel/${reel.code}/`
    });

  } catch (err) {
    res.status(500).json({ error: "Instagram API error", details: err.message });
  }
});

export default router;
