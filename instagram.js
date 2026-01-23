import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const API_KEY = process.env.INSTA_API_KEY;

/**
 * Latest Instagram Reel from @breacherbros
 */
router.get("/insta-latest", async (req, res) => {
  try {
    const url = "https://api.ensembledata.com/instagram/user/posts?username=breacherbros";

    const r = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${API_KEY}`
      }
    });

    const data = await r.json();

    if (!data || !data.data || !data.data.length) {
      return res.status(404).json({ error: "No Instagram data found" });
    }

    // nur Reels (Videos)
    const reels = data.data.filter(p => p.is_video === true);

    if (!reels.length) {
      return res.status(404).json({ error: "No reels found" });
    }

    const latest = reels[0];

    res.json({
      videoUrl: latest.video_url,
      thumbnail: latest.thumbnail_url,
      link: latest.permalink,
      caption: latest.caption || ""
    });

  } catch (err) {
    res.status(500).json({
      error: "Instagram API error",
      details: err.message
    });
  }
});

export default router;
