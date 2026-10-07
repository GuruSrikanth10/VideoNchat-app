// The meeting page: joins the room, connects to everyone and wires up the UI.
import { connect, request } from "./lib/socket.js";
import { PeerMesh, videoLimitsFor } from "./lib/rtc.js";
import { LocalMedia } from "./lib/media.js";
import { ScreenShare } from "./lib/screen-share.js";
import { summarize, rate } from "./lib/stats.js";
import { local, session } from "./lib/storage.js";
import { Tiles } from "./ui/tiles.js";
import { Chat } from "./ui/chat.js";
import { People } from "./ui/people.js";
import { toast, announce } from "./ui/toast.js";
import { confirmDialog, choiceDialog } from "./ui/dialog.js";
import { hydrateIcons, setIcon } from "./ui/icons.js";
import { Lobby } from "./ui/lobby.js";
import { DevicePicker, rememberedDevices } from "./ui/devices.js";
import { SpeakingDetector } from "./lib/audio-levels.js";
import {
  SHORTCUTS,
  bindShortcuts,
  keysFor,
  describeKeys,
  ariaFor,
  shortcutFor,
} from "./ui/shortcuts.js";

const $ = (id) => document.getElementById(id);

const roomId = decodeURIComponent(location.pathname.split("/").filter(Boolean)[0] ?? "");
const NAME_KEY = "videonchat:name";
const SESSION_KEY = `videonchat:session:${roomId}`;
const LAST_CALL_KEY = "videonchat:last-call";

hydrateIcons();

const socket = connect();
const media = new LocalMedia();
const share = new ScreenShare();
const tiles = new Tiles($("tiles"), { onFlipCamera: () => flipCamera() });
const participants = new Map(); // id -> { id, name, audio, video, screen }
const outbox = []; // signals produced while offline
const statsHistory = new Map(); // id -> last stats summary
const speaking = new Map(); // id -> { track, detector }

let self = null; // { id, name, session }
let mesh = null;
let name = "";
let joined = false;
let leaving = false;
let callStartedAt = 0;

const chat = new Chat({
  list: $("messages"),
  typing: $("typing"),
  form: $("chat-form"),
  input: $("chat-input"),
  counter: $("chat-counter"),
  jump: $("chat-jump"),
  onSend: async (text) => {
    const reply = await request(socket, "chat:send", { text });
    if (!reply.ok) toast(describeError(reply.error), { tone: "warning" });
  },
  onTyping: (typing) => {
    if (joined) socket.emit("chat:typing", { typing });
  },
});
const people = new People($("people-list"));

// ---------------------------------------------------------------- joining

let lobby = null;

async function main() {
  if (!roomId) return location.assign("/");
  media.preferred = rememberedDevices();
  lobby = new Lobby({
    media,
    initialName: local.get(NAME_KEY) ?? "",
    peek: () => request(socket, "room:peek", { roomId }),
    onJoin: enterCall,
    toggleMic,
    toggleCamera,
    flipCamera,
  });
  await lobby.start();
}

// Called from the lobby. Resolves to true once in the call.
async function enterCall(chosenName) {
  name = chosenName;
  local.set(NAME_KEY, name);
  if (!(await join())) return false;

  lobby.destroy();
  callStartedAt = Date.now();
  document.body.dataset.state = "call";
  $("lobby").hidden = true;
  document.querySelector(".room").hidden = false;
  $("controls").hidden = false;
  if (matchMedia("(min-width: 1100px)").matches) setPanel("chat", { focus: false });

  tiles.upsert("self", { name, self: true });
  refreshSelfView();
  updateControls();
  trackSpeaking("self", media.mic);
  $("controls").focus();
  return true;
}

