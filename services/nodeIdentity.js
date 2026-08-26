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

function hardwareMaterial() {
  const values = [];
  const candidates = [
    // Common x86/UEFI hosts. Docker normally exposes these read-only from the
    // host kernel, so the value survives container recreation.
    "/sys/class/dmi/id/product_uuid",
    "/sys/class/dmi/id/board_serial",
    // Raspberry Pi / ARM boards when the device tree is visible.
    "/proc/device-tree/serial-number",
    // Optional explicit host machine-id mount for deployments that want it.
    "/host/etc/machine-id"
  ];

  // Outside Docker, the machine-id is also a useful stable host signal. Do
  // not use a container image's own /etc/machine-id as a hardware identity.
  if (!isContainer()) candidates.push("/etc/machine-id");

  for (const file of candidates) {
    const value = readTrimmed(file);
    if (value) values.push(`${path.basename(file)}:${value.toLowerCase()}`);
  }

  // Older Raspberry Pi images expose the board serial only through cpuinfo.
  try {
    const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8");
    const match = cpuinfo.match(/^Serial\s*:\s*([0-9a-f]+)$/im);
    if (match?.[1]) values.push(`cpu-serial:${match[1].toLowerCase()}`);
  } catch (_) {}

  return [...new Set(values)].sort();
}

function digest(parts) {
  return crypto
    .createHash("sha256")
    .update(DOMAIN_SEPARATOR)
    .update("\0")
    .update(parts.join("\0"))
    .digest("hex");
}

function readPersistedFallback() {
  try {
    const parsed = JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf8"));
    if (typeof parsed.fallbackSeed === "string" && /^[a-f0-9]{64}$/.test(parsed.fallbackSeed)) {
      return parsed.fallbackSeed;
    }
  } catch (_) {}
  return null;
}

function persist(identity) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), { mode: 0o600 });
  } catch (error) {
    console.warn("Unable to persist node identity diagnostics:", error.message);
  }
}

function getIdentity() {
  const material = hardwareMaterial();
  let hardwareBindingHash;
  let source;
  let fallbackSeed = null;

  if (material.length) {
    // Only this one-way digest leaves the Selfhost process. Raw board serials,
    // UUIDs and machine IDs are never transmitted to NekoLive.
    hardwareBindingHash = digest(material);
    source = "hardware";
  } else {
    fallbackSeed = readPersistedFallback() || crypto.randomBytes(32).toString("hex");
    hardwareBindingHash = digest([`fallback:${fallbackSeed}`]);
    source = "persistent-fallback";
  }

  const nodeId = `nl-${hardwareBindingHash.slice(0, 32)}`;
  const identity = {
    version: 1,
    nodeId,
    hardwareBindingHash,
    source,
    ...(fallbackSeed ? { fallbackSeed } : {})
  };
  persist(identity);
  return identity;
}

module.exports = { getIdentity };
