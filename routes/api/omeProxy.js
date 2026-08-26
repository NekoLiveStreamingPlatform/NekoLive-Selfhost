const express = require("express");
const http = require("http");
const https = require("https");
const { loadConfig } = require("../../config/loader");

const router = express.Router();

function getUpstream(kind) {
  const config = loadConfig();
  const raw = kind === "llhls" ? config.ome?.playerurl : config.ome?.webrtcurl;
  if (!raw) throw new Error(`OME ${kind} upstream is not configured.`);

  const parsed = new URL(String(raw));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`OME ${kind} upstream must use http:// or https://`);
  }
  return parsed;
}

function getRequestSuffix(req) {
  const wildcard = String(req.params[0] || "").replace(/^\/+/, "");
  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
  return { wildcard, query };
}

function upstreamPath(base, wildcard, query) {
  const root = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return `${root}${wildcard}${query}`;
}

function rewriteLocation(value, base, publicPrefix) {
  if (!value) return value;
  try {
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) return value;

    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    let relativePath = resolved.pathname;
    if (relativePath.startsWith(basePath)) {
      relativePath = relativePath.slice(basePath.length);
    } else {
      relativePath = relativePath.replace(/^\/+/, "");
    }

    return `${publicPrefix}/${relativePath}${resolved.search}${resolved.hash}`;
  } catch (_) {
    return value;
  }
}

function proxyToOme(kind, publicPrefix) {
  return (req, res) => {
    let base;
    try {
      base = getUpstream(kind);
    } catch (error) {
      return res.status(503).json({ ok: false, error: error.message });
    }

    const { wildcard, query } = getRequestSuffix(req);
    const transport = base.protocol === "https:" ? https : http;
    const headers = { ...req.headers, host: base.host };

    // These describe the public Selfhost origin to OME while Host itself must
    // remain the configured upstream host. OME should never need to know or
    // expose the private Docker/LAN address to the browser.
    headers["x-forwarded-host"] = req.get("host") || "";
    headers["x-forwarded-proto"] = req.get("x-forwarded-proto") || req.protocol;
    headers["x-forwarded-for"] = req.ip || req.socket.remoteAddress || "";

    const upstream = transport.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port || undefined,
        method: req.method,
        path: upstreamPath(base, wildcard, query),
        headers
      },
      (upstreamRes) => {
        const responseHeaders = { ...upstreamRes.headers };

        // WHEP commonly returns a Location header for the resource created by
        // POST. Keep later PATCH/DELETE requests on the same public Selfhost
        // domain instead of leaking the private OME host/port to the browser.
        if (responseHeaders.location) {
          responseHeaders.location = rewriteLocation(
            responseHeaders.location,
            base,
            publicPrefix
          );
        }

        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        upstreamRes.pipe(res);
      }
    );

    upstream.on("error", (error) => {
      console.error(`OME ${kind} proxy failed:`, error.message);
      if (!res.headersSent) {
        res.status(502).json({ ok: false, error: "OME playback upstream unavailable." });
      } else {
        res.destroy(error);
      }
    });

    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  };
}

// LL-HLS manifests, parts and segments. GET/HEAD/OPTIONS are the common
// methods, but router.all also keeps unusual player probes working.
router.all("/llhls/*", proxyToOme("llhls", "/ome/llhls"));

// WHEP signaling (POST + PATCH + DELETE, depending on the client). This only
// proxies signaling. WebRTC ICE media still needs its UDP/TURN path to be
// reachable if WebRTC playback is enabled.
router.all("/webrtc/*", proxyToOme("webrtc", "/ome/webrtc"));

module.exports = router;
