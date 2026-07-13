// A deliberately small, from-scratch chat — NOT a port of NekoLive's
// chat/chatServer.js (967 lines, 12 Sequelize models, roles, mod commands,
// emotes — far too coupled to NekoLive's account system to reuse). Viewers
// here never make any account at all: they pick a display name and chat.
// The owner (identified via ADMIN_TOKEN, see below) gets one moderation
// power — ban — which writes to the same BannedConnection table the OME
// admission webhook consults, so one action blocks both chat and playback.
const WebSocket = require("ws");
const crypto = require("crypto");
const BannedConnection = require("../models/BannedConnection");

// Generated fresh on every process start, never persisted. The channel page
// only ever embeds this into the HTML when the request's session is already
// logged in (see routes/index.js + views/channel.ejs), so it never reaches
// an anonymous viewer's browser. This sidesteps needing to unsign/parse the
// express-session cookie from inside the raw WebSocket upgrade handshake —
// a much smaller surface for a single-owner app than wiring up the session
// store there.
const ADMIN_TOKEN = crypto.randomBytes(24).toString("hex");

const MAX_DISPLAY_NAME_LENGTH = 24;
const MAX_MESSAGE_LENGTH = 500;

let wss = null;
const clients = new Map(); // ws -> { displayName, ip, isAdmin }

// Messages are only ever inserted via textContent client-side (never
// innerHTML), so this just keeps names sane-looking rather than guarding
// against injection — trim, cap length, and fall back to a random guest
// name if left blank.
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
    if (!info.displayName) return; // must join first
    const message = String(data.message || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) return;
    broadcast({ type: "chat_message", displayName: info.displayName, message: message, ts: Date.now() });
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
    if (req.url !== "/ws/chat") return;
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
}

module.exports = { start: start, stop: stop, ADMIN_TOKEN: ADMIN_TOKEN };
