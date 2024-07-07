#!/usr/bin/env node
import e from "node:path";
import t from "node:fs";
import s from "yargs";
import { hideBin as r } from "yargs/helpers";
import n from "express";
import i from "node:http";
import o from "node:https";
import { randomUUID as a } from "node:crypto";
import { EventEmitter as c } from "node:events";
import { WebSocketServer as l } from "ws";
import d from "cors";
function h(e) {
  return e && e.__esModule ? e.default : e;
}
var g = {
  host: "::",
  port: 9e3,
  expire_timeout: 5e3,
  alive_timeout: 9e4,
  key: "peerjs",
  path: "/",
  concurrent_limit: 5e3,
  allow_discovery: !1,
  proxied: !1,
  cleanup_out_msgs: 1e3,
  corsOptions: { origin: !0 },
};
class u {
  lastReadAt = new Date().getTime();
  messages = [];
  getLastReadAt() {
    return this.lastReadAt;
  }
  addMessage(e) {
    this.messages.push(e);
  }
  readMessage() {
    if (this.messages.length > 0)
      return (this.lastReadAt = new Date().getTime()), this.messages.shift();
  }
  getMessages() {
    return this.messages;
  }
}
class m {
  clients = new Map();
  messageQueues = new Map();
  getClientsIds() {
    return [...this.clients.keys()];
  }
  getClientById(e) {
    return this.clients.get(e);
  }
  getClientsIdsWithQueue() {
    return [...this.messageQueues.keys()];
  }
  setClient(e, t) {
    this.clients.set(t, e);
  }
  removeClientById(e) {
    return !!this.getClientById(e) && (this.clients.delete(e), !0);
  }
  getMessageQueueById(e) {
    return this.messageQueues.get(e);
  }
  addMessageToQueue(e, t) {
    this.getMessageQueueById(e) || this.messageQueues.set(e, new u()),
      this.getMessageQueueById(e)?.addMessage(t);
  }
  clearMessageQueue(e) {
    this.messageQueues.delete(e);
  }
  generateClientId(e) {
    const t = e || a;
    let s = t();
    for (; this.getClientById(s); ) s = t();
    return s;
  }
}
class p {
  timeoutId = null;
  constructor({ realm: e, config: t, checkInterval: s = 300, onClose: r }) {
    (this.realm = e),
      (this.config = t),
      (this.onClose = r),
      (this.checkInterval = s);
  }
  start() {
    this.timeoutId && clearTimeout(this.timeoutId),
      (this.timeoutId = setTimeout(() => {
        this.checkConnections(), (this.timeoutId = null), this.start();
      }, this.checkInterval));
  }
  stop() {
    this.timeoutId && (clearTimeout(this.timeoutId), (this.timeoutId = null));
  }
  checkConnections() {
    const e = this.realm.getClientsIds(),
      t = new Date().getTime(),
      { alive_timeout: s } = this.config;
    for (const r of e) {
      const e = this.realm.getClientById(r);
      if (!e) continue;
      if (!(t - e.getLastPing() < s))
        try {
          e.getSocket()?.close();
        } finally {
          this.realm.clearMessageQueue(r),
            this.realm.removeClientById(r),
            e.setSocket(null),
            this.onClose?.(e);
        }
    }
  }
}
let y;
var I;
let E;
var f;
((I = y || (y = {})).INVALID_KEY = "Invalid key provided"),
  (I.INVALID_TOKEN = "Invalid token provided"),
  (I.INVALID_WS_PARAMETERS =
    "No id, token, or key supplied to websocket server"),
  (I.CONNECTION_LIMIT_EXCEED = "Server has reached its concurrent user limit"),
  ((f = E || (E = {})).OPEN = "OPEN"),
  (f.LEAVE = "LEAVE"),
  (f.CANDIDATE = "CANDIDATE"),
  (f.OFFER = "OFFER"),
  (f.ANSWER = "ANSWER"),
  (f.EXPIRE = "EXPIRE"),
  (f.HEARTBEAT = "HEARTBEAT"),
  (f.ID_TAKEN = "ID-TAKEN"),
  (f.ERROR = "ERROR");
