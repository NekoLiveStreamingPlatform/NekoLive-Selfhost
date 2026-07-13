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

## Quick start

```
npm install
cp config/config.example.json config/config.json   # then edit it
node app.js
```

Open the app in a browser — first run redirects to `/setup` to create your
admin account and channel name.

See [`docs/OME-SETUP.md`](docs/OME-SETUP.md) for setting up the
OvenMediaEngine side (Server.xml, admission webhook, Push Publishing).

## Quick start (Docker)

```
cp config/config.example.json config/config.json   # then edit it
mkdir -p data
docker compose up -d --build
```

`config/` and `data/` are bind-mounted (see `docker-compose.yml`) so your
settings and SQLite database survive rebuilds/`docker compose down` —
neither is ever baked into the image (see `.dockerignore`). This container
only runs the app itself; OvenMediaEngine still needs to run separately (see
`docs/OME-SETUP.md`), whether that's its own container, another host on your
network, or a public OME instance.

**Not build-tested** — this `Dockerfile`/`docker-compose.yml` were written
but couldn't be verified in this environment (no Docker available here). If
`npm install` fails on the `sqlite3` native module inside the container,
either switch the base image or add build tools (`python3 make g++`) so it
can compile from source instead of using a prebuilt binary.

## Project layout

- `app.js` — entrypoint: Express app, session, WS chat, live-detection loop
- `db.js` / `models/` — SQLite via Sequelize (`Settings` singleton,
  `BannedConnection`)
- `routes/` — pages (`index.js`), admin dashboard (`admin.js`), APIs
  (`api/admission.js` for OME's webhook, `api/stream.js` for the channel
  page's status polling, `api/multistream.js` for multistream targets)
- `services/` — `omeClient.js` (OME REST calls), `liveDetection.js` (poll
  loop), `multistream.js` (start/stop/sync push-publish targets),
  `viewerSessions.js` (viewer counting)
- `chat/chatServer.js` — anonymous single-room WebSocket chat
- `views/` — EJS templates + `views/js/nl-whep-player.js` (the player,
  shared with NekoLive) + `views/js/channel.js` (client logic)
