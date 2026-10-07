// Structured JSON logs. Chat messages, names and room IDs are never logged:
// log IDs and counts only.
const pino = require("pino");

function createLogger(config) {
  return pino({ level: config.logLevel, base: { service: "videonchat" } });
}

module.exports = { createLogger };
