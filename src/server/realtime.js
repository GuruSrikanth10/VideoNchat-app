// Realtime protocol v1 (docs/protocol.md): room membership, chat, media
// state and WebRTC signalling over Socket.IO. The server owns identity:
// it assigns participant IDs and stamps every relayed event with them.
const { randomUUID } = require("crypto");
const { publicView } = require("./rooms");
const { createLimiter } = require("./rate-limit");
const schemas = require("./schemas");

// Browsers always send Origin for WebSockets and cross-site requests; only
// this app's own pages may connect. Clients without an Origin (tests,
// command-line tools) can't ride on a visitor's browser, so they're allowed.
function isAllowedOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (config.publicUrl) return origin === config.publicUrl;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function attachRealtime({ io, rooms, config, logger }) {
  const leaveRoom = (roomId, participantId) => {
    const participant = rooms.leave(roomId, participantId);
    if (participant) io.to(roomId).emit("participant:left", { id: participantId });
  };

  io.on("connection", (socket) => {
    const limiter = createLimiter();
    const current = () => {
      const { roomId, participantId } = socket.data;
      return roomId ? rooms.participant(roomId, participantId) : undefined;
    };

    // Wraps a handler with rate limiting, error handling and a safe ack.
    const handle = (event, handler) => {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === "function" ? ack : () => {};
        if (!limiter.allow(event)) return reply({ ok: false, error: "rate-limited" });
        try {
          handler(payload, reply);
        } catch (err) {
          logger.error({ err, event }, "realtime handler failed");
          reply({ ok: false, error: "server-error" });
        }
      });
    };

    handle("room:join", (payload, reply) => {
      if (socket.data.participantId) return reply({ ok: false, error: "already-joined" });
      const parsed = schemas.parseJoin(payload);
      if (!parsed.ok) return reply(parsed);
      const { roomId, name, session } = parsed.value;

      // A reconnecting tab resumes its participant silently.
      let result = session ? rooms.resume(roomId, session, socket.id) : undefined;
      const resumed = Boolean(result);
      if (!result) result = rooms.join(roomId, { name, socketId: socket.id });
      if (result.error) return reply({ ok: false, error: result.error });

      const { room, participant } = result;
      socket.data = { roomId, participantId: participant.id };
      socket.join(roomId);
      if (!resumed) socket.to(roomId).emit("participant:joined", publicView(participant));
      logger.debug({ participants: room.participants.size, resumed }, "participant joined");

      reply({
        ok: true,
        resumed,
        self: { ...publicView(participant), session: participant.session },
        participants: [...room.participants.values()]
          .filter((p) => p.id !== participant.id)
          .map(publicView),
        history: room.history,
        maxRoomSize: rooms.maxRoomSize,
      });
    });

    handle("room:leave", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const { roomId } = socket.data;
      socket.leave(roomId);
      socket.data = {};
      leaveRoom(roomId, participant.id);
      reply({ ok: true });
    });

    handle("chat:send", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const parsed = schemas.parseChat(payload);
      if (!parsed.ok) return reply(parsed);
      const message = {
        id: randomUUID(),
        from: participant.id,
        name: participant.name,
        text: parsed.value.text,
        ts: Date.now(),
      };
      rooms.addMessage(socket.data.roomId, message);
      io.to(socket.data.roomId).emit("chat:message", message);
      reply({ ok: true, id: message.id });
    });

    handle("chat:typing", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const parsed = schemas.parseTyping(payload);
      if (!parsed.ok) return reply(parsed);
      socket.to(socket.data.roomId).emit("chat:typing", {
        from: participant.id,
        name: participant.name,
        typing: parsed.value.typing,
      });
      reply({ ok: true });
    });

    handle("media:state", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const parsed = schemas.parseMediaState(payload);
      if (!parsed.ok) return reply(parsed);
      Object.assign(participant, parsed.value);
      socket.to(socket.data.roomId).emit("participant:updated", publicView(participant));
      reply({ ok: true });
    });

    // Relays WebRTC offers, answers and ICE candidates to one participant
    // in the same room, stamped with the sender's ID.
    handle("rtc:signal", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const parsed = schemas.parseSignal(payload);
      if (!parsed.ok) return reply(parsed);
      const { to, ...signal } = parsed.value;
      const target = rooms.participant(socket.data.roomId, to);
      if (!target || !target.connected) return reply({ ok: false, error: "unknown-peer" });
      io.to(target.socketId).emit("rtc:signal", { from: participant.id, ...signal });
      reply({ ok: true });
    });

    socket.on("disconnect", (reason) => {
      const participant = current();
      if (!participant || participant.socketId !== socket.id) return;
      const { roomId } = socket.data;
      // Leaving on purpose is immediate. A dropped connection gets a grace
      // period to come back before the others are told.
      if (reason === "client namespace disconnect" || config.reconnectGraceMs === 0) {
        leaveRoom(roomId, participant.id);
        return;
      }
      participant.connected = false;
      participant.leaveTimer = setTimeout(
        () => leaveRoom(roomId, participant.id),
        config.reconnectGraceMs,
      );
    });
  });
}

module.exports = { attachRealtime, isAllowedOrigin };
