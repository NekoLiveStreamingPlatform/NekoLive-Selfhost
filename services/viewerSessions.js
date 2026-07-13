// Copied as-is from NekoLive's utils/viewerSessions.js — in-memory only,
// dedupes OME's per-connection AdmissionWebhook events by client IP so a
// single browser holding several concurrent LLHLS connections doesn't count
// as several viewers. No DB dependency, single-process, single-channel here
// so there's only ever one implicit "channel" — kept as a parameter anyway
// to keep the shape identical to the original in case this ever needs more
// than one stream name.

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1"]);

function isLoopback(ip) {
  if (!ip) return true;
  if (LOOPBACK_IPS.has(ip)) return true;
  return ip.startsWith("::ffff:127.");
}

const sessionsByChannel = new Map();
const MAX_SESSION_AGE_MS = 6 * 60 * 60 * 1000;

function normalizeChannel(channelName) {
  return String(channelName || "").toLowerCase();
}

function recordOpen(channelName, connectionKey, ip) {
  if (isLoopback(ip)) return;
  const key = normalizeChannel(channelName);
  if (!key) return;
  if (!sessionsByChannel.has(key)) sessionsByChannel.set(key, new Map());
  sessionsByChannel.get(key).set(connectionKey, { ip, openedAt: Date.now() });
}

function recordClose(channelName, connectionKey) {
  sessionsByChannel.get(normalizeChannel(channelName))?.delete(connectionKey);
}

function countViewers(channelName) {
  const conns = sessionsByChannel.get(normalizeChannel(channelName));
  if (!conns || conns.size === 0) return 0;
  const now = Date.now();
  const uniqueIps = new Set();
  for (const [key, conn] of conns) {
    if (now - conn.openedAt > MAX_SESSION_AGE_MS) {
      conns.delete(key);
      continue;
    }
    uniqueIps.add(conn.ip);
  }
  return uniqueIps.size;
}

module.exports = { recordOpen, recordClose, countViewers, isLoopback };
