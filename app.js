const http = require("http");
const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { ExpressPeerServer } = require("peer");
const { WebSocketServer } = require("ws");

// Room IDs are generated UUIDs; custom names are allowed but restricted to
// letters, digits, "_" and "-". Room IDs, PeerJS IDs and per-tab secrets all
// use this format.
const TOKEN = /^[\w-]{1,64}$/;
const isToken = (value) => typeof value === "string" && TOKEN.test(value);
const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// Builds the app without listening, so tests can start it on any port.
function createServer() {
  const app = express();
  const server = http.createServer(app);

  //****************************//SOCKET AND PEER SETUP //****************************//
  // The page is served from this same origin, so no CORS setup is needed.
  // Payloads are small text messages, so keep the buffer far below the 1 MB default.
  const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });

  // PeerJS must only take over WebSocket upgrades for its own path. By default
  // its WebSocket server answers every other upgrade (including Socket.IO's)
  // with "400 Bad Request", which forces Socket.IO back to long-polling.
  const peerServer = ExpressPeerServer(server, {
    createWebSocketServer: (options) => {
      const wss = new WebSocketServer({ noServer: true });
      server.on("upgrade", (req, socket, head) => {
        const { pathname } = new URL(req.url, "http://localhost");
        if (pathname !== options.path) return; // not ours: Socket.IO handles it
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      });
      return wss;
    },
  });

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use("/peerjs", peerServer);
  app.use(express.static(path.join(__dirname, "public")));
  // Browser libraries are served from node_modules instead of public CDNs, so
  // versions are pinned in package-lock.json and the app doesn't depend on them.
  app.use("/vendor/peerjs", express.static(path.join(__dirname, "node_modules/peerjs/dist")));
  app.use(
    "/vendor/sweetalert2",
    express.static(path.join(__dirname, "node_modules/sweetalert2/dist")),
  );

  //****************************//GET REQUESTS //****************************//
  app.get("/", (req, res) => {
    res.redirect(`/${randomUUID()}`); // Creates a new random id and redirects it.
  });

  app.get("/leave", (req, res) => {
    res.render("leave");
  });

  // Anything that isn't a valid room ID (e.g. /favicon.ico) is a 404.
  app.get("/:room", (req, res, next) => {
    if (!TOKEN.test(req.params.room)) return next();
    res.render("room", { roomId: req.params.room });
  });

  //****************************//SOCKET IO CONNECTION //****************************//

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
      // that owns it (same secret), e.g. after a reconnect. Then the stale socket
      // is replaced; anyone else is refused.
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

    // Lets clients measure their real round-trip time to the server.
    socket.on("net:ping", (ack) => {
      if (typeof ack === "function") ack();
    });

    socket.on("disconnect", () => {
      const { roomId, peerId } = socket.data;
      if (roomId) socket.to(roomId).emit("user-disconnected", peerId);
    });
  });

  return { app, server, io };
}

function start(port = Number(process.env.PORT) || 3000) {
  const { server } = createServer();
  server.listen(port, () => console.log(`Listening on port ${port}`));
  return server;
}

if (require.main === module) start();

module.exports = { createServer, start };
