// The Express app: pages, static files and HTTP endpoints.
const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const { TOKEN } = require("./tokens");

const PUBLIC = path.join(__dirname, "../../public");
const page = (name) => path.join(PUBLIC, name);

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
function addPageRoutes(app, { logger }) {
  app.get("/", (req, res) => res.sendFile(page("index.html"), staticOptions));
  app.get("/new", (req, res) => res.redirect(`/${randomUUID()}`));

  app.get("/leave", (req, res) => res.sendFile(page("leave.html"), staticOptions));

  // Anything that isn't a valid room ID (e.g. /favicon.ico) is a 404.
  app.get("/:room", (req, res, next) => {
    if (!TOKEN.test(req.params.room)) return next();
    res.sendFile(page("room.html"), staticOptions);
  });

  app.use((req, res) => {
    res.status(404).sendFile(page("404.html"));
  });

  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err }, "request failed");
    res.status(500).sendFile(page("500.html"));
  });
}

module.exports = { createHttpApp, addPageRoutes };
