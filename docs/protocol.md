# Realtime protocol (v1)

The browser and the server talk over one Socket.IO connection. It carries
room membership, chat, media state and WebRTC signalling. Audio and video
travel directly between browsers (or through a TURN relay); the server
never sees them.

## Rules

- **The server owns identity.** It assigns every participant an ID. Every
  event it relays carries the sender's ID (`from`/`id`), so clients never
  identify themselves.
- **Every payload is validated** (`src/server/schemas.js`). Invalid
  requests get `{ ok: false, error }` and are never relayed.
- **Every event is rate-limited** per connection (`src/server/rate-limit.js`).
  Messages over the limit get `{ ok: false, error: "rate-limited" }`.
- **Requests are acknowledged.** Client-to-server events take an ack
  callback and receive `{ ok: true, ... }` or `{ ok: false, error }`.
- **Only this app's pages may connect.** A browser `Origin` must match
  `PUBLIC_URL`, or the `Host` header when `PUBLIC_URL` isn't set.

## Joining and leaving

| Event | Direction | Payload | Reply / notes |
| --- | --- | --- | --- |
| `room:join` | client → server | `{ roomId, name, session?, ticket? }` | `{ ok, resumed, self, participants, history, maxRoomSize, locked, knocks, iceServers }` |
| `room:leave` | client → server | – | `{ ok }`; others get `participant:left` at once |
| `participant:joined` | server → client | `{ id, name, audio, video, screen, hand, host, recording }` | sent to everyone else in the room |
| `participant:updated` | server → client | `{ id, name, audio, video, screen, hand, host, recording }` | after `media:state`, `hand:set` or `recording:set`; to everyone, the person included, after `host:lower-hand` or a host change |
| `participant:left` | server → client | `{ id }` | after `room:leave`, or a disconnect that outlasts the grace period |
| `server:restarting` | server → client | `{ inSeconds }` | on `SIGTERM`; clients show "reconnecting" and rejoin on their own |

- `roomId` is 1–64 characters from `[A-Za-z0-9_-]`. `name` is trimmed and
  1–40 characters long.
- `self` holds the new participant's `id`, `name` and a private `session`
  token. Clients keep the token in `sessionStorage`.
- Errors: `invalid-payload`, `invalid-room`, `invalid-name`,
  `invalid-session`, `invalid-ticket`, `already-joined`, `room-full` (more
  than `MAX_ROOM_SIZE` people), `room-locked` (see below).

### Reconnecting

When a connection drops without `room:leave`, the participant stays in the
room for `RECONNECT_GRACE_SECONDS`. If the tab joins again with its
`session` token in that time:

- the reply has `resumed: true` and the same `self.id`;
- nobody else is told anything;
- WebRTC signals sent to the participant while they were away are
  delivered straight after the reply.

After the grace period the participant is removed. The next join gets a
new ID, and the client rebuilds its connections. Closing the tab sends a
Socket.IO disconnect, which counts as leaving straight away.

## Chat

| Event | Direction | Payload | Reply / notes |
| --- | --- | --- | --- |
| `chat:send` | client → server | `{ text }` | `{ ok, id }`; text is trimmed, 1–1000 characters |
| `chat:message` | server → client | `{ id, from, name, text, ts }` | to everyone, including the sender; `ts` is the server's time in ms |
| `chat:typing` | client → server | `{ typing }` | relayed to the others as `{ from, name, typing }` |

The last 50 messages of a room are kept in memory and sent to newcomers in
`history`. They're gone when the room empties.

## Media state

| Event | Direction | Payload | Reply / notes |
| --- | --- | --- | --- |
| `media:state` | client → server | any of `{ audio, video, screen }` (booleans) | `{ ok }`; relayed as `participant:updated` |

## Hosts and locked rooms

The first person in a room is its host. When the host leaves, whoever has
been in the room longest becomes host, and everyone gets a
`participant:updated` saying so. Every host-only event replies `not-host`
to anyone else.

