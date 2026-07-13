// Ported from NekoLive's services/pushPublishService.js, simplified from a
// list of targets down to exactly one: relaying this self-hosted stream to
// the owner's own NekoLive channel via OME's native Push Publishing (OME
// pushes the already-ingested stream out to a second RTMP destination
// itself — no re-encode, no separate ffmpeg process here).
const axios = require("axios");
const { loadConfig } = require("../config/loader");
const { omeAuthHeader, withTrailingSlash, OME_VHOST } = require("./omeClient");
const Settings = require("../models/Settings");

function pushApiUrl(node, suffix) {
  const appName = node.appName || "app";
  return `${withTrailingSlash(node.apiUrl)}v1/vhosts/${OME_VHOST}/apps/${appName}${suffix}`;
}

async function startPush(settings) {
  const config = loadConfig();
  const node = config.ome;
  const payload = {
    id: "nl-selfhost-relay",
    stream: { name: node.streamName },
    protocol: "rtmp",
    url: settings.relayRtmpUrl,
    streamKey: settings.relayStreamKey || ""
  };
  const res = await axios.post(pushApiUrl(node, ":startPush"), payload, {
    headers: { Authorization: omeAuthHeader(node) },
    timeout: 5000
  });
  settings.relayOmePushId = res.data?.response?.id || payload.id;
  await settings.save();
}

async function stopPush(settings) {
  const config = loadConfig();
  const node = config.ome;
  try {
    await axios.post(
      pushApiUrl(node, ":stopPush"),
      { id: settings.relayOmePushId || "nl-selfhost-relay" },
      { headers: { Authorization: omeAuthHeader(node) }, timeout: 5000 }
    );
  } finally {
    // Always clear locally even if the remote stop call fails — matches
    // pushPublishService.js's behavior, since a push target OME no longer
    // recognizes (e.g. it already stopped itself when the source stream
    // ended) shouldn't leave this app stuck thinking a relay is still active.
    settings.relayOmePushId = null;
    await settings.save();
  }
}

// Called by liveDetection.js on every live/offline transition.
async function onLiveStateChanged(isLive) {
  const settings = await Settings.findByPk(1);
  if (!settings || !settings.relayEnabled) return;

  if (isLive && !settings.relayOmePushId) {
    await startPush(settings);
  } else if (!isLive && settings.relayOmePushId) {
    await stopPush(settings);
  }
}

module.exports = { startPush, stopPush, onLiveStateChanged };
