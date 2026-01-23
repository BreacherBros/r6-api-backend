import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const INSTA_API_KEY = process.env.INSTA_API_KEY;
const USER_ID = "71865672761"; // breacherbros

router.get("/instagram-latest", async (req, res) => {
  try {
    const url = `https://ensembledata.com/apis/instagram/user/reels?user_id=${USER_ID}&depth=1&chunk_size=3&token=${INSTA_API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data?.data?.reels || data.data.reels.length === 0) {
      return res.status(404).json({ 
        error: "No Instagram reels found", 
        raw: data 
      });
    }

    const reel = data.data.reels[0]; // neuestes Reel

    const shortcode = reel.shortcode || reel.code || null;
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
      permalink: shortcode
        ? `https://www.instagram.com/reel/${shortcode}/`
        : null
    });

  } catch (err) {
    res.status(500).json({
      error: "Instagram API error",
      details: err.message
    });
  }
});

export default router;
