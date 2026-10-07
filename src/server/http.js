// The Express app: pages, static files and HTTP endpoints.
const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const { TOKEN } = require("./tokens");

const ROOT = path.join(__dirname, "../..");

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

// Files change on every deploy and aren't fingerprinted, so browsers always
// revalidate them (cheap 304s thanks to ETags).
const staticOptions = {
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
};

function createHttpApp({ config, health }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.set("view engine", "ejs");
  app.set("views", path.join(ROOT, "views"));

  app.use(
    helmet({
      // The CSP is added together with the module-based client, which has no
      // inline scripts or third-party assets.
      contentSecurityPolicy: false,
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

  app.use(express.static(path.join(ROOT, "public"), staticOptions));
  // Browser libraries are served from node_modules instead of public CDNs, so
  // versions are pinned in package-lock.json and the app doesn't depend on them.
  app.use(
    "/vendor/peerjs",
    express.static(path.join(ROOT, "node_modules/peerjs/dist"), staticOptions),
  );
  app.use(
    "/vendor/sweetalert2",
    express.static(path.join(ROOT, "node_modules/sweetalert2/dist"), staticOptions),
  );

  return app;
}

// Page routes go last so the static files and APIs above take precedence.
function addPageRoutes(app, { logger }) {
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

  app.use((req, res) => {
    res.status(404).sendFile(path.join(ROOT, "public/404.html"));
  });

  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err }, "request failed");
    res.status(500).sendFile(path.join(ROOT, "public/500.html"));
  });
}

module.exports = { createHttpApp, addPageRoutes };