// Resolves to true if we're in the room.
async function join() {
  const reply = await request(socket, "room:join", {
    roomId,
    name,
    session: session.get(SESSION_KEY) ?? undefined,
  });
  if (!reply.ok) {
    handleJoinError(reply.error);
    return false;
  }

  const resumed = reply.resumed && self?.id === reply.self.id;
  self = reply.self;
  session.set(SESSION_KEY, self.session);
  chat.setSelf(self.id);

  if (resumed) {
    // Same identity: connections carry on; flush what we couldn't send.
    mesh.setIceServers(reply.iceServers);
    for (const signal of outbox.splice(0)) socket.emit("rtc:signal", signal);
  } else {
    // New identity (first join, or the grace period ran out): start over.
    outbox.length = 0;
    mesh?.closeAll();
    for (const id of [...participants.keys()]) removeParticipant(id, { quiet: true });
    mesh = createMesh(reply.iceServers);
  }

  // Reconcile with who is actually here now.
  const present = new Set(reply.participants.map((p) => p.id));
  for (const id of [...participants.keys()]) {
    if (!present.has(id)) removeParticipant(id, { quiet: true });
  }
  for (const participant of reply.participants) {
    addParticipant(participant, { quiet: true });
    // Newcomers start the connections; people who were already here wait
    // for our offer. After a resume, missed offers are delivered instead.
    if (!resumed) mesh.call(participant.id);
  }
  for (const message of reply.history) chat.add(message);

  joined = true;
  sendMediaState();
  hideBanner();
  updateCount();
  return true;
}

function createMesh(iceServers) {
  const created = new PeerMesh({ selfId: self.id, send: sendSignal, iceServers });
  created.setTrack("mic", media.mic);
  created.setTrack("camera", media.camera);
  created.setTrack("screen", share.track);
  created.addEventListener("track", ({ detail }) => showRemoteMedia(detail.id));
  created.addEventListener("state", ({ detail }) => {
    if (detail.state === "failed") tiles.upsert(detail.id, { quality: "poor" });
  });
  return created;
}

function sendSignal(signal) {
  if (joined && socket.connected) socket.emit("rtc:signal", signal);
  else outbox.push(signal);
}

function handleJoinError(error) {
  if (!self) {
    // Still in the lobby: let the person try again from there.
    if (error === "room-full") {
      toast("This meeting is full right now. Try again in a moment.", { tone: "warning" });
    } else {
      toast(`Couldn't join the meeting (${describeError(error)}).`, { tone: "error" });
    }
    return;
  }
  if (error === "room-full") {
    return choiceDialog({
      title: "This meeting is full",
      body: "Everyone in a call sends video to everyone else, so rooms are kept small.",
      choices: [
        { label: "Try again", value: "retry" },
        { label: "Start a new meeting", value: "new", tone: "primary", autofocus: true },
      ],
    }).then((choice) => (choice === "new" ? location.assign("/") : location.reload()));
  }
  showBanner(`Couldn't join the meeting (${describeError(error)}). Retrying…`);
  setTimeout(join, 3000);
}

// ----------------------------------------------------------- participants

function addParticipant(participant, { quiet = false } = {}) {
  const known = participants.has(participant.id);
  participants.set(participant.id, participant);
  tiles.upsert(participant.id, {
    name: participant.name,
    audio: participant.audio,
    video: participant.video,
  });
  showRemoteMedia(participant.id);
  if (!known && !quiet) toast(`${participant.name} joined`);
  updateCount();
  renderPeople();
}

function updateParticipant(participant) {
  const previous = participants.get(participant.id);
  if (!previous) return addParticipant(participant);
  participants.set(participant.id, participant);
  tiles.upsert(participant.id, {
    name: participant.name,
    audio: participant.audio,
    video: participant.video,
  });
  if (participant.screen && !previous.screen) toast(`${participant.name} is presenting`);
  showRemoteMedia(participant.id);
  renderPeople();
}

function removeParticipant(id, { quiet = false } = {}) {
  const participant = participants.get(id);
  participants.delete(id);
  statsHistory.delete(id);
  trackSpeaking(id, null);
  mesh?.remove(id);
  tiles.remove(id);
  if (participant && !quiet) toast(`${participant.name} left`);
  updateCount();
  renderPeople();
}

