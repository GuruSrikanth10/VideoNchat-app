// In-memory registry of rooms and the people in them. A room exists while
// someone is in it; its chat history disappears with it.
const { randomUUID, randomBytes, timingSafeEqual } = require("crypto");

const HISTORY_SIZE = 50;

const sameToken = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

class RoomRegistry {
  constructor({ maxRoomSize }) {
    this.maxRoomSize = maxRoomSize;
    this.rooms = new Map(); // roomId -> { id, participants: Map, history: [] }
  }

  get(roomId) {
    return this.rooms.get(roomId);
  }

  participant(roomId, participantId) {
    return this.rooms.get(roomId)?.participants.get(participantId);
  }

  // Adds a new participant, or returns { error } if the room is full.
  join(roomId, { name, socketId }) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { id: roomId, participants: new Map(), history: [] };
      this.rooms.set(roomId, room);
    }
    if (room.participants.size >= this.maxRoomSize) return { error: "room-full" };

    const participant = {
      id: randomUUID(),
      session: randomBytes(24).toString("base64url"),
      name,
      socketId,
      connected: true,
      leaveTimer: null,
      audio: false,
      video: false,
      screen: false,
      joinedAt: Date.now(),
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

  leave(roomId, participantId) {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    if (!participant) return undefined;
    clearTimeout(participant.leaveTimer);
    room.participants.delete(participantId);
    if (room.participants.size === 0) this.rooms.delete(roomId);
    return participant;
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
const publicView = ({ id, name, audio, video, screen }) => ({ id, name, audio, video, screen });

module.exports = { RoomRegistry, publicView, HISTORY_SIZE };
