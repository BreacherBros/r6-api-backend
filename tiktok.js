import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const USERNAME = "breacherbros";

/* =========================
   Latest TikTok from Profile
========================= */
router.get("/tiktok-latest", async (req, res) => {
  try {
    const url = `https://www.tikwm.com/api/user/posts?unique_id=${USERNAME}&count=10`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data?.data?.videos || data.data.videos.length === 0) {
      return res.status(404).json({ error: "No TikTok videos found" });
    }

    // immer das neueste Video
    const video = data.data.videos[0];

    res.json({
      id: video.video_id,
      title: video.title || "",
      cover: video.cover || null,
      play: video.play || null,
      author: USERNAME,
      link: `https://www.tiktok.com/@${USERNAME}/video/${video.video_id}`
    });

  } catch (err) {
    res.status(500).json({
      error: "TikTok API error",
      details: err.message
    });
  }
});

export default router;
