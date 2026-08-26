# OvenMediaEngine setup for NekoLive Self-Host

This app is a thin control layer around your own single OvenMediaEngine (OME)
instance. The supplied Docker Compose stack runs both services on one private
Docker network and Selfhost can proxy OME's browser-facing HTTP endpoints
through the normal Selfhost site URL.

## 1. Run OvenMediaEngine

The recommended setup is this repository's `docker-compose.yml` because it
keeps the OME Manager API, LL-HLS HTTP listener and WebRTC signaling listener
private to Docker.

If you run OME separately, Selfhost only needs to be able to reach:

- OME Manager API (normally `8081`)
- OME LL-HLS publisher (normally `8080`)
- OME WebRTC/WHEP signaling (normally `3333`, only needed if WebRTC playback is used)

Those three HTTP ports do **not** need to be public when
`ome.proxyPlayback: true` is enabled.

RTMP/SRT ingest and WebRTC ICE/TURN are different protocols and have their own
network requirements.

## 2. Configure `Server.xml`

Below is a minimal single-node example. **Check it against your installed
OME version's own bundled reference config first** — OME's schema has
changed across releases and its parser rejects any element it doesn't
recognize:

```bash
docker run --rm airensoft/ovenmediaengine:latest cat /opt/ovenmediaengine/bin/origin_conf/Server.xml
```

Key pieces this app depends on:

- **`<AdmissionWebhooks>`** — `ControlServerUrl` must point at
  `http://<this-app-host>:<port>/api/admission/ome`. With this repo's Compose
  stack, use `http://nekolive-selfhost:8090/api/admission/ome`.
- **Managers API** (`Bind/Managers/API` + `Managers/API/AccessToken`) — put
  the same values into this app's `config/config.json` under `ome.apiUrl` /
  `ome.apiAccessToken`.
- **`<Push>` publisher** — needs no static destination config; Multistream
  starts/stops targets through OME's REST API.
- **LL-HLS** — normally listens on `8080`. Selfhost proxies it at
  `/ome/llhls/*`, so viewers do not connect to `:8080` directly.
- **WebRTC signaling** — normally listens on `3333`. Selfhost can proxy WHEP
  signaling at `/ome/webrtc/*`, but WebRTC ICE media still needs reachable
  UDP/TURN candidates if you actually use WebRTC playback.

The repository already includes `ome/Server.xml`; normally you should use that
instead of recreating this configuration manually.

## 3. Configure this app

Copy `config/config.example.json` to `config/config.json`.

Recommended Docker configuration:

```json
{
  "port": 8090,
  "siteUrl": "https://stream.example.com",
  "sessionSecret": "replace-with-a-long-random-string",
  "ome": {
    "apiUrl": "http://ome:8081/",
    "apiAccessToken": "replace-with-your-ome-token",
    "playerurl": "http://ome:8080/",
    "webrtcurl": "http://ome:3333/",
    "proxyPlayback": true,
    "appName": "app",
    "streamName": "live"
  }
}
```

Meaning:

- `siteUrl` — your public Selfhost URL. Behind Cloudflare this should be the
  HTTPS hostname, for example `https://stream.example.com`.
- `sessionSecret` — a long random value, e.g.:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

- `ome.apiUrl` — private OME Manager API. Under Compose this should be
  `http://ome:8081/`.
- `ome.apiAccessToken` — must match `OME_API_ACCESS_TOKEN` / the token in
  `Server.xml`.
- `ome.playerurl` — **private upstream** LL-HLS address used by the Selfhost
  reverse proxy. Under Compose: `http://ome:8080/`.
- `ome.webrtcurl` — **private upstream** WHEP signaling address used by the
  Selfhost reverse proxy. Under Compose: `http://ome:3333/`.
- `ome.proxyPlayback` — when `true`, browsers receive Selfhost URLs such as
  `/ome/llhls/app/live/llhls.m3u8` rather than direct OME host/port URLs.
- `ome.streamName` — stream name, for example `live`.

If Selfhost and OME are running directly on the same host rather than Docker,
use `http://127.0.0.1:8081/`, `http://127.0.0.1:8080/` and
`http://127.0.0.1:3333/` instead.

If you intentionally want the legacy direct-to-OME browser behavior, set:

```json
"proxyPlayback": false
```

and then `playerurl`/`webrtcurl` must again be public/LAN-reachable addresses.

**Your stream key is not stored in this config.** It is generated when `/setup`
runs and is managed from the Selfhost admin dashboard.

## 4. One-domain Cloudflare setup

With proxy playback enabled, a normal Cloudflare Tunnel/reverse proxy only
needs the Selfhost web origin:

```text
Public:  https://stream.example.com
Origin:  http://localhost:8090
```

Selfhost then forwards internally:

```text
/ome/llhls/*   -> http://ome:8080/*
/ome/webrtc/*  -> http://ome:3333/*
```

The OME Manager API (`8081`) is server-to-server only and is never exposed to
the browser.

The built-in viewer currently uses LL-HLS, so normal viewing can work entirely
through the single Cloudflare hostname. Do not expose `8080` just for browser
playback when using this mode.

### WebRTC caveat

Proxying `3333` only proxies WHEP/SDP signaling. OME's actual WebRTC media path
uses the ICE candidates configured in `Server.xml` (this repo uses UDP
`10000-10004` and TCP TURN `3478`). A normal Cloudflare HTTP Tunnel does not
carry that UDP media. If you do not use WebRTC playback, this does not affect
the LL-HLS player.

### Ingest caveat

RTMP (`1935`) and SRT (`9999/udp`) are publishing protocols, not website HTTP.
They remain separate from the one-domain browser setup unless you use a
service specifically capable of proxying those protocols.

## 5. First run

```bash
cp config/config.example.json config/config.json
mkdir -p data
docker compose pull
docker compose up -d
```

Visit `siteUrl`. First run redirects to `/setup` to create the local admin
account, channel name and stream key. Start publishing and the channel page
should show LIVE after the live-detection poll sees the stream.

Useful checks:

```bash
docker compose logs -f nekolive-selfhost
docker compose logs -f ome
```

When live, the browser-facing manifest should be under the Selfhost origin,
for example:

```text
https://stream.example.com/ome/llhls/app/live/llhls.m3u8
```

not an internal address such as `http://192.168.x.x:8080/...`.

## Caveats

- OME config syntax is version-sensitive; compare `ome/Server.xml` against the
  reference config shipped by your installed OME image if OME rejects it.
- The same `OME_API_ACCESS_TOKEN` must be used by OME and Selfhost.
- A Cloudflare Tunnel makes the Selfhost HTTP(S)/LL-HLS path easy to expose,
  but it does not replace RTMP/SRT ingest or WebRTC ICE/TURN networking.
