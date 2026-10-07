// Room IDs are generated UUIDs; custom names are allowed but restricted to
// letters, digits, "_" and "-". Room IDs, PeerJS IDs and per-tab secrets all
// use this format.
const TOKEN = /^[\w-]{1,64}$/;

const isToken = (value) => typeof value === "string" && TOKEN.test(value);
const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

module.exports = { TOKEN, isToken, clean };
