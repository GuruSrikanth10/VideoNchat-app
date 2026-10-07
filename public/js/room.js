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
import { ReactionMenu } from "./ui/reactions.js";
import { CallRecorder, saveRecording } from "./lib/recorder.js";
import { SpeechCaptioner } from "./lib/captions.js";
import { CaptionDisplay } from "./ui/captions.js";
import { toast, announce } from "./ui/toast.js";
import { confirmDialog, choiceDialog } from "./ui/dialog.js";
import { hydrateIcons, setIcon } from "./ui/icons.js";
import { Lobby } from "./ui/lobby.js";
import { DevicePicker, rememberedDevices } from "./ui/devices.js";
import { SpeakingDetector } from "./lib/audio-levels.js";
import { strings } from "./strings.js";
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
const EFFECTS_KEY = "videonchat:effects";
const CAPTIONS_KEY = "videonchat:captions";
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
let handRaisedAt = null; // when your hand went up (server time), or null

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
const people = new People({
  list: $("people-list"),
  menu: $("person-menu"),
  onAction: hostAction,
});
const knocks = new Map(); // knock ID -> name: people waiting to be let in

// ---------------------------------------------------------------- joining

let lobby = null;

async function main() {
  if (!roomId) return location.assign("/");
  media.preferred = rememberedDevices();
  try {
    Object.assign(media.effects, JSON.parse(local.get(EFFECTS_KEY) ?? "{}"));
  } catch {
    // nothing remembered
  }
  lobby = new Lobby({
    media,
    initialName: local.get(NAME_KEY) ?? "",
    peek: () => request(socket, "room:peek", { roomId }),
    onJoin: enterCall,
    onKnock: askToJoin,
    toggleMic,
    toggleCamera,
    flipCamera,
  });
  await lobby.start();
}

// Called from the lobby. Resolves to true once in the call. A ticket
// from a host gets you into a locked meeting.
async function enterCall(chosenName, { ticket } = {}) {
  name = chosenName;
  local.set(NAME_KEY, name);
  if (!(await join({ ticket }))) return false;

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

// For a locked meeting: asks the host, then joins if let in. Resolves to
// true once in the call, "denied", or false.
async function askToJoin(chosenName) {
  name = chosenName;
  local.set(NAME_KEY, name);
  const reply = await request(socket, "room:knock", { roomId, name });
  if (!reply.ok) {
    if (reply.error === "not-locked") return enterCall(name); // unlocked meanwhile
    toast(strings.join.failed(describeError(reply.error)), { tone: "error" });
    return false;
  }
  const answer = await new Promise((resolve) => {
    const answered = (result) => {
      socket.off("knock:answered", answered);
      socket.off("disconnect", dropped);
      resolve(result);
    };
    const dropped = () => answered(null);
    socket.on("knock:answered", answered);
    socket.on("disconnect", dropped);
  });
  if (!answer) return false; // disconnected while waiting: ask again
  if (!answer.admitted) return "denied";
  return enterCall(name, { ticket: answer.ticket ?? undefined });
}

// Resolves to true if we're in the room.
async function join({ ticket } = {}) {
  const reply = await request(socket, "room:join", {
    roomId,
    name,
    session: session.get(SESSION_KEY) ?? undefined,
    ticket,
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
  setLocked(reply.locked);
  knocks.clear();
  for (const knock of reply.knocks ?? []) knocks.set(knock.id, knock.name);
  renderKnocks();

  joined = true;
  sendMediaState();
  // A new identity starts with its hand down; put it back up if it was.
  if (!resumed && handRaisedAt) setHand(true);
  // Everyone has to know about a recording that is still going.
  if (!resumed && recorder.active) socket.emit("recording:set", { recording: true });
  renderRecording();
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
    if (error === "room-locked") {
      lobby.setLocked(true);
    } else if (error === "room-full") {
      toast(strings.join.roomFull, { tone: "warning" });
    } else {
      toast(strings.join.failed(describeError(error)), { tone: "error" });
    }
    return;
  }
  if (error === "room-full") {
    return choiceDialog({
      title: strings.join.fullTitle,
      body: strings.join.fullBody,
      choices: [
        { label: strings.join.tryAgain, value: "retry" },
        { label: strings.join.startNew, value: "new", tone: "primary", autofocus: true },
      ],
    }).then((choice) => (choice === "new" ? location.assign("/") : location.reload()));
  }
  if (error === "room-locked") {
    // Away too long, and the meeting was locked meanwhile: ask again.
    return choiceDialog({
      title: strings.host.locked,
      body: strings.lobby.locked,
      choices: [{ label: strings.lobby.askToJoin, value: "ask", tone: "primary", autofocus: true }],
    }).then(() => location.reload());
  }
  showBanner(strings.join.retrying(describeError(error)));
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
    hand: participant.hand,
  });
  showRemoteMedia(participant.id);
  if (!known && !quiet) toast(strings.call.joined(participant.name));
  updateCount();
  renderRecording();
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
    hand: participant.hand,
  });
  if (participant.screen && !previous.screen) toast(strings.call.presenting(participant.name));
  if (participant.hand && !previous.hand) toast(strings.hands.raised(participant.name));
  if (participant.recording !== previous.recording) {
    const notice = participant.recording ? strings.recording.started : strings.recording.stopped;
    toast(notice(participant.name), { tone: participant.recording ? "warning" : "info" });
  }
  renderRecording();
  showRemoteMedia(participant.id);
  renderPeople();
}

