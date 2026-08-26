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
  `api/federation.js` for NekoLive Relay Node control messages)
- `services/` — `omeClient.js` (OME REST calls), `liveDetection.js` (poll
  loop), `multistream.js` (start/stop/sync push-publish targets),
  `federationClient.js` (NekoLive Relay Node pairing/heartbeats),
  `viewerSessions.js` (viewer counting)
- `chat/chatServer.js` — anonymous single-room WebSocket chat
- `views/` — EJS templates plus the NekoLive-compatible channel player and
  client-side channel/admin logic
