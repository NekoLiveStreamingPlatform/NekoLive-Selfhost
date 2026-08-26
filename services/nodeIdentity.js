const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const IDENTITY_FILE = path.join(DATA_DIR, "node-identity.json");
const DOMAIN_SEPARATOR = "NekoLive-Selfhost-Hardware-Identity-v1";

function readTrimmed(file) {
  try {
    const value = fs.readFileSync(file, "utf8").replace(/\0/g, "").trim();
    return value.length >= 4 ? value : null;
  } catch (_) {
    return null;
  }
}

function isContainer() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch (_) {
    return false;
  }
}

function readPersisted() {
  try {
    const parsed = JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function preferredHardwareAnchor() {
  const candidates = [
    // Prefer one strong/stable anchor instead of combining every field. That
    // avoids changing the Node ID merely because a kernel/container update
    // temporarily stops exposing one secondary DMI property.
    ["dmi-product-uuid", "/sys/class/dmi/id/product_uuid"],
    ["dmi-board-serial", "/sys/class/dmi/id/board_serial"],
    ["device-tree-serial", "/proc/device-tree/serial-number"],
    ["host-machine-id", "/host/etc/machine-id"]
  ];

  if (!isContainer()) candidates.push(["machine-id", "/etc/machine-id"]);

  for (const [kind, file] of candidates) {
    const value = readTrimmed(file);
    if (value) return { kind, value: value.toLowerCase() };
  }

  // Older Raspberry Pi images expose the board serial only through cpuinfo.
  try {
    const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8");
    const match = cpuinfo.match(/^Serial\s*:\s*([0-9a-f]+)$/im);
    if (match?.[1]) return { kind: "cpu-serial", value: match[1].toLowerCase() };
  } catch (_) {}

  return null;
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(DOMAIN_SEPARATOR)
    .update("\0")
    .update(String(value))
    .digest("hex");
}

function persist(identity) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), { mode: 0o600 });
  } catch (error) {
    console.warn("Unable to persist node identity diagnostics:", error.message);
  }
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function getIdentity() {
  const persisted = readPersisted();
  const anchor = preferredHardwareAnchor();
  let hardwareBindingHash;
  let source;
  let fallbackSeed = null;
  let anchorType = null;

  if (anchor) {
    hardwareBindingHash = digest(`${anchor.kind}:${anchor.value}`);
    source = "hardware";
    anchorType = anchor.kind;
  } else if (validHash(persisted?.hardwareBindingHash)) {
    // If the host temporarily stops exposing DMI/device-tree values, retain
    // the previously hardware-derived identity from the persistent data
    // volume instead of unexpectedly creating a different Node ID.
    hardwareBindingHash = persisted.hardwareBindingHash;
    source = persisted.source === "hardware" ? "hardware-cached" : "persistent-fallback";
    fallbackSeed = typeof persisted.fallbackSeed === "string" ? persisted.fallbackSeed : null;
    anchorType = persisted.anchorType || null;
  } else {
    fallbackSeed =
      (typeof persisted?.fallbackSeed === "string" && /^[a-f0-9]{64}$/.test(persisted.fallbackSeed)
        ? persisted.fallbackSeed
        : crypto.randomBytes(32).toString("hex"));
    hardwareBindingHash = digest(`fallback:${fallbackSeed}`);
    source = "persistent-fallback";
  }

  const nodeId = `nl-${hardwareBindingHash.slice(0, 32)}`;
  const identity = {
    version: 2,
    nodeId,
    hardwareBindingHash,
    source,
    ...(anchorType ? { anchorType } : {}),
    ...(fallbackSeed ? { fallbackSeed } : {})
  };
  persist(identity);
  return identity;
}

module.exports = { getIdentity };
