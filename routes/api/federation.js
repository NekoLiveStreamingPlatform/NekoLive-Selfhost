const express = require("express");
const Settings = require("../../models/Settings");
const federationClient = require("../../services/federationClient");

const router = express.Router();

// Central NekoLive -> Selfhost callback. This endpoint is server-to-server
// authenticated with the paired node's HMAC secret; it never accepts a
// creator stream key.
router.post("/control", async (req, res) => {
  const settings = await Settings.findByPk(1);
  const payload = req.body || {};
  if (!federationClient.verifyControlSignature(settings, payload, req.headers)) {
    return res.status(401).json({ ok: false, error: "Invalid node signature." });
  }

  if (payload.action === "terminate" || payload.action === "block") {
    settings.federationBlocked = true;
  } else if (payload.action === "resume" || payload.action === "unblock") {
    settings.federationBlocked = false;
  } else {
    return res.status(400).json({ ok: false, error: "Unknown federation action." });
  }

  await settings.save();
  federationClient.heartbeat().catch(() => {});
  res.json({ ok: true, blocked: settings.federationBlocked });
});

router.get("/status", async (req, res) => {
  const settings = await Settings.findByPk(1);
  res.json({
    ok: true,
    paired: !!settings?.federationNodeId,
    enabled: !!settings?.federationEnabled,
    blocked: !!settings?.federationBlocked,
    nodeId: settings?.federationNodeId || null,
    hubUrl: settings?.federationHubUrl || null,
    lastSeenAt: settings?.federationLastSeenAt || null
  });
});

module.exports = router;
