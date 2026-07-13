const express = require("express");
const { loadConfig } = require("../../config/loader");
const viewerSessions = require("../../services/viewerSessions");
const BannedConnection = require("../../models/BannedConnection");
const Settings = require("../../models/Settings");

const router = express.Router();

async function isBanned(ip) {
  if (!ip) return false;
  const row = await BannedConnection.findOne({ where: { ip } });
  return !!row;
}

// OvenMediaEngine's AdmissionWebhooks contract — same request/response shape
// as NekoLive's routes/api/omeAdmission.js:
//   { client: { address, port },
//     request: { direction: "incoming"|"outgoing", status: "opening"|"closing", url } }
// -> { allowed: true|false }
//
// Unlike the main NekoLive site (many independent channels — one bad actor
// must never be able to cost every OTHER channel's viewers anything, so
// playback there is never gated), this app is single-channel and the owner
// explicitly wants to enforce their own ToS: both directions consult the
// ban list here.
router.post("/", async (req, res) => {
  try {
    const request = req.body?.request || {};
    const direction = String(request.direction || "").toLowerCase();
    const status = String(request.status || "").toLowerCase();
    const url = String(request.url || "");
    const clientIp = req.body?.client?.address || "";
    const connectionKey = `${clientIp}:${req.body?.client?.port || ""}`;

    if (direction === "outgoing") {
      if (status === "opening" && (await isBanned(clientIp))) {
        return res.json({ allowed: false });
      }
      try {
        const config = loadConfig();
        if (status === "opening") {
          viewerSessions.recordOpen(config.ome.streamName, connectionKey, clientIp);
        } else if (status === "closing") {
          viewerSessions.recordClose(config.ome.streamName, connectionKey);
        }
      } catch (trackingError) {
        console.warn("Viewer session tracking failed (non-fatal):", trackingError.message);
      }
      return res.json({ allowed: true });
    }

    // Ingest ("incoming"). Closing is always allowed.
    if (status !== "opening") {
      return res.json({ allowed: true });
    }
    if (await isBanned(clientIp)) {
      return res.json({ allowed: false });
    }

    // Stream key rides in the URL — a `jwt=` query param (RTMP/WHIP) or the
    // last colon-delimited segment for SRT streamid-style ingest.
    let rawKey = "";
    try {
      const parsed = new URL(url);
      rawKey = parsed.searchParams.get("jwt") || parsed.pathname;
    } catch (_) {
      rawKey = url;
    }

    // Generated on /setup and shown/regeneratable from the admin dashboard
    // (routes/admin.js) — not a value typed into config.json.
    const settings = await Settings.findByPk(1);
    const expectedKey = settings?.streamKey;
    const providedKey = String(rawKey || "").split(":").pop();
    return res.json({ allowed: !!expectedKey && providedKey === expectedKey });
  } catch (error) {
    console.error("Admission webhook failed:", error);
    return res.status(500).json({ allowed: false });
  }
});

module.exports = router;