// Shows a participant's camera, and their screen while they present.
function showRemoteMedia(id) {
  const streams = mesh?.streams(id);
  const participant = participants.get(id);
  if (!streams || !participant) return;
  // A fresh MediaStream makes the <video> pick up newly arrived tracks.
  const tracks = streams.media.getTracks();
  if (tracks.length) tiles.upsert(id, { stream: new MediaStream(tracks) });
  trackSpeaking(id, streams.media.getAudioTracks()[0] ?? null);
  if (participant.screen && streams.screen.getTracks().length) {
    tiles.showScreen(id, {
      name: participant.name,
      stream: new MediaStream(streams.screen.getTracks()),
    });
  } else {
    tiles.hideScreen(id);
  }
}

function renderPeople() {
  $("people-heading").textContent = `People (${participants.size + 1})`;
  people.render([
    {
      id: "self",
      name,
      self: true,
      audio: media.micEnabled && Boolean(media.mic),
      video: media.cameraEnabled && Boolean(media.camera),
      screen: share.active,
    },
    ...participants.values(),
  ]);
}

function updateCount() {
  const count = participants.size + 1;
  $("participant-count").textContent = count === 1 ? "Just you" : `${count} in call`;
  // e.g. "(3) Meeting · VideoNChat", so the tab shows who's there.
  document.title = `${count > 1 ? `(${count}) ` : ""}Meeting · VideoNChat`;
  mesh?.setVideoLimits(videoLimitsFor(count));
}

// ------------------------------------------------------------ server events

socket.on("participant:joined", (participant) => addParticipant(participant));
socket.on("participant:updated", (participant) => updateParticipant(participant));
socket.on("participant:left", ({ id }) => removeParticipant(id));
socket.on("rtc:signal", (signal) => mesh?.handleSignal(signal));
socket.on("chat:message", (message) => chat.add(message));
socket.on("chat:typing", ({ from, name: typer, typing }) => chat.setTyping(from, typer, typing));

socket.on("server:restarting", () => {
  showBanner("The server is restarting. You'll be reconnected automatically.");
});

socket.on("disconnect", () => {
  if (leaving) return;
  joined = false;
  showBanner("Connection lost. Reconnecting…");
});

socket.on("connect", () => {
  if (self && !leaving) join(); // resume after a reconnect
});

// ------------------------------------------------------------- local media

function refreshSelfView() {
  tiles.upsert("self", {
    stream: new MediaStream(media.camera ? [media.camera] : []),
    audio: media.micEnabled,
    video: media.cameraEnabled && Boolean(media.camera),
    mirrored: media.facing !== "environment",
    canFlip,
  });
}

// Phones and tablets with a front and a back camera get a switch button.
let canFlip = false;
async function updateCanFlip() {
  const { videoinput = [] } = await media.listDevices().catch(() => ({}));
  canFlip = matchMedia("(pointer: coarse)").matches && videoinput.length > 1;
  $("lobby-flip").hidden = !canFlip;
  if (joined) refreshSelfView();
}
navigator.mediaDevices?.addEventListener?.("devicechange", updateCanFlip);

media.addEventListener("trackchange", ({ detail }) => {
  mesh?.setTrack(detail.slot, detail.track);
  // Device labels (and so the camera count) are only known once one runs.
  if (detail.slot === "camera" && detail.track) updateCanFlip();
  if (joined) {
    refreshSelfView();
    if (detail.slot === "mic") trackSpeaking("self", detail.track);
  }
});
media.addEventListener("change", () => {
  if (!joined) return;
  refreshSelfView();
  updateControls();
  // e.g. the camera started only after joining (a slow permission prompt).
  sendMediaState();
});
media.addEventListener("deviceended", ({ detail }) => {
  toast(detail.slot === "mic" ? "Microphone disconnected" : "Camera disconnected", {
    tone: "warning",
  });
});

share.addEventListener("change", () => {
  mesh?.setTrack("screen", share.track);
  if (share.active) tiles.showScreen("self", { self: true, stream: share.stream });
  else tiles.hideScreen("self");
  sendMediaState();
  updateControls();
});

function sendMediaState() {
  renderPeople();
  if (!joined) return;
  socket.emit("media:state", {
    audio: media.micEnabled,
    video: media.cameraEnabled && Boolean(media.camera),
    screen: share.active,
  });
}

