// Ported from NekoLive's utils/mediaNodes.js — those functions only ever
// touched a plain {apiUrl, apiAccessToken, playerurl, webrtcurl, name} shape,
// never the Sequelize NodeServer model, so they carry over verbatim (with
// only the multi-node ranking/DB-lookup helpers dropped, since this app only
// ever has exactly one OME node).
const axios = require("axios");

function withTrailingSlash(value) {
  const base = String(value || "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base : `${base}/`;
}

function withoutTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const OME_VHOST = "default";

// OvenMediaEngine's REST API auth: Basic base64(<AccessToken>) — not the
// usual HTTP Basic ":password" convention.
function omeAuthHeader(node) {
  const token = Buffer.from(String(node.apiAccessToken || "")).toString("base64");
  return `Basic ${token}`;
}

// Queries OME's REST API for a single stream's current state. Returns null
// if the node has no API configured or the request fails; otherwise
// { live, raw }. Non-404 = live, mirroring the simplicity of NekoLive's own
// MediaMTX-equivalent check.
async function getOmeStreamInfo(node, streamName) {
  if (!node?.apiUrl || !streamName) return null;
  const appName = node.appName || "app";
  const url = `${withTrailingSlash(node.apiUrl)}v1/vhosts/${OME_VHOST}/apps/${appName}/streams/${encodeURIComponent(
    streamName.toLowerCase()
  )}`;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: omeAuthHeader(node) },
      timeout: 4000,
      validateStatus: () => true
    });
    if (res.status === 404) return { live: false, raw: null };
    if (res.status < 200 || res.status >= 300) return null;
    return { live: true, raw: res.data };
  } catch (error) {
    console.warn(`OME stream-info check failed for ${streamName}:`, error.message);
    return null;
  }
}

// Browser-facing playback defaults to the Selfhost origin. `playerurl` and
// `webrtcurl` are then private upstream addresses used only by omeProxy.js.
// Pass publicBase for an absolute URL (needed by federation heartbeats); omit
// it for a same-origin relative URL returned to the local browser.
function resolveOmePlaybackUrls(node, streamName, publicBase = "") {
  const name = String(streamName || "").toLowerCase();
  const appName = node?.appName || "app";
  if (!name) return { llhls: "", webrtc: "" };

  if (node?.proxyPlayback !== false) {
    const base = withoutTrailingSlash(publicBase);
    return {
      llhls: `${base}/ome/llhls/${encodeURIComponent(appName)}/${encodeURIComponent(name)}/llhls.m3u8`,
      webrtc: `${base}/ome/webrtc/${encodeURIComponent(appName)}/${encodeURIComponent(name)}?direction=whep`
    };
  }

  // Backwards-compatible direct-to-OME mode for deployments that explicitly
  // disable the Selfhost proxy.
  return {
    llhls: node.playerurl ? `${withTrailingSlash(node.playerurl)}${appName}/${name}/llhls.m3u8` : "",
    webrtc: node.webrtcurl ? `${withTrailingSlash(node.webrtcurl)}${appName}/${name}?direction=whep` : ""
  };
}

module.exports = {
  withTrailingSlash,
  omeAuthHeader,
  getOmeStreamInfo,
  resolveOmePlaybackUrls,
  OME_VHOST
};