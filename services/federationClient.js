const crypto = require("crypto");
const axios = require("axios");
const WebSocket = require("ws");
const Settings = require("../models/Settings");
const { loadConfig } = require("../config/loader");
const { resolveOmePlaybackUrls } = require("./omeClient");
const nodeIdentity = require("./nodeIdentity");
const liveDetection = require("./liveDetection");
const viewerSessions = require("./viewerSessions");

const HEARTBEAT_MS = 15_000;
const TUNNEL_RECONNECT_MS = 5_000;
const MAX_PROXY_BODY = 12 * 1024 * 1024;
let heartbeatTimer = null;
let heartbeatInFlight = false;
let tunnelSocket = null;
let tunnelReconnectTimer = null;
let stopping = false;
let chatInjector = null;

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function signature(secret, nodeId, timestamp, payload) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${nodeId}.${canonicalize(payload)}`)
    .digest("hex");
}

function tunnelSignature(secret, nodeId, timestamp) {
  return crypto
    .createHmac("sha256", secret)
    .update(`tunnel.${timestamp}.${nodeId}`)
    .digest("hex");
}

function signedHeaders(settings, payload) {
  const timestamp = String(Date.now());
  return {
    "x-nekolive-node-id": settings.federationNodeId,
    "x-nekolive-timestamp": timestamp,
    "x-nekolive-signature": signature(
      settings.federationNodeSecret,
      settings.federationNodeId,
      timestamp,
      payload
    )
  };
}

function llhlsPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const pathname = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw).pathname
      : new URL(raw, "http://selfhost.local").pathname;
    return pathname.startsWith("/ome/llhls/") ? pathname : null;
  } catch (_) {
    return null;
  }
}

function websocketTunnelUrl(settings) {
  const hub = new URL(normalizeBaseUrl(settings.federationHubUrl));
  hub.protocol = hub.protocol === "https:" ? "wss:" : "ws:";
  hub.pathname = "/streamnode/federation/tunnel";
  const timestamp = String(Date.now());
  hub.search = "";
  hub.searchParams.set("nodeId", settings.federationNodeId);
  hub.searchParams.set("timestamp", timestamp);
  hub.searchParams.set(
    "signature",
    tunnelSignature(settings.federationNodeSecret, settings.federationNodeId, timestamp)
  );
  return hub.toString();
}

async function pair({ hubUrl, publicUrl, pairingCode, transportMode = "direct" }) {
  const hub = normalizeBaseUrl(hubUrl);
  const mode = transportMode === "tunnel" ? "tunnel" : "direct";
  const publicBase = mode === "direct" ? normalizeBaseUrl(publicUrl) : "";
  const identity = nodeIdentity.getIdentity();

  if (!/^https?:\/\//i.test(hub)) throw new Error("Hub URL must start with http:// or https://");
  if (mode === "direct" && !/^https?:\/\//i.test(publicBase)) {
    throw new Error("Direct mode requires a public Selfhost URL.");
  }
  if (!pairingCode) throw new Error("Pairing code is required.");

  const response = await axios.post(
    `${hub}/streamnode/federation/pair`,
    {
      pairingCode: String(pairingCode).trim(),
      nodeId: identity.nodeId,
      hardwareBindingHash: identity.hardwareBindingHash,
      transportMode: mode,
      publicUrl: mode === "direct" ? publicBase : null,
      software: "NekoLive-Selfhost"
    },
    { timeout: 10_000, validateStatus: () => true }
  );

  if (response.status < 200 || response.status >= 300 || !response.data?.nodeId || !response.data?.nodeSecret) {
    throw new Error(response.data?.error || `NekoLive pairing failed (${response.status}).`);
  }

  // Pairing rotates the node secret and may convert an already-running guest
  // tunnel into an owned channel. Drop the old socket before using the new
  // credentials so the central tunnel never keeps stale guest ownership.
  closeTunnel();

  const settings = await Settings.findByPk(1);
  settings.federationHubUrl = hub;
  settings.federationPublicUrl = mode === "direct" ? publicBase : null;
  settings.federationNodeId = response.data.nodeId;
  settings.federationNodeSecret = response.data.nodeSecret;
  settings.federationChannelName = response.data.channelName || null;
  settings.federationGuestNode = false;
  settings.federationTransportMode = mode;
  settings.federationRelayEnabled = true;
  settings.federationEnabled = true;
  settings.federationBlocked = false;
  await settings.save();

  await ensureTunnel();
  await heartbeat();
  await settings.reload();
  return settings;
}

async function registerGuest({ hubUrl }) {
  const hub = normalizeBaseUrl(hubUrl);
  const identity = nodeIdentity.getIdentity();
  if (!/^https?:\/\//i.test(hub)) throw new Error("Hub URL must start with http:// or https://");

  const response = await axios.post(
    `${hub}/streamnode/federation/guest/register`,
    {
      nodeId: identity.nodeId,
      hardwareBindingHash: identity.hardwareBindingHash,
      software: "NekoLive-Selfhost"
    },
    { timeout: 10_000, validateStatus: () => true }
  );

  if (response.status < 200 || response.status >= 300 || !response.data?.nodeId || !response.data?.nodeSecret) {
    throw new Error(response.data?.error || `Guest relay registration failed (${response.status}).`);
  }

  const settings = await Settings.findByPk(1);
  settings.federationHubUrl = hub;
  settings.federationPublicUrl = null;
  settings.federationNodeId = response.data.nodeId;
  settings.federationNodeSecret = response.data.nodeSecret;
  settings.federationChannelName = response.data.channelName || null;
  settings.federationGuestNode = true;
  settings.federationTransportMode = "tunnel";
  settings.federationRelayEnabled = true;
  settings.federationEnabled = true;
  settings.federationBlocked = false;
  await settings.save();

  await ensureTunnel();
  await heartbeat();
  await settings.reload();
  return settings;
}

function closeTunnel() {
  if (tunnelReconnectTimer) clearTimeout(tunnelReconnectTimer);
  tunnelReconnectTimer = null;
  const ws = tunnelSocket;
  tunnelSocket = null;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    try {
      ws.close();
    } catch (_) {}
  }
}

function scheduleTunnelReconnect() {
  if (stopping || tunnelReconnectTimer) return;
  tunnelReconnectTimer = setTimeout(() => {
    tunnelReconnectTimer = null;
    ensureTunnel().catch(() => {});
  }, TUNNEL_RECONNECT_MS);
  tunnelReconnectTimer.unref?.();
}

function absoluteManifestUri(value, base) {
  const uri = String(value || "").trim();
  if (!uri || /^https?:\/\//i.test(uri) || uri.startsWith("data:")) return uri;
  if (uri.startsWith("//")) return `${base.protocol}${uri}`;
  if (uri.startsWith("/")) return `${base.origin}${uri}`;
  return uri;
}

function normalizeLlhlsManifestForRelay(body, base) {
  let text = Buffer.from(body).toString("utf8");

  text = text.replace(/URI=(['"])([^'"]+)\1/g, (match, quote, uri) => {
    const normalized = absoluteManifestUri(uri, base);
    return `URI=${quote}${normalized}${quote}`;
  });

  text = text
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.trimStart().startsWith("#")) return line;
      const leading = line.match(/^\s*/)?.[0] || "";
      const trailing = line.match(/\s*$/)?.[0] || "";
      const uri = line.trim();
      return `${leading}${absoluteManifestUri(uri, base)}${trailing}`;
    })
    .join("\n");

  return Buffer.from(text);
}

async function handleProxyRequest(data) {
  const ws = tunnelSocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const requestId = String(data.requestId || "");
  if (!requestId) return;

  const sendResponse = (payload) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "proxy_response", requestId, ...payload }));
    }
  };

  if (data.kind !== "llhls") {
    sendResponse({ status: 400, headers: { "content-type": "text/plain" }, bodyBase64: "" });
    return;
  }

  const relativePath = String(data.path || "").replace(/^\/+/, "");
  if (!relativePath || relativePath.includes("..") || relativePath.includes("\\") || relativePath.includes("://")) {
    sendResponse({ status: 400, headers: { "content-type": "text/plain" }, bodyBase64: "" });
    return;
  }

  try {
    const config = loadConfig();
    const base = new URL(String(config.ome?.playerurl || ""));
    if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("Invalid OME LL-HLS origin");
    const root = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    const target = new URL(`${root}${relativePath}${String(data.query || "")}`, base.origin);
    if (target.origin !== base.origin || !target.pathname.startsWith(root)) {
      throw new Error("Relay media path escaped the configured OME origin");
    }

    const requestHeaders = {};
    for (const name of ["accept", "range", "if-none-match", "if-modified-since"]) {
      const value = data.headers?.[name];
      if (value) requestHeaders[name] = String(value);
    }

    const upstream = await axios.get(target.toString(), {
      responseType: "arraybuffer",
      headers: requestHeaders,
      timeout: 12_000,
      maxContentLength: MAX_PROXY_BODY,
      maxBodyLength: MAX_PROXY_BODY,
      validateStatus: () => true
    });

    let body = Buffer.from(upstream.data || Buffer.alloc(0));
    if (body.length > MAX_PROXY_BODY) throw new Error("OME relay response exceeded limit");
    const headers = {};
    for (const name of [
      "content-type", "cache-control", "etag", "last-modified",
      "accept-ranges", "content-range", "content-length"
    ]) {
      if (upstream.headers?.[name] != null) headers[name] = upstream.headers[name];
    }

    const contentType = String(upstream.headers?.["content-type"] || "").toLowerCase();
    if (body.length && (contentType.includes("mpegurl") || relativePath.toLowerCase().endsWith(".m3u8"))) {
      body = normalizeLlhlsManifestForRelay(body, base);
      headers["content-length"] = String(body.length);
    }

    if (upstream.status >= 400) {
      console.warn(`NekoLive tunnel OME response ${upstream.status}: ${target.pathname}${target.search}`);
    }

    sendResponse({
      status: upstream.status,
      headers,
      bodyBase64: body.toString("base64"),
      upstreamBase: `${base.origin}${root}`
    });
  } catch (error) {
    console.warn("NekoLive tunnel media request failed:", error.message);
    sendResponse({
      status: 502,
      headers: { "content-type": "text/plain" },
      bodyBase64: Buffer.from("Selfhost media upstream unavailable.").toString("base64")
    });
  }
}

async function handleTunnelMessage(raw) {
  let data;
  try {
    data = JSON.parse(String(raw));
  } catch (_) {
    return;
  }

  if (data.type === "proxy_request") {
    await handleProxyRequest(data);
    return;
  }

  if (data.type === "chat_from_nekolive" && typeof chatInjector === "function") {
    chatInjector({
      displayName: String(data.displayName || data.username || "NekoLive").slice(0, 40),
      message: String(data.message || "").slice(0, 500),
      ts: Number(data.ts) || Date.now(),
      source: "nekolive",
      sourceLabel: "NEKOLIVE"
    });
    return;
  }

  if (data.type === "ping" && tunnelSocket?.readyState === WebSocket.OPEN) {
    tunnelSocket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
  }
}

async function ensureTunnel() {
  if (stopping) return;
  if (tunnelSocket && (tunnelSocket.readyState === WebSocket.OPEN || tunnelSocket.readyState === WebSocket.CONNECTING)) return;

  const settings = await Settings.findByPk(1);
  if (
    !settings?.federationEnabled ||
    !settings.federationRelayEnabled ||
    settings.federationBlocked ||
    !settings.federationHubUrl ||
    !settings.federationNodeId ||
    !settings.federationNodeSecret
  ) return;

  let ws;
  try {
    ws = new WebSocket(websocketTunnelUrl(settings), {
      handshakeTimeout: 10_000,
      maxPayload: MAX_PROXY_BODY + 1024 * 1024
    });
  } catch (_) {
    scheduleTunnelReconnect();
    return;
  }
  tunnelSocket = ws;

  ws.on("message", (raw) => {
    handleTunnelMessage(raw).catch(() => {});
  });
  ws.on("close", () => {
    if (tunnelSocket === ws) tunnelSocket = null;
    scheduleTunnelReconnect();
  });
  ws.on("error", () => {});
}

async function heartbeat() {
  if (heartbeatInFlight) return;
  heartbeatInFlight = true;
  try {
    const settings = await Settings.findByPk(1);
    if (
      !settings?.federationEnabled ||
      !settings.federationHubUrl ||
      !settings.federationNodeId ||
      !settings.federationNodeSecret
    ) return;

    if (settings.federationRelayEnabled) await ensureTunnel();

    const identity = nodeIdentity.getIdentity();
    const config = loadConfig();
    const live = liveDetection.getState();
    const playback = resolveOmePlaybackUrls(
      config.ome,
      config.ome.streamName,
      settings.federationPublicUrl || config.siteUrl
    );
    const tunnelMode = settings.federationTransportMode === "tunnel";
    const relayLive = Boolean(live.isLive && settings.federationRelayEnabled && !settings.federationBlocked);
    const payload = {
      nodeIdentity: {
        nodeId: identity.nodeId,
        hardwareBindingHash: identity.hardwareBindingHash
      },
      transportMode: tunnelMode ? "tunnel" : "direct",
      relayEnabled: Boolean(settings.federationRelayEnabled),
      publicUrl: tunnelMode ? null : settings.federationPublicUrl,
      channel: {
        name: settings.channelName,
        title: settings.channelTitle || "",
        bio: settings.channelBio || "",
        game: settings.channelGame || "",
        isLive: relayLive,
        llhlsUrl: !tunnelMode && relayLive ? playback.llhls : null,
        llhlsPath: tunnelMode && relayLive ? llhlsPath(playback.llhls) : null,
        viewerCount: viewerSessions.countViewers(config.ome.streamName)
      }
    };

    const response = await axios.post(
      `${normalizeBaseUrl(settings.federationHubUrl)}/streamnode/federation/heartbeat`,
      payload,
      {
        headers: signedHeaders(settings, payload),
        timeout: 8_000,
        validateStatus: () => true
      }
    );

    if (response.status >= 200 && response.status < 300) {
      const blocked = !!(response.data?.blocked || response.data?.terminated);
      settings.federationBlocked = blocked;
      if (response.data?.channelName) {
        settings.federationChannelName = String(response.data.channelName).slice(0, 80);
      }
      if (response.data?.transportMode) {
        settings.federationTransportMode = response.data.transportMode === "tunnel" ? "tunnel" : "direct";
      }
      settings.federationLastSeenAt = new Date();
      await settings.save();
      if (blocked) closeTunnel();
    } else if (response.status === 403 || response.status === 409) {
      settings.federationBlocked = true;
      await settings.save();
      closeTunnel();
    }
  } catch (error) {
    console.warn("NekoLive federation heartbeat failed:", error.message);
  } finally {
    heartbeatInFlight = false;
  }
}

async function setRelayEnabled(enabled) {
  const settings = await Settings.findByPk(1);
  if (!settings) return;
  settings.federationRelayEnabled = Boolean(enabled);
  await settings.save();
  if (settings.federationRelayEnabled) {
    await ensureTunnel();
  } else {
    closeTunnel();
  }
  await heartbeat();
}

async function unlinkAccountToGuest() {
  const settings = await Settings.findByPk(1);
  if (!settings?.federationEnabled || !settings.federationNodeId || !settings.federationNodeSecret || !settings.federationHubUrl) {
    throw new Error("This Selfhost node is not linked to NekoLive.");
  }
  if (settings.federationGuestNode) return settings;

  const payload = { channelName: settings.channelName || "" };
  const response = await axios.post(
    `${normalizeBaseUrl(settings.federationHubUrl)}/streamnode/federation/unlink-account`,
    payload,
    {
      headers: signedHeaders(settings, payload),
      timeout: 8_000,
      validateStatus: () => true
    }
  );

  if (response.status < 200 || response.status >= 300 || !response.data?.guestNode) {
    throw new Error(response.data?.error || `Failed to unlink NekoLive account (${response.status}).`);
  }

  closeTunnel();
  settings.federationGuestNode = true;
  settings.federationTransportMode = "tunnel";
  settings.federationRelayEnabled = true;
  settings.federationPublicUrl = null;
  settings.federationChannelName = response.data.channelName || null;
  settings.federationBlocked = false;
  settings.federationLastSeenAt = new Date();
  await settings.save();

  await ensureTunnel();
  await heartbeat();
  await settings.reload();
  return settings;
}

function setChatInjector(fn) {
  chatInjector = typeof fn === "function" ? fn : null;
}

function sendChatMessage(payload) {
  const ws = tunnelSocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const message = String(payload?.message || "").trim().slice(0, 500);
  if (!message) return false;
  ws.send(JSON.stringify({
    type: "chat_from_selfhost",
    displayName: String(payload?.displayName || "Guest").trim().slice(0, 40) || "Guest",
    message,
    ts: Number(payload?.ts) || Date.now()
  }));
  return true;
}

async function disconnect() {
  const settings = await Settings.findByPk(1);
  if (settings?.federationNodeId && settings.federationNodeSecret && settings.federationHubUrl) {
    const payload = { action: "disconnect" };
    try {
      await axios.post(
        `${normalizeBaseUrl(settings.federationHubUrl)}/streamnode/federation/disconnect`,
        payload,
        {
          headers: signedHeaders(settings, payload),
          timeout: 8_000,
          validateStatus: () => true
        }
      );
    } catch (_) {}
  }

  closeTunnel();
  if (settings) {
    settings.federationEnabled = false;
    settings.federationRelayEnabled = true;
    settings.federationGuestNode = false;
    settings.federationTransportMode = "direct";
    settings.federationHubUrl = null;
    settings.federationPublicUrl = null;
    settings.federationNodeId = null;
    settings.federationNodeSecret = null;
    settings.federationChannelName = null;
    settings.federationBlocked = false;
    settings.federationLastSeenAt = null;
    await settings.save();
  }
}

function verifyControlSignature(settings, payload, headers) {
  const nodeId = String(headers["x-nekolive-node-id"] || "");
  const timestamp = String(headers["x-nekolive-timestamp"] || "");
  const provided = String(headers["x-nekolive-signature"] || "");
  if (!settings?.federationNodeSecret || nodeId !== settings.federationNodeId) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > 5 * 60_000) return false;
  const expected = signature(settings.federationNodeSecret, nodeId, timestamp, payload);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function start() {
  if (heartbeatTimer) return;
  stopping = false;
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  heartbeatTimer.unref?.();
  ensureTunnel().catch(() => {});
  heartbeat().catch(() => {});
}

function stop() {
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  closeTunnel();
}

module.exports = {
  pair,
  registerGuest,
  unlinkAccountToGuest,
  disconnect,
  heartbeat,
  setRelayEnabled,
  setChatInjector,
  sendChatMessage,
  getNodeIdentity: nodeIdentity.getIdentity,
  start,
  stop,
  verifyControlSignature
};
