const express = require("express");
const Settings = require("../../models/Settings");
const { loadConfig } = require("../../config/loader");
const { resolveOmePlaybackUrls } = require("../../services/omeClient");
const liveDetection = require("../../services/liveDetection");
const viewerSessions = require("../../services/viewerSessions");

const router = express.Router();

// Polled client-side (views/js/channel.js) so the channel page picks up a
// go-live/go-offline transition without a manual page reload.
router.get("/status", async (req, res) => {
  try {
    const settings = await Settings.findByPk(1);
    const config = loadConfig();
    const live = liveDetection.getState();
    const playback = resolveOmePlaybackUrls(config.ome, config.ome.streamName);

    res.json({
      ok: true,
      live: live.isLive,
      title: settings?.channelTitle || "",
      llhlsUrl: live.isLive ? playback.llhls : null,
      viewerCount: viewerSessions.countViewers(config.ome.streamName)
    });
  } catch (error) {
    console.error("stream status failed:", error.message);
    res.status(500).json({ ok: false, error: "Failed to load stream status." });
  }
});

module.exports = router;
