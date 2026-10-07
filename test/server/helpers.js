const pino = require("pino");
const { io: connect } = require("socket.io-client");
const { createServer } = require("../../app");
const { loadConfig } = require("../../src/server/config");

// Starts the app on a random local port. Every log line is captured in
// `logs` (at the most verbose level) so tests can inspect them.
async function startTestServer(env = {}) {
  const config = loadConfig({ NODE_ENV: "test", ...env });
  const logs = [];
  const logger = pino({ level: "trace" }, { write: (line) => logs.push(line) });
  const { server, io } = createServer({ config, logger });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = new Set();

  return {
    url,
    logs,
    // A connected Socket.IO client using the WebSocket transport only.
    async client() {
      const socket = connect(url, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
      });
      clients.add(socket);
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    },
    async close() {
      for (const socket of clients) socket.disconnect();
      server.closeAllConnections(); // keep-alive HTTP connections from fetch()
      await new Promise((resolve) => io.close(resolve));
    },
  };
}

// Resolves with the arguments of the next `event`, or rejects after `ms`.
function nextEvent(socket, event, ms = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms);
    function handler(...args) {
      clearTimeout(timer);
      resolve(args);
    }
    socket.once(event, handler);
  });
}

// Collects every `event` received during the next `ms` milliseconds.
function collect(socket, event, ms = 300) {
  const seen = [];
  const handler = (...args) => seen.push(args);
  socket.on(event, handler);
  return new Promise((resolve) =>
    setTimeout(() => {
      socket.off(event, handler);
      resolve(seen);
    }, ms),
  );
}

let counter = 0;
const uniqueRoom = () => `room-${process.pid}-${++counter}`;
const secret = () => `secret-${Math.random().toString(36).slice(2)}`;

// Joins `room` and waits until the server has processed it.
async function join(socket, room, peerId, name, tabSecret = secret()) {
  socket.emit("join-room", room, peerId, name, tabSecret);
  await new Promise((resolve) => socket.emit("net:ping", resolve));
  return tabSecret;
}

module.exports = { startTestServer, nextEvent, collect, uniqueRoom, join, secret };
