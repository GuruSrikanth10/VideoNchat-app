// Every message the scripts show, in one place and ready for translation:
// a translation is a copy of this module with the values changed. Parts
// that vary are function arguments, and counts go through plural().
//
// (The pages' own HTML holds their static text.)

const LOCALE = "en";
const pluralRules = new Intl.PluralRules(LOCALE);

// plural(3, { one: "1 person", other: (n) => `${n} people` }) -> "3 people"
const plural = (count, forms) => {
  const form = forms[pluralRules.select(count)] ?? forms.other;
  return typeof form === "function" ? form(count) : form;
};

export const strings = {
  locale: LOCALE,

  // Server error codes, as the end of a sentence.
  errors: {
    "rate-limited": "you're sending too fast",
    "not-joined": "not connected to the meeting yet",
    timeout: "no response from the server",
    "empty-message": "the message is empty",
    "room-full": "the meeting is full",
    "room-locked": "the meeting is locked",
    "not-host": "only the host can do that",
    "unknown-participant": "they're no longer in the meeting",
    "unknown-knock": "they're no longer waiting",
    "too-many-knocks": "too many people are waiting already",
  },

  home: {
    invalidCode: "That doesn't look like a meeting link or code from this site.",
    missingCode: "Enter the meeting link or code you were sent.",
  },

  lobby: {
    nameRequired: "Please enter your name.",
    joining: "Joining…",
    joinNow: "Join now",
    roomFull: "This meeting is full right now.",
    locked: "This meeting is locked. Ask to join, and the host will let you in.",
    askToJoin: "Ask to join",
    asking: "Asking to join…",
    waiting: "Waiting for the host to let you in…",
    denied: "The host didn't let you in.",
    nobodyHere: "No one else is here yet.",
    peopleHere: (count) =>
      plural(count, {
        one: "1 person is in this meeting.",
        other: (n) => `${n} people are in this meeting.`,
      }),
    micOff: "Turn off microphone",
    micOn: "Turn on microphone",
    cameraOff: "Turn off camera",
    cameraOn: "Turn on camera",
  },

  // Plain-language help for each getUserMedia error.
  mediaErrors: {
    reasons: {
      NotAllowedError:
        "Camera and microphone access is blocked. Allow it from the camera icon in the address bar (or your browser's site settings), then try again.",
      NotFoundError: "No camera or microphone was found. Connect one and try again.",
      NotReadableError:
        "Your camera or microphone is being used by another app. Close it and try again.",
      OverconstrainedError: "The selected camera or microphone isn't available.",
      SecurityError: "Camera and microphone only work on a secure (https) connection.",
    },
    other: "Your camera or microphone couldn't start.",
    micOnly: "You can join with your microphone only.",
    cameraOnly: "You can join with your camera only.",
    watchOnly: "You can still join to see and hear everyone.",
  },

  join: {
    roomFull: "This meeting is full right now. Try again in a moment.",
    failed: (reason) => `Couldn't join the meeting (${reason}).`,
    retrying: (reason) => `Couldn't join the meeting (${reason}). Retrying…`,
    fullTitle: "This meeting is full",
    fullBody: "Everyone in a call sends video to everyone else, so rooms are kept small.",
    tryAgain: "Try again",
    startNew: "Start a new meeting",
  },

  call: {
    title: (count) => `${count > 1 ? `(${count}) ` : ""}Meeting · VideoNChat`,
    count: (count) => plural(count, { one: "Just you", other: (n) => `${n} in call` }),
    peopleHeading: (count) => `People (${count})`,
    joined: (name) => `${name} joined`,
    left: (name) => `${name} left`,
    presenting: (name) => `${name} is presenting`,
    restarting: "The server is restarting. You'll be reconnected automatically.",
    reconnecting: "Connection lost. Reconnecting…",
    audioBlocked: "Your browser paused the call audio.",
    playAudio: "Play audio",
    ping: (ms) => `${ms} ms`,
    pingLabel: (ms) => `Round trip to the server: ${ms} milliseconds`,
    offline: "offline",
  },

  media: {
    micDisconnected: "Microphone disconnected",
    cameraDisconnected: "Camera disconnected",
    noMic: "No microphone is available.",
    cameraFailed: "The camera couldn't start.",
    shareFailed: "Screen sharing couldn't start.",
    flipFailed: "Couldn't switch cameras.",
    micIsOn: "Microphone on",
    micIsOff: "Microphone off",
    cameraIsOn: "Camera on",
    cameraIsOff: "Camera off",
    usingBackCamera: "Using the back camera",
    usingFrontCamera: "Using the front camera",
    switchCamera: "Switch camera",
  },

  // Control bar labels and tooltips.
  controls: {
    mute: "Mute",
    unmute: "Unmute",
    stopVideo: "Stop video",
    startVideo: "Start video",
    present: "Present",
    stopPresenting: "Stop presenting",
    presentTooltip: "Present your screen",
    chatTooltip: "Chat with everyone",
    peopleTooltip: "Show everyone",
    inviteTooltip: "Invite people",
    settingsTooltip: "Settings",
    leaveTooltip: "Leave the meeting",
    withShortcut: (text, keys) => `${text} (${keys})`,
  },

  effects: {
    title: "Effects",
    noise: "Noise suppression",
    noiseHint: "Filters out background noise, like typing and fans.",
    blur: "Blur my background",
    blurFailed: "Your background couldn't be blurred.",
    noiseFailed: "Noise suppression couldn't be changed.",
  },

  invite: {
    shareTitle: "Join my VideoNChat meeting",
    copied: "Invite link copied",
    shareThis: (url) => `Share this link: ${url}`,
  },

  leave: {
    confirmTitle: "Leave the meeting?",
    confirmBody: "You can rejoin with the same link.",
    confirm: "Leave",
    duration: (words) => `You were in the meeting for ${words}.`,
    removedTitle: "You were removed from the meeting",
    removedBody: "The host removed you. You can still start a new meeting.",
  },

  dialog: {
    cancel: "Cancel",
  },

  host: {
    label: "Host",
    youAreHost: "You're now the host",
    lock: "Lock meeting",
    lockHint: "New people have to ask to join, and you let them in.",
    locked: "The meeting is locked",
    unlocked: "The meeting is unlocked",
    lockedBadge: "Locked",
    actionsFor: (name) => `Options for ${name}`,
    mute: "Mute",
    askUnmute: "Ask to unmute",
    lowerHand: "Lower hand",
    remove: "Remove from meeting",
    removeTitle: (name) => `Remove ${name}?`,
    removeBody: "They can rejoin with the link unless you lock the meeting.",
    removed: (name) => `${name} was removed`,
    asked: (name) => `Asked ${name} to unmute`,
    mutedBy: (name) => `${name} muted you`,
    askedBy: (name) => `${name} asks you to unmute`,
    askedBody: "Only you can turn your microphone on.",
    stayMuted: "Stay muted",
    unmute: "Unmute",
    waitingTitle: "Waiting to join",
    wantsToJoin: (name) => `${name} wants to join`,
    admit: "Admit",
    deny: "Deny",
    admitName: (name) => `Admit ${name}`,
    denyName: (name) => `Deny ${name}`,
  },

  hands: {
    raise: "Raise hand",
    lower: "Lower hand",
    raised: (name) => `${name} raised a hand`,
    yoursUp: "Your hand is raised",
    yoursDown: "Your hand is lowered",
    state: "hand raised",
    loweredByHost: "The host lowered your hand",
  },

  reactions: {
    react: "React",
    tooltip: "Send a reaction or raise your hand",
    menu: "Reactions",
    group: "Send a reaction",
    labels: {
      "👍": "thumbs up",
      "❤️": "heart",
      "😂": "laughter",
      "😮": "surprise",
      "👏": "applause",
      "🎉": "celebration",
    },
    send: (label) => `Send ${label}`,
    sent: (name, label) => `${name} reacted with ${label}`,
  },

  shortcuts: {
    hand: "Raise or lower your hand",
    mic: "Turn your microphone on or off",
    camera: "Turn your camera on or off",
    chat: "Open or close the chat",
    people: "Open or close the people list",
    help: "Show keyboard shortcuts",
    close: "Close a panel or dialog",
    escape: "Esc",
  },

  chat: {
    you: "You",
    typing: (names) =>
      names.length === 1
        ? `${names[0]} is typing…`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing…`
          : "Several people are typing…",
    charactersLeft: (count) =>
      plural(count, { one: "1 character left", other: (n) => `${n} characters left` }),
  },

  tiles: {
    you: (name) => `${name} (you)`,
    yourScreen: "Your screen",
    screenOf: (name) => `${name}'s screen`,
    thisTile: "this tile",
    pin: (who) => `Pin ${who}`,
    unpin: (who) => `Unpin ${who}`,
    fullscreen: (who) => `Show ${who} full screen`,
    pictureInPicture: (who) => `Show ${who} picture-in-picture`,
  },

  people: {
    invite: "Invite people",
    presenting: "presenting",
    cameraOff: "camera off",
    muted: "muted",
  },

  devices: {
    videoinput: "Camera",
    audioinput: "Microphone",
    audiooutput: "Speaker",
    numbered: (kind, number) => `${strings.devices[kind]} ${number}`,
    none: (kind) => `No ${strings.devices[kind].toLowerCase()} found`,
  },

  quality: {
    good: "Good connection",
    fair: "Fair connection",
    poor: "Poor connection",
    measuring: "Measuring connection",
    details: (label, parts) => `${label}: ${parts.join(", ")}`,
    roundTrip: (ms) => `${ms} ms round trip`,
    loss: (percent) => `${percent}% packet loss`,
    bitrate: (kbps) => `${kbps} kbps`,
  },
};
