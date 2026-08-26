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

  const DISPLAY_NAME_KEY = "nl_selfhost_display_name";
  let displayName = localStorage.getItem(DISPLAY_NAME_KEY) || "";
  let ws = null;
  let pingTimer = null;

  function appendChatMessage(name, message, sourceLabel) {
    const line = document.createElement("div");
    line.className = "nl-chat-message";

    if (sourceLabel) {
      const source = document.createElement("span");
      source.textContent = sourceLabel;
      source.style.display = "inline-block";
      source.style.marginRight = ".4rem";
      source.style.padding = ".1rem .35rem";
      source.style.border = "1px solid var(--border)";
      source.style.borderRadius = ".35rem";
      source.style.fontSize = ".65rem";
      source.style.fontWeight = "700";
      source.style.letterSpacing = ".04em";
      line.appendChild(source);
    }

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
      else if (data.type === "chat_message") appendChatMessage(data.displayName, data.message, data.sourceLabel || "SELFHOST");
      else if (data.type === "viewer_count") viewerCountEl.textContent = `${data.count} watching`;
      else if (data.type === "banned") appendSystemMessage("You have been banned.");
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
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