class S {
  timeoutId = null;
  constructor({ realm: e, config: t, messageHandler: s }) {
    (this.realm = e), (this.config = t), (this.messageHandler = s);
  }
  startMessagesExpiration() {
    this.timeoutId && clearTimeout(this.timeoutId),
      (this.timeoutId = setTimeout(() => {
        this.pruneOutstanding(),
          (this.timeoutId = null),
          this.startMessagesExpiration();
      }, this.config.cleanup_out_msgs));
  }
  stopMessagesExpiration() {
    this.timeoutId && (clearTimeout(this.timeoutId), (this.timeoutId = null));
  }
  pruneOutstanding() {
    const e = this.realm.getClientsIdsWithQueue(),
      t = new Date().getTime(),
      s = this.config.expire_timeout,
      r = {};
    for (const n of e) {
      const e = this.realm.getMessageQueueById(n);
      if (!e) continue;
      if (t - e.getLastReadAt() < s) continue;
      const i = e.getMessages();
      for (const e of i) {
        const t = `${e.src}_${e.dst}`;
        r[t] ||
          (this.messageHandler.handle(void 0, {
            type: E.EXPIRE,
            src: e.dst,
            dst: e.src,
          }),
          (r[t] = !0));
      }
      this.realm.clearMessageQueue(n);
    }
  }
}
class k {
  socket = null;
  lastPing = new Date().getTime();
  constructor({ id: e, token: t }) {
    (this.id = e), (this.token = t);
  }
  getId() {
    return this.id;
  }
  getToken() {
    return this.token;
  }
  getSocket() {
    return this.socket;
  }
  setSocket(e) {
    this.socket = e;
  }
  getLastPing() {
    return this.lastPing;
  }
  setLastPing(e) {
    this.lastPing = e;
  }
  send(e) {
    this.socket?.send(JSON.stringify(e));
  }
}
class v extends c {
  constructor({ server: e, realm: t, config: s }) {
    super(), this.setMaxListeners(0), (this.realm = t), (this.config = s);
    const r = this.config.path;
    this.path = `${r}${r.endsWith("/") ? "" : "/"}peerjs`;
    const n = { path: this.path, server: e };
    (this.socketServer = s.createWebSocketServer
      ? s.createWebSocketServer(n)
      : new l(n)),
      this.socketServer.on("connection", (e, t) => {
        this._onSocketConnection(e, t);
      }),
      this.socketServer.on("error", (e) => {
        this._onSocketError(e);
      });
  }
  _onSocketConnection(e, t) {
    e.on("error", (e) => {
      this._onSocketError(e);
    });
    const { searchParams: s } = new URL(t.url ?? "", "https://peerjs"),
      { id: r, token: n, key: i } = Object.fromEntries(s.entries());
    if (!r || !n || !i)
      return void this._sendErrorAndClose(e, y.INVALID_WS_PARAMETERS);
    if (i !== this.config.key)
      return void this._sendErrorAndClose(e, y.INVALID_KEY);
    const o = this.realm.getClientById(r);
    if (o)
      return n !== o.getToken()
        ? (e.send(
            JSON.stringify({
              type: E.ID_TAKEN,
              payload: { msg: "ID is taken" },
            })
          ),
          void e.close())
        : void this._configureWS(e, o);
    this._registerClient({ socket: e, id: r, token: n });
  }
  _onSocketError(e) {
    this.emit("error", e);
  }
  _registerClient({ socket: e, id: t, token: s }) {
    if (this.realm.getClientsIds().length >= this.config.concurrent_limit)
      return void this._sendErrorAndClose(e, y.CONNECTION_LIMIT_EXCEED);
    const r = new k({ id: t, token: s });
    this.realm.setClient(r, t),
      e.send(JSON.stringify({ type: E.OPEN })),
      this._configureWS(e, r);
  }
  _configureWS(e, t) {
    t.setSocket(e),
      e.on("close", () => {
        t.getSocket() === e &&
          (this.realm.removeClientById(t.getId()), this.emit("close", t));
      }),
      e.on("message", (e) => {
        try {
          const s = JSON.parse(e.toString());
          (s.src = t.getId()), this.emit("message", t, s);
        } catch (e) {
          this.emit("error", e);
        }
      }),
      this.emit("connection", t);
  }
  _sendErrorAndClose(e, t) {
    e.send(JSON.stringify({ type: E.ERROR, payload: { msg: t } })), e.close();
  }
}
const R = (e) => {
    if (e) {
      const t = new Date().getTime();
      e.setLastPing(t);
    }
    return !0;
  },
  C = ({ realm: e }) => {
    const t = (s, r) => {
      const n = r.type,
        i = r.src,
        o = r.dst,
        a = e.getClientById(o);
      if (a) {
        const n = a.getSocket();
        try {
          if (!n) throw new Error("Peer dead");
          {
            const e = JSON.stringify(r);
            n.send(e);
          }
        } catch (r) {
          n ? n.close() : e.removeClientById(a.getId()),
            t(s, { type: E.LEAVE, src: o, dst: i });
        }
      } else {
        ![E.LEAVE, E.EXPIRE].includes(n) && o
          ? e.addMessageToQueue(o, r)
          : n !== E.LEAVE || o || e.removeClientById(i);
      }
      return !0;
    };
    return t;
  };
