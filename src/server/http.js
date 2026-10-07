// The Express app: pages, static files and HTTP endpoints.
const fs = require("fs");
const path = require("path");
const { randomUUID, timingSafeEqual } = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const { TOKEN } = require("./tokens");
const { createLimiter } = require("./rate-limit");

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
      // Browsers report anything the policy blocks (see /api/csp-report).
      reportUri: ["/api/csp-report"],
      reportTo: ["csp"],
      ...(config.httpsOnly ? { upgradeInsecureRequests: [] } : {}),
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

// Which kind of page a report came from, without the room's ID (a
// meeting's link is what keeps it private).
function pageKind(url) {
  let pathname;
  try {
    pathname = new URL(url, "http://x").pathname;
  } catch {
    return "unknown";
  }
  if (pathname === "/") return "home";
  if (pathname === "/leave") return "leave";
  return TOKEN.test(pathname.slice(1).replace(/\/$/, "")) ? "room" : "other";
}

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);

// Only the origin of a blocked resource (or a keyword like "inline").
function blockedSource(value) {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return value.slice(0, 40);
  }
}

// Reports from browsers: rate limited per address and size limited.
function reportEndpoints(app, { logger, metrics }) {
  const limiters = new Map();
  const allow = (req) => {
    if (limiters.size > 10_000) limiters.clear();
    let limiter = limiters.get(req.ip);
    if (!limiter) {
      limiter = createLimiter({ default: { capacity: 10, perSecond: 0.2 } });
      limiters.set(req.ip, limiter);
    }
    return limiter.allow("report");
  };
  const body = express.json({
    limit: "8kb",
    type: ["application/json", "text/plain", "application/csp-report", "application/reports+json"],
  });

  // Uncaught errors in the pages, sent with navigator.sendBeacon.
  app.post("/api/client-errors", body, (req, res) => {
    if (!allow(req)) return res.status(429).end();
    const report = req.body ?? {};
    metrics.clientErrors.inc();
    logger.warn(
      {
        clientError: {
          message: text(report.message, 300),
          source: pageKind(report.source) === "other" ? text(report.source, 200) : undefined,
          line: Number.isInteger(report.line) ? report.line : undefined,
          column: Number.isInteger(report.column) ? report.column : undefined,
          stack: text(report.stack, 1000),
          page: pageKind(report.page),
        },
      },
      "client error",
    );
    res.status(204).end();
  });

  // Content-Security-Policy violations, in either report format.
  app.post("/api/csp-report", body, (req, res) => {
    if (!allow(req)) return res.status(429).end();
    const reports = Array.isArray(req.body)
      ? req.body.filter((r) => r?.type === "csp-violation").map((r) => r.body ?? {})
      : [req.body?.["csp-report"] ?? {}];
    for (const report of reports.slice(0, 10)) {
      const directive = String(
        report.effectiveDirective ??
          report["effective-directive"] ??
          report["violated-directive"] ??
          "",
      )
        .split(" ")[0]
        .replace(/[^a-z-]/g, "")
        .slice(0, 40);
      metrics.cspViolations.inc({ directive: directive || "unknown" });
      logger.warn(
        {
          cspViolation: {
            directive,
            blocked: blockedSource(report.blockedURL ?? report["blocked-uri"]),
            page: pageKind(report.documentURL ?? report["document-uri"]),
          },
        },
        "csp violation",
      );
    }
    res.status(204).end();
  });
}

function createHttpApp({ config, logger, health, metrics }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: contentSecurityPolicy(config),
      xFrameOptions: { action: "deny" },
      strictTransportSecurity: config.httpsOnly,
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    res.setHeader("Reporting-Endpoints", 'csp="/api/csp-report"');
    next();
  });
  app.use(compression());

  // For the hosting platform's health checks and uptime monitors.
  app.get("/healthz", (req, res) => {
    res.set("Cache-Control", "no-store").json({ status: "ok", ...health() });
  });

  // For Prometheus (or any scraper), only with METRICS_TOKEN.
  app.get("/metrics", (req, res) => {
    // Reserved either way, so it never turns into a meeting called "metrics".
    if (!config.metricsToken) return res.status(404).type("text/plain").send("Not found");
    const expected = Buffer.from(`Bearer ${config.metricsToken}`);
    const given = Buffer.from(req.get("authorization") ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return res.status(401).set("WWW-Authenticate", "Bearer").end();
    }
    res.set("Cache-Control", "no-store").type("text/plain; version=0.0.4").send(metrics.render());
  });

  reportEndpoints(app, { logger, metrics });

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
    // A bad request (e.g. a report that's too big, or isn't JSON) is the
    // client's problem, not a server failure.
    const status = err.status ?? err.statusCode;
    if (status >= 400 && status < 500)
      return res.status(status).type("text/plain").send("Bad request");
    logger.error({ err }, "request failed");
    send(res, "500.html", 500);
  });
}

module.exports = { createHttpApp, addPageRoutes };