// Highlights whoever is speaking.
function trackSpeaking(id, track) {
  const current = speaking.get(id);
  if (current?.track === track) return;
  current?.detector.stop();
  speaking.delete(id);
  tiles.setSpeaking(id, false);
  if (!track) return;
  const detector = new SpeakingDetector(track, (isSpeaking) => {
    // Muted people aren't highlighted even if their mic picks up noise.
    const muted = id === "self" ? !media.micEnabled : !participants.get(id)?.audio;
    tiles.setSpeaking(id, isSpeaking && !muted);
  });
  speaking.set(id, { track, detector });
}

// ---------------------------------------------------------------- controls

function setControl(button, { label, tooltip, iconName, active }) {
  button.querySelector(".control__label").textContent = label;
  button.setAttribute("aria-label", label);
  button.dataset.active = String(active);
  setIcon(button.querySelector("svg"), iconName);
  setTooltip(button, tooltip);
}

// A hover/focus hint with the button's shortcut, e.g. "Turn off microphone
// (Ctrl+D)". Hidden from screen readers, who get aria-keyshortcuts instead.
function setTooltip(button, text) {
  let tip = button.querySelector(".control__tooltip");
  if (!tip) {
    tip = document.createElement("span");
    tip.className = "control__tooltip";
    tip.setAttribute("aria-hidden", "true");
    button.append(tip);
  }
  const shortcut = shortcutFor(button.dataset.shortcut);
  tip.textContent = shortcut ? `${text} (${describeKeys(shortcut)})` : text;
}

function updateControls() {
  const micOn = media.micEnabled && Boolean(media.mic);
  setControl($("mic"), {
    label: micOn ? "Mute" : "Unmute",
    tooltip: micOn ? "Turn off microphone" : "Turn on microphone",
    iconName: micOn ? "mic" : "mic-off",
    active: !micOn,
  });
  const cameraOn = media.cameraEnabled && Boolean(media.camera);
  setControl($("camera"), {
    label: cameraOn ? "Stop video" : "Start video",
    tooltip: cameraOn ? "Turn off camera" : "Turn on camera",
    iconName: cameraOn ? "video" : "video-off",
    active: !cameraOn,
  });
  $("share").hidden = !ScreenShare.supported();
  setControl($("share"), {
    label: share.active ? "Stop presenting" : "Present",
    tooltip: share.active ? "Stop presenting" : "Present your screen",
    iconName: share.active ? "monitor-x" : "monitor-up",
    active: share.active,
  });
}

// Used by the lobby and call buttons and the shortcuts. Each resolves to
// what changed, e.g. "Microphone off" (or null if nothing did).
async function toggleMic() {
  if (!media.mic) {
    toast("No microphone is available.", { tone: "warning" });
    return null;
  }
  media.setMicEnabled(!media.micEnabled);
  return media.micEnabled ? "Microphone on" : "Microphone off";
}

let cameraBusy = false;
async function flipCamera() {
  if (cameraBusy) return;
  cameraBusy = true;
  const flipped = await media.flipCamera();
  cameraBusy = false;
  if (!flipped) toast("Couldn't switch cameras.", { tone: "warning" });
  else
    announce(media.facing === "environment" ? "Using the back camera" : "Using the front camera");
}

async function toggleCamera() {
  if (cameraBusy) return null;
  cameraBusy = true;
  const buttons = [$("camera"), $("lobby-camera")];
  for (const button of buttons) button.disabled = true;
  const turningOn = !(media.cameraEnabled && media.camera);
  const done = await media.setCameraEnabled(turningOn);
  for (const button of buttons) button.disabled = false;
  cameraBusy = false;
  if (!done) {
    toast("The camera couldn't start.", { tone: "warning" });
    return null;
  }
  return turningOn ? "Camera on" : "Camera off";
}

$("mic").addEventListener("click", toggleMic);
$("camera").addEventListener("click", toggleCamera);

