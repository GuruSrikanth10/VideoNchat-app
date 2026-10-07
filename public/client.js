const currentLink = window.location.host + "/";
console.log(currentLink);

const socket = io(currentLink);

const videoGrid = document.getElementById("video-grid");
const myVideo = document.createElement("video");
myVideo.muted = true;

var user;
// Proves to the server that a re-join after a reconnect comes from this tab.
const tabSecret = crypto.randomUUID();

Swal.fire({
  title: "Enter your Name",
  input: "text",
  inputLabel: "User Name 😎",
  inputPlaceholder: "Your Name",
  confirmButtonText: "Join Call",
  confirmButtonColor: "#648c11",
  backdrop: "#733635",
  allowOutsideClick: false,
  inputValidator: (value) => {
    return new Promise((resolve) => {
      if (value) {
        resolve();
      } else {
        resolve("Your name cannot be empty!");
      }
    });
  },
}).then((result) => {
  user = result.value;
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

  const addVideoStream = (video, stream) => {
    video.srcObject = stream;
    video.controls = true;
    video.addEventListener("loadedmetadata", () => {
      video.play();
    });
    videoGrid.append(video);
  };

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
    const html = `<i class="fas fa-microphone"></i>`;
    muteButton.innerHTML = html;
    console.log("You are Unmuted");
    Swal.fire({
      position: "top-end",
      text: "Your mic is on",
      showConfirmButton: false,
      timer: 1500,
      width: 200,
    });
  };

  const setMuteButton = () => {
    const html = `<i class="fas fa-microphone-slash" style="color:red;"></i>`;
    muteButton.innerHTML = html;
    console.log("Muted");
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
    const html = `<i class="fas fa-video"></i>`;
    stopVideo.innerHTML = html;
    console.log("Cammera Mode ON");
    Swal.fire({
      position: "top-end",
      text: "Your cam is on",
      showConfirmButton: false,
      timer: 1500,
      width: 200,
    });
  };

  const unsetVideoButton = () => {
    const html = `<i class="fas fa-video-slash" style="color:red;"></i>`;
    stopVideo.innerHTML = html;
    console.log("Cammera Mode OFF");
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

  // debugging code
  // const socket = io();

  // debugging code

  socket.on("typing", function (data) {
    feedback.textContent = data + " is typing a message...";
  });

  socket.on("stoppedTyping", () => {
    feedback.innerHTML = "";
  });
  function sendCurrentMessage() {
    const message = text.value.trim();
    if (message) socket.emit("message", message);
    text.value = ""; //Clear the textbox
  }

  sendMessage.addEventListener("click", sendCurrentMessage);

  //Send the message if the user presses Enter
  text.addEventListener("keydown", (K) => {
    if (K.key === "Enter") {
      sendCurrentMessage();
    } else if (text.value.length !== 0) {
      socket.emit("typing");
    } else if (text.value.length === 0) {
      socket.emit("stoppedTyping");
    }
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
    feedback.textContent = "";
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
    var currentPing = ResponseTime.innerHTML;
    Swal.fire({
      title: "Your ping is " + currentPing,
      text: "The lesser the better 🧐",
      icon: "info",
    });
  });
  function claculateRTT() {
    var networkInformation = navigator.connection;
    var ping = networkInformation.rtt;
    ResponseTime.innerHTML = ping + " ms";
    if (ping < 200) {
      networkInfo.style.backgroundColor = "#009940";
    } else if (ping < 350) {
      networkInfo.style.backgroundColor = "yellow";
    } else {
      networkInfo.style.backgroundColor = "red";
    }
  }

  function recurciveCalculate() {
    claculateRTT();
    console.log("Calculating ping ...");
    setTimeout(recurciveCalculate, 5000);
  }

  recurciveCalculate();

  //****************************// LEAVE MEETING //****************************//

  var leaveButton = document.getElementById("leave-meet");
  //console.log(leaveButton);
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
        window.location = "http://" + currentLink + "leave";
      }
    });
  });
});
// http://localhost:3000/leave
