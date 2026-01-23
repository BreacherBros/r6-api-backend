import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const YT_API_KEY = process.env.YOUTUBE_API_KEY;

// BreacherBros
const UPLOADS_PLAYLIST_ID = "UUBkzbmUXRMiwfb2yeV9iuyQ";

// Test-Route
router.get("/test", (req, res) => {
  res.json({ ok: true, msg: "youtube route works" });
});

// Neuestes Video
router.get("/youtube-latest", async (req, res) => {
  try {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${UPLOADS_PLAYLIST_ID}&maxResults=1&key=${YT_API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data.items || !data.items.length) {
      return res.status(404).json({ error: "No videos in uploads playlist" });
    }

    const v = data.items[0];

    res.json({
      videoId: v.snippet.resourceId.videoId,
      title: v.snippet.title,
      thumbnail: v.snippet.thumbnails.high.url,
      published: v.snippet.publishedAt
    });

  } catch (err) {
    res.status(500).json({
      error: "YouTube API error",
      details: err.message
    });
  }
});

export default router;
