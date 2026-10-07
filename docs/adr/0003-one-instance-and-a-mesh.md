# ADR 0003: One server instance, and a peer-to-peer mesh

- Status: accepted (Phase 5)
- Date: 2026-10-07

## Context

Phase 5 of the plan lists horizontal scaling (Socket.IO's Redis adapter,
sticky sessions, rooms in Redis) and larger rooms (an SFU with simulcast),
both marked "only when needed".

Today the app runs on one small instance. Media flows between browsers,
so the server only carries signalling, chat and presence: kilobytes per
person. One Node process handles far more meetings than the hosting plan
does.

## Decision

Neither is built yet:

- **State stays in one process's memory.** Rooms, locks, waiting lists
  and chat history live in a `RoomRegistry`. A restart loses them.
  Clients reconnect and rejoin by themselves, and the first person back
  becomes host again.
- **Calls stay a full mesh of up to six people** (`MAX_ROOM_SIZE`), with
  per-sender bitrate limits that step down as rooms grow.

## When to revisit

- **More than one instance is needed** (load, or zero-downtime deploys):
  move the registry behind an interface backed by Redis, add the
  Socket.IO Redis adapter, and use sticky sessions. This would also let
  locks survive restarts, which in-memory state can't.
- **Rooms of more than six are needed**: add an SFU (LiveKit or
  mediasoup) with simulcast. Keep the mesh for small rooms if it's
  cheaper.

The `/metrics` endpoint shows rooms, participants, time to first video,
TURN use and ICE failures, which are the numbers that tell when either
limit is getting close.
