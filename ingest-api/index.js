const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const net = require("net");
const dns = require("dns").promises;

const app = express();

// ── Security & Middleware ────────────────────────────────────
app.use(express.json({ limit: "50kb" }));
app.use(cors({ origin: "*", credentials: true }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Muitas tentativas de login. Tente novamente em 15 minutos."
});

const metricsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  skip: (req) => req.headers["x-device-token"],
});

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ── Database Initialization ──────────────────────────────────
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
          id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, document TEXT DEFAULT '',
          email TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '',
          city TEXT DEFAULT '', state TEXT DEFAULT '', plan TEXT DEFAULT 'basic',
          status TEXT DEFAULT 'active', telegram_token TEXT DEFAULT '',
          telegram_chat_id TEXT DEFAULT '', alert_email TEXT DEFAULT '',
          notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'client', client_id INT REFERENCES clients(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS hosts (
          id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS devices (
          id SERIAL PRIMARY KEY, name TEXT NOT NULL, hostname TEXT UNIQUE,
          token TEXT NOT NULL UNIQUE, client_id INT REFERENCES clients(id) ON DELETE CASCADE,
          ip_address TEXT DEFAULT '', device_type TEXT DEFAULT 'server', tags TEXT[] DEFAULT '{}',
          description TEXT DEFAULT '', location TEXT DEFAULT '', status TEXT DEFAULT 'pending',
          last_seen TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
          snmp_community TEXT DEFAULT 'public', snmp_version TEXT DEFAULT '2c',
          ssh_user TEXT, ssh_port INT DEFAULT 22, monitor_ping BOOLEAN DEFAULT TRUE,
          monitor_snmp BOOLEAN DEFAULT FALSE, monitor_agent BOOLEAN DEFAULT TRUE,
          ddns_address TEXT DEFAULT '', monitor_port INT DEFAULT 0, notes TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS metrics (
          id BIGSERIAL PRIMARY KEY, time TIMESTAMPTZ NOT NULL, host_id INT REFERENCES hosts(id) ON DELETE CASCADE,
          host TEXT NOT NULL, device_id INT REFERENCES devices(id) ON DELETE SET NULL,
          cpu FLOAT DEFAULT 0, memory FLOAT DEFAULT 0, disk_percent FLOAT DEFAULT 0,
          latency_ms FLOAT DEFAULT 0, status TEXT DEFAULT 'online'
      );
    `);
    console.log("Database initialized");
  } catch (e) { console.error("DB Init Error:", e.message); }
}
initDB();

const JWT_SECRET = process.env.JWT_SECRET || "nexuswatch-secret-key-2024";
const WEBSOCKET_URL = process.env.WEBSOCKET_URL || "http://websocket:3001";

function logger(level, msg, data = {}) {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`, data);
}

// ── Auth Middleware ──────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token required" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (e) { res.status(401).json({ error: "Invalid token" }); }
}

function superadmin(req, res, next) {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "Superadmin only" });
  next();
}

function clientFilter(req) {
  return req.user.role === "superadmin" ? (req.query.client_id ? parseInt(req.query.client_id) : null) : req.user.client_id;
}

// ── Routes ───────────────────────────────────────────────────

// Health & Setup
app.get("/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok" }); }
  catch (e) { res.status(500).json({ status: "error", error: e.message }); }
});

app.get("/auth/status", async (req, res) => {
  const r = await pool.query("SELECT id FROM users LIMIT 1");
  res.json({ setupDone: r.rows.length > 0 });
});

app.post("/auth/setup", async (req, res) => {
  const { username, password } = req.body;
  const exists = await pool.query("SELECT id FROM users LIMIT 1");
  if (exists.rows.length > 0) return res.status(409).json({ error: "Setup already done" });
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'superadmin')", [username, hash]);
  res.json({ ok: true });
});

app.post("/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const r = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id, username, role: user.role, client_id: user.client_id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, role: user.role, client_id: user.client_id });
});

app.get("/auth/me", auth, (req, res) => res.json(req.user));

