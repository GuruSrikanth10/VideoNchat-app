// The PeerJS signalling server, mounted at /peerjs on the app's own server.
const { ExpressPeerServer } = require("peer");
const { WebSocketServer } = require("ws");

function mountPeerServer(app, server) {
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
  app.use("/peerjs", peerServer);
}

module.exports = { mountPeerServer };
