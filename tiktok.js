import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const USERNAME = "breacherbros";
const RAPID_API_KEY = process.env.TIKTOK_API_KEY;

router.get("/tiktok-latest", async (req, res) => {
  try {
    const url = `https://tiktok-scraper7.p.rapidapi.com/user/posts?username=${USERNAME}&count=5`;

    const r = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": RAPID_API_KEY,
        "X-RapidAPI-Host": "tiktok-scraper7.p.rapidapi.com"
      }
    });

    const data = await r.json();
    console.log("TIKTOK RAW:", JSON.stringify(data, null, 2));

    if (!data?.data?.videos || data.data.videos.length === 0) {
      return res.status(404).json({ error: "No TikTok videos found", raw: data });
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
