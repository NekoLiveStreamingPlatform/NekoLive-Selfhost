const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");

let cached = null;

// Fails loudly and early rather than silently booting with placeholder OME
// credentials from config.example.json — a self-hosted deploy with the wrong
// (or missing) OME access token would otherwise fail in a confusing way much
// later, at the first admission-webhook/live-check call instead of at startup.
function loadConfig() {
  if (cached) return cached;
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Missing config/config.json. Copy config/config.example.json to config/config.json and fill in your OME node's details first.`
    );
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  cached = JSON.parse(raw);
  return cached;
}

module.exports = { loadConfig, CONFIG_PATH };
