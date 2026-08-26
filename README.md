# NekoLive Self-Host

A self-hosted, single-channel streaming app — like Owncast, backed by
OvenMediaEngine (OME) and using the same WHEP/LLHLS player as NekoLive.

- One channel, one local admin account (no NekoLive/ZITADEL account needed).
- Anonymous viewer chat — no account required to watch or chat.
- Admin can ban an IP from the dashboard, which blocks both chat and
  playback in one action, without the banned person ever needing to sign up
  for anything.
- Multistream: simulcast this stream to any number of destinations (your
  own NekoLive channel, Twitch, YouTube, Kick, custom RTMP/SRT...) via
  OME's native Push Publishing, each toggleable on/off in real time from
  the dashboard — even mid-stream.
- Optional NekoLive Relay Node federation lets a Selfhost instance appear on
  the main NekoLive platform without sharing the creator's local stream key.
- OME browser playback can be proxied through the Selfhost origin, so LL-HLS
  does not need a separate public `:8080` address/domain.

## Supported Docker architectures

The GHCR image is built as a multi-architecture image for:

- `linux/amd64` — normal Intel/AMD x86-64 servers and PCs.
- `linux/arm64` — ARM64 servers and Raspberry Pi 4/5 running a 64-bit OS.

Docker automatically selects the correct architecture from the same image tag:

```bash
docker pull ghcr.io/nekolivestreamingplatform/nekolive-selfhost:latest
```

No ARM-specific tag is required. `docker compose pull` and
`docker compose up -d` also select the correct image automatically.

The included `airensoft/ovenmediaengine:latest` Compose dependency is also
multi-architecture, so the full Compose stack can run on ARM64 hosts.

To build only the ARM64 Selfhost image locally with Buildx:

```bash
docker buildx build \
  --platform linux/arm64 \
  -t nekolive-selfhost:arm64 \
  --load .
```

## Quick start

```bash
npm install
cp config/config.example.json config/config.json   # then edit it
node app.js
```

Open the app in a browser — first run redirects to `/setup` to create your
admin account and channel name.

See [`docs/OME-SETUP.md`](docs/OME-SETUP.md) for setting up the
OvenMediaEngine side (Server.xml, admission webhook, Push Publishing).

## Quick start (Docker)

```bash
cp config/config.example.json config/config.json   # then edit it
mkdir -p data
docker compose pull
docker compose up -d
```

If you want to build the Selfhost application image locally instead of using
GHCR:

```bash
docker compose up -d --build
```

Only `config/config.json` is bind-mounted into `/app/config`; the rest of the
`config/` directory is application code stored in the image. This is important
because `config/loader.js` is required during startup. Mounting the whole local
`config/` directory over `/app/config` would hide that file and make the
container fail with `Cannot find module './config/loader'`.

`data/` is also bind-mounted so the SQLite database survives rebuilds and
`docker compose down`. Neither the runtime config nor database is baked into
the image.

## One public web domain / Cloudflare

With `ome.proxyPlayback` enabled (the default example), OME's HTTP endpoints
stay private and Selfhost exposes playback below its own origin:

```text
https://stream.example.com/                  -> Selfhost :8090
https://stream.example.com/ome/llhls/...     -> internal OME :8080
https://stream.example.com/ome/webrtc/...    -> internal OME :3333 signaling
```

A Docker config can therefore use internal service names:

```json
{
  "port": 8090,
  "siteUrl": "https://stream.example.com",
  "ome": {
    "apiUrl": "http://ome:8081/",
    "apiAccessToken": "replace-me",
    "playerurl": "http://ome:8080/",
    "webrtcurl": "http://ome:3333/",
    "proxyPlayback": true,
    "appName": "app",
    "streamName": "live"
  }
}
```

For a normal Cloudflare Tunnel/reverse proxy, point the public hostname only at
Selfhost (`http://localhost:8090`). You do not need separate Cloudflare hostnames
or public TCP mappings for OME `8080`, `3333`, or `8081`.

The built-in player currently uses LL-HLS, so this gives normal viewers a true
single-domain HTTP(S) deployment. WHEP signaling is also proxied through the
same origin, but **WebRTC media itself is not normal HTTP traffic**: OME still
advertises ICE/TURN candidates (for example UDP `10000-10004` and TCP TURN
`3478`). A standard Cloudflare HTTP Tunnel does not proxy that UDP media path.
If you only use LL-HLS playback, those WebRTC media ports are not needed for the
browser player; if you enable WebRTC playback, make the ICE/TURN path reachable
separately or use a WebRTC-capable relay service.

RTMP/SRT ingest is also a separate protocol from the website, so creators still
need whatever ingest ports you choose to expose (the supplied Compose example
keeps RTMP `1935` and SRT `9999/udp`).

To disable the Selfhost playback proxy and return direct OME URLs like older
releases, set:

```json
"proxyPlayback": false
```

The GitHub Actions Docker workflow builds both `linux/amd64` and
`linux/arm64` with Docker Buildx/QEMU. Pull requests build both architectures
without publishing; pushes to `main`, version tags, and manual publish runs
push the multi-architecture manifest to GHCR.

The Dockerfile uses Debian/glibc rather than Alpine to retain broad native
module compatibility for `sqlite3`. If a future `sqlite3` release stops
shipping a suitable prebuilt binary for one of the supported architectures,
the fallback is to add `python3`, `make`, and `g++` to the build stage and
compile it from source.

## Project layout

- `app.js` — entrypoint: Express app, session, WS chat, live-detection loop
- `db.js` / `models/` — SQLite via Sequelize (`Settings` singleton,
  `BannedConnection`)
- `routes/` — pages (`index.js`), admin dashboard (`admin.js`), APIs
  (`api/admission.js` for OME's webhook, `api/stream.js` for the channel
  page's status polling, `api/multistream.js` for multistream targets,
  `api/federation.js` for NekoLive Relay Node control messages, and
  `api/omeProxy.js` for same-origin LL-HLS/WHEP proxying)
- `services/` — `omeClient.js` (OME REST calls + playback URL resolution),
  `liveDetection.js` (poll loop), `multistream.js` (start/stop/sync
  push-publish targets), `federationClient.js` (NekoLive Relay Node
  pairing/heartbeats), `viewerSessions.js` (viewer counting)
- `chat/chatServer.js` — anonymous single-room WebSocket chat
- `views/` — EJS templates plus the NekoLive-compatible channel player and
  client-side channel/admin logic
