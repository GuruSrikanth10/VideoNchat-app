// The Express app: pages, static files and HTTP endpoints.
const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const { TOKEN } = require("./tokens");

const ROOT = path.join(__dirname, "../..");

function createHttpApp({ config }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.set("view engine", "ejs");
  app.set("views", path.join(ROOT, "views"));

  app.use(express.static(path.join(ROOT, "public")));
  // Browser libraries are served from node_modules instead of public CDNs, so
  // versions are pinned in package-lock.json and the app doesn't depend on them.
  app.use("/vendor/peerjs", express.static(path.join(ROOT, "node_modules/peerjs/dist")));
  app.use("/vendor/sweetalert2", express.static(path.join(ROOT, "node_modules/sweetalert2/dist")));

  return app;
}

// Page routes go last so the static files and APIs above take precedence.
function addPageRoutes(app) {
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
}

module.exports = { createHttpApp, addPageRoutes };
