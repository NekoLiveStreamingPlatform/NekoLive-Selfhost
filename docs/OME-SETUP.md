# OvenMediaEngine setup for NekoLive Self-Host

This app is a thin control layer around your own single OvenMediaEngine (OME)
instance — it doesn't run OME itself. You need OME running somewhere this app
can reach over HTTP (same machine, same LAN, or a public host), and this app
running somewhere OME can reach (for the admission webhook).

## 1. Run OvenMediaEngine

Easiest via Docker:

```
docker run -d --name ome \
  -p 1935:1935 -p 9999:9999/udp \
  -p 3333:3333 -p 3334:3334 \
  -p 8080:8080 -p 8081:8081 \
  -v $(pwd)/Server.xml:/opt/ovenmediaengine/bin/origin_conf/Server.xml \
  airensoft/ovenmediaengine:latest
```

## 2. Configure `Server.xml`

Below is a minimal single-node example. **Check it against your installed
OME version's own bundled reference config first** — OME's schema has
changed across releases and its parser rejects any element it doesn't
recognize:

```
docker run --rm airensoft/ovenmediaengine:latest cat /opt/ovenmediaengine/bin/origin_conf/Server.xml
```

Key pieces this app depends on:

- **`<AdmissionWebhooks>`** — `ControlServerUrl` must point at
  `http://<this-app-host>:<port>/api/admission/ome`. Enable it for both
  ingest (`<Providers>rtmp,webrtc,srt</Providers>`) and playback
  (`<Publishers>llhls,webrtc</Publishers>`) — the second one is what lets
  bans actually block playback, not just chat.
- **Managers API** (`Bind/Managers/API` + `Managers/API/AccessToken`) — put
  the same values into this app's `config/config.json` under `ome.apiUrl` /
  `ome.apiAccessToken`.
- **`<Push>` publisher** — needs no static config beyond being enabled; the
  Multistream feature (dashboard) starts/stops each destination purely via
  OME's REST API (`:startPush`/`:stopPush`), the same way NekoLive's own
  `services/pushPublishService.js` does.

```xml
<Server version="8">
  <Name>NekoLiveSelfHost-OME</Name>
  <Type>origin</Type>
  <IP>*</IP>
  <PrivacyProtection>false</PrivacyProtection>
  <StunServer>stun.ovenmediaengine.com:13478</StunServer>

  <Modules>
    <HTTP2><Enable>true</Enable></HTTP2>
    <LLHLS><Enable>true</Enable></LLHLS>
  </Modules>

  <Bind>
    <Managers>
      <API>
        <Port>8081</Port>
      </API>
    </Managers>
    <Providers>
      <RTMP><Port>1935</Port></RTMP>
      <WebRTC><Signalling><Port>3333</Port></Signalling></WebRTC>
      <SRT><Port>9999</Port></SRT>
    </Providers>
    <Publishers>
      <LLHLS><Port>8080</Port></LLHLS>
      <WebRTC><Signalling><Port>3334</Port></Signalling></WebRTC>
    </Publishers>
  </Bind>

  <Managers>
    <API>
      <AccessToken>PUT-A-LONG-RANDOM-TOKEN-HERE</AccessToken>
    </API>
  </Managers>

  <VirtualHosts>
    <VirtualHost>
      <Name>default</Name>
      <Host><Names><Name>*</Name></Names></Host>

      <AdmissionWebhooks>
        <ControlServerUrl>http://YOUR-APP-HOST:8090/api/admission/ome</ControlServerUrl>
        <SecretKey></SecretKey>
        <Timeout>3000</Timeout>
        <Enables>
          <Providers>rtmp,webrtc,srt</Providers>
          <Publishers>llhls,webrtc</Publishers>
        </Enables>
      </AdmissionWebhooks>

      <Applications>
        <Application>
          <Name>app</Name>
          <Type>live</Type>
          <Providers>
            <RTMP />
            <WebRTC />
            <SRT />
          </Providers>
          <Publishers>
            <LLHLS>
              <SegmentDuration>6</SegmentDuration>
              <SegmentCount>10</SegmentCount>
            </LLHLS>
            <WebRTC />
            <Push />
          </Publishers>
        </Application>
      </Applications>
    </VirtualHost>
  </VirtualHosts>
</Server>
```

## 3. Configure this app

Copy `config/config.example.json` to `config/config.json` and fill in:

- `sessionSecret` — a long random string (e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- `ome.apiUrl` — OME's Manager API. This is only ever called
  **server-to-server** (this app -> OME), never by a viewer's browser, so if
  you're running both via `docker-compose.yml` (see below) this can be the
  internal service hostname, e.g. `http://ome:8081/` — no need to expose
  port 8081 publicly.
- `ome.apiAccessToken` — the same token you put in `Server.xml`'s
  `Managers/API/AccessToken` (generate one with the same command as
  `sessionSecret` above)
- `ome.playerurl` (LLHLS) / `ome.webrtcurl` (WebRTC/WHEP) — unlike `apiUrl`,
  these get sent to **viewers' browsers** to fetch/connect to directly, so
  they must be a publicly/LAN-reachable host:port — the internal compose
  hostname won't work here. Match whatever ports `Server.xml`'s
  `Bind/Publishers` section actually uses (this repo's `ome/Server.xml`
  uses 8080 for LLHLS and 3333 for WebRTC — note plain 3333, not the TLS
  variant 3334, until you've configured a cert).
- `ome.streamName` — whatever stream name you'll publish under, e.g. `live`

**Your stream key is no longer set here** — it's generated automatically the
first time you run `/setup`, and shown (with a regenerate button) on the
admin dashboard, along with ready-to-copy RTMP/SRT ingest URLs.

If you're running OME via this repo's own `ome/Server.xml` +
`docker-compose.yml` (rather than the generic single-container example
above), the `AccessToken` there and `config.json`'s `ome.apiAccessToken`
must be the exact same value, and `Server.xml`'s
`AdmissionWebhooks/ControlServerUrl` must use the app's compose service
name (`http://nekolive-selfhost:8090/api/admission/ome`), not `127.0.0.1` —
from inside the `ome` container, `127.0.0.1` means OME's own localhost, not
the app's.

## 4. First run

```
npm install
node app.js
```
(or `docker compose up -d --build` if using the compose setup above)

Visit the app's URL — you'll be redirected to `/setup` to create your admin
account, channel name, and stream key (this only ever happens once; no
default credential ships with this app). Grab the ingest URL from the admin
dashboard and start streaming — the channel page should show LIVE within
~20 seconds.

## Caveats

- **Not verified against a live OME deployment.** This app's admission
  webhook contract, Push Publishing payload shape, and playback URL
  conventions were ported from NekoLive's own OME integration (confirmed
  working there), but this exact `Server.xml` example hasn't been tested
  end-to-end — treat it as a starting point and be ready to diff it against
  your OME version's own reference config if it fails to start.
- **Multistreaming to NekoLive** (as one of your destinations) requires your
  own real NekoLive channel + stream key
  — get that from your NekoLive account's dashboard first.
