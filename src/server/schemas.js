// Validation for every client-to-server payload. Each parser returns
// { ok: true, value } with a normalised copy, or { ok: false, error }.
const { isToken } = require("./tokens");

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const optionalString = (value, max) =>
  value === undefined || value === null || (typeof value === "string" && value.length <= max);

const MAX_NAME = 40;
const MAX_MESSAGE = 1000;
const MAX_SDP = 32 * 1024;

// The reactions anyone can send; nothing else is relayed.
const REACTIONS = ["👍", "❤️", "😂", "😮", "👏", "🎉"];

function parseJoin(payload) {
  if (!isObject(payload)) return fail("invalid-payload");
  const { roomId, name, session } = payload;
  if (!isToken(roomId)) return fail("invalid-room");
  if (typeof name !== "string" || !name.trim()) return fail("invalid-name");
  if (session !== undefined && !(typeof session === "string" && /^[\w-]{1,64}$/.test(session))) {
    return fail("invalid-session");
  }
  return ok({ roomId, name: name.trim().slice(0, MAX_NAME), session });
}

function parseChat(payload) {
  if (!isObject(payload) || typeof payload.text !== "string") return fail("invalid-payload");
  const text = payload.text.trim().slice(0, MAX_MESSAGE);
  return text ? ok({ text }) : fail("empty-message");
}

function parseTyping(payload) {
  if (!isObject(payload) || typeof payload.typing !== "boolean") return fail("invalid-payload");
  return ok({ typing: payload.typing });
}

function parseMediaState(payload) {
  if (!isObject(payload)) return fail("invalid-payload");
  const value = {};
  for (const key of ["audio", "video", "screen"]) {
    if (payload[key] === undefined) continue;
    if (typeof payload[key] !== "boolean") return fail("invalid-payload");
    value[key] = payload[key];
  }
  return Object.keys(value).length ? ok(value) : fail("invalid-payload");
}

function parseHand(payload) {
  if (!isObject(payload) || typeof payload.raised !== "boolean") return fail("invalid-payload");
  return ok({ raised: payload.raised });
}

function parseReaction(payload) {
  if (!isObject(payload) || !REACTIONS.includes(payload.emoji)) return fail("invalid-payload");
  return ok({ emoji: payload.emoji });
}

function parseDescription(description) {
  if (!isObject(description)) return null;
  const { type, sdp } = description;
  if (!["offer", "answer", "rollback"].includes(type)) return null;
  if (type !== "rollback" && !(typeof sdp === "string" && sdp.length <= MAX_SDP)) return null;
  return type === "rollback" ? { type } : { type, sdp };
}

function parseCandidate(candidate) {
  if (!isObject(candidate)) return null;
  const { sdpMLineIndex } = candidate;
  if (!optionalString(candidate.candidate, 2048)) return null;
  if (!optionalString(candidate.sdpMid, 64)) return null;
  if (!optionalString(candidate.usernameFragment, 256)) return null;
  if (!(sdpMLineIndex == null || (Number.isInteger(sdpMLineIndex) && sdpMLineIndex >= 0))) {
    return null;
  }
  return {
    candidate: candidate.candidate ?? "",
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: sdpMLineIndex ?? null,
    usernameFragment: candidate.usernameFragment ?? null,
  };
}

// A WebRTC signal for one other participant: a session description or an
// ICE candidate, never both.
function parseSignal(payload) {
  if (!isObject(payload) || !isToken(payload.to)) return fail("invalid-payload");
  const hasDescription = payload.description !== undefined;
  const hasCandidate = payload.candidate !== undefined;
  if (hasDescription === hasCandidate) return fail("invalid-payload");
  if (hasDescription) {
    const description = parseDescription(payload.description);
    return description ? ok({ to: payload.to, description }) : fail("invalid-payload");
  }
  const candidate = parseCandidate(payload.candidate);
  return candidate ? ok({ to: payload.to, candidate }) : fail("invalid-payload");
}

module.exports = {
  parseJoin,
  parseChat,
  parseTyping,
  parseMediaState,
  parseHand,
  parseReaction,
  parseSignal,
  REACTIONS,
  MAX_NAME,
  MAX_MESSAGE,
};
