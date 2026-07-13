const express = require("express");
const { ensureAuthenticated } = require("../../middleware/auth");
const PushTarget = require("../../models/PushTarget");
const multistream = require("../../services/multistream");
const liveDetection = require("../../services/liveDetection");

const router = express.Router();
router.use(ensureAuthenticated);

const ALLOWED_PROTOCOLS = ["rtmp", "srt", "mpegts"];

function serialize(target) {
  return {
    id: target.id,
    label: target.label,
    protocol: target.protocol,
    url: target.url,
    hasStreamKey: !!target.streamKey,
    enabled: target.enabled,
    active: !!target.omePushId
  };
}

router.get("/", async (req, res) => {
  const targets = await PushTarget.findAll({ order: [["createdAt", "ASC"]] });
  res.json({ ok: true, targets: targets.map(serialize) });
});

router.post("/", async (req, res) => {
  try {
    const { label, protocol, url, streamKey } = req.body;
    if (!label || !url) {
      return res.status(400).json({ error: "Label and URL are required." });
    }
    const target = await PushTarget.create({
      label: String(label).trim().slice(0, 60),
      protocol: ALLOWED_PROTOCOLS.includes(protocol) ? protocol : "rtmp",
      url: String(url).trim(),
      streamKey: streamKey ? String(streamKey).trim() : null,
      enabled: false
    });
    res.json({ ok: true, target: serialize(target) });
  } catch (error) {
    console.error("Create multistream target failed:", error);
    res.status(500).json({ error: "Failed to create target." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const target = await PushTarget.findByPk(req.params.id);
    if (!target) return res.status(404).json({ error: "Target not found." });
    if (target.omePushId) await multistream.stop(target);
    await target.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error("Delete multistream target failed:", error);
    res.status(500).json({ error: "Failed to delete target." });
  }
});

// Real-time toggle — starting only actually pushes if the stream is
// currently live (nothing to push otherwise); stopping always tears down
// an active push regardless of live state, so a target never gets stranded
// running against a stream that's already ended.
router.post("/:id/toggle", async (req, res) => {
  try {
    const target = await PushTarget.findByPk(req.params.id);
    if (!target) return res.status(404).json({ error: "Target not found." });

    const nextEnabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : !target.enabled;
    target.enabled = nextEnabled;
    await target.save();

    const { isLive } = liveDetection.getState();
    if (nextEnabled && isLive) {
      await multistream.start(target);
    } else if (!nextEnabled && target.omePushId) {
      await multistream.stop(target);
    }

    res.json({ ok: true, target: serialize(target) });
  } catch (error) {
    console.error("Toggle multistream target failed:", error);
    res.status(500).json({ error: "Failed to toggle target." });
  }
});

module.exports = router;
