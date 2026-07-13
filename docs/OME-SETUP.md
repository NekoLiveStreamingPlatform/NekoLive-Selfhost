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
  relay-to-NekoLive feature starts/stops it purely via OME's REST API
  (`:startPush`/`:stopPush`), the same way NekoLive's own
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

- `ome.apiUrl` — `http://YOUR-OME-HOST:8081/`
- `ome.apiAccessToken` — the same token you put in `Server.xml`'s
  `Managers/API/AccessToken`
- `ome.playerurl` — `http://YOUR-OME-HOST:8080/` (LLHLS)
- `ome.webrtcurl` — `http://YOUR-OME-HOST:3334/` (WebRTC/WHEP playback)
- `ome.streamName` — whatever stream name you'll publish under, e.g. `live`
  (so your RTMP URL becomes `rtmp://YOUR-OME-HOST/app/live`)
- `ome.streamKey` — a long random secret **you choose** — this app checks
  incoming publishes against it (via a `?jwt=` query param on the RTMP/WHIP
  URL, or as the SRT streamid), so put your broadcaster software's stream
  key/URL as:
  - RTMP: `rtmp://YOUR-OME-HOST/app/live?jwt=YOUR-STREAM-KEY`
  - SRT: `srt://YOUR-OME-HOST:9999?streamid=publish:app/live:YOUR-STREAM-KEY`

## 4. First run

```
npm install
node app.js
```

Visit the app's URL — you'll be redirected to `/setup` to create your admin
account and channel name (this only ever happens once; no default credential
ships with this app). Then start streaming with the URL/key from step 3 —
the channel page should show LIVE within ~20 seconds.

## Caveats

- **Not verified against a live OME deployment.** This app's admission
  webhook contract, Push Publishing payload shape, and playback URL
  conventions were ported from NekoLive's own OME integration (confirmed
  working there), but this exact `Server.xml` example hasn't been tested
  end-to-end — treat it as a starting point and be ready to diff it against
  your OME version's own reference config if it fails to start.
- **Relay to NekoLive** requires your own real NekoLive channel + stream key
  — get that from your NekoLive account's dashboard first.
