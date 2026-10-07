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
| `room:join` | client → server | `{ roomId, name, session? }` | `{ ok, resumed, self, participants, history, maxRoomSize, iceServers }` |
| `room:leave` | client → server | – | `{ ok }`; others get `participant:left` at once |
| `participant:joined` | server → client | `{ id, name, audio, video, screen }` | sent to everyone else in the room |
| `participant:updated` | server → client | `{ id, name, audio, video, screen }` | after `media:state` |
| `participant:left` | server → client | `{ id }` | after `room:leave`, or a disconnect that outlasts the grace period |
| `server:restarting` | server → client | `{ inSeconds }` | on `SIGTERM`; clients show "reconnecting" and rejoin on their own |

- `roomId` is 1–64 characters from `[A-Za-z0-9_-]`. `name` is trimmed and
  1–40 characters long.
- `self` holds the new participant's `id`, `name` and a private `session`
  token. Clients keep the token in `sessionStorage`.
- Errors: `invalid-payload`, `invalid-room`, `invalid-name`,
  `invalid-session`, `already-joined`, `room-full` (more than
  `MAX_ROOM_SIZE` people).

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
