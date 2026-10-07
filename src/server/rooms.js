// In-memory registry of rooms and the people in them. A room exists while
// someone is in it; its chat history (and its lock) disappear with it.
const { randomUUID, randomBytes, timingSafeEqual } = require("crypto");

const HISTORY_SIZE = 50;
// People waiting to be let into a locked room, at most.
const MAX_KNOCKS = 20;
// How long someone who was let in has to use their ticket.
const TICKET_TTL_MS = 60_000;

const sameToken = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

class RoomRegistry {
  constructor({ maxRoomSize }) {
    this.maxRoomSize = maxRoomSize;
    // roomId -> { id, participants: Map, history: [], locked, knocks: Map, tickets: Map }
    this.rooms = new Map();
  }

  get(roomId) {
    return this.rooms.get(roomId);
  }

  participant(roomId, participantId) {
    return this.rooms.get(roomId)?.participants.get(participantId);
  }

  // Adds a new participant, or returns { error } if the room is full, or
  // locked and they have no ticket from a host letting them in. The first
  // person in a room is its host.
  join(roomId, { name, socketId, ticket, now = Date.now() }) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        participants: new Map(),
        history: [],
        locked: false,
        knocks: new Map(), // knock ID -> { id, name, socketId }
        tickets: new Map(), // ticket -> expiry time
      };
      this.rooms.set(roomId, room);
    }
    if (room.participants.size >= this.maxRoomSize) return { error: "room-full" };
    if (room.locked && !this.#useTicket(room, ticket, now)) return { error: "room-locked" };

    const participant = {
      id: randomUUID(),
      session: randomBytes(24).toString("base64url"),
      name,
      socketId,
      connected: true,
      leaveTimer: null,
      // Signals that arrive while the participant is reconnecting.
      pending: [],
      audio: false,
      video: false,
      screen: false,
      // When their hand went up (null when it's down), so hands are taken
      // in order.
      hand: null,
      host: room.participants.size === 0,
      joinedAt: now,
    };
    room.participants.set(participant.id, participant);
    return { room, participant };
  }

  // Reattaches a participant to a new socket after a reconnect, if the
  // session token matches. Returns undefined otherwise.
  resume(roomId, session, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    for (const participant of room.participants.values()) {
      if (sameToken(participant.session, session)) {
        clearTimeout(participant.leaveTimer);
        participant.leaveTimer = null;
        participant.connected = true;
        participant.socketId = socketId;
        return { room, participant };
      }
    }
    return undefined;
  }

  // Removes a participant. If they were the host, whoever has been there
  // longest takes over: returned as `newHost`.
  leave(roomId, participantId) {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    if (!participant) return undefined;
    clearTimeout(participant.leaveTimer);
    room.participants.delete(participantId);
    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
      return { participant, newHost: null };
    }
    let newHost = null;
    if (participant.host && ![...room.participants.values()].some((p) => p.host)) {
      newHost = [...room.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      newHost.host = true;
    }
    return { participant, newHost };
  }

  // Someone asks to be let into a locked room. Returns the knock, or
  // { error }.
  knock(roomId, { name, socketId }) {
    const room = this.rooms.get(roomId);
    if (!room?.locked) return { error: "not-locked" };
    if (room.knocks.size >= MAX_KNOCKS) return { error: "too-many-knocks" };
    const knock = { id: randomUUID(), name, socketId };
    room.knocks.set(knock.id, knock);
    return { knock };
  }

  // A host answers a knock. Letting someone in gives them a single-use
  // ticket that gets them past the lock.
  answerKnock(roomId, knockId, admit, now = Date.now()) {
    const room = this.rooms.get(roomId);
    const knock = room?.knocks.get(knockId);
    if (!knock) return undefined;
    room.knocks.delete(knockId);
    if (!admit) return { knock, ticket: null };
    const ticket = randomBytes(24).toString("base64url");
    room.tickets.set(ticket, now + TICKET_TTL_MS);
    return { knock, ticket };
  }

  // The knocks a socket has made (e.g. when it disconnects).
  cancelKnocks(socketId) {
    const cancelled = [];
    for (const room of this.rooms.values()) {
      for (const knock of room.knocks.values()) {
        if (knock.socketId === socketId) {
          room.knocks.delete(knock.id);
          cancelled.push({ roomId: room.id, knock });
        }
      }
    }
    return cancelled;
  }

  #useTicket(room, ticket, now) {
    for (const [known, expires] of room.tickets) {
      if (expires < now) room.tickets.delete(known);
    }
    if (typeof ticket !== "string" || !room.tickets.has(ticket)) return false;
    room.tickets.delete(ticket);
    return true;
  }

  addMessage(roomId, message) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.history.push(message);
    if (room.history.length > HISTORY_SIZE) room.history.shift();
  }

  stats() {
    let participants = 0;
    for (const room of this.rooms.values()) participants += room.participants.size;
    return { rooms: this.rooms.size, participants };
  }
}

// What other participants may know about someone.
const publicView = ({ id, name, audio, video, screen, hand, host }) => ({
  id,
  name,
  audio,
  video,
  screen,
  hand,
  host,
});

module.exports = { RoomRegistry, publicView, HISTORY_SIZE, MAX_KNOCKS, TICKET_TTL_MS };
