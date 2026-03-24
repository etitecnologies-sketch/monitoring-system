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
app.use(express.json({ limit: "100kb" }));
app.use(cors({ origin: "*", credentials: true }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Muitas tentativas de login. Tente novamente em 15 minutos."
});

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ── Database Initialization (Professional) ───────────────────
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
    
    // Migrações profissionais (Garante que colunas novas existam sem apagar dados)
    const migrations = [
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS ddns_address TEXT DEFAULT ''",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS monitor_port INT DEFAULT 0",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS monitor_agent BOOLEAN DEFAULT TRUE",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS monitor_ping BOOLEAN DEFAULT TRUE",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS monitor_snmp BOOLEAN DEFAULT FALSE"
    ];
    for (let m of migrations) { await pool.query(m).catch(() => {}); }

    console.log("Database initialized & Migrated successfully");
  } catch (e) { console.error("DB Init Error:", e.message); }
}
initDB();

const JWT_SECRET = process.env.JWT_SECRET || "nexuswatch-secret-key-2024";
const WEBSOCKET_URL = process.env.WEBSOCKET_URL || "http://websocket:3001";

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

// ── API Routes ───────────────────────────────────────────────

app.get("/health", (req, res) => res.json({ status: "ok" }));

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

// Devices (Professional & Full Support)
app.get("/devices", auth, async (req, res) => {
  try {
    const cid = clientFilter(req);
    let query = `
      SELECT d.*, c.name as client_name,
        (SELECT latency_ms FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_latency,
        (SELECT cpu FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_cpu,
        (SELECT memory FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_memory
      FROM devices d
      LEFT JOIN clients c ON c.id = d.client_id
      WHERE 1=1
    `;
    const params = [];
    if (cid) { params.push(cid); query += ` AND d.client_id=$1`; }
    query += " ORDER BY d.created_at DESC";
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
  const { 
    name, description, location, device_type, ip_address, tags, 
    ddns_address, monitor_port, monitor_ping, monitor_agent, notes 
  } = req.body;
  try {
    const r = await pool.query(`
      UPDATE devices SET 
        name=$1, description=$2, location=$3, device_type=$4, ip_address=$5, 
        tags=$6, ddns_address=$7, monitor_port=$8, monitor_ping=$9, 
        monitor_agent=$10, notes=$11
      WHERE id=$12 RETURNING *
    `, [
      name, description||"", location||"", device_type||"other", ip_address||"", 
      tags||[], ddns_address||"", parseInt(monitor_port)||0, 
      monitor_ping!==false, monitor_agent!==false, notes||"", 
      req.params.id
    ]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Device not found" });
    res.json(r.rows[0]);
    if (ddns_address && monitor_port) setImmediate(() => cloudMonitor(req.params.id));
  } catch (e) { 
    console.error("Update Device Error:", e.message);
    res.status(500).json({ error: e.message }); 
  }
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
    socket.on("connect", () => { socket.destroy(); res.json({ alive: true, message: "Cloud connection successful!" }); });
    socket.on("timeout", () => { socket.destroy(); res.json({ alive: false, message: "Connection timed out." }); });
    socket.on("error", (err) => { socket.destroy(); res.json({ alive: false, message: `Error: ${err.code}` }); });
    socket.connect(monitor_port, ddns_address);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cloud Monitor Logic (Background)
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

app.get("/stats", auth, async (req, res) => {
  const cid = clientFilter(req);
  const filter = cid ? `WHERE client_id=${cid}` : "";
  const total = await pool.query(`SELECT COUNT(*) FROM devices ${filter}`);
  const online = await pool.query(`SELECT COUNT(*) FROM devices ${filter ? filter + " AND" : "WHERE"} status='online'`);
  res.json({ devices: parseInt(total.rows[0].count), online: parseInt(online.rows[0].count) });
});

// Clients (Superadmin only)
app.get("/clients", auth, superadmin, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clients ORDER BY created_at DESC");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/clients", auth, superadmin, async (req, res) => {
  const { name, document, email, phone, address, city, state, plan, status, telegram_token, telegram_chat_id, alert_email, notes } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  try {
    const r = await pool.query(`
      INSERT INTO clients (name, document, email, phone, address, city, state, plan, status, telegram_token, telegram_chat_id, alert_email, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [name, document||"", email||"", phone||"", address||"", city||"", state||"", plan||"basic", status||"active", telegram_token||"", telegram_chat_id||"", alert_email||"", notes||""]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/clients/:id", auth, superadmin, async (req, res) => {
  const { name, document, email, phone, address, city, state, plan, status, telegram_token, telegram_chat_id, alert_email, notes } = req.body;
  try {
    const r = await pool.query(`
      UPDATE clients SET name=$1, document=$2, email=$3, phone=$4, address=$5, city=$6, state=$7, plan=$8, status=$9, 
        telegram_token=$10, telegram_chat_id=$11, alert_email=$12, notes=$13
      WHERE id=$14 RETURNING *
    `, [name, document||"", email||"", phone||"", address||"", city||"", state||"", plan||"basic", status||"active", 
        telegram_token||"", telegram_chat_id||"", alert_email||"", notes||"", req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/clients/:id", auth, superadmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM clients WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("Professional Ingest API Running"));
