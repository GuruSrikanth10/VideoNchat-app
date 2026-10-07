// Reads configuration from environment variables, with safe defaults.
// Invalid values fail fast at startup instead of misbehaving later.

const DEFAULT_STUN = ["stun:stun.l.google.com:19302"];

function loadConfig(env = process.env) {
  const errors = [];

  const integer = (name, fallback, { min, max }) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${name} must be an integer from ${min} to ${max} (got "${raw}")`);
      return fallback;
    }
    return value;
  };

  const list = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const url = (name) => {
    const raw = env[name];
    if (!raw) return null;
    try {
      return new URL(raw).origin;
    } catch {
      errors.push(`${name} must be an absolute URL (got "${raw}")`);
      return null;
    }
  };

  // ICE_SERVERS: extra servers as JSON, e.g. static TURN credentials from a
  // provider: [{"urls": "turns:turn.example.com:443", "username": "u", "credential": "c"}]
  const iceServers = () => {
    const raw = env.ICE_SERVERS;
    if (!raw) return [];
    try {
      const servers = JSON.parse(raw);
      const valid =
        Array.isArray(servers) &&
        servers.every(
          (s) =>
            s &&
            (typeof s.urls === "string" ||
              (Array.isArray(s.urls) && s.urls.every((u) => typeof u === "string"))),
        );
      if (valid) return servers;
    } catch {
      // reported below
    }
    errors.push('ICE_SERVERS must be a JSON array of {"urls": ...} objects');
    return [];
  };

  // TRUST_PROXY: number of proxy hops in front of the app (Render: 1).
  const trustProxy = integer("TRUST_PROXY", 0, { min: 0, max: 10 });

  const nodeEnv = env.NODE_ENV || "development";
  const config = {
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: integer("PORT", 3000, { min: 0, max: 65535 }),
    publicUrl: url("PUBLIC_URL"),
    trustProxy,
    logLevel: env.LOG_LEVEL || (nodeEnv === "test" ? "silent" : "info"),
    // Bearer token for GET /metrics; without it, there are no metrics.
    metricsToken: env.METRICS_TOKEN || null,
    maxRoomSize: integer("MAX_ROOM_SIZE", 6, { min: 2, max: 50 }),
    reconnectGraceMs: integer("RECONNECT_GRACE_SECONDS", 15, { min: 0, max: 300 }) * 1000,
    shutdownGraceMs: integer("SHUTDOWN_GRACE_SECONDS", 5, { min: 0, max: 60 }) * 1000,
    ice: {
      stunUrls: list("STUN_URLS", DEFAULT_STUN),
      turnUrls: list("TURN_URLS", []),
      turnSecret: env.TURN_SECRET || null,
      turnTtlSeconds: integer("TURN_TTL_SECONDS", 6 * 60 * 60, { min: 60, max: 86400 }),
      extraServers: iceServers(),
    },
  };

  if (config.metricsToken && config.metricsToken.length < 16) {
    errors.push("METRICS_TOKEN must be at least 16 characters long");
  }
  if (config.ice.turnUrls.length > 0 && !config.ice.turnSecret) {
    errors.push("TURN_SECRET is required when TURN_URLS is set");
  }
  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
  }
  return Object.freeze(config);
}

module.exports = { loadConfig };
