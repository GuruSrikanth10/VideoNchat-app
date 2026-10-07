// Realtime protocol v1 (docs/protocol.md): room membership, chat, media
// state and WebRTC signalling over Socket.IO. The server owns identity:
// it assigns participant IDs and stamps every relayed event with them.
const { randomUUID } = require("crypto");
const { publicView } = require("./rooms");
const { createLimiter } = require("./rate-limit");
const { iceServersFor } = require("./ice");
const schemas = require("./schemas");
const { isToken } = require("./tokens");

// Signals held for someone who is reconnecting (bounded).
const MAX_PENDING_SIGNALS = 500;

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
    const left = rooms.leave(roomId, participantId);
    if (!left) return;
    io.to(roomId).emit("participant:left", { id: participantId });
    if (left.newHost) io.to(roomId).emit("participant:updated", publicView(left.newHost));
  };

  // Host-only events go straight to the hosts' sockets.
  const toHosts = (roomId, event, payload) => {
    for (const participant of rooms.get(roomId)?.participants.values() ?? []) {
      if (participant.host && participant.connected) {
        io.to(participant.socketId).emit(event, payload);
      }
    }
  };
  const knockView = ({ id, name }) => ({ id, name });

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

    // A host action aimed at another participant in the same room.
    const hostAction = (event, handler) => {
      handle(event, (payload, reply) => {
        const host = current();
        if (!host) return reply({ ok: false, error: "not-joined" });
        if (!host.host) return reply({ ok: false, error: "not-host" });
        const parsed = schemas.parseTarget(payload);
        if (!parsed.ok) return reply(parsed);
        const target = rooms.participant(socket.data.roomId, parsed.value.id);
        if (!target || target === host) return reply({ ok: false, error: "unknown-participant" });
        handler({ host, target, roomId: socket.data.roomId }, reply);
      });
    };

    handle("room:join", (payload, reply) => {
      if (socket.data.participantId) return reply({ ok: false, error: "already-joined" });
      const parsed = schemas.parseJoin(payload);
      if (!parsed.ok) return reply(parsed);
      const { roomId, name, session, ticket } = parsed.value;

      // A reconnecting tab resumes its participant silently (even if the
      // room was locked in the meantime).
      let result = session ? rooms.resume(roomId, session, socket.id) : undefined;
      const resumed = Boolean(result);
      if (!result) result = rooms.join(roomId, { name, socketId: socket.id, ticket });
      if (result.error) return reply({ ok: false, error: result.error });
      for (const { roomId: knocked, knock } of rooms.cancelKnocks(socket.id)) {
        toHosts(knocked, "knock:resolved", { id: knock.id, admitted: knocked === roomId });
      }

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
        locked: room.locked,
        // A host who reconnects sees who is still waiting to come in.
        knocks: participant.host ? [...room.knocks.values()].map(knockView) : [],
        // Only people in a room get TURN credentials.
        iceServers: iceServersFor(config, { user: participant.id }),
      });

      // Deliver the signals that arrived while this tab was reconnecting,
      // so no negotiation is left half-finished.
      for (const signal of participant.pending.splice(0)) socket.emit("rtc:signal", signal);
    });

    // Fresh credentials for connections made late in a long meeting.
    handle("rtc:ice-servers", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      reply({ ok: true, iceServers: iceServersFor(config, { user: participant.id }) });
    });

    // For the lobby: how many people are in a room, without joining it.
    // Names stay private until you join.
    handle("room:peek", (payload, reply) => {
      const roomId = payload?.roomId;
      if (!isToken(roomId)) return reply({ ok: false, error: "invalid-room" });
      const room = rooms.get(roomId);
      const count = room?.participants.size ?? 0;
      reply({
        ok: true,
        count,
        full: count >= rooms.maxRoomSize,
        locked: room?.locked ?? false,
        // So people know before they join.
        recording: [...(room?.participants.values() ?? [])].some((p) => p.recording),
        maxRoomSize: rooms.maxRoomSize,
      });
    });

    // Asks the hosts of a locked room to be let in. The answer comes as
    // knock:answered; a ticket in it gets you past the lock once.
    handle("room:knock", (payload, reply) => {
      if (socket.data.participantId) return reply({ ok: false, error: "already-joined" });
      const parsed = schemas.parseKnock(payload);
      if (!parsed.ok) return reply(parsed);
      const { roomId, name } = parsed.value;
      // One knock per tab at a time.
      for (const { roomId: knocked, knock } of rooms.cancelKnocks(socket.id)) {
        toHosts(knocked, "knock:resolved", { id: knock.id, admitted: false });
      }
      const result = rooms.knock(roomId, { name, socketId: socket.id });
      if (result.error) return reply({ ok: false, error: result.error });
      toHosts(roomId, "knock:request", knockView(result.knock));
      reply({ ok: true, id: result.knock.id });
    });

    handle("knock:answer", (payload, reply) => {
      const host = current();
      if (!host) return reply({ ok: false, error: "not-joined" });
      if (!host.host) return reply({ ok: false, error: "not-host" });
      const parsed = schemas.parseKnockAnswer(payload);
      if (!parsed.ok) return reply(parsed);
      const { roomId } = socket.data;
      const answered = rooms.answerKnock(roomId, parsed.value.id, parsed.value.admit);
      if (!answered) return reply({ ok: false, error: "unknown-knock" });
      const { knock, ticket } = answered;
      io.to(knock.socketId).emit("knock:answered", { admitted: Boolean(ticket), ticket });
      toHosts(roomId, "knock:resolved", { id: knock.id, admitted: Boolean(ticket) });
      reply({ ok: true });
    });

    // Locked rooms only let in people a host lets in. Unlocking lets in
    // everyone who was waiting.
    handle("room:lock", (payload, reply) => {
      const host = current();
      if (!host) return reply({ ok: false, error: "not-joined" });
      if (!host.host) return reply({ ok: false, error: "not-host" });
      const parsed = schemas.parseLock(payload);
      if (!parsed.ok) return reply(parsed);
      const { roomId } = socket.data;
      const room = rooms.get(roomId);
      room.locked = parsed.value.locked;
      if (!room.locked) {
        for (const knock of room.knocks.values()) {
          io.to(knock.socketId).emit("knock:answered", { admitted: true, ticket: null });
          toHosts(roomId, "knock:resolved", { id: knock.id, admitted: true });
        }
        room.knocks.clear();
      }
      io.to(roomId).emit("room:updated", { locked: room.locked });
      reply({ ok: true });
    });

    // Turns someone's microphone off. (Their app does it; only they can
    // turn it back on.)
    hostAction("host:mute", ({ host, target }, reply) => {
      io.to(target.socketId).emit("host:mute", { by: host.name });
      reply({ ok: true });
    });

    // Asks someone to unmute: they decide.
    hostAction("host:ask-unmute", ({ host, target }, reply) => {
      io.to(target.socketId).emit("host:ask-unmute", { by: host.name });
      reply({ ok: true });
    });

    hostAction("host:lower-hand", ({ target, roomId }, reply) => {
      target.hand = null;
      io.to(roomId).emit("participant:updated", publicView(target));
      reply({ ok: true });
    });

    // Removes someone from the meeting. They can come back with the link
    // unless the room is locked.
    hostAction("host:remove", ({ host, target, roomId }, reply) => {
      const removed = io.sockets.sockets.get(target.socketId);
      if (removed) {
        removed.emit("room:removed", { by: host.name });
        removed.leave(roomId);
        removed.data = {};
      }
      leaveRoom(roomId, target.id);
      reply({ ok: true });
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

    handle("hand:set", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const parsed = schemas.parseHand(payload);
      if (!parsed.ok) return reply(parsed);
      // Raising an already raised hand keeps its place in the queue.
      participant.hand = parsed.value.raised ? (participant.hand ?? Date.now()) : null;
      socket.to(socket.data.roomId).emit("participant:updated", publicView(participant));
      reply({ ok: true, hand: participant.hand });
    });

    // Recording happens on the recorder's device. The server's part is to
    // make sure everyone knows.
    handle("recording:set", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const parsed = schemas.parseRecording(payload);
      if (!parsed.ok) return reply(parsed);
      participant.recording = parsed.value.recording;
      socket.to(socket.data.roomId).emit("participant:updated", publicView(participant));
      reply({ ok: true });
    });

    // Captions of someone's own speech, made by their browser. Relayed,
    // never stored or logged.
    handle("caption:send", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const parsed = schemas.parseCaption(payload);
      if (!parsed.ok) return reply(parsed);
      socket.to(socket.data.roomId).emit("caption", { from: participant.id, ...parsed.value });
      reply({ ok: true });
    });

    // Reactions are fleeting: relayed, never stored.
    handle("reaction:send", (payload, reply) => {
      const participant = current();
      if (!participant) return reply({ ok: false, error: "not-joined" });
      const parsed = schemas.parseReaction(payload);
      if (!parsed.ok) return reply(parsed);
      socket.to(socket.data.roomId).emit("reaction", {
        from: participant.id,
        emoji: parsed.value.emoji,
      });
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
      if (!target) return reply({ ok: false, error: "unknown-peer" });
      const relayed = { from: participant.id, ...signal };
      if (!target.connected) {
        target.pending.push(relayed);
        if (target.pending.length > MAX_PENDING_SIGNALS) target.pending.shift();
        return reply({ ok: true, queued: true });
      }
      io.to(target.socketId).emit("rtc:signal", relayed);
      reply({ ok: true });
    });

    socket.on("disconnect", (reason) => {
      for (const { roomId, knock } of rooms.cancelKnocks(socket.id)) {
        toHosts(roomId, "knock:resolved", { id: knock.id, admitted: false });
      }
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
