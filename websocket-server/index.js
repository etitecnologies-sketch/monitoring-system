const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || "nexuswatch-secret-key-2024";
const PORT = process.env.PORT || 3001;
const WS_REQUIRE_AUTH = String(process.env.WS_REQUIRE_AUTH || "").toLowerCase() === "true" || process.env.WS_REQUIRE_AUTH === "1";
const WS_PUBLISH_KEY = process.env.WS_PUBLISH_KEY || process.env.PUBLISH_KEY || "";

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
  if (WS_PUBLISH_KEY) {
    const key = String(req.headers["x-internal-key"] || "");
    if (!key || key !== WS_PUBLISH_KEY) return res.status(401).json({ error: "Unauthorized" });
  }

  const metric = req.body;
  const host = metric?.host || metric?.name;

  // Validate payload
  if (!metric || !host) {
    return res.status(400).json({ error: "Missing required fields: host" });
  }

  try {
    const clientId = metric.client_id != null ? String(metric.client_id) : null;
    const isEvent = String(metric.type || "").toUpperCase() === "EVENT";
    const payload = { ...metric, host };

    const rooms = [];
    if (clientId) {
      rooms.push(`client:${clientId}:host:${host}`);
      rooms.push(`client:${clientId}:all`);
    }
    rooms.push(`host:${host}`);

    for (const roomName of rooms) {
      io.to(roomName).emit(isEvent ? "event" : "metric", payload);
    }

    // Log metric publishing
    console.log(`[${new Date().toISOString()}] Published ${isEvent ? "event" : "metric"}:`, {
      host,
      client_id: clientId,
    });

    res.json({
      ok: true,
      rooms,
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
io.use((socket, next) => {
  const headerAuth = socket.handshake.headers?.authorization || socket.handshake.headers?.Authorization || "";
  const headerToken = typeof headerAuth === "string" && headerAuth.startsWith("Bearer ") ? headerAuth.slice(7) : "";
  const authToken = socket.handshake.auth?.token;
  const token = authToken || headerToken || "";

  if (!token) {
    if (WS_REQUIRE_AUTH) return next(new Error("Unauthorized"));
    socket.user = null;
    return next();
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch {
    if (WS_REQUIRE_AUTH) return next(new Error("Unauthorized"));
    socket.user = null;
    next();
  }
});

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

    const user = socket.user;
    if (!user) {
      if (callback) callback({ error: "Unauthorized" });
      return;
    }

    const hostRoom = user.role === "superadmin" ? `host:${host}` : `client:${user.client_id}:host:${host}`;
    socket.join(hostRoom);
    const client = connectedClients.get(clientId);
    if (client) {
      client.subscriptions.add(host);
    }

    console.log(`[${new Date().toISOString()}] 📡 ${clientId} subscribed to ${hostRoom}`);

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
    const user = socket.user;
    const hostRoom = !user ? `host:${host}` : (user.role === "superadmin" ? `host:${host}` : `client:${user.client_id}:host:${host}`);
    socket.leave(hostRoom);
    const client = connectedClients.get(clientId);
    if (client) {
      client.subscriptions.delete(host);
    }

    console.log(`[${new Date().toISOString()}] 🚫 ${clientId} unsubscribed from ${hostRoom}`);

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
