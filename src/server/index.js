// Builds and starts the server.
const http = require("http");
const { Server } = require("socket.io");
const { loadConfig } = require("./config");
const { createLogger } = require("./logger");
const { createHttpApp, addPageRoutes } = require("./http");
const { mountPeerServer } = require("./peerjs");
const { attachLegacyProtocol } = require("./legacy-socket");
const { RoomRegistry } = require("./rooms");
const { attachRealtime, isAllowedOrigin } = require("./realtime");

// Builds the app without listening, so tests can start it on any port.
function createServer({ config = loadConfig(), logger = createLogger(config) } = {}) {
  let io;
  const rooms = new RoomRegistry({ maxRoomSize: config.maxRoomSize });
  const health = () => ({
    uptimeSeconds: Math.round(process.uptime()),
    connections: io?.engine.clientsCount ?? 0,
    ...rooms.stats(),
  });
  const app = createHttpApp({ config, logger, health });
  const server = http.createServer(app);

  // The page is served from this same origin, so no CORS setup is needed.
  // Payloads are small, so keep the buffer far below the 1 MB default.
  io = new Server(server, {
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req, config)),
  });

  // Lets clients measure their real round-trip time to the server.
  io.on("connection", (socket) => {
    socket.on("net:ping", (ack) => {
      if (typeof ack === "function") ack();
    });
  });

  mountPeerServer(app, server);
  attachLegacyProtocol(io);
  attachRealtime({ io, rooms, config, logger });
  addPageRoutes(app, { logger });

  return { app, server, io, rooms, config, logger };
}

function start() {
  const { server, io, config, logger } = createServer();
  server.listen(config.port, () => {
    logger.info({ port: server.address().port }, "listening");
  });

  // On deploys the platform sends SIGTERM. Warn connected clients (calls are
  // peer-to-peer, so media keeps flowing while they reconnect), stop accepting
  // connections, then exit.
  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) process.exit(1); // second signal: give up waiting
    stopping = true;
    const inSeconds = Math.ceil(config.shutdownGraceMs / 1000);
    logger.info({ signal, inSeconds }, "shutting down");
    io.emit("server:restarting", { inSeconds });
    server.close();
    setTimeout(() => {
      io.close();
      process.exit(0);
    }, config.shutdownGraceMs).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return server;
}

module.exports = { createServer, start };