// Devices
app.get("/devices", auth, async (req, res) => {
  try {
    const cid = clientFilter(req);
    let query = "SELECT * FROM devices WHERE 1=1";
    const params = [];
    if (cid) { params.push(cid); query += ` AND client_id=$1`; }
    query += " ORDER BY created_at DESC";
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/devices", auth, async (req, res) => {
  const { name, description, location, device_type, ip_address, tags, ddns_address, monitor_port, client_id } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  const cid = req.user.role === "superadmin" ? (client_id || null) : req.user.client_id;
  const token = crypto.randomBytes(32).toString("hex");
  try {
    const r = await pool.query(`
      INSERT INTO devices (name, description, location, token, device_type, ip_address, tags, ddns_address, monitor_port, client_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [name, description||"", location||"", token, device_type||"other", ip_address||"", tags||[], ddns_address||"", parseInt(monitor_port)||0, cid]);
    res.status(201).json(r.rows[0]);
    if (ddns_address && monitor_port) setImmediate(() => cloudMonitor(r.rows[0].id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/devices/:id", auth, async (req, res) => {
  const { name, description, location, device_type, ip_address, tags, ddns_address, monitor_port, notes } = req.body;
  try {
    const r = await pool.query(`
      UPDATE devices SET name=$1, description=$2, location=$3, device_type=$4, ip_address=$5, tags=$6, ddns_address=$7, monitor_port=$8, notes=$9
      WHERE id=$10 RETURNING *
    `, [name, description||"", location||"", device_type||"other", ip_address||"", tags||[], ddns_address||"", parseInt(monitor_port)||0, notes||"", req.params.id]);
    res.json(r.rows[0]);
    if (ddns_address && monitor_port) setImmediate(() => cloudMonitor(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/devices/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM devices WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/devices/:id/test", auth, async (req, res) => {
  try {
    const dr = await pool.query("SELECT ddns_address, monitor_port FROM devices WHERE id=$1", [req.params.id]);
    const { ddns_address, monitor_port } = dr.rows[0];
    if (!ddns_address || !monitor_port) return res.status(400).json({ error: "DDNS/Port not set" });
    
    const socket = new net.Socket();
    socket.setTimeout(8000);
    socket.on("connect", () => { socket.destroy(); res.json({ alive: true, message: "Conectado com sucesso!" }); });
    socket.on("timeout", () => { socket.destroy(); res.json({ alive: false, message: "Tempo esgotado." }); });
    socket.on("error", (err) => { socket.destroy(); res.json({ alive: false, message: `Erro: ${err.code}` }); });
    socket.connect(monitor_port, ddns_address);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cloud Monitor Logic
async function cloudMonitor(deviceId = null) {
  try {
    const query = deviceId ? ["SELECT * FROM devices WHERE id=$1", [deviceId]] : ["SELECT * FROM devices WHERE ddns_address != '' AND monitor_port > 0", []];
    const r = await pool.query(...query);
    for (const dev of r.rows) {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.on("connect", async () => {
        socket.destroy();
        await pool.query("UPDATE devices SET status='online', last_seen=NOW() WHERE id=$1", [dev.id]);
      });
      socket.on("error", async () => {
        socket.destroy();
        await pool.query("UPDATE devices SET status='offline' WHERE id=$1", [dev.id]);
      });
      socket.connect(dev.monitor_port, dev.ddns_address);
    }
  } catch (e) { console.error("Cloud Monitor Error:", e.message); }
}
setInterval(cloudMonitor, 60000);

// Metrics
app.post("/metrics", metricsLimiter, async (req, res) => {
  const token = req.headers["x-device-token"];
  const { host, cpu, memory, latency_ms, status } = req.body;
  try {
    const dr = await pool.query("SELECT id FROM devices WHERE token=$1", [token]);
    if (dr.rows.length === 0) return res.status(401).json({ error: "Invalid token" });
    const devId = dr.rows[0].id;
    await pool.query("UPDATE devices SET status=$1, last_seen=NOW() WHERE id=$2", [status||"online", devId]);
    const hr = await pool.query("INSERT INTO hosts (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id", [host]);
    await pool.query("INSERT INTO metrics (time, host_id, host, device_id, cpu, memory, latency_ms) VALUES (NOW(), $1, $2, $3, $4, $5, $6)", 
      [hr.rows[0].id, host, devId, cpu||0, memory||0, latency_ms||0]);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/stats", auth, async (req, res) => {
  const cid = clientFilter(req);
  const filter = cid ? `WHERE client_id=${cid}` : "";
  const total = await pool.query(`SELECT COUNT(*) FROM devices ${filter}`);
  const online = await pool.query(`SELECT COUNT(*) FROM devices ${filter ? filter + " AND" : "WHERE"} status='online'`);
  res.json({ devices: parseInt(total.rows[0].count), online: parseInt(online.rows[0].count) });
});

// Final Handlers
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("API Running"));
