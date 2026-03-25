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
const { SocksClient } = require("socks");

const app = express();

// Middleware de diagnóstico para logar todas as requisições no console do Railway
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ── Security & Middleware ────────────────────────────────────
app.use(express.json({ limit: "100kb" }));
app.use(cors({ origin: "*", credentials: true }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Muitas tentativas de login. Tente novamente em 15 minutos."
});

const metricsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
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
    console.log("Database Professional Restore: OK");
  } catch (e) { console.error("DB Restore Error:", e.message); }
}
initDB();

const JWT_SECRET = process.env.JWT_SECRET || "nexuswatch-secret-key-2024";
const WEBSOCKET_URL = process.env.WEBSOCKET_URL || "http://websocket:3001";

// ── Middlewares ──────────────────────────────────────────────
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

// ── Auth ─────────────────────────────────────────────────────
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

// ── Devices ──────────────────────────────────────────────────
app.get("/devices", auth, async (req, res) => {
  try {
    const cid = clientFilter(req);
    let query = `
      SELECT d.*, c.name as client_name,
        (SELECT latency_ms FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_latency,
        (SELECT cpu FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_cpu,
        (SELECT memory FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_memory,
        (SELECT status FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_status
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
  const { 
    name, description, location, device_type, ip_address, tags, 
    ddns_address, monitor_port, monitor_ping, monitor_agent, notes, client_id,
    snmp_community, snmp_version, ssh_user, ssh_port
  } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  const cid = req.user.role === "superadmin" ? (client_id || null) : req.user.client_id;
  const token = crypto.randomBytes(32).toString("hex");
  try {
    const r = await pool.query(`
      INSERT INTO devices (
        name, description, location, token, device_type, ip_address, tags, 
        ddns_address, monitor_port, monitor_ping, monitor_agent, notes, client_id,
        snmp_community, snmp_version, ssh_user, ssh_port
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *
    `, [
      name, description||"", location||"", token, device_type||"other", ip_address||"", tags||[], 
      ddns_address||"", parseInt(monitor_port)||0, monitor_ping!==false, monitor_agent!==false, notes||"", cid,
      snmp_community||"public", snmp_version||"2c", ssh_user||"", parseInt(ssh_port)||22
    ]);
    res.status(201).json(r.rows[0]);
    if (ddns_address && monitor_port) setImmediate(() => cloudMonitor(r.rows[0].id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/devices/:id", auth, async (req, res) => {
  const { 
    name, description, location, device_type, ip_address, tags, 
    ddns_address, monitor_port, monitor_ping, monitor_agent, notes,
    snmp_community, snmp_version, ssh_user, ssh_port
  } = req.body;
  try {
    const r = await pool.query(`
      UPDATE devices SET 
        name=$1, description=$2, location=$3, device_type=$4, ip_address=$5, tags=$6, 
        ddns_address=$7, monitor_port=$8, monitor_ping=$9, monitor_agent=$10, notes=$11,
        snmp_community=$12, snmp_version=$13, ssh_user=$14, ssh_port=$15
      WHERE id=$16 RETURNING *
    `, [
      name, description||"", location||"", device_type||"other", ip_address||"", tags||[], 
      ddns_address||"", parseInt(monitor_port)||0, monitor_ping!==false, monitor_agent!==false, notes||"",
      snmp_community||"public", snmp_version||"2c", ssh_user||"", parseInt(ssh_port)||22,
      req.params.id
    ]);
    res.json(r.rows[0]);
    if (ddns_address && monitor_port) setImmediate(() => cloudMonitor(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/devices/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM devices WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/devices/:id/regenerate-token", auth, async (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  const r = await pool.query("UPDATE devices SET token=$1 WHERE id=$2 RETURNING token", [token, req.params.id]);
  res.json({ token: r.rows[0].token });
});

app.post("/devices/:id/test", auth, async (req, res) => {
  try {
    const dr = await pool.query("SELECT ip_address, ddns_address, monitor_port FROM devices WHERE id=$1", [req.params.id]);
    const { ip_address, ddns_address, monitor_port } = dr.rows[0];
    const targetHost = ddns_address || ip_address;
    
    if (!targetHost || !monitor_port) return res.status(400).json({ error: "Endereço (IP/DDNS) ou Porta não configurados" });
    
    const socket = new net.Socket();
    socket.setTimeout(8000);
    socket.on("connect", () => { socket.destroy(); res.json({ alive: true, message: `Conectado com sucesso em ${targetHost}:${monitor_port}!` }); });
    socket.on("timeout", () => { socket.destroy(); res.json({ alive: false, message: `Timeout ao tentar conectar em ${targetHost}:${monitor_port}.` }); });
    socket.on("error", (err) => { socket.destroy(); res.json({ alive: false, message: `Erro de conexão (${err.code}) em ${targetHost}:${monitor_port}.` }); });
    socket.connect(monitor_port, targetHost);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Clients ──────────────────────────────────────────────────
app.get("/clients", auth, superadmin, async (req, res) => {
  const r = await pool.query("SELECT * FROM clients ORDER BY name");
  res.json(r.rows);
});

app.post("/clients", auth, superadmin, async (req, res) => {
  const { name, document, email, phone, plan, status } = req.body;
  const r = await pool.query("INSERT INTO clients (name, document, email, phone, plan, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [name, document||"", email||"", phone||"", plan||"basic", status||"active"]);
  res.status(201).json(r.rows[0]);
});

app.put("/clients/:id", auth, superadmin, async (req, res) => {
  const { name, document, email, phone, plan, status } = req.body;
  const r = await pool.query("UPDATE clients SET name=$1, document=$2, email=$3, phone=$4, plan=$5, status=$6 WHERE id=$7 RETURNING *", [name, document, email, phone, plan, status, req.params.id]);
  res.json(r.rows[0]);
});

app.delete("/clients/:id", auth, superadmin, async (req, res) => {
  await pool.query("DELETE FROM clients WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/clients/:id/users", auth, superadmin, async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO users (username, password_hash, role, client_id) VALUES ($1,$2,'client',$3)", [username, hash, req.params.id]);
  res.json({ ok: true });
});

// ── Metrics ──────────────────────────────────────────────────
app.get("/metrics/:host", auth, async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const r = await pool.query(`
    SELECT * FROM metrics 
    WHERE host=$1 AND time > NOW() - interval '${hours} hours'
    ORDER BY time ASC
  `, [req.params.host]);
  res.json(r.rows);
});

app.get("/alerts", auth, async (req, res) => {
  const cid = clientFilter(req);
  let query = `
    SELECT m.*, d.name as device_name, c.name as client_name
    FROM metrics m
    JOIN devices d ON d.id = m.device_id
    JOIN clients c ON c.id = d.client_id
    WHERE m.status = 'offline' AND m.time > NOW() - interval '24 hours'
  `;
  const params = [];
  if (cid) { params.push(cid); query += ` AND d.client_id=$1`; }
  query += " ORDER BY m.time DESC LIMIT 50";
  const r = await pool.query(query, params);
  res.json(r.rows.map(row => ({ ...row, alert_type: 'offline' })));
});

app.post("/metrics", metricsLimiter, async (req, res) => {
  const token = req.headers["x-device-token"] || req.body.device_token;
  const { host, cpu, memory, latency_ms, status } = req.body;
  try {
    const dr = await pool.query("SELECT id, client_id FROM devices WHERE token=$1", [token]);
    if (dr.rows.length === 0) return res.status(401).json({ error: "Invalid token" });
    const devId = dr.rows[0].id;
    const cid = dr.rows[0].client_id;
    await pool.query("UPDATE devices SET status=$1, last_seen=NOW() WHERE id=$2", [status||"online", devId]);
    const hr = await pool.query("INSERT INTO hosts (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id", [host]);
    await pool.query("INSERT INTO metrics (time, host_id, host, device_id, cpu, memory, latency_ms) VALUES (NOW(), $1, $2, $3, $4, $5, $6)", 
      [hr.rows[0].id, host, devId, cpu||0, memory||0, latency_ms||0]);
    
    // Publish to WebSocket
    fetch(`${WEBSOCKET_URL}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, cpu, memory, latency_ms, device_id: devId, client_id: cid, time: new Date().toISOString() }),
    }).catch(() => {});

    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Utils ────────────────────────────────────────────────────