$("share").addEventListener("click", async () => {
  if (share.active) return share.stop();
  try {
    await share.start();
  } catch {
    toast("Screen sharing couldn't start.", { tone: "error" });
  }
});

// Side panels (chat, people): at most one is open at a time.
// People has two toggles: its control button and the participant count.
const PANELS = {
  chat: { toggles: ["chat-toggle"], focus: "chat-input" },
  people: { toggles: ["people-toggle", "people-count"], focus: "people-close" },
};

function setPanel(panel, { focus = true } = {}) {
  const previous = document.body.dataset.panel;
  // Focus inside a panel that closes would be lost; it goes to the toggle.
  const stranded = previous && previous !== panel && $(previous).contains(document.activeElement);
  if (panel) document.body.dataset.panel = panel;
  else delete document.body.dataset.panel;
  for (const [key, { toggles }] of Object.entries(PANELS)) {
    for (const id of toggles) $(id).setAttribute("aria-expanded", String(key === panel));
  }
  if (panel === "chat") $("chat-unread").hidden = true;
  if (panel && focus) $(PANELS[panel].focus).focus();
  else if (stranded) {
    const toggles = PANELS[previous].toggles.map($);
    (toggles.find((el) => el.checkVisibility?.() ?? true) ?? toggles[0]).focus();
  }
}

const togglePanel = (panel) => setPanel(document.body.dataset.panel === panel ? null : panel);

for (const [key, { toggles }] of Object.entries(PANELS)) {
  for (const id of toggles) $(id).addEventListener("click", () => togglePanel(key));
  $(key).addEventListener("keydown", (event) => {
    if (event.key === "Escape") setPanel(null);
  });
}
$("chat-close").addEventListener("click", () => setPanel(null));
$("people-close").addEventListener("click", () => setPanel(null));

// ------------------------------------------------------------- shortcuts

const inCall = () => document.body.dataset.state === "call";
const dialogOpen = () => Boolean(document.querySelector("dialog[open]"));

bindShortcuts(document, {
  mic: async () => announceChange(await toggleMic()),
  camera: async () => announceChange(await toggleCamera()),
  chat: () => inCall() && !dialogOpen() && togglePanel("chat"),
  people: () => inCall() && !dialogOpen() && togglePanel("people"),
  help: () => {
    const help = $("shortcuts-dialog");
    if (help.open) help.close();
    else if (!dialogOpen()) help.showModal();
  },
});

// Shortcuts change things without moving focus, so say what happened.
function announceChange(message) {
  if (message) announce(message);
}

function renderShortcuts() {
  const rows = SHORTCUTS.map(({ description, ...shortcut }) => [description, keysFor(shortcut)]);
  rows.push(["Close a panel or dialog", ["Esc"]]);
  $("shortcuts-list").replaceChildren(
    ...rows.map(([description, keys]) => {
      const row = document.createElement("div");
      row.className = "shortcut";
      const term = document.createElement("dt");
      term.textContent = description;
      const value = document.createElement("dd");
      value.append(
        ...keys.map((key) => {
          const kbd = document.createElement("kbd");
          kbd.textContent = key;
          return kbd;
        }),
      );
      row.append(term, value);
      return row;
    }),
  );
}
renderShortcuts();

$("show-shortcuts").addEventListener("click", () => {
  $("settings-dialog").close();
  $("shortcuts-dialog").showModal();
});

// Tooltips and aria-keyshortcuts for the buttons that have shortcuts.
for (const [id, action] of [
  ["mic", "mic"],
  ["camera", "camera"],
  ["chat-toggle", "chat"],
  ["people-toggle", "people"],
  ["lobby-mic", "mic"],
  ["lobby-camera", "camera"],
]) {
  $(id).dataset.shortcut = action;
  $(id).setAttribute("aria-keyshortcuts", ariaFor(shortcutFor(action)));
}
for (const [id, text] of [
  ["chat-toggle", "Chat with everyone"],
  ["people-toggle", "Show everyone"],
  ["invite", "Invite people"],
  ["settings", "Settings"],
  ["leave", "Leave the meeting"],
]) {
  setTooltip($(id), text);
}

