// Copied verbatim from NekoLive's views/js/nl-whep-player.js — no
// NekoLive-specific dependencies, only browser APIs (RTCPeerConnection,
// fetch, MediaStream) plus the optional global window.Hls for LLHLS
// fallback (loaded via CDN in views/partials/header.ejs).
(function () {
  "use strict";

  // videoEl: a <video> element. whepUrl: the stream's WHEP endpoint.
  // Returns the RTCPeerConnection so the caller can close() it on teardown.
  async function attachWhep(videoEl, whepUrl) {
    const pc = new RTCPeerConnection();
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      remoteStream.addTrack(event.track);
      videoEl.srcObject = remoteStream;
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const res = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp
    });
    if (!res.ok) {
      pc.close();
      throw new Error(`WHEP offer failed (${res.status})`);
    }
    const answerSdp = await res.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    return pc;
  }

  function detachWhep(pc) {
    try {
      pc?.close();
    } catch (_) {}
  }

  function supportsWebRTCPlayback() {
    return typeof window.RTCPeerConnection === "function";
  }

  // LLHLS fallback — hls.js where available, else native <video> HLS
  // (Safari/iOS).
  function attachHlsFallback(videoEl, hlsUrl) {
    if (!hlsUrl) return null;
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, liveSyncDuration: 3.0 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(videoEl);
      videoEl.play?.().catch(() => {});
      return { type: "hls", hls };
    }
    if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = hlsUrl;
      videoEl.play?.().catch(() => {});
      return { type: "native-hls", videoEl };
    }
    return null;
  }

  const WHEP_CONNECT_TIMEOUT_MS = 6000;

  // Picks WHEP (WebRTC) when supported and the connection actually comes up
  // within a short window, falling back to LLHLS otherwise — covers
  // browsers/devices with no or broken WebRTC support instead of forcing
  // one protocol everywhere.
  async function attachBestPlayback(videoEl, { whepUrl, llhlsUrl } = {}) {
    if (whepUrl && supportsWebRTCPlayback()) {
      try {
        const pc = await attachWhep(videoEl, whepUrl);
        const result = await new Promise((resolve) => {
          let settled = false;
          const finishWhep = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ type: "whep", pc });
          };
          const fallbackToHls = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            detachWhep(pc);
            resolve(attachHlsFallback(videoEl, llhlsUrl) || { type: "none" });
          };
          const checkState = () => {
            const state = pc.connectionState || pc.iceConnectionState;
            if (state === "connected" || state === "completed") finishWhep();
            else if (state === "failed" || state === "disconnected" || state === "closed") fallbackToHls();
          };
          const timer = setTimeout(fallbackToHls, WHEP_CONNECT_TIMEOUT_MS);
          pc.addEventListener("connectionstatechange", checkState);
          pc.addEventListener("iceconnectionstatechange", checkState);
          checkState();
        });
        return result;
      } catch (err) {
        console.warn("WHEP attach failed, falling back to LLHLS:", err.message);
      }
    }
    return attachHlsFallback(videoEl, llhlsUrl) || { type: "none" };
  }

  function detachBestPlayback(handle) {
    if (!handle) return;
    if (handle.type === "whep") detachWhep(handle.pc);
    else if (handle.type === "hls") {
      try { handle.hls.destroy(); } catch (_) {}
    } else if (handle.type === "native-hls" && handle.videoEl) {
      try {
        handle.videoEl.removeAttribute("src");
        handle.videoEl.load();
      } catch (_) {}
    }
  }

  window.NLWhepPlayer = { attachWhep, detachWhep, attachBestPlayback, detachBestPlayback };
})();
