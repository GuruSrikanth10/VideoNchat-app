const express = require("express");
const app = express();
const { v4: uuidv4 } = require("uuid");

//****************************//PORT //****************************//
const port =  3000 || process.env.PORT; // While hosting 3000 may not be available
const server = app.listen(port, () =>
  console.log(`Listening on port ${port}..`)
);

//****************************//SOCKET AND PEER SETUP //****************************//
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const { ExpressPeerServer } = require("peer");
const peerServer = ExpressPeerServer(server, {
  debug: true,
});

app.set("view engine", "ejs");
app.use("/peerjs", peerServer);
app.use(express.static("public"));

//****************************//GET REQUESTS //****************************//
app.get("/", (req, res) => {
  res.redirect(`/${uuidv4()}`); // Creates a new random id and redirects it.
});

app.get("/leave", (req, res) => {
  res.render("leave");
});

app.get("/:room", (req, res) => {
  res.render("room", { roomId: req.params.room });
});

//****************************//SOCKET IO CONNECTION //****************************//

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join-room", (roomId, userId, userName) => {
    console.log(`${userName} joined rooom ${roomId}`);
    socket.join(roomId);
    socket.broadcast.to(roomId).emit("user-connected", userId, userName);

    socket.on("message", (message) => {
      console.log("Message received:", message);
      io.to(roomId).emit("createMessage", message, userName);
    });

    socket.on("typing", () => {
      console.log(`${userName} is typing`);
      socket.broadcast.to(roomId).emit("typing", userName);
    });

    socket.on("stoppedTyping", () => {
      console.log(`${userName} stopped typing`);
      socket.broadcast.to(roomId).emit("stoppedTyping");
    });

    socket.on("disconnect", () => {
      console.log(`${userName} disconnected`);
      socket.broadcast.to(roomId).emit("user-disconnected", userId);
    });
  });
});
