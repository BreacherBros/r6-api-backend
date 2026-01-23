import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const INSTA_API_KEY = process.env.INSTA_API_KEY;
const USERNAME = "breacherbros";

/* =========================
   Latest Instagram Reel
========================= */
router.get("/instagram-latest", async (req, res) => {
  try {
    const url = `https://ensembledata.com/apis/instagram/user/reels?username=${USERNAME}&chunk_size=1&token=${INSTA_API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data?.data?.reels || data.data.reels.length === 0) {
      return res.status(404).json({ error: "No Instagram media found" });
    }

    const reel = data.data.reels[0];

    const shortcode = reel.shortcode;
    const caption = reel?.caption?.text || "";
    const thumbnail =
      reel?.image_versions2?.candidates?.[0]?.url || null;

    const video_url =
      reel?.video_versions?.[0]?.url || null;

    res.json({
      id: reel.id,
      shortcode,
      video_url,
      thumbnail,
      caption,
      permalink: `https://www.instagram.com/reel/${shortcode}/`
    });

  } catch (err) {
    res.status(500).json({
      error: "Instagram API error",
      details: err.message
    });
  }
});

export default router;