const callDevices = new DevicePicker({
  media,
  selects: {
    videoinput: $("call-videoinput"),
    audioinput: $("call-audioinput"),
    audiooutput: $("call-audiooutput"),
  },
  onSpeaker: (deviceId) => tiles.setSpeaker(deviceId),
});

$("settings").addEventListener("click", async () => {
  await callDevices.refresh();
  $("settings-dialog").showModal();
});

// Unread badge while the chat is closed (or hidden on small screens).
$("messages").addEventListener("chat:new", ({ detail }) => {
  const visible = $("chat").checkVisibility?.() ?? true;
  if (!detail.mine && !visible) $("chat-unread").hidden = false;
});

$("invite").addEventListener("click", async () => {
  const url = location.href;
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: "Join my VideoNChat meeting", url });
      return;
    } catch {
      // cancelled: fall back to copying
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Invite link copied", { tone: "success" });
  } catch {
    toast(`Share this link: ${url}`, { duration: 10000 });
  }
});

$("leave").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Leave the meeting?",
    body: "You can rejoin with the same link.",
    confirmLabel: "Leave",
    tone: "danger",
  });
  if (ok) leave();
});

async function leave() {
  leaving = true;
  joined = false;
  await request(socket, "room:leave", undefined, 2000);
  session.remove(SESSION_KEY);
  // For the leave page: how long the call lasted.
  session.set(
    LAST_CALL_KEY,
    JSON.stringify({ room: roomId, seconds: (Date.now() - callStartedAt) / 1000 }),
  );
  mesh?.closeAll();
  share.stop();
  media.stop();
  socket.disconnect();
  location.assign(`/leave?room=${encodeURIComponent(roomId)}`);
}

// Closing the tab counts as leaving straight away (no grace period).
window.addEventListener("pagehide", () => {
  if (!leaving) socket.disconnect();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload(); // restored from the back/forward cache
});

// --------------------------------------------------------- connection info

function measurePing() {
  const started = performance.now();
  socket.timeout(5000).emit("net:ping", (err) => {
    const value = $("ping-value");
    const badge = $("ping");
    if (err) {
      value.textContent = "offline";
      badge.dataset.quality = "poor";
      return;
    }
    const ms = Math.round(performance.now() - started);
    value.textContent = `${ms} ms`;
    badge.dataset.quality = ms < 150 ? "good" : ms < 300 ? "fair" : "poor";
    badge.setAttribute("aria-label", `Round trip to the server: ${ms} milliseconds`);
  });
}
measurePing();
setInterval(measurePing, 5000);

// Per-participant call quality from WebRTC statistics.
setInterval(async () => {
  if (!mesh) return;
  for (const id of mesh.ids()) {
    const pc = mesh.connection(id);
    if (!pc || pc.connectionState === "closed") continue;
    try {
      const summary = summarize(await pc.getStats(), statsHistory.get(id));
      statsHistory.set(id, summary);
      tiles.upsert(id, { quality: rate(summary), stats: summary });
    } catch {
      // the connection closed while we were asking
    }
  }
}, 2000);

// ------------------------------------------------------------------- misc

document.addEventListener("autoplay-blocked", () => {
  showBanner("Your browser paused the call audio.", {
    action: "Play audio",
    onAction: () => {
      tiles.resumeAll();
      hideBanner();
    },
  });
});

function showBanner(message, { action, onAction } = {}) {
  const banner = $("banner");
  banner.querySelector(".banner__text").textContent = message;
  const button = banner.querySelector(".banner__action");
  button.hidden = !action;
  if (action) {
    button.textContent = action;
    button.onclick = onAction;
  }
  banner.hidden = false;
}

function hideBanner() {
  $("banner").hidden = true;
}

function describeError(error) {
  return (
    {
      "rate-limited": "you're sending too fast",
      "not-joined": "not connected to the meeting yet",
      timeout: "no response from the server",
      "empty-message": "the message is empty",
    }[error] ?? error
  );
}

// A handle for debugging from the browser console (and for tests).
window.videonchat = { socket, media, share, mesh: () => mesh, self: () => self };

main();