app.get("/stats", auth, async (req, res) => {
  const cid = clientFilter(req);
  const filter = cid ? `WHERE client_id=${cid}` : "";
  const total = await pool.query(`SELECT COUNT(*) FROM devices ${filter}`);
  const online = await pool.query(`SELECT COUNT(*) FROM devices ${filter ? (filter + " AND") : "WHERE"} status='online'`);
  const clients = await pool.query("SELECT COUNT(*) FROM clients");
  const totalCount = parseInt(total.rows[0].count);
  const onlineCount = parseInt(online.rows[0].count);
  res.json({ devices: totalCount, online: onlineCount, offline: totalCount - onlineCount, clients: parseInt(clients.rows[0].count) });
});

app.get("/tags", auth, async (req, res) => {
  const r = await pool.query("SELECT DISTINCT unnest(tags) as tag FROM devices");
  res.json(r.rows.map(x => x.tag));
});

app.get("/device-types", auth, (req, res) => res.json([
  { value: "server", label: "Servidor", icon: "🖥️" },
  { value: "camera", label: "Câmera IP", icon: "📷" },
  { value: "router", label: "Roteador", icon: "🌐" },
  { value: "switch", label: "Switch", icon: "🔀" },
  { value: "other", label: "Outro", icon: "📦" }
]));

