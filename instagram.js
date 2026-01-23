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
    const url = `https://ensembledata.com/apis/instagram/user/reels?username=${USERNAME}&chunk_size=5&token=${INSTA_API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    /* =========================
       RAW DATA DEBUG (optional)
    ========================= */
    // console.log(JSON.stringify(data, null, 2));

    let mediaList = [];

    // mögliche Datenpfade
    if (data?.data?.reels?.length) mediaList = data.data.reels;
    else if (data?.data?.items?.length) mediaList = data.data.items;
    else if (data?.data?.media?.length) mediaList = data.data.media;

    if (!mediaList.length) {
      return res.status(404).json({ error: "No Instagram media found" });
    }

    // 🔥 neuestes Reel/Video finden
    const reel =
      mediaList.find(m => m.media_type === 2 || m.video_versions) ||
      mediaList[0];

    const shortcode =
      reel?.shortcode ||
      reel?.code ||
      reel?.id ||
      null;

    const caption =
      reel?.caption?.text ||
      reel?.caption ||
      "";

    const thumbnail =
      reel?.image_versions2?.candidates?.[0]?.url ||
      reel?.thumbnail_url ||
      reel?.display_url ||
      null;

    const video_url =
      reel?.video_versions?.[0]?.url ||
      reel?.video_url ||
      null;

    if (!shortcode && !video_url) {
      return res.status(404).json({ error: "No usable reel found" });
    }

    res.json({
      id: reel.id || null,
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
