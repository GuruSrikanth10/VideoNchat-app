// The original Socket.IO protocol used by the PeerJS-based room page.
const { isToken, clean } = require("./tokens");

function attachLegacyProtocol(io) {
  const findByPeerId = (roomId, peerId) =>
    [...(io.sockets.adapter.rooms.get(roomId) ?? [])]
      .map((id) => io.sockets.sockets.get(id))
      .find((s) => s?.data.peerId === peerId);

  // Handlers are registered once per connection; the room and identity live in
  // socket.data, so repeated join-room events can't stack duplicate handlers.
  io.on("connection", (socket) => {
    socket.on("join-room", (roomId, peerId, name, secret) => {
      if (socket.data.roomId || ![roomId, peerId, secret].every(isToken)) return;

      // A peer ID that is already in the room may only be reclaimed by the tab
      // that owns it (same secret), e.g. after a reconnect. Then the stale
      // socket is replaced; anyone else is refused.
      const holder = findByPeerId(roomId, peerId);
      if (holder && holder.data.secret !== secret) return;
      holder?.disconnect(true);

      socket.data = { roomId, peerId, secret, name: clean(name, 40) || "Guest" };
      socket.join(roomId);
      socket.to(roomId).emit("user-connected", peerId, socket.data.name);
    });

    socket.on("message", (message) => {
      const { roomId, name, peerId } = socket.data;
      const text = clean(message, 1000);
      if (roomId && text) io.to(roomId).emit("createMessage", text, name, peerId);
    });

    socket.on("typing", () => {
      const { roomId, name } = socket.data;
      if (roomId) socket.to(roomId).emit("typing", name);
    });

    socket.on("stoppedTyping", () => {
      const { roomId, name } = socket.data;
      if (roomId) socket.to(roomId).emit("stoppedTyping", name);
    });

    socket.on("disconnect", () => {
      const { roomId, peerId } = socket.data;
      if (roomId) socket.to(roomId).emit("user-disconnected", peerId);
    });
  });
}

module.exports = { attachLegacyProtocol };
