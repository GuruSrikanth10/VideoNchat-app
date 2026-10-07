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
const MAX_CAPTION = 300;

// The reactions anyone can send; nothing else is relayed.
const REACTIONS = ["👍", "❤️", "😂", "😮", "👏", "🎉"];

const isSecret = (value) => typeof value === "string" && /^[\w-]{1,64}$/.test(value);

const parseName = (name) =>
  typeof name === "string" && name.trim() ? name.trim().slice(0, MAX_NAME) : null;

// `ticket` is what a host's "let in" gave someone waiting outside a
// locked room.
function parseJoin(payload) {
  if (!isObject(payload)) return fail("invalid-payload");
  const { roomId, session, ticket } = payload;
  if (!isToken(roomId)) return fail("invalid-room");
  const name = parseName(payload.name);
  if (!name) return fail("invalid-name");
  if (session !== undefined && !isSecret(session)) return fail("invalid-session");
  if (ticket !== undefined && !isSecret(ticket)) return fail("invalid-ticket");
  return ok({ roomId, name, session, ticket });
}

function parseKnock(payload) {
  if (!isObject(payload)) return fail("invalid-payload");
  if (!isToken(payload.roomId)) return fail("invalid-room");
  const name = parseName(payload.name);
  if (!name) return fail("invalid-name");
  return ok({ roomId: payload.roomId, name });
}

function parseKnockAnswer(payload) {
  if (!isObject(payload) || !isToken(payload.id) || typeof payload.admit !== "boolean") {
    return fail("invalid-payload");
  }
  return ok({ id: payload.id, admit: payload.admit });
}

function parseLock(payload) {
  if (!isObject(payload) || typeof payload.locked !== "boolean") return fail("invalid-payload");
  return ok({ locked: payload.locked });
}

// A host action aimed at one participant: { id }.
function parseTarget(payload) {
  if (!isObject(payload) || !isToken(payload.id)) return fail("invalid-payload");
  return ok({ id: payload.id });
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

// A caption of the sender's own speech: interim text is replaced as they
// speak, final text ends a phrase.
function parseCaption(payload) {
  if (
    !isObject(payload) ||
    typeof payload.text !== "string" ||
    typeof payload.final !== "boolean"
  ) {
    return fail("invalid-payload");
  }
  const text = payload.text.trim().slice(-MAX_CAPTION);
  return ok({ text, final: payload.final });
}

function parseRecording(payload) {
  if (!isObject(payload) || typeof payload.recording !== "boolean") return fail("invalid-payload");
  return ok({ recording: payload.recording });
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
  parseKnock,
  parseKnockAnswer,
  parseLock,
  parseTarget,
  parseChat,
  parseTyping,
  parseMediaState,
  parseHand,
  parseReaction,
  parseRecording,
  parseCaption,
  parseSignal,
  REACTIONS,
  MAX_NAME,
  MAX_MESSAGE,
};