| Event | Direction | Payload | Reply / notes |
| --- | --- | --- | --- |
| `room:lock` | host → server | `{ locked }` | `{ ok }`; everyone gets `room:updated { locked }`. Unlocking lets in everyone waiting |
| `room:knock` | client → server | `{ roomId, name }` | `{ ok, id }`, before joining; hosts get `knock:request { id, name }`. Errors: `not-locked`, `too-many-knocks` (20 waiting) |
| `knock:answer` | host → server | `{ id, admit }` | `{ ok }`; the person waiting gets `knock:answered { admitted, ticket }`, and hosts get `knock:resolved { id, admitted }` |
| `host:mute` | host → server | `{ id }` | the person gets `host:mute { by }`, and their app turns the mic off |
| `host:ask-unmute` | host → server | `{ id }` | the person gets `host:ask-unmute { by }` and decides for themselves |
| `host:lower-hand` | host → server | `{ id }` | `participant:updated` with `hand: null` |
| `host:remove` | host → server | `{ id }` | the person gets `room:removed { by }` and is out of the room; the others get `participant:left` |

- A locked room answers `room:join` with `room-locked`. The person can
  then knock. If a host lets them in, `ticket` gets them past the lock
  once, within a minute. Reconnecting with a `session` is never blocked
  by the lock.
- Hosts who reconnect get the people still waiting in the join reply's
  `knocks`. Hosts are also told (`knock:resolved`) when someone stops
  waiting.
- Someone who was removed can come back with the link unless the room is
  locked.
- Rooms only live in the server's memory, so a restart unlocks them. The
  first person back becomes host and can lock the room again. Keeping
  locks across restarts needs shared storage (see the plan's Phase 5).
- `room:knock` is limited to 3 in a burst, then one every 10 seconds.

## Recording

| Event | Direction | Payload | Reply / notes |
| --- | --- | --- | --- |
| `recording:set` | client → server | `{ recording }` (boolean) | `{ ok }`; relayed as `participant:updated` |

Recordings are made and saved on the recorder's own device; nothing is
uploaded. The server's job is to make sure everyone knows: clients send
`recording:set` before they start, `recording` is part of every
participant view (so late joiners see it), and `room:peek` reports
`recording` so the lobby can say so before anyone joins.

## Captions

| Event | Direction | Payload | Reply / notes |
| --- | --- | --- | --- |
| `caption:send` | client → server | `{ text, final }` | `{ ok }`; relayed to the others as `caption { from, text, final }` |

Captions are of the sender's own speech, made by their browser's speech
recognition, and only if they turn it on. Interim text (`final: false`)
replaces the previous interim text; final text ends a phrase. Text is
trimmed to its last 300 characters. Captions are never stored or logged,
and are limited to a burst of 30, then 10 a second.

## Raised hands and reactions

| Event | Direction | Payload | Reply / notes |
| --- | --- | --- | --- |
| `hand:set` | client → server | `{ raised }` (boolean) | `{ ok, hand }`; relayed as `participant:updated` |
| `reaction:send` | client → server | `{ emoji }` | `{ ok }`; relayed to the others as `reaction` |
| `reaction` | server → client | `{ from, emoji }` | not stored; late joiners don't see it |

- `hand` is when the hand went up (server time in ms), or `null`. Raising a
  hand that is already up keeps its time, so hands are taken in order.
- `emoji` is one of 👍 ❤️ 😂 😮 👏 🎉; anything else is `invalid-payload`.
  Reactions are limited to a burst of 10, then 2 a second.

## WebRTC signalling

| Event | Direction | Payload | Reply / notes |
| --- | --- | --- | --- |
| `rtc:signal` | client → server | `{ to, description }` or `{ to, candidate }` | `{ ok }`, `{ ok, queued }` while the target reconnects, or `unknown-peer` |
| `rtc:signal` | server → client | `{ from, description }` or `{ from, candidate }` | only between members of the same room |
| `rtc:ice-servers` | client → server | – | `{ ok, iceServers }`: fresh TURN credentials |

- `description` is `{ type: "offer" | "answer" | "rollback", sdp }`, with
  the SDP capped at 32 KB.
- `candidate` is an `RTCIceCandidateInit`. Only `candidate`, `sdpMid`,
  `sdpMLineIndex` and `usernameFragment` are forwarded.

### How clients connect

- One `RTCPeerConnection` per pair of participants, using
  [perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation).
  The participant whose ID sorts higher is "polite".
- The newcomer sends the first offers, to everyone in `participants`.
  People already in the room wait for them.
- Every connection has three transceivers, always in this order:
  microphone, camera, screen share. Tracks are swapped with
  `replaceTrack()`, so muting, turning the camera on or off, switching
  devices and presenting never need a new offer.
- A connection that fails restarts ICE.

## Other

| Event | Direction | Notes |
| --- | --- | --- |
| `net:ping` | client → server | acknowledged immediately; used to measure round-trip time |
