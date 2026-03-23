const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
  },
});

// ✅ Health probe para Kubernetes
app.get("/health", (req, res) => res.json({ status: "ok", clients: io.engine.clientsCount }));

// ✅ Rota que o ingest-api chama via HTTP
app.post("/publish", (req, res) => {
  const metric = req.body;
  if (!metric || !metric.host) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  io.emit("metric", metric);
  res.sendStatus(200);
});

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("subscribe", (host) => {
    socket.join(`host:${host}`);
    console.log(`${socket.id} subscribed to host:${host}`);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`WebSocket server on :${PORT}`));
