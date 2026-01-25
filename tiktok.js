import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const USERNAME = "breacherbros";
const RAPID_KEY = process.env.TIKTOK_API_KEY;

/* =========================
   Latest TikTok
========================= */
router.get("/tiktok-latest", async (req, res) => {
  try {
    const url = `https://scraptik.p.rapidapi.com/user-posts?username=${USERNAME}&count=5`;

    const r = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": RAPID_KEY,
        "X-RapidAPI-Host": "scraptik.p.rapidapi.com"
      }
    });

    const data = await r.json();

    if (!data?.data?.videos || data.data.videos.length === 0) {
      return res.status(404).json({ error: "No TikTok videos found" });
    }

    const v = data.data.videos[0];

    res.json({
      id: v.video_id,
      title: v.title || "",
      cover: v.cover || null,
      play: v.play || null,
      link: `https://www.tiktok.com/@${USERNAME}/video/${v.video_id}`
    });

  } catch (err) {
    res.status(500).json({
      error: "TikTok API error",
      details: err.message
    });
  }
});

export default router;
