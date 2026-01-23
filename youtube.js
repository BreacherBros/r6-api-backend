import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = "UCBkzbmUXRMiwfb2yeV9iuyQ"; // BreacherBros Channel-ID

// Test-Route
router.get("/test", (req, res) => {
  res.json({ ok: true, msg: "youtube route works" });
});

// Neuestes Video
router.get("/youtube-latest", async (req, res) => {
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&order=date&maxResults=1&type=video&key=${YT_API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data.items || !data.items.length) {
      return res.status(404).json({ error: "No videos found" });
    }

    const v = data.items[0];

    res.json({
      videoId: v.id.videoId,
      title: v.snippet.title,
      thumbnail: v.snippet.thumbnails.high.url,
      published: v.snippet.publishedAt
    });

  } catch (err) {
    res.status(500).json({ error: "YouTube API error", details: err.message });
  }
});

export default router;