class _ {
  handlers = new Map();
  registerHandler(e, t) {
    this.handlers.has(e) || this.handlers.set(e, t);
  }
  handle(e, t) {
    const { type: s } = t,
      r = this.handlers.get(s);
    return !!r && r(e, t);
  }
}
class A {
  constructor(e, t = new _()) {
    this.handlersRegistry = t;
    const s = C({ realm: e }),
      r = R,
      n = (e, { type: t, src: r, dst: n, payload: i }) =>
        s(e, { type: t, src: r, dst: n, payload: i });
    this.handlersRegistry.registerHandler(E.HEARTBEAT, (e, t) => r(e, t)),
      this.handlersRegistry.registerHandler(E.OFFER, n),
      this.handlersRegistry.registerHandler(E.ANSWER, n),
      this.handlersRegistry.registerHandler(E.CANDIDATE, n),
      this.handlersRegistry.registerHandler(E.LEAVE, n),
      this.handlersRegistry.registerHandler(E.EXPIRE, n);
  }
  handle(e, t) {
    return this.handlersRegistry.handle(e, t);
  }
}
var O;
O = JSON.parse(
  '{"name":"PeerJS Server","description":"A server side element to broker connections between PeerJS clients.","website":"https://peerjs.com/"}'
);
var T = ({ config: e, realm: t }) => {
  const s = n.Router();
  return (
    s.get("/id", (s, r) => {
      r.contentType("html"), r.send(t.generateClientId(e.generateClientId));
    }),
    s.get("/peers", (s, r) => {
      if (e.allow_discovery) {
        const e = t.getClientsIds();
        return r.send(e);
      }
      return r.sendStatus(401);
    }),
    s
  );
};
const w = ({ config: e, realm: t, corsOptions: s }) => {
    const r = n.Router();
    return (
      r.use(d(s)),
      r.get("/", (e, t) => {
        t.send(h(O));
      }),
      r.use("/:key", T({ config: e, realm: t })),
      r
    );
  },
  N = ({ app: t, server: s, options: r }) => {
    const n = r,
      i = new m(),
      o = new A(i),
      a = w({ config: n, realm: i, corsOptions: r.corsOptions }),
      c = new S({ realm: i, config: n, messageHandler: o }),
      l = new p({
        realm: i,
        config: n,
        onClose: (e) => {
          t.emit("disconnect", e);
        },
      });
    t.use(r.path, a);
    const d = { ...n, path: e.posix.join(t.path(), r.path, "/") },
      h = new v({ server: s, realm: i, config: d });
    h.on("connection", (e) => {
      const s = i.getMessageQueueById(e.getId());
      if (s) {
        let t;
        for (; (t = s.readMessage()); ) o.handle(e, t);
        i.clearMessageQueue(e.getId());
      }
      t.emit("connection", e);
    }),
      h.on("message", (e, s) => {
        t.emit("message", e, s), o.handle(e, s);
      }),
      h.on("close", (e) => {
        t.emit("disconnect", e);
      }),
      h.on("error", (e) => {
        t.emit("error", e);
      }),
      c.startMessagesExpiration(),
      l.start();
  };
