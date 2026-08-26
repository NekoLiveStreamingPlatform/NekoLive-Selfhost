// A deliberately small, from-scratch chat — NOT a port of NekoLive's
// account-coupled chat server. Viewers here never need a NekoLive account:
// they pick a local display name and chat. When federation relay is enabled,
// messages are mirrored through the authenticated node tunnel and carry an
// explicit SELFHOST / NEKOLIVE source label on both sides.
const WebSocket = require("ws");
const crypto = require("crypto");
const BannedConnection = require("../models/BannedConnection");

const ADMIN_TOKEN = crypto.randomBytes(24).toString("hex");
const MAX_DISPLAY_NAME_LENGTH = 24;
const MAX_MESSAGE_LENGTH = 500;

let wss = null;
let relaySender = null;
const clients = new Map(); // ws -> { displayName, ip, isAdmin }

function sanitizeDisplayName(raw) {
  const cleaned = String(raw || "").trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return cleaned || ("Guest-" + Math.floor(Math.random() * 10000));
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function broadcastViewerCount() {
  broadcast({ type: "viewer_count", count: clients.size });
}

async function isBanned(ip) {
  if (!ip) return false;
  return !!(await BannedConnection.findOne({ where: { ip } }));
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcastFederatedMessage(payload) {
  const message = String(payload?.message || "").trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!message) return;
  broadcast({
    type: "chat_message",
    displayName: sanitizeDisplayName(payload?.displayName || "NekoLive"),
    message,
    ts: Number(payload?.ts) || Date.now(),
    source: "nekolive",
    sourceLabel: "NEKOLIVE"
  });
}

function setRelaySender(fn) {
  relaySender = typeof fn === "function" ? fn : null;
}

async function handleMessage(ws, raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return;
  }

  const info = clients.get(ws);
  if (!info) return;

  if (data.type === "join") {
    info.displayName = sanitizeDisplayName(data.displayName);
    info.isAdmin = typeof data.adminToken === "string" && data.adminToken === ADMIN_TOKEN;
    send(ws, { type: "joined", displayName: info.displayName, isAdmin: info.isAdmin });
    broadcastViewerCount();
    return;
  }

  if (data.type === "chat") {
    if (!info.displayName) return;
    const message = String(data.message || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) return;
    const payload = {
      type: "chat_message",
      displayName: info.displayName,
      message,
      ts: Date.now(),
      source: "selfhost",
      sourceLabel: "SELFHOST"
    };
    broadcast(payload);
    if (relaySender) {
      try {
        relaySender(payload);
      } catch (_) {}
    }
    return;
  }

  if (data.type === "ping") {
    send(ws, { type: "pong" });
    return;
  }

  if (data.type === "ban") {
    if (!info.isAdmin) return;
    const targetName = String(data.displayName || "");
    let targetEntry = null;
    for (const entry of clients.entries()) {
      if (entry[1].displayName === targetName) {
        targetEntry = entry;
        break;
      }
    }
    if (!targetEntry) return;
    const targetWs = targetEntry[0];
    const targetInfo = targetEntry[1];
    await BannedConnection.findOrCreate({
      where: { ip: targetInfo.ip },
      defaults: { reason: "Banned from chat" }
    });
    send(targetWs, { type: "banned" });
    targetWs.close();
  }
}

function start(server) {
  wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const requestPath = req.url.split("?")[0];
    if (requestPath !== "/ws/chat") return;
    wss.handleUpgrade(req, socket, head, async (ws) => {
      const ip = clientIp(req);
      if (await isBanned(ip)) {
        ws.close(4003, "banned");
        return;
      }
      clients.set(ws, { displayName: null, ip: ip, isAdmin: false });
      ws.on("message", (raw) => handleMessage(ws, raw));
      ws.on("close", () => {
        clients.delete(ws);
        broadcastViewerCount();
      });
    });
  });
}

function stop() {
  if (wss) wss.close();
  wss = null;
  clients.clear();
  relaySender = null;
}

module.exports = {
  start,
  stop,
  ADMIN_TOKEN,
  setRelaySender,
  broadcastFederatedMessage
};
