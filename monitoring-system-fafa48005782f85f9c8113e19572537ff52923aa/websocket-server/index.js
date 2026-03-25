const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || "changeme-secret-jwt";
const PORT = process.env.PORT || 3001;

// Socket.IO with CORS and advanced options
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
  pingInterval: 30000,
  pingTimeout: 10000,
});

// Track connected sockets
const connectedClients = new Map();
const clientMetrics = new Map();

// ✅ Health probe endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    connectedClients: connectedClients.size,
    totalRooms: io.sockets.adapter.rooms.size,
  });
});

// ✅ Readiness endpoint
app.get("/ready", (req, res) => {
  res.json({ status: "ready" });
});

// ✅ Publish metrics endpoint (called by ingest-api)
app.post("/publish", (req, res) => {
  const metric = req.body;

  // Validate payload
  if (!metric || !metric.host) {
    return res.status(400).json({ error: "Missing required fields: host" });
  }

  try {
    // Broadcast to all subscribers of this host
    const roomName = `host:${metric.host}`;
    io.to(roomName).emit("metric", metric);

    // Log metric publishing
    console.log(`[${new Date().toISOString()}] Published to ${roomName}:`, {
      cpu: metric.cpu?.toFixed(1),
      memory: metric.memory?.toFixed(1),
      recipients: io.rooms.get(roomName)?.size || 0,
    });

    // Also emit to all clients (for dashboard updates)
    io.emit("metric:all", metric);

    res.json({
      ok: true,
      recipients: io.rooms.get(roomName)?.size || 0,
    });
  } catch (err) {
    console.error("Error publishing metric:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get current metrics endpoint
app.get("/metrics/:host", (req, res) => {
  const { host } = req.params;
  const metrics = clientMetrics.get(host);

  if (!metrics) {
    return res.status(404).json({ error: "No metrics for this host" });
  }

  res.json(metrics);
});

// ✅ Error handling middleware
app.use((err, req, res, next) => {
  console.error("Express error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  const clientId = socket.id;
  const clientIp = socket.handshake.address;

  console.log(`[${new Date().toISOString()}] ✓ Client connected: ${clientId} from ${clientIp}`);
  connectedClients.set(clientId, {
    id: clientId,
    IP: clientIp,
    connectedAt: new Date(),
    subscriptions: new Set(),
  });

  // Send connected acknowledgment
  socket.emit("connected", {
    id: clientId,
    timestamp: new Date().toISOString(),
  });

  // Handle subscription to host metrics
  socket.on("subscribe", (host, callback) => {
    if (!host) {
      if (callback) callback({ error: "Host parameter required" });
      return;
    }

    socket.join(`host:${host}`);
    const client = connectedClients.get(clientId);
    if (client) {
      client.subscriptions.add(host);
    }

    console.log(`[${new Date().toISOString()}] 📡 ${clientId} subscribed to host:${host}`);

    if (callback) {
      callback({ ok: true, host });
    }

    // Emit subscription confirmation to client
    socket.emit("subscribed", {
      host,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle unsubscribe
  socket.on("unsubscribe", (host, callback) => {
    socket.leave(`host:${host}`);
    const client = connectedClients.get(clientId);
    if (client) {
      client.subscriptions.delete(host);
    }

    console.log(`[${new Date().toISOString()}] 🚫 ${clientId} unsubscribed from host:${host}`);

    if (callback) {
      callback({ ok: true, host });
    }
  });

  // Handle ping (for keep-alive)
  socket.on("ping", (callback) => {
    if (callback) {
      callback({ pong: true, timestamp: new Date().toISOString() });
    }
  });

  // Error handling
  socket.on("error", (error) => {
    console.error(`Socket error from ${clientId}:`, error);
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    const client = connectedClients.get(clientId);
    const subs = client ? Array.from(client.subscriptions) : [];

    console.log(
      `[${new Date().toISOString()}] ✗ Client disconnected: ${clientId} (${reason}), was subscribed to: ${subs.join(", ")}`
    );

    connectedClients.delete(clientId);
    clientMetrics.delete(clientId);
  });

  // Handle reconnection
  socket.on("reconnect", () => {
    console.log(`[${new Date().toISOString()}] ⟳ Client reconnected: ${clientId}`);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║     WebSocket Metrics Server          ║`);
  console.log(`║     Running on port ${PORT}                  ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});
