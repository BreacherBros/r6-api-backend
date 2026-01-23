import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = "UCBkzbmUXRMiwfb2yeV9iuyQ";

// Test-Route
router.get("/test", (req, res) => {
  res.json({ ok: true, msg: "youtube route works" });
});

// Helper: Uploads Playlist holen
async function getUploadsPlaylist() {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${CHANNEL_ID}&key=${YT_API_KEY}`;
  const r = await fetch(url);
  const data = await r.json();

  if (!data.items || !data.items.length) return null;

  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

// Neuestes Video
router.get("/youtube-latest", async (req, res) => {
  try {
    const uploadsPlaylist = await getUploadsPlaylist();

    if (!uploadsPlaylist) {
      return res.status(404).json({ error: "Uploads playlist not found" });
    }

    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylist}&maxResults=1&key=${YT_API_KEY}`;
    const r2 = await fetch(playlistUrl);
    const data2 = await r2.json();

    if (!data2.items || !data2.items.length) {
      return res.status(404).json({ error: "No videos in uploads playlist" });
    }

    const v = data2.items[0].snippet;

    res.json({
      videoId: v.resourceId.videoId,
      title: v.title,
      thumbnail: v.thumbnails.high.url,
      published: v.publishedAt
    });

  } catch (err) {
    res.status(500).json({ error: "YouTube API error", details: err.message });
  }
});

export default router;
