const express = require("express");
const http = require("http");
const https = require("https");
const { loadConfig } = require("../../config/loader");

const router = express.Router();
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

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

function rewriteManifestUri(value, base, publicPrefix) {
  const uri = String(value || "").trim();
  if (!uri || uri.startsWith("data:")) return uri;

  // Relative child paths such as chunklist_*.m3u8 already resolve correctly
  // underneath /ome/llhls/<app>/<stream>/, so leave those untouched.
  if (!uri.startsWith("/") && !/^https?:\/\//i.test(uri)) return uri;

  try {
    // Protocol-relative URLs need an explicit scheme before URL parsing.
    const resolved = uri.startsWith("//")
      ? new URL(`${base.protocol}${uri}`)
      : uri.startsWith("/")
        ? new URL(uri, base.origin)
        : new URL(uri);

    // Never rewrite a genuinely external key/CDN URL.
    if (resolved.origin !== base.origin) return uri;

    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    let relativePath = resolved.pathname;
    if (basePath !== "/" && relativePath.startsWith(basePath)) {
      relativePath = relativePath.slice(basePath.length);
    } else {
      relativePath = relativePath.replace(/^\/+/, "");
    }

    return `${publicPrefix}/${relativePath}${resolved.search}${resolved.hash}`;
  } catch (_) {
    return uri;
  }
}

function rewriteLlhlsManifest(body, base, publicPrefix) {
  let text = Buffer.concat(body).toString("utf8");

  // URI attributes used by EXT-X-MAP, EXT-X-PART, EXT-X-PRELOAD-HINT,
  // EXT-X-KEY, EXT-X-MEDIA and similar tags.
  text = text.replace(/URI=(['"])([^'"]+)\1/g, (_match, quote, uri) => {
    return `URI=${quote}${rewriteManifestUri(uri, base, publicPrefix)}${quote}`;
  });
  text = text.replace(/URI=([^,'"\s]+)/g, (_match, uri) => {
    return `URI=${rewriteManifestUri(uri, base, publicPrefix)}`;
  });

  // Non-comment lines are playlist/segment/part URIs.
  text = text
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.trimStart().startsWith("#")) return line;
      const leading = line.match(/^\s*/)?.[0] || "";
      const trailing = line.match(/\s*$/)?.[0] || "";
      return `${leading}${rewriteManifestUri(line.trim(), base, publicPrefix)}${trailing}`;
    })
    .join("\n");

  return Buffer.from(text, "utf8");
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

    // Manifest rewriting requires plain bytes rather than a compressed OME
    // response. Segments/parts are normally already media-compressed.
    if (kind === "llhls") headers["accept-encoding"] = "identity";

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

        const contentType = String(responseHeaders["content-type"] || "").toLowerCase();
        const isManifest =
          kind === "llhls" &&
          req.method !== "HEAD" &&
          (contentType.includes("mpegurl") || wildcard.toLowerCase().endsWith(".m3u8"));

        if (!isManifest) {
          res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
          upstreamRes.pipe(res);
          return;
        }

        const chunks = [];
        let size = 0;
        upstreamRes.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_MANIFEST_BYTES) {
            upstreamRes.destroy(new Error("OME LL-HLS manifest exceeded proxy size limit."));
            return;
          }
          chunks.push(chunk);
        });
        upstreamRes.on("end", () => {
          if (res.headersSent) return;
          const rewritten = rewriteLlhlsManifest(chunks, base, publicPrefix);
          delete responseHeaders["transfer-encoding"];
          delete responseHeaders["content-encoding"];
          responseHeaders["content-length"] = String(rewritten.length);
          res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
          res.end(rewritten);
        });
        upstreamRes.on("error", (error) => {
          console.error("OME LL-HLS manifest proxy failed:", error.message);
          if (!res.headersSent) res.status(502).send("OME LL-HLS manifest unavailable.");
          else res.destroy(error);
        });
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
