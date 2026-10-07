// The Express app: pages, static files and HTTP endpoints.
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const { TOKEN } = require("./tokens");

const PUBLIC = path.join(__dirname, "../../public");
const VIEWS = path.join(__dirname, "../../views");

// Only this origin may use the camera, microphone and screen capture.
const PERMISSIONS_POLICY = [
  "camera=(self)",
  "microphone=(self)",
  "display-capture=(self)",
  "fullscreen=(self)",
  "picture-in-picture=(self)",
  "autoplay=(self)",
  "geolocation=()",
  "payment=()",
  "usb=()",
].join(", ");

// The pages have no inline scripts or styles and load nothing from other
// origins, so the policy can be strict. The explicit ws(s): origin covers
// browsers whose 'self' doesn't include WebSockets yet.
function contentSecurityPolicy(config) {
  const websocketOrigin = (req) => {
    const host = req.headers.host;
    if (!/^[\w.-]+(:\d+)?$/.test(host ?? "")) return "'self'";
    return `${req.secure ? "wss" : "ws"}://${host}`;
  };
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", websocketOrigin],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
    },
  };
}

// Files change on every deploy and aren't fingerprinted, so browsers always
// revalidate them (cheap 304s thanks to ETags).
const staticOptions = {
  index: false,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
};

// The HTML pages. {{origin}} becomes PUBLIC_URL (or nothing), so link
// previews get the absolute image URLs most sites require. Production reads
// each page once; development re-reads them so edits show up on reload.
function pageRenderer(config) {
  const render = (name) =>
    fs
      .readFileSync(path.join(VIEWS, name), "utf8")
      .replaceAll("{{origin}}", config.publicUrl ?? "");
  const cache = new Map();
  return (name) => {
    if (!config.isProduction) return render(name);
    if (!cache.has(name)) cache.set(name, render(name));
    return cache.get(name);
  };
}

function createHttpApp({ config, health }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: contentSecurityPolicy(config),
      xFrameOptions: { action: "deny" },
      strictTransportSecurity: config.isProduction,
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    next();
  });
  app.use(compression());

  // For the hosting platform's health checks and uptime monitors.
  app.get("/healthz", (req, res) => {
    res.set("Cache-Control", "no-store").json({ status: "ok", ...health() });
  });

  app.use(express.static(PUBLIC, staticOptions));
  return app;
}

// Page routes go last so the static files and APIs above take precedence.
function addPageRoutes(app, { config, logger }) {
  const page = pageRenderer(config);
  // Revalidated every time, like the static files (send() adds an ETag).
  const send = (res, name, status = 200) =>
    res.status(status).type("html").set("Cache-Control", "no-cache").send(page(name));

  app.get("/", (req, res) => send(res, "index.html"));
  app.get("/new", (req, res) => res.redirect(`/${randomUUID()}`));

  app.get("/leave", (req, res) => send(res, "leave.html"));

  // Anything that isn't a valid room ID (e.g. /favicon.ico) is a 404.
  app.get("/:room", (req, res, next) => {
    if (!TOKEN.test(req.params.room)) return next();
    send(res, "room.html");
  });

  app.use((req, res) => send(res, "404.html", 404));

  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err }, "request failed");
    send(res, "500.html", 500);
  });
}

module.exports = { createHttpApp, addPageRoutes };