function removeParticipant(id, { quiet = false } = {}) {
  const participant = participants.get(id);
  captionDisplay.remove(id);
  participants.delete(id);
  statsHistory.delete(id);
  trackSpeaking(id, null);
  mesh?.remove(id);
  tiles.remove(id);
  if (participant && !quiet) toast(strings.call.left(participant.name));
  updateCount();
  renderRecording();
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
  $("people-heading").textContent = strings.call.peopleHeading(participants.size + 1);
  $("host-tools").hidden = !self?.host;
  people.render(
    [
      {
        id: "self",
        name,
        self: true,
        host: Boolean(self?.host),
        audio: media.micEnabled && Boolean(media.mic),
        video: media.cameraEnabled && Boolean(media.camera),
        screen: share.active,
        hand: handRaisedAt,
      },
      ...participants.values(),
    ],
    { canManage: Boolean(self?.host) },
  );
}

function updateCount() {
  const count = participants.size + 1;
  $("participant-count").textContent = strings.call.count(count);
  // e.g. "(3) Meeting · VideoNChat", so the tab shows who's there.
  document.title = strings.call.title(count);
  mesh?.setVideoLimits(videoLimitsFor(count));
}

// ------------------------------------------------------------ server events

socket.on("participant:joined", (participant) => addParticipant(participant));
socket.on("participant:updated", (participant) => {
  if (participant.id === self?.id) updateSelf(participant);
  else updateParticipant(participant);
});
socket.on("room:updated", ({ locked }) => {
  setLocked(locked);
  toast(locked ? strings.host.locked : strings.host.unlocked);
});
socket.on("knock:request", ({ id, name: knocker }) => {
  knocks.set(id, knocker);
  renderKnocks();
});
socket.on("knock:resolved", ({ id }) => {
  knocks.delete(id);
  renderKnocks();
});
socket.on("host:mute", ({ by }) => {
  if (media.micEnabled) media.setMicEnabled(false);
  toast(strings.host.mutedBy(by), { tone: "warning" });
});
socket.on("host:ask-unmute", async ({ by }) => {
  if (media.micEnabled || dialogOpen()) return;
  const choice = await choiceDialog({
    title: strings.host.askedBy(by),
    body: strings.host.askedBody,
    choices: [
      { label: strings.host.stayMuted, value: "stay" },
      { label: strings.host.unmute, value: "unmute", tone: "primary", autofocus: true },
    ],
  });
  if (choice === "unmute") media.setMicEnabled(true);
});
socket.on("room:removed", () => leave({ reason: "removed" }));
socket.on("participant:left", ({ id }) => removeParticipant(id));
socket.on("rtc:signal", (signal) => mesh?.handleSignal(signal));
socket.on("chat:message", (message) => chat.add(message));
socket.on("caption", ({ from, text, final }) => {
  const speaker = participants.get(from);
  if (speaker && showingCaptions) captionDisplay.show(from, speaker.name, { text, final });
});
socket.on("reaction", ({ from, emoji }) => {
  const sender = participants.get(from);
  if (!sender) return;
  tiles.react(from, emoji);
  announce(strings.reactions.sent(sender.name, strings.reactions.labels[emoji] ?? emoji));
});
socket.on("chat:typing", ({ from, name: typer, typing }) => chat.setTyping(from, typer, typing));

socket.on("server:restarting", () => {
  showBanner(strings.call.restarting);
});