// ── Cloud Monitor Logic (SSTP/VPN/Subnet Support) ────────────
async function cloudMonitor(deviceId = null) {
  try {
    const query = deviceId ? 
      ["SELECT * FROM devices WHERE id=$1", [deviceId]] : 
      ["SELECT * FROM devices WHERE (ddns_address != '' AND monitor_port > 0) OR (ip_address != '' AND monitor_port > 0)", []];
    
    const r = await pool.query(...query);
    
    for (const dev of r.rows) {
      const start = Date.now();
      const targetHost = dev.ddns_address || dev.ip_address;
      if (!targetHost || !dev.monitor_port) continue;

      const isPrivate = targetHost.startsWith("192.168.") || targetHost.startsWith("10.") || targetHost.startsWith("172.");
      
      const updateStatus = async (status, latency = 0, error = null) => {
        const notePrefix = isPrivate ? "🛡️ VPN " : "☁️ Cloud ";
        await pool.query("UPDATE devices SET status=$1, last_seen=NOW(), notes=$2 WHERE id=$3", [status, error ? `${notePrefix}Error: ${error}` : `${notePrefix}OK`, dev.id]);
        await pool.query("INSERT INTO metrics (time, host, device_id, latency_ms, status) VALUES (NOW(), $1, $2, $3, $4)", [targetHost, dev.id, latency, status]);
      };

      if (false) { // VPN desativada temporariamente para estabilidade
      } else {
        // Conexão direta (DDNS ou IP Público)
        const socket = new net.Socket();
        socket.setTimeout(8000);
        socket.on("connect", () => { socket.destroy(); updateStatus("online", Date.now() - start); });
        socket.on("timeout", () => { socket.destroy(); updateStatus("offline", 0, "Timeout"); });
        socket.on("error", (err) => { socket.destroy(); updateStatus("offline", 0, err.code); });
        socket.connect(dev.monitor_port, targetHost);
      }
    }
  } catch (e) { console.error("Cloud Monitor Error:", e.message); }
}
setInterval(cloudMonitor, 60000);

app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("Professional API RESTORED"));
