// Builds and starts the server.
const http = require("http");
const { Server } = require("socket.io");
const { loadConfig } = require("./config");
const { createLogger } = require("./logger");
const { createHttpApp, addPageRoutes } = require("./http");
const { mountPeerServer } = require("./peerjs");
const { attachLegacyProtocol } = require("./legacy-socket");

// Builds the app without listening, so tests can start it on any port.
function createServer({ config = loadConfig(), logger = createLogger(config) } = {}) {
  const app = createHttpApp({ config, logger });
  const server = http.createServer(app);

  // The page is served from this same origin, so no CORS setup is needed.
  // Payloads are small, so keep the buffer far below the 1 MB default.
  const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });

  // Lets clients measure their real round-trip time to the server.
  io.on("connection", (socket) => {
    socket.on("net:ping", (ack) => {
      if (typeof ack === "function") ack();
    });
  });

  mountPeerServer(app, server);
  attachLegacyProtocol(io);
  addPageRoutes(app);

  return { app, server, io, config, logger };
}

function start() {
  const { server, config, logger } = createServer();
  server.listen(config.port, () => {
    logger.info({ port: server.address().port }, "listening");
  });
  return server;
}

module.exports = { createServer, start };
