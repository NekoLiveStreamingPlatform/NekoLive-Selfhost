(function () {
  "use strict";

  const STATUS_POLL_MS = 10000;
  const offlineOverlay = document.getElementById("nl-offline-overlay");
  const liveBadge = document.getElementById("nl-live-badge");
  const viewerCountEl = document.getElementById("nl-viewer-count");
  const streamTitleEl = document.getElementById("nl-stream-title");
  const chatFeed = document.getElementById("nl-chat-feed");
  const nameRow = document.getElementById("nl-chat-name-row");
  const nameInput = document.getElementById("nl-chat-name-input");
  const nameSaveBtn = document.getElementById("nl-chat-name-save");
  const inputRow = document.getElementById("nl-chat-input-row");
  const chatInput = document.getElementById("nl-chat-input");
  const chatSendBtn = document.getElementById("nl-chat-send");

  let lastLiveState = null;

  // ---------- Video status polling ----------
  // Playback itself (play/pause/mute/volume/quality/PiP/fullscreen/stall
  // recovery) is entirely owned by /js/player.js — the same player used on
  // the main NekoLive site's channel page. This just tells it when to
  // start/stop via window.initializeMediaElementPlayer/destroyStreamPlayer.
  async function pollStatus() {
    try {
      const res = await fetch("/api/stream/status", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) return;

      if (data.title) streamTitleEl.textContent = data.title;
      viewerCountEl.textContent = `${data.viewerCount} watching`;

      if (data.live) {
        liveBadge.textContent = "LIVE";
        liveBadge.className = "nl-live-badge";
        offlineOverlay.style.display = "none";
      } else {
        liveBadge.textContent = "OFFLINE";
        liveBadge.className = "nl-offline-badge";
        offlineOverlay.style.display = "flex";
      }

      // Only start/stop when the live state actually changes — avoids
      // tearing down and reconnecting a perfectly fine HLS session on every
      // single poll.
      if (data.live !== lastLiveState) {
        lastLiveState = data.live;
        if (data.live && data.llhlsUrl) {
          window.initializeMediaElementPlayer(data.llhlsUrl);
        } else {
          window.destroyStreamPlayer();
        }
      }
    } catch (err) {
      console.error("stream status poll failed:", err);
    }
  }
  pollStatus();
  setInterval(pollStatus, STATUS_POLL_MS);

  // ---------- Chat ----------
  const DISPLAY_NAME_KEY = "nl_selfhost_display_name";
  let displayName = localStorage.getItem(DISPLAY_NAME_KEY) || "";
  let ws = null;
  let pingTimer = null;

  function appendChatMessage(name, message) {
    const line = document.createElement("div");
    line.className = "nl-chat-message";
    const nameSpan = document.createElement("span");
    nameSpan.className = "nl-chat-name";
    nameSpan.textContent = name + ":";
    const textSpan = document.createElement("span");
    textSpan.textContent = " " + message;
    line.appendChild(nameSpan);
    line.appendChild(textSpan);
    chatFeed.appendChild(line);
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  function appendSystemMessage(text) {
    const line = document.createElement("div");
    line.className = "nl-chat-message";
    line.style.color = "var(--muted)";
    line.style.fontStyle = "italic";
    line.textContent = text;
    chatFeed.appendChild(line);
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  function connectChat() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${window.location.host}/ws/chat`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", displayName, adminToken: window.NL_ADMIN_TOKEN }));
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 15000);
    };
    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (data.type === "joined") appendSystemMessage("Connected to chat.");
      else if (data.type === "chat_message") appendChatMessage(data.displayName, data.message);
      else if (data.type === "viewer_count") viewerCountEl.textContent = `${data.count} watching`;
      else if (data.type === "banned") appendSystemMessage("You have been banned.");
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      // Visible instead of a silently empty chat box — if this keeps
      // reappearing every few seconds, the WebSocket upgrade for /ws/chat
      // isn't reaching this app at all (commonly a reverse proxy in front
      // of it not forwarding the Upgrade/Connection headers for that path).
      appendSystemMessage("Chat disconnected — reconnecting...");
      setTimeout(connectChat, 3000);
    };
    ws.onerror = () => {};
  }

  function joinChatWithName(name) {
    displayName = name;
    localStorage.setItem(DISPLAY_NAME_KEY, name);
    nameRow.style.display = "none";
    inputRow.style.display = "flex";
    connectChat();
  }

  if (displayName) {
    joinChatWithName(displayName);
  } else {
    nameSaveBtn.addEventListener("click", () => {
      const value = nameInput.value.trim();
      if (!value) return;
      joinChatWithName(value.slice(0, 24));
    });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") nameSaveBtn.click();
    });
  }

  function sendChatMessage() {
    const value = chatInput.value.trim();
    if (!value || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", message: value }));
    chatInput.value = "";
  }
  chatSendBtn.addEventListener("click", sendChatMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });
})();
