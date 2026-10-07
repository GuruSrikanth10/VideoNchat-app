// Room IDs are generated UUIDs; custom names are allowed but restricted to
// letters, digits, "_" and "-". Participant IDs use the same format.
const TOKEN = /^[\w-]{1,64}$/;

const isToken = (value) => typeof value === "string" && TOKEN.test(value);

module.exports = { TOKEN, isToken };
