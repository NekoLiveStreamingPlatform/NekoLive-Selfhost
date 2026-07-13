// General multistream support — mirrors NekoLive's own
// services/pushPublishService.js: any number of PushTarget rows (Twitch,
// YouTube, Kick, your own NekoLive channel, custom RTMP/SRT...), each
// independently start/stop-able via OME's native Push Publishing (no
// re-encode, no separate ffmpeg process). Replaces the earlier
// single-purpose "relay to NekoLive" feature (services/pushRelay.js).
const axios = require("axios");
const { loadConfig } = require("../config/loader");
const { omeAuthHeader, withTrailingSlash, OME_VHOST } = require("./omeClient");
const PushTarget = require("../models/PushTarget");

function pushApiUrl(node, suffix) {
  const appName = node.appName || "app";
  return `${withTrailingSlash(node.apiUrl)}v1/vhosts/${OME_VHOST}/apps/${appName}${suffix}`;
}

// Starts (or restarts) pushing to one target right now. Independent of
// live/offline state — callers decide when it's appropriate to call this
// (the real-time toggle route calls it directly; syncTargets() below calls
// it on a go-live transition).
async function start(target) {
  const config = loadConfig();
  const node = config.ome;
  const payload = {
    id: `nl-target-${target.id}`,
    stream: { name: node.streamName },
    protocol: target.protocol || "rtmp",
    url: target.url,
    streamKey: target.streamKey || ""
  };
  const res = await axios.post(pushApiUrl(node, ":startPush"), payload, {
    headers: { Authorization: omeAuthHeader(node) },
    timeout: 5000
  });
  target.omePushId = res.data?.response?.id || payload.id;
  await target.save();
  return { ok: true, pushId: target.omePushId };
}

async function stop(target) {
  if (!target?.omePushId) return { ok: true };
  const config = loadConfig();
  const node = config.ome;
  try {
    await axios.post(
      pushApiUrl(node, ":stopPush"),
      { id: target.omePushId },
      { headers: { Authorization: omeAuthHeader(node) }, timeout: 5000 }
    );
  } finally {
    // Cleared even if the remote call fails — a push OME no longer
    // recognizes (e.g. it already stopped when the source stream ended)
    // shouldn't leave this app stuck thinking it's still active.
    target.omePushId = null;
    await target.save();
  }
  return { ok: true };
}

// Bulk sync on a go-live/go-offline transition (called from
// liveDetection.js) — starts every enabled target that isn't already
// pushing when going live, stops every currently-pushing target when going
// offline. The real-time toggle route (routes/api/multistream.js) calls
// start()/stop() directly for a single target instead, bypassing this.
async function syncTargets(isLive) {
  const targets = await PushTarget.findAll({ where: { enabled: true } });
  for (const target of targets) {
    try {
      if (isLive && !target.omePushId) {
        await start(target);
      } else if (!isLive && target.omePushId) {
        await stop(target);
      }
    } catch (error) {
      console.error(`Multistream sync failed for target ${target.id} (${target.label}):`, error.message);
    }
  }
}

module.exports = { start, stop, syncTargets };