const M = s(r(process.argv)),
  b = !!process.env.PORT,
  P = M.usage("Usage: $0")
    .wrap(Math.min(98, M.terminalWidth()))
    .options({
      expire_timeout: {
        demandOption: !1,
        alias: "t",
        describe: "timeout (milliseconds)",
        default: 5e3,
      },
      concurrent_limit: {
        demandOption: !1,
        alias: "c",
        describe: "concurrent limit",
        default: 5e3,
      },
      alive_timeout: {
        demandOption: !1,
        describe: "broken connection check timeout (milliseconds)",
        default: 6e4,
      },
      key: {
        demandOption: !1,
        alias: "k",
        describe: "connection key",
        default: "peerjs",
      },
      sslkey: { type: "string", demandOption: !1, describe: "path to SSL key" },
      sslcert: {
        type: "string",
        demandOption: !1,
        describe: "path to SSL certificate",
      },
      host: { type: "string", demandOption: !1, alias: "H", describe: "host" },
      port: { type: "number", demandOption: !b, alias: "p", describe: "port" },
      path: {
        type: "string",
        demandOption: !1,
        describe: "custom path",
        default: process.env.PEERSERVER_PATH ?? "/",
      },
      allow_discovery: {
        type: "boolean",
        demandOption: !1,
        describe: "allow discovery of peers",
      },
      proxied: {
        type: "boolean",
        demandOption: !1,
        describe: "Set true if PeerServer stays behind a reverse proxy",
        default: !1,
      },
      cors: {
        type: "string",
        array: !0,
        describe: "Set the list of CORS origins",
      },
    })
    .boolean("allow_discovery")
    .parseSync();
P.port || (P.port = parseInt(process.env.PORT)),
  P.cors && (P.corsOptions = { origin: P.cors }),
  process.on("uncaughtException", function (e) {
    console.error("Error: " + e.toString());
  }),
  (P.sslkey ?? P.sslcert) &&
    (P.sslkey && P.sslcert
      ? (P.ssl = {
          key: t.readFileSync(e.resolve(P.sslkey)),
          cert: t.readFileSync(e.resolve(P.sslcert)),
        })
      : (console.error(
          "Warning: PeerServer will not run because either the key or the certificate has not been provided."
        ),
        process.exit(1)));
const D = P.path,
  L = (function (e = {}, t) {
    const s = n();
    let r = { ...g, ...e };
    const a = r.port,
      c = r.host;
    let l;
    const { ssl: d, ...h } = r;
    d && Object.keys(d).length
      ? ((l = o.createServer(d, s)), (r = h))
      : (l = i.createServer(s));
    const u = (function (e, t) {
      const s = n(),
        r = { ...g, ...t };
      return (
        r.proxied && s.set("trust proxy", "false" !== r.proxied && !!r.proxied),
        s.on("mount", () => {
          if (!e)
            throw new Error(
              "Server is not passed to constructor - can't start PeerServer"
            );
          N({ app: s, server: e, options: r });
        }),
        s
      );
    })(l, r);
    return s.use(u), l.listen(a, c, () => t?.(l)), u;
  })(P, (e) => {
    const { address: t, port: s } = e.address();
    console.log("Started PeerServer on %s, port: %s, path: %s", t, s, D || "/");
    const r = () => {
      e.close(() => {
        console.log("Http server closed."), process.exit(0);
      });
    };
    process.on("SIGINT", r), process.on("SIGTERM", r);
  });
L.on("connection", (e) => {
  console.log(`Client connected: ${e.getId()}`);
}),
  L.on("disconnect", (e) => {
    console.log(`Client disconnected: ${e.getId()}`);
  });
//# sourceMappingURL=peerjs.js.map