import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = "UCBkzbmUXRMiwfb2yeV9iuyQ"; 
const UPLOADS_PLAYLIST = "UUBkzbmUXRMiwfb2yeV9iuyQ";

/* TEST */
router.get("/test", (req, res) => {
  res.json({ ok: true, msg: "youtube route works" });
});

/* LATEST VIDEO */
router.get("/youtube-latest", async (req, res) => {
  try {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${UPLOADS_PLAYLIST}&maxResults=1&key=${YT_API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data.items || !data.items.length) {
      return res.status(404).json({ error: "No videos in uploads playlist" });
    }

    const v = data.items[0].snippet;

    res.json({
      videoId: v.resourceId.videoId,
      title: v.title,
      thumbnail: v.thumbnails.maxres?.url || v.thumbnails.high.url,
      published: v.publishedAt
    });

  } catch (err) {
    res.status(500).json({ error: "YouTube API error", details: err.message });
  }
});

export default router;
