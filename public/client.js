const socket = io();

const videoGrid = document.getElementById("video-grid");
const myVideo = document.createElement("video");
myVideo.muted = true;
myVideo.classList.add("self-view");

var user;
// Proves to the server that a re-join after a reconnect comes from this tab.
const tabSecret = crypto.randomUUID();

const NAME_KEY = "videonchat:name";
const readSavedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
};

Swal.fire({
  title: "Enter your Name",
  input: "text",
  inputLabel: "User Name 😎",
  inputPlaceholder: "Your Name",
  inputValue: readSavedName(),
  inputAttributes: { maxlength: "40", autocomplete: "name" },
  confirmButtonText: "Join Call",
  confirmButtonColor: "#648c11",
  backdrop: "#733635",
  allowOutsideClick: false,
  allowEscapeKey: false, // closing the prompt used to join as "null"
  inputValidator: (value) => (value.trim() ? undefined : "Your name cannot be empty!"),
}).then((result) => {
  user = result.value.trim().slice(0, 40);
  try {
    localStorage.setItem(NAME_KEY, user);
  } catch {
    // private mode: the name just isn't remembered
  }
  // Signalling goes through the PeerJS server mounted at /peerjs on this
  // same server, so it works locally and in production without edits.
  const secure = location.protocol === "https:";
  const peer = new Peer(undefined, {
    host: location.hostname,
    port: Number(location.port) || (secure ? 443 : 80),
    path: "/peerjs",
    secure,
  });

  // Every call, in both directions, keyed by the remote peer ID.
  const calls = new Map(); // peerId -> { call, video }
  var currentUser = null;
  var myVideoStream = null;

  // Camera and mic, then mic only, then watch-only. Never rejects.
  const mediaReady = getLocalMedia();

  const peerOpen = new Promise((resolve, reject) => {
    peer.once("open", resolve);
    peer.once("error", reject);
  });

  peer.on("error", (err) => console.warn("PeerJS:", err.type));
  // If the signalling connection drops, reconnect with the same peer ID.
  peer.on("disconnected", () => {
    setTimeout(() => {
      if (!peer.destroyed) peer.reconnect();
    }, 2000);
  });

  // Registered immediately so an early call is never lost; it is answered
  // once local media has settled (without media we can still watch).
  peer.on("call", async (call) => {
    call.answer((await mediaReady) ?? undefined);
    trackCall(call);
  });

  const joinRoom = () =>
    socket.emit("join-room", ROOM_ID, currentUser, user, tabSecret);

  // Announce ourselves only when calls can be answered, so the people
  // already in the room can call straight away.
  Promise.all([peerOpen, mediaReady])
    .then(([peerId, stream]) => {
      currentUser = peerId;
      myVideoStream = stream;
      if (stream) addVideoStream(myVideo, stream);
      joinRoom();
    })
    .catch((err) => {
      Swal.fire({
        icon: "error",
        title: "Couldn't connect",
        text: "The call server is unreachable (" + (err.type || err.message) + "). Reload to try again.",
        confirmButtonText: "Reload",
      }).then(() => location.reload());
    });

  // After Socket.IO reconnects (network blip, laptop sleep), join again.
  socket.on("connect", () => {
    if (currentUser) joinRoom();
  });

  socket.on("user-connected", async (userId, userName) => {
    //For alert
    Swal.fire({
      position: "top-end",
      text: userName + " Has joined the meet!!",
      showConfirmButton: false,
      timer: 1500,
      width: 250,
    });
    const stream = await mediaReady;
    if (stream) trackCall(peer.call(userId, stream));
  });

  socket.on("user-disconnected", (userId) => dropCall(userId));

  function trackCall(call) {
    if (!call) return;
    dropCall(call.peer); // replace any stale call with the same person
    const video = document.createElement("video");
    calls.set(call.peer, { call, video });
    call.on("stream", (remoteStream) => addVideoStream(video, remoteStream));
    const onEnd = () => {
      if (calls.get(call.peer)?.call === call) dropCall(call.peer);
    };
    call.on("close", onEnd);
    call.on("error", onEnd);
    // People who join during a screen share get the screen, not the camera.
    if (screenTrack) {
      call.peerConnection
        ?.getSenders()
        .find((s) => s.track?.kind === "video")
        ?.replaceTrack(screenTrack)
        .catch(() => {});
    }
  }

  function dropCall(peerId) {
    const entry = calls.get(peerId);
    if (!entry) return;
    calls.delete(peerId);
    entry.video.remove();
    entry.call.close();
  }

  async function getLocalMedia() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showMediaError({ name: "SecurityError" });
      return null;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (videoError) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        Swal.fire({
          position: "top-end",
          text: "No camera available, so you joined with audio only.",
          showConfirmButton: false,
          timer: 3000,
          width: 300,
        });
        return stream;
      } catch (audioError) {
        showMediaError(videoError.name === "NotAllowedError" ? videoError : audioError);
        return null;
      }
    }
  }

  function showMediaError(err) {
    const reasons = {
      NotAllowedError:
        "Camera and microphone access is blocked. Allow it in your browser's site settings, then try again.",
      NotFoundError: "No camera or microphone was found on this device.",
      NotReadableError: "Your camera or microphone is being used by another app.",
      SecurityError: "Camera and microphone need a secure (https) connection.",
    };
    Swal.fire({
      icon: "warning",
      title: "You joined without camera or microphone",
      text: (reasons[err.name] || "Your camera or microphone couldn't start.") +
        " You can still see and hear the people already in the call.",
      showCancelButton: true,
      confirmButtonText: "Try again",
      cancelButtonText: "Continue",
    }).then((result) => {
      if (result.isConfirmed) location.reload();
    });
  }

  // No native controls: they let people unmute their own preview or pause
  // someone else. playsInline keeps iPhones from going fullscreen.
  function addVideoStream(video, stream) {
    video.srcObject = stream;
    video.playsInline = true;
    video.autoplay = true;
    if (!video.isConnected) videoGrid.append(video);
    video.play().catch(() => {}); // autoplay is allowed after the Join click
  }

  //****************************// AUDIO HANDLING //****************************//

  const muteButton = document.querySelector("#muteButton");

  muteButton.addEventListener("click", () => {
    const track = myVideoStream?.getAudioTracks()[0];
    if (!track) return showMissingDevice("microphone");
    if (track.enabled) {
      track.enabled = false;
      setMuteButton();
    } else {
      track.enabled = true;
      unsetMuteButton();
    }
  });

  function showMissingDevice(kind) {
    Swal.fire({
      position: "top-end",
      text: "No " + kind + " is connected to this call.",
      showConfirmButton: false,
      timer: 2000,
      width: 250,
    });
  }

  const unsetMuteButton = () => {
    const html = `<i class="fas fa-microphone" aria-hidden="true"></i>`;
    muteButton.innerHTML = html;
    muteButton.setAttribute("aria-pressed", "false");
    Swal.fire({
      position: "top-end",
      text: "Your mic is on",
      showConfirmButton: false,
      timer: 1500,
      width: 200,
    });
  };

  const setMuteButton = () => {
    const html = `<i class="fas fa-microphone-slash off" aria-hidden="true"></i>`;
    muteButton.innerHTML = html;
    muteButton.setAttribute("aria-pressed", "true");
    Swal.fire({
      position: "top-end",
      text: "You are muted",
      showConfirmButton: false,
      timer: 1500,
      width: 200,
    });
  };

  //****************************// VIDEO HANDLING //****************************//

  const stopVideo = document.querySelector("#stopVideo");

  stopVideo.addEventListener("click", () => {
    const track = myVideoStream?.getVideoTracks()[0];
    if (!track) return showMissingDevice("camera");
    if (track.enabled) {
      track.enabled = false;
      unsetVideoButton();
    } else {
      track.enabled = true;
      setVideoButton();
    }
  });

  const setVideoButton = () => {
    const html = `<i class="fas fa-video" aria-hidden="true"></i>`;
    stopVideo.innerHTML = html;
    stopVideo.setAttribute("aria-pressed", "false");
    Swal.fire({
      position: "top-end",
      text: "Your cam is on",
      showConfirmButton: false,
      timer: 1500,
      width: 200,
    });
  };

  const unsetVideoButton = () => {
    const html = `<i class="fas fa-video-slash off" aria-hidden="true"></i>`;
    stopVideo.innerHTML = html;
    stopVideo.setAttribute("aria-pressed", "true");
    Swal.fire({
      position: "top-end",
      text: "Your cam is off",
      showConfirmButton: false,
      timer: 1500,
      width: 200,
    });
  };

  //****************************// INVITE  //****************************//

  const inviteButton = document.querySelector("#inviteButton");

  inviteButton.addEventListener("click", (e) => {
    var share = document.createElement("input"),
      text = window.location.href;
    document.body.appendChild(share);
    share.value = text;
    share.select();
    document.execCommand("copy");
    document.body.removeChild(share);
    Swal.fire({
      title: "Invite link has been copied",
      icon: "success",
      text: "Share it with your friends!",
    });
  });

  //****************************// SCREEN SHARING //****************************//

  const shareScreen = document.querySelector("#shareScreen");

  let screenTrack = null;

  // Swaps the outgoing video on every live call. One failing connection
  // can't stop the others from switching.
  function replaceOutgoingVideo(track) {
    return Promise.allSettled(
      [...calls.values()].map(({ call }) => {
        const sender = call.peerConnection
          ?.getSenders()
          .find((s) => s.track?.kind === "video");
        return sender?.replaceTrack(track);
      })
    );
  }

  shareScreen.addEventListener("click", async () => {
    if (screenTrack) return stopScreenShare(); // second click stops sharing
    if (!navigator.mediaDevices?.getDisplayMedia) {
      return Swal.fire({ icon: "info", text: "Screen sharing isn't supported in this browser." });
    }
    try {
      const captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenTrack = captureStream.getVideoTracks()[0];
      screenTrack.onended = stopScreenShare; // browser's own "Stop sharing"
      await replaceOutgoingVideo(screenTrack);
      shareScreen.setAttribute("aria-pressed", "true");
    } catch (err) {
      console.error("Screen share failed:", err);
    }
  });

  function stopScreenShare() {
    if (!screenTrack) return;
    screenTrack.onended = null;
    screenTrack.stop();
    screenTrack = null;
    shareScreen.setAttribute("aria-pressed", "false");
    replaceOutgoingVideo(myVideoStream?.getVideoTracks()[0] ?? null);
  }

  //****************************// MESSAGING //****************************//
  var text = document.querySelector("#chat_message");
  var sendMessage = document.getElementById("send");
  var messages = document.querySelector(".messages");
  var feedback = document.getElementById("feedback");

  // Names of people typing right now, each expiring if no update arrives.
  const typers = new Map(); // name -> timeout id

  function renderTyping() {
    const names = [...typers.keys()];
    if (names.length === 0) feedback.textContent = "";
    else if (names.length === 1) feedback.textContent = names[0] + " is typing…";
    else if (names.length === 2) feedback.textContent = names.join(" and ") + " are typing…";
    else feedback.textContent = "Several people are typing…";
  }

  function setTyping(name, isTyping) {
    clearTimeout(typers.get(name));
    if (isTyping) typers.set(name, setTimeout(() => setTyping(name, false), 4000));
    else typers.delete(name);
    renderTyping();
  }

  socket.on("typing", (name) => setTyping(name, true));
  socket.on("stoppedTyping", (name) => setTyping(name, false));
  let typingSentAt = 0;
  let typingIdle;

  function stopTyping() {
    clearTimeout(typingIdle);
    if (typingSentAt) socket.emit("stoppedTyping");
    typingSentAt = 0;
  }

  function sendCurrentMessage() {
    const message = text.value.trim();
    if (message) socket.emit("message", message);
    text.value = ""; //Clear the textbox
    stopTyping();
  }

  sendMessage.addEventListener("click", sendCurrentMessage);

  // The input event sees the updated value (keydown didn't), and "typing"
  // is sent at most every 2 seconds instead of on every keystroke.
  text.addEventListener("input", () => {
    clearTimeout(typingIdle);
    if (!text.value.trim()) return stopTyping();
    if (Date.now() - typingSentAt > 2000) {
      socket.emit("typing");
      typingSentAt = Date.now();
    }
    typingIdle = setTimeout(stopTyping, 3000);
  });

  //Send the message if the user presses Enter (but not mid-IME composition)
  text.addEventListener("keydown", (K) => {
    if (K.key === "Enter" && !K.isComposing) sendCurrentMessage();
  });
  // Builds a chat entry from DOM nodes. Remote text is only ever assigned to
  // textContent, so messages and names can never inject HTML or scripts.
  function appendMessage(text, senderName, isMine) {
    const item = document.createElement("div");
    item.className = "message";

    const profile = document.createElement("div");
    profile.className = "profile";
    const author = document.createElement("b");
    const icon = document.createElement("i");
    icon.className = "far fa-user-circle";
    const name = document.createElement("span");
    name.textContent = isMine ? "me" : senderName;
    author.append(icon, " ", name);
    const timeBox = document.createElement("div");
    timeBox.className = "time";
    const time = document.createElement("time");
    time.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    timeBox.append(time);
    profile.append(author, timeBox);

    const body = document.createElement("span");
    body.textContent = text;

    item.append(profile, body);
    messages.append(item);
  }

  socket.on("createMessage", (message, userName, senderId) => {
    setTyping(userName, false);
    appendMessage(message, userName, senderId === currentUser);

    //For scrolling to bottom
    var chatWindow = document.querySelector(".main__chat_window");
    var xH = chatWindow.scrollHeight;
    chatWindow.scrollTo(0, xH);
  });

  const showChat = document.querySelector("#showChat");
  const backBtn = document.querySelector(".header__back");

  showChat.addEventListener("click", () => {
    document.querySelector(".main__right").style.display = "flex";
    document.querySelector(".main__right").style.flex = "1";
    document.querySelector(".main__left").style.display = "none";
    document.querySelector(".header__back").style.display = "block";
  });

  backBtn.addEventListener("click", () => {
    document.querySelector(".main__left").style.display = "flex";
    document.querySelector(".main__left").style.flex = "1";
    document.querySelector(".main__right").style.display = "none";
    document.querySelector(".header__back").style.display = "none";
  });

  //****************************// PING INFO //****************************//

  var ResponseTime = document.getElementById("rtt-value");
  var networkInfo = document.getElementById("network-content");

  networkInfo.addEventListener("click", () => {
    var currentPing = ResponseTime.textContent;
    Swal.fire({
      title: "Your ping is " + currentPing,
      text: "Round trip to the server. The lesser the better 🧐",
      icon: "info",
    });
  });

  // navigator.connection only exists in Chromium (and isn't the server
  // round trip anyway); reading it crashed setup in Firefox and Safari.
  function measurePing() {
    const started = performance.now();
    socket.timeout(5000).emit("net:ping", (err) => {
      if (err) {
        ResponseTime.textContent = "offline";
        networkInfo.style.backgroundColor = "red";
        return;
      }
      const ping = Math.round(performance.now() - started);
      ResponseTime.textContent = ping + " ms";
      if (ping < 200) {
        networkInfo.style.backgroundColor = "#009940";
      } else if (ping < 350) {
        networkInfo.style.backgroundColor = "yellow";
      } else {
        networkInfo.style.backgroundColor = "red";
      }
    });
  }

  measurePing();
  setInterval(measurePing, 5000);

  //****************************// LEAVE MEETING //****************************//

  var leaveButton = document.getElementById("leave-meet");
  leaveButton.addEventListener("click", () => {
    Swal.fire({
      title: "Are you sure?",
      text: "You want to leave this meet!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, leave now!",
      cancelButtonText: "Nope!",
      reverseButtons: true,
    }).then((result) => {
      if (result.isConfirmed) {
        myVideoStream?.getTracks().forEach((track) => track.stop());
        screenTrack?.stop();
        location.assign("/leave");
      }
    });
  });
});
