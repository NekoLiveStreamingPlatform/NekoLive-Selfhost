// Ported from NekoLive's views/js/player.js — the exact same player the
// main site uses for its own channel page's main video (LLHLS via hls.js/
// native HLS; WHEP there is only for co-stream tiles, which this app
// doesn't have, so nothing WHEP-related was carried over). Stripped: the
// IMA/VAST ad-preroll code — this app has no ads/monetization at all, so
// it would only ever be dead, never-triggered code paths.
(() => {
  let hls = null;
  let currentUrl = null;
  let retryTimer = null;
  let watchdogTimer = null;
  let keepLiveTimer = null;
  let stalledSince = 0;
  let menuOpen = false;

  const RETRY_MS = 3000;
  const WATCHDOG_MS = 1500;
  const STALL_THRESHOLD_MS = 5000;

  // ~3-5s latency
  const HLS_CFG = {
    enableWorker: true,
    lowLatencyMode: true,
    liveSyncDuration: 3.0,
    liveMaxLatencyDuration: 8.0,
    maxBufferLength: 10,
    maxMaxBufferLength: 16,
    maxBufferHole: 0.5,
    backBufferLength: 60,
    fragLoadingTimeOut: 20000,
    manifestLoadingTimeOut: 20000,
    levelLoadingMaxRetry: 8,
    manifestLoadingMaxRetry: 8
  };

  const $ = s => document.querySelector(s);
  const v = () => document.getElementById("stream-video");

  // ---------- Audio prefs ----------
  const LS_VOLUME_KEY = "nl_volume";
  const LS_MUTED_KEY = "nl_muted";
  const saveAudio = el => { try {
    localStorage.setItem(LS_VOLUME_KEY, String(el.volume));
    localStorage.setItem(LS_MUTED_KEY, String(el.muted));
  } catch {} };
  const loadAudio = el => { try {
    const vol = parseFloat(localStorage.getItem(LS_VOLUME_KEY));
    const muted = localStorage.getItem(LS_MUTED_KEY);
    if (!Number.isNaN(vol)) el.volume = Math.min(1, Math.max(0, vol));
    if (muted !== null) el.muted = (muted === "true");
  } catch {} };

  // ---------- UI ----------
  function buildUI() {
    const wrap = v().parentElement || document.body;

    wrap.querySelectorAll(".nl-controls,.nl-center-play,.nl-menu").forEach(n => n.remove());

    const bar = document.createElement("div");
    bar.className = "nl-controls";
    bar.innerHTML = `
      <button class="nl-btn" id="nl-play" title="Play/Pause">▶</button>
      <span class="nl-time" id="nl-time">LIVE</span>
      <span class="nl-live" id="nl-live">LIVE</span>
      <div class="nl-spacer"></div>
      <div class="nl-vol-wrap">
        <button class="nl-btn" id="nl-mute" title="Mute/Unmute">🔊</button>
        <input class="nl-range" id="nl-vol" type="range" min="0" max="1" step="0.01" value="1">
      </div>
      <button class="nl-btn" id="nl-quality" title="Quality">⚙</button>
      <button class="nl-btn" id="nl-pip" title="Picture in Picture">▣</button>
      <button class="nl-btn" id="nl-fs" title="Fullscreen">⛶</button>
    `;
    wrap.appendChild(bar);

    const menu = document.createElement("div");
    menu.className = "nl-menu"; menu.id = "nl-qmenu";
    wrap.appendChild(menu);

    const playBtn = $("#nl-play");
    const muteBtn = $("#nl-mute");
    const vol = $("#nl-vol");
    const pip = $("#nl-pip");
    const fs = $("#nl-fs");
    const q = $("#nl-quality");

    const updatePlay = () => { playBtn.textContent = v().paused ? "▶" : "⏸"; };
    const updateMute = () => { muteBtn.textContent = v().muted || v().volume === 0 ? "🔈" : "🔊"; };

    playBtn.onclick = () => v().paused ? v().play().catch(() => {}) : v().pause();
    v().addEventListener("play", updatePlay);
    v().addEventListener("pause", updatePlay);
    updatePlay();

    vol.value = v().volume ?? 1;
    vol.oninput = () => { v().volume = Number(vol.value); v().muted = (v().volume === 0); saveAudio(v()); updateMute(); };
    muteBtn.onclick = () => { v().muted = !v().muted; if (!v().muted && v().volume === 0) v().volume = .5; saveAudio(v()); updateMute(); };
    updateMute();

    fs.onclick = () => {
      const wrap = v().parentElement;
      if (document.fullscreenElement) document.exitFullscreen();
      else wrap.requestFullscreen?.();
    };

    pip.onclick = async () => {
      try {
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else await v().requestPictureInPicture();
      } catch (e) { console.warn("[PiP] not available", e); }
    };

    q.onclick = () => {
      menuOpen = !menuOpen;
      $("#nl-qmenu").classList.toggle("show", menuOpen);
      if (menuOpen) rebuildQualityMenu();
    };
    document.addEventListener("click", (e) => {
      if (!menuOpen) return;
      if (!$("#nl-qmenu").contains(e.target) && e.target !== q) {
        $("#nl-qmenu").classList.remove("show");
        menuOpen = false;
      }
    });

    // show controls once on first pointer move (useful on mobile)
    const showOnce = () => { bar.classList.add("nl-show"); window.removeEventListener("pointermove", showOnce); };
    window.addEventListener("pointermove", showOnce, { once: true });
  }

  function rebuildQualityMenu() {
    const m = $("#nl-qmenu");
    if (!hls || !hls.levels?.length) {
      m.innerHTML = `<button disabled>No quality options</button>`;
      return;
    }
    const cur = hls.autoLevelEnabled ? -1 : hls.currentLevel;
    const items = [`<button data-q="-1"${cur === -1 ? ' style="font-weight:700"' : ''}>Auto</button>`]
      .concat(hls.levels.map((L, idx) => {
        const label = (L.height ? `${L.height}p` : `${Math.round((L.bitrate || 0) / 1000)}kbps`);
        const is = idx === cur;
        return `<button data-q="${idx}"${is ? ' style="font-weight:700"' : ''}>${label}</button>`;
      }));
    m.innerHTML = items.join("");
    m.querySelectorAll("button[data-q]").forEach(btn => {
      btn.onclick = () => {
        const q = Number(btn.getAttribute("data-q"));
        if (q === -1) {
          hls.currentLevel = -1; hls.autoLevelEnabled = true;
        } else {
          hls.autoLevelEnabled = false; hls.currentLevel = q;
        }
        $("#nl-qmenu").classList.remove("show"); menuOpen = false;
      };
    });
  }

  // ---------- autoplay with audio (fallback muted + pill) ----------
  function showUnmuteOverlay() {
    if ($(".mejs__unmute-pill")) return;
    const btn = document.createElement("button");
    btn.className = "mejs__unmute-pill";
    btn.textContent = "Tap to unmute";
    const wrap = v().parentElement || document.body;
    wrap.appendChild(btn);
    const unmute = () => { v().muted = false; v().volume = Math.max(0.25, v().volume || 0.5); v().play().catch(() => {}); saveAudio(v()); btn.remove(); };
    btn.addEventListener("click", unmute, { once: true });
    document.addEventListener("pointerdown", unmute, { once: true });
    document.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") unmute(); }, { once: true });
  }
  async function tryAutoplayWithAudio() {
    loadAudio(v());
    if (v().muted === false && (v().volume ?? 1) > 0) {
      try { await v().play(); return; } catch {}
    }
    v().muted = true;
    try { await v().play(); showUnmuteOverlay(); } catch { showUnmuteOverlay(); }
  }

  // ---------- life-cycle ----------
  function clearTimers() {
    if (retryTimer) clearTimeout(retryTimer); retryTimer = null;
    if (watchdogTimer) clearInterval(watchdogTimer); watchdogTimer = null;
    if (keepLiveTimer) clearInterval(keepLiveTimer); keepLiveTimer = null;
  }
  function cleanup() {
    clearTimers(); stalledSince = 0;
    const el = v(); if (el) { saveAudio(el); try { el.pause(); } catch {} try { el.removeAttribute("src"); } catch {} try { el.load(); } catch {} }
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    currentUrl = null;
  }

  function scheduleRecover(tag) {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (currentUrl) initializeMediaElementPlayer(currentUrl);
    }, RETRY_MS);
    console.warn("[HLS] recover scheduled:", tag);
  }

  function startWatchdog() {
    clearInterval(watchdogTimer);
    let lastT = v().currentTime;
    watchdogTimer = setInterval(() => {
      if (v().paused || v().readyState < 2) return;
      const t = v().currentTime;
      if (t === lastT) {
        if (!stalledSince) stalledSince = performance.now();
        const elapsed = performance.now() - stalledSince;

        if (hls?.liveSyncPosition && hls.liveSyncPosition - v().currentTime > 3) {
          v().currentTime = hls.liveSyncPosition - 0.5;
        }
        if (elapsed > STALL_THRESHOLD_MS) {
          console.warn("[HLS] stall -> recover");
          stalledSince = 0;
          try { hls?.recoverMediaError(); } catch {}
          try { hls?.startLoad(-1); } catch {}
          try { v().play(); } catch {}
        }
      } else {
        stalledSince = 0;
      }
      lastT = t;
    }, WATCHDOG_MS);

    clearInterval(keepLiveTimer);
    keepLiveTimer = setInterval(() => {
      const behind = hls?.liveSyncPosition ? Math.max(0, hls.liveSyncPosition - v().currentTime) : 0;
      $("#nl-time").textContent = behind <= 1.0 ? "LIVE" : `LIVE -${behind.toFixed(1)}s`;
    }, 1000);
  }

  // ---------- Public API ----------
  window.destroyStreamPlayer = cleanup;

  window.initializeMediaElementPlayer = function initializeMediaElementPlayer(url) {
    const el = v();
    if (!el) return;

    const fallback = el.querySelector("source")?.src || "";
    const src = url || el.getAttribute("data-playback") || fallback;
    if (!src) { console.warn("[HLS] no source URL"); return; }
    if (currentUrl === src && (hls || el.currentSrc)) return;

    cleanup();
    currentUrl = src;

    el.playsInline = true;
    el.setAttribute("crossorigin", "anonymous");

    buildUI();

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls(HLS_CFG);

      hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
        if (!data.details.live) {
          try { hls.startLoad(-1); } catch {}
        }
      });
      hls.on(Hls.Events.BUFFER_EOS, () => {
        console.warn("[HLS] BUFFER_EOS -> restart at live edge");
        try { hls.startLoad(-1); } catch {}
        try { el.play(); } catch {}
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data?.fatal) return;
        console.warn("[HLS] fatal:", data.type, data.details);
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            try { hls.startLoad(-1); } catch {}
            scheduleRecover("network");
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            try { hls.recoverMediaError(); } catch {}
            break;
          default:
            cleanup(); scheduleRecover("fatal");
        }
      });

      hls.attachMedia(el);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
      hls.on(Hls.Events.MANIFEST_PARSED, async () => {
        await tryAutoplayWithAudio();
        startWatchdog();
        rebuildQualityMenu();
      });

    } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = src;
      tryAutoplayWithAudio();
      startWatchdog();
      el.addEventListener("error", () => scheduleRecover("native-error"), { once: true });
    } else {
      console.error("[HLS] Not supported (hls.js missing?)");
    }

    ["volumechange", "pause"].forEach(ev => el.addEventListener(ev, () => saveAudio(el)));
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const el = v(); if (!el || el.paused || !currentUrl) return;
    el.play().catch(() => {});
  });
})();
