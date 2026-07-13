// Minimal single-node/single-channel subset of NekoLive's
// routes/api/livecheck.js: poll OME for one stream's state, debounce with a
// grace period before flipping offline (this exact codebase spent a long
// session fixing a flapping-isLive bug in the main site caused by treating
// a single transient probe failure as "confirmed offline" — this avoids
// repeating that mistake here), and guard against overlapping ticks. No DB
// writes at all: live state is purely in-memory, which is an acceptable
// tradeoff for a single small self-hosted process with no analytics/email
// consumers of that state.
const { loadConfig } = require("../config/loader");
const { getOmeStreamInfo } = require("./omeClient");
const pushRelay = require("./pushRelay");

const POLL_INTERVAL_MS = 20_000;
const GRACE_MS = POLL_INTERVAL_MS * 3; // ~60s of consecutive failures before going offline

const state = {
  isLive: false,
  lastSeenLiveAt: 0,
  since: null
};

let tickRunning = false;
let timer = null;

function getState() {
  return { ...state };
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const config = loadConfig();
    const node = config.ome;
    const info = await getOmeStreamInfo(node, node.streamName);
    const probeSaysLive = !!info?.live;
    const now = Date.now();

    if (probeSaysLive) {
      const wasLive = state.isLive;
      state.isLive = true;
      state.lastSeenLiveAt = now;
      if (!wasLive) state.since = now;
      if (!wasLive) {
        try {
          await pushRelay.onLiveStateChanged(true);
        } catch (error) {
          console.error("pushRelay start failed:", error.message);
        }
      }
      return;
    }

    // Probe says not-live (or the request itself failed, info === null) —
    // only actually flip offline after the grace period, so a single
    // transient OME/network hiccup doesn't bounce the channel page between
    // live/offline every poll.
    if (state.isLive && now - state.lastSeenLiveAt > GRACE_MS) {
      state.isLive = false;
      state.since = null;
      try {
        await pushRelay.onLiveStateChanged(false);
      } catch (error) {
        console.error("pushRelay stop failed:", error.message);
      }
    }
  } catch (error) {
    console.error("Live detection tick failed:", error.message);
  } finally {
    tickRunning = false;
  }
}

function start() {
  if (timer) return;
  tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, getState, POLL_INTERVAL_MS };
