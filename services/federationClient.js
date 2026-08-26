const crypto = require("crypto");
const axios = require("axios");
const Settings = require("../models/Settings");
const { loadConfig } = require("../config/loader");
const { resolveOmePlaybackUrls } = require("./omeClient");
const liveDetection = require("./liveDetection");
const viewerSessions = require("./viewerSessions");

const HEARTBEAT_MS = 15_000;
let heartbeatTimer = null;
let heartbeatInFlight = false;

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

async function pair({ hubUrl, publicUrl, pairingCode }) {
  const hub = normalizeBaseUrl(hubUrl);
  const publicBase = normalizeBaseUrl(publicUrl);
  if (!/^https?:\/\//i.test(hub)) throw new Error("Hub URL must start with http:// or https://");
  if (!/^https?:\/\//i.test(publicBase)) throw new Error("Public node URL must start with http:// or https://");
  if (!pairingCode) throw new Error("Pairing code is required.");

  const response = await axios.post(
    `${hub}/streamnode/federation/pair`,
    {
      pairingCode: String(pairingCode).trim(),
      publicUrl: publicBase,
      software: "NekoLive-Selfhost"
    },
    { timeout: 10_000, validateStatus: () => true }
  );

  if (response.status < 200 || response.status >= 300 || !response.data?.nodeId || !response.data?.nodeSecret) {
    throw new Error(response.data?.error || `NekoLive pairing failed (${response.status}).`);
  }

  const settings = await Settings.findByPk(1);
  settings.federationHubUrl = hub;
  settings.federationPublicUrl = publicBase;
  settings.federationNodeId = response.data.nodeId;
  settings.federationNodeSecret = response.data.nodeSecret;
  settings.federationChannelName = response.data.channelName || null;
  settings.federationEnabled = true;
  settings.federationBlocked = false;
  await settings.save();

  await heartbeat();
  return settings;
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

    const config = loadConfig();
    const live = liveDetection.getState();
    const playback = resolveOmePlaybackUrls(
      config.ome,
      config.ome.streamName,
      settings.federationPublicUrl || config.siteUrl
    );
    const payload = {
      publicUrl: settings.federationPublicUrl,
      channel: {
        // This local name is metadata only. The central NekoLive hub uses the
        // account that generated the pairing code as the authoritative
        // channel identity and ignores this field for channel ownership.
        name: settings.channelName,
        title: settings.channelTitle || "",
        bio: settings.channelBio || "",
        isLive: !!live.isLive,
        // A central termination/blacklist never stops the owner's local
        // stream. It only removes the playback URL from the federation link.
        llhlsUrl: live.isLive && !settings.federationBlocked ? playback.llhls : null,
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
      settings.federationLastSeenAt = new Date();
      await settings.save();
    }
  } catch (error) {
    console.warn("NekoLive federation heartbeat failed:", error.message);
  } finally {
    heartbeatInFlight = false;
  }
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
    } catch (_) {
      // Local unlink must still work when the central service is unreachable.
    }
  }

  if (settings) {
    settings.federationEnabled = false;
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
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  heartbeatTimer.unref?.();
  heartbeat().catch(() => {});
}

function stop() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

module.exports = {
  pair,
  disconnect,
  heartbeat,
  start,
  stop,
  verifyControlSignature
};