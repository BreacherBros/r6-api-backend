import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const INSTA_API_KEY = process.env.INSTA_API_KEY;
const USERNAME = "breacherbros"; // Instagram Username

router.get("/instagram-latest", async (req, res) => {
  try {
    const url = `https://ensembledata.com/apis/instagram/user/${USERNAME}/media`;

    const r = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${INSTA_API_KEY}`
      }
    });

    const data = await r.json();

    if (!data || !data.data || !data.data.length) {
      return res.status(404).json({ error: "No Instagram media found" });
    }

    // 🔥 Nur Reels filtern
    const reels = data.data.filter(m => m.media_type === "VIDEO");

    if (!reels.length) {
      return res.status(404).json({ error: "No reels found" });
    }

    const latest = reels[0];

    res.json({
      id: latest.id,
      caption: latest.caption || "",
      media_url: latest.media_url,
      permalink: latest.permalink,
      timestamp: latest.timestamp
    });

  } catch (err) {
    res.status(500).json({ error: "Instagram API error", details: err.message });
  }
});

export default router;
