# NekoLive Selfhost Federation

NekoLive-Selfhost can remain a completely local creator-owned streaming app or expose its live stream through the main NekoLive platform.

Federation never uses the creator's RTMP/SRT ingest key as a central credential. A separate node secret signs federation traffic.

## Relay modes

### NekoLive Proxy mode (no Selfhost domain required)

This is the default choice in the Selfhost dashboard when pairing a creator channel.

The Selfhost app opens an outbound authenticated WebSocket to the NekoLive hub:

```text
Selfhost / OME
    |
    | outbound WSS only
    v
NekoLive federation tunnel
    |
    +--> NekoLive channel page / guest relay page
    +--> LL-HLS proxy requests
    +--> bidirectional chat bridge
```

The Selfhost installation does **not** need:

- a public web domain;
- an inbound HTTP/HTTPS port;
- a Cloudflare Tunnel pointing at the Selfhost web app;
- a publicly reachable OME LL-HLS port.

Viewers use the normal public NekoLive website. NekoLive forwards the requested LL-HLS objects through the already-established outbound node tunnel.

This mode makes the central NekoLive infrastructure carry the viewer video bandwidth. It is therefore convenient for anonymous/NAT/CGNAT nodes, but it is not as bandwidth-efficient for NekoLive as Direct mode.

The current implementation transfers each LL-HLS object through a bounded request/response frame. It is intended as the first production transport for modest Selfhost nodes; a future binary-streaming tunnel can remove JSON/base64 overhead for high-volume relay/CDN use.

### Direct mode

Selfhost has a reachable HTTPS URL and viewers fetch LL-HLS directly from it.

NekoLive still receives signed live state and can bridge chat over the outbound federation socket, but the central platform does not carry the video segments.

Use Direct mode when the Selfhost owner has a domain/reverse proxy and wants their own server to carry viewer bandwidth.

## Creator-owned channel pairing

1. Sign into the NekoLive account that owns the destination channel.
2. Open `/streamnode/federation/connect` on the main NekoLive website.
3. Generate the one-time pairing code.
4. In Selfhost Admin -> NekoLive Relay Node, enter the hub URL and code.
5. Choose NekoLive Proxy or Direct transport.

The NekoLive account that generated the code is authoritative. The Selfhost heartbeat cannot select a different central channel by changing its local channel name.

Pairing returns a dedicated node secret for signed federation traffic. It does not copy the creator stream key to NekoLive.

## Guest / anonymous relay

If the Selfhost owner does not want a NekoLive account, the dashboard can register a guest relay identity.

Guest mode:

- creates no fake NekoLive `User` or `Channel` account;
- creates only a federation node identity;
- always uses NekoLive Proxy mode;
- gets a central guest name derived from the stable Node ID;
- has a public guest relay page and bridged chat;
- can later be disconnected and replaced with a real creator-owned pairing.

The NekoLive operator can disable new guest registrations globally with:

```text
FEDERATION_GUEST_RELAY_ENABLED=false
```

## Relay on / off

The Selfhost dashboard has a separate NekoLive relay toggle.

Turning relay **off**:

- removes the stream from NekoLive;
- closes the central relay tunnel;
- stops federation chat forwarding;
- does **not** stop OME;
- does **not** stop local Selfhost playback;
- does **not** delete the pairing.

Turning relay on reconnects the outbound tunnel and resumes signed heartbeats.

## Stable Node ID and privacy

Selfhost derives a stable local node identity from one preferred host hardware anchor when available, such as a DMI product UUID or Raspberry Pi board serial.

Raw hardware values never leave the Selfhost process. Only a domain-separated SHA-256 digest is sent to NekoLive.

The public-style node identifier is derived from that digest:

```text
nl-<32 hex characters>
```

`data/node-identity.json` stores the derived identity so a temporary loss of DMI/device-tree metadata does not unexpectedly issue a new Node ID. If no usable hardware anchor exists, Selfhost stores a random fallback seed in the persistent `data/` volume.

The supplied Docker Compose already persists `./data:/app/data`.

### What the identity protection can and cannot do

The central NekoLive admin can blacklist a Node ID. The stored one-way hardware binding is also checked when the node tries to pair or register as a guest again, so ordinary deletion/re-pull/recreate workflows do not produce a fresh allowed relay identity on the same host.

Blocked identity rows cannot be removed from the NekoLive admin UI until an administrator explicitly unblocks them first.

This is abuse resistance, not hardware attestation. NekoLive-Selfhost is open-source software, so a determined operator can modify the client and spoof identifiers. Strong anti-spoofing would require a trusted hardware-backed attestation design such as TPM-backed keys and a server-side attestation policy.

## Chat bridge

When federation relay is enabled, the authenticated node tunnel also carries chat.

- Local Selfhost chat messages are tagged `SELFHOST` when mirrored to NekoLive.
- NekoLive messages are tagged `NEKOLIVE` when mirrored into the local Selfhost page.
- Guest relay pages include their own NekoLive-side chat and forward messages both directions.
- Account-linked nodes use the normal NekoLive channel chat; Selfhost-origin messages are visibly marked so they are not confused with authenticated NekoLive users.

The node does not receive another creator's NekoLive password, session cookie, or chat credentials.

## Network summary

For **Proxy mode**, the Selfhost host only needs outbound access to the NekoLive HTTPS/WSS domain plus whatever ingest ports the creator uses locally for OME.

For **Direct mode**, viewers also need access to the Selfhost public HTTPS URL.

RTMP/SRT ingest remains separate from viewer federation transport.