socket.on("disconnect", () => {
  if (leaving) return;
  joined = false;
  showBanner(strings.call.reconnecting);
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
  // Nothing is listened to while you're muted.
  captioner.setPaused(!(media.micEnabled && media.mic));
  if (!joined) return;
  refreshSelfView();
  updateControls();
  // e.g. the camera started only after joining (a slow permission prompt).
  sendMediaState();
});
media.addEventListener("deviceended", ({ detail }) => {
  toast(detail.slot === "mic" ? strings.media.micDisconnected : strings.media.cameraDisconnected, {
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
  tip.textContent = shortcut ? strings.controls.withShortcut(text, describeKeys(shortcut)) : text;
}

function updateControls() {
  const micOn = media.micEnabled && Boolean(media.mic);
  setControl($("mic"), {
    label: micOn ? strings.controls.mute : strings.controls.unmute,
    tooltip: micOn ? strings.lobby.micOff : strings.lobby.micOn,
    iconName: micOn ? "mic" : "mic-off",
    active: !micOn,
  });
  const cameraOn = media.cameraEnabled && Boolean(media.camera);
  setControl($("camera"), {
    label: cameraOn ? strings.controls.stopVideo : strings.controls.startVideo,
    tooltip: cameraOn ? strings.lobby.cameraOff : strings.lobby.cameraOn,
    iconName: cameraOn ? "video" : "video-off",
    active: !cameraOn,
  });
  $("share").hidden = !ScreenShare.supported();
  setControl($("share"), {
    label: share.active ? strings.controls.stopPresenting : strings.controls.present,
    tooltip: share.active ? strings.controls.stopPresenting : strings.controls.presentTooltip,
    iconName: share.active ? "monitor-x" : "monitor-up",
    active: share.active,
  });
}

// Used by the lobby and call buttons and the shortcuts. Each resolves to
// what changed, e.g. "Microphone off" (or null if nothing did).
async function toggleMic() {
  if (!media.mic) {
    toast(strings.media.noMic, { tone: "warning" });
    return null;
  }
  media.setMicEnabled(!media.micEnabled);
  return media.micEnabled ? strings.media.micIsOn : strings.media.micIsOff;
}

let cameraBusy = false;
async function flipCamera() {
  if (cameraBusy) return;
  cameraBusy = true;
  const flipped = await media.flipCamera();
  cameraBusy = false;
  if (!flipped) toast(strings.media.flipFailed, { tone: "warning" });
  else
    announce(
      media.facing === "environment"
        ? strings.media.usingBackCamera
        : strings.media.usingFrontCamera,
    );
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
    toast(strings.media.cameraFailed, { tone: "warning" });
    return null;
  }
  return turningOn ? strings.media.cameraIsOn : strings.media.cameraIsOff;
}

$("mic").addEventListener("click", toggleMic);
$("camera").addEventListener("click", toggleCamera);

$("share").addEventListener("click", async () => {
  if (share.active) return share.stop();
  try {
    await share.start();
  } catch {
    toast(strings.media.shareFailed, { tone: "error" });
  }
});

// --------------------------------------------------- hands and reactions

const reactionMenu = new ReactionMenu({
  menu: $("reactions"),
  toggle: $("react"),
  hand: $("raise-hand"),
  buttons: $("reaction-buttons"),
  onReact: sendReaction,
  onHand: () => setHand(!handRaisedAt),
});

async function sendReaction(emoji) {
  tiles.react("self", emoji);
  const reply = await request(socket, "reaction:send", { emoji });
  if (!reply.ok) toast(describeError(reply.error), { tone: "warning" });
}

async function setHand(raised) {
  const reply = await request(socket, "hand:set", { raised });
  if (!reply.ok) return toast(describeError(reply.error), { tone: "warning" });
  const changed = Boolean(handRaisedAt) !== raised;
  handRaisedAt = reply.hand;
  reactionMenu.setHand(raised);
  $("hand-badge").hidden = !raised;
  tiles.upsert("self", { hand: raised });
  renderPeople();
  if (changed) announce(raised ? strings.hands.yoursUp : strings.hands.yoursDown);
}

// --------------------------------------------------------------- captions

const captionDisplay = new CaptionDisplay($("captions"));
let showingCaptions = local.get(CAPTIONS_KEY) === "on";

// Captions of your own speech, only while you choose to share them.
const captioner = new SpeechCaptioner({
  lang: document.documentElement.lang || navigator.language,
  onCaption: (caption) => {
    if (!joined) return;
    socket.emit("caption:send", caption);
    if (showingCaptions) captionDisplay.show("self", strings.captions.you, caption);
  },
  onError: (error) => {
    $("caption-me-toggle").checked = false;
    const blocked = error === "not-allowed" || error === "service-not-allowed";
    toast(blocked ? strings.captions.blocked : strings.captions.failed, { tone: "warning" });
  },
});

function refreshCaptionSettings() {
  $("captions-toggle").checked = showingCaptions;
  $("caption-me-toggle").checked = captioner.active;
  $("caption-me-field").hidden = !SpeechCaptioner.supported();
  $("caption-me-hint").textContent = SpeechCaptioner.supported()
    ? $("caption-me-hint").dataset.text
    : strings.captions.unsupported;
}
$("caption-me-hint").dataset.text = $("caption-me-hint").textContent.trim();

$("captions-toggle").addEventListener("change", (event) => {
  showingCaptions = event.target.checked;
  local.set(CAPTIONS_KEY, showingCaptions ? "on" : "off");
  if (!showingCaptions) captionDisplay.clear();
});

$("caption-me-toggle").addEventListener("change", (event) => {
  if (event.target.checked) {
    captioner.setPaused(!(media.micEnabled && media.mic));
    captioner.start();
  } else {
    captioner.stop();
  }
});

// -------------------------------------------------------------- recording

const recorder = new CallRecorder({
  getTiles: () => tiles.snapshot(),
  getAudioTracks: () =>
    [
      media.mic,
      ...[...participants.keys()].flatMap((id) => mesh?.streams(id)?.media.getAudioTracks() ?? []),
    ].filter(Boolean),
});

async function startRecording() {
  if (!CallRecorder.supported()) return toast(strings.recording.unsupported, { tone: "warning" });
  // Everyone is told first; no announcement, no recording.
  const reply = await request(socket, "recording:set", { recording: true });
  if (!reply.ok) return toast(strings.recording.failed, { tone: "error" });
  try {
    recorder.start();
  } catch {
    socket.emit("recording:set", { recording: false });
    return toast(strings.recording.failed, { tone: "error" });
  }
  renderRecording();
}

async function stopRecording() {
  if (!recorder.active) return;
  const blob = await recorder.stop();
  socket.emit("recording:set", { recording: false });
  renderRecording();
  if (!blob?.size) return;
  const when = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  saveRecording(blob, strings.recording.fileName(roomId, when));
  toast(strings.recording.saved, { tone: "success" });
}

// Who is recording, at the top of the call for as long as it lasts.
function renderRecording() {
  const others = [...participants.values()].filter((p) => p.recording).map((p) => p.name);
  const mine = recorder.active;
  $("recording-notice").hidden = !mine && others.length === 0;
  $("recording-stop").hidden = !mine;
  const text = mine
    ? others.length
      ? strings.recording.youAndOthers(others.length)
      : strings.recording.you
    : others.length
      ? strings.recording.others(others)
      : "";
  if ($("recording-text").textContent !== text) $("recording-text").textContent = text;
  $("record-toggle").hidden = !CallRecorder.supported();
  $("record-toggle").querySelector(".record-toggle__label").textContent = mine
    ? strings.recording.stop
    : strings.recording.start;
}

$("record-toggle").addEventListener("click", () => {
  $("settings-dialog").close();
  if (recorder.active) stopRecording();
  else startRecording();
});
$("recording-stop").addEventListener("click", stopRecording);

// Closing the tab would lose the recording, so the browser asks first.
window.addEventListener("beforeunload", (event) => {
  if (recorder.active) event.preventDefault();
});

// ------------------------------------------------------------------- host

// Changes the server made to you: becoming host, or a host lowering your
// hand.
function updateSelf(view) {
  const becameHost = view.host && !self.host;
  self = { ...self, host: view.host };
  if (becameHost) toast(strings.host.youAreHost, { tone: "success" });
  if (!view.hand && handRaisedAt) {
    handRaisedAt = null;
    reactionMenu.setHand(false);
    $("hand-badge").hidden = true;
    tiles.upsert("self", { hand: false });
    announce(strings.hands.loweredByHost);
  }
  renderPeople();
  renderKnocks();
}

function setLocked(locked) {
  $("lock-state").hidden = !locked;
  $("lock-toggle").checked = Boolean(locked);
}

$("lock-toggle").addEventListener("change", async (event) => {
  const locked = event.target.checked;
  const reply = await request(socket, "room:lock", { locked });
  if (!reply.ok) {
    event.target.checked = !locked;
    toast(describeError(reply.error), { tone: "warning" });
  }
});

// Hosts see who is waiting to be let in.
function renderKnocks() {
  const visible = Boolean(self?.host) && knocks.size > 0;
  $("knocks").hidden = !visible;
  $("knock-list").replaceChildren(
    ...[...knocks].map(([id, knocker]) => {
      const item = document.createElement("li");
      item.className = "knock";
      const text = document.createElement("span");
      text.className = "knock__text";
      text.textContent = strings.host.wantsToJoin(knocker);
      const answer = (admit, label, ariaLabel, tone) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn btn--${tone} knock__button`;
        button.textContent = label;
        button.setAttribute("aria-label", ariaLabel);
        button.addEventListener("click", async () => {
          button.disabled = true;
          const reply = await request(socket, "knock:answer", { id, admit });
          if (!reply.ok) toast(describeError(reply.error), { tone: "warning" });
          knocks.delete(id);
          renderKnocks();
        });
        return button;
      };
      item.append(
        text,
        answer(false, strings.host.deny, strings.host.denyName(knocker), "secondary"),
        answer(true, strings.host.admit, strings.host.admitName(knocker), "primary"),
      );
      return item;
    }),
  );
}

// Actions from a person's menu in the People panel.
async function hostAction(action, person) {
  if (action === "remove") {
    const ok = await confirmDialog({
      title: strings.host.removeTitle(person.name),
      body: strings.host.removeBody,
      confirmLabel: strings.host.remove,
      tone: "danger",
    });
    if (!ok) return;
  }
  const event = {
    mute: "host:mute",
    askUnmute: "host:ask-unmute",
    lowerHand: "host:lower-hand",
    remove: "host:remove",
  }[action];
  const reply = await request(socket, event, { id: person.id });
  if (!reply.ok) return toast(describeError(reply.error), { tone: "warning" });
  if (action === "askUnmute") toast(strings.host.asked(person.name));
  if (action === "remove") toast(strings.host.removed(person.name));
}

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
  hand: () => inCall() && !dialogOpen() && setHand(!handRaisedAt),
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
  rows.push([strings.shortcuts.close, [strings.shortcuts.escape]]);
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
  ["chat-toggle", strings.controls.chatTooltip],
  ["people-toggle", strings.controls.peopleTooltip],
  ["react", strings.reactions.tooltip],
  ["invite", strings.controls.inviteTooltip],
  ["settings", strings.controls.settingsTooltip],
  ["leave", strings.controls.leaveTooltip],
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
  $("noise-toggle").checked = media.effects.noiseSuppression;
  $("blur-toggle").checked = media.effects.backgroundBlur;
  $("blur-field").hidden = !media.canBlur;
  refreshCaptionSettings();
  $("settings-dialog").showModal();
});

const rememberEffects = () => local.set(EFFECTS_KEY, JSON.stringify(media.effects));

$("noise-toggle").addEventListener("change", async (event) => {
  const done = await media.setNoiseSuppression(event.target.checked);
  if (!done) toast(strings.effects.noiseFailed, { tone: "warning" });
  rememberEffects();
});

$("blur-toggle").addEventListener("change", async (event) => {
  const done = await media.setBackgroundBlur(event.target.checked);
  if (!done) {
    event.target.checked = false;
    media.effects.backgroundBlur = false;
    toast(strings.effects.blurFailed, { tone: "warning" });
  }
  rememberEffects();
});

// Unread badge while the chat is closed (or hidden on small screens).
$("messages").addEventListener("chat:new", ({ detail }) => {
  const visible = $("chat").checkVisibility?.() ?? true;
  if (!detail.mine && !visible) $("chat-unread").hidden = false;
});

for (const id of ["invite", "people-invite"]) $(id).addEventListener("click", invite);

async function invite() {
  const url = location.href;
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: strings.invite.shareTitle, url });
      return;
    } catch {
      // cancelled: fall back to copying
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(strings.invite.copied, { tone: "success" });
  } catch {
    toast(strings.invite.shareThis(url), { duration: 10000 });
  }
}

$("leave").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: strings.leave.confirmTitle,
    body: strings.leave.confirmBody,
    confirmLabel: strings.leave.confirm,
    tone: "danger",
  });
  if (ok) leave();
});

async function leave({ reason } = {}) {
  await stopRecording(); // saved before the page goes
  captioner.stop();
  leaving = true;
  joined = false;
  if (!reason) await request(socket, "room:leave", undefined, 2000);
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
  const query = new URLSearchParams({ room: roomId, ...(reason ? { reason } : {}) });
  location.assign(`/leave?${query}`);
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
      value.textContent = strings.call.offline;
      badge.dataset.quality = "poor";
      return;
    }
    const ms = Math.round(performance.now() - started);
    value.textContent = strings.call.ping(ms);
    badge.dataset.quality = ms < 150 ? "good" : ms < 300 ? "fair" : "poor";
    badge.setAttribute("aria-label", strings.call.pingLabel(ms));
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
  showBanner(strings.call.audioBlocked, {
    action: strings.call.playAudio,
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

const describeError = (error) => strings.errors[error] ?? error;

// A handle for debugging from the browser console (and for tests).
window.videonchat = { socket, media, share, mesh: () => mesh, self: () => self };

main();
