const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const net = require("net");

const app = express();

// ── Security & Middleware ────────────────────────────────────
app.use(express.json({ limit: "10kb" })); // Limit payload size
app.use(cors({ 
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true,
  optionsSuccessStatus: 200
}));

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per windowMs
  message: "Too many login attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

const metricsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  skip: (req) => req.headers["x-device-token"], // Skip for authenticated agents
});

// Database connection pool
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ── Auto-Schema Initialization ───────────────────────────────
async function initDB() {
  try {
    logger("INFO", "Initializing database schema...");
    
    // Create tables in correct order
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
          id                SERIAL PRIMARY KEY,
          name              TEXT NOT NULL UNIQUE,
          document          TEXT    DEFAULT '',
          email             TEXT    DEFAULT '',
          phone             TEXT    DEFAULT '',
          address           TEXT    DEFAULT '',
          city              TEXT    DEFAULT '',
          state             TEXT    DEFAULT '',
          plan              TEXT    DEFAULT 'basic',
          status            TEXT    DEFAULT 'active',
          telegram_token    TEXT    DEFAULT '',
          telegram_chat_id  TEXT    DEFAULT '',
          alert_email       TEXT    DEFAULT '',
          notes             TEXT    DEFAULT '',
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          username      TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL DEFAULT 'client',
          client_id     INT  REFERENCES clients(id) ON DELETE CASCADE,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS hosts (
          id         SERIAL PRIMARY KEY,
          name       TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS devices (
          id            SERIAL PRIMARY KEY,
          name          TEXT NOT NULL,
          hostname      TEXT UNIQUE,
          token         TEXT NOT NULL UNIQUE,
          client_id     INT  REFERENCES clients(id) ON DELETE CASCADE,
          ip_address    TEXT    DEFAULT '',
          device_type   TEXT    DEFAULT 'server',
          tags          TEXT[]  DEFAULT '{}',
          description   TEXT    DEFAULT '',
          location      TEXT    DEFAULT '',
          status        TEXT    DEFAULT 'pending',
          last_seen     TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          snmp_community TEXT DEFAULT 'public',
          snmp_version   TEXT DEFAULT '2c',
          ssh_user       TEXT,
          ssh_port       INT DEFAULT 22,
          monitor_ping   BOOLEAN DEFAULT TRUE,
          monitor_snmp   BOOLEAN DEFAULT FALSE,
          monitor_agent  BOOLEAN DEFAULT TRUE,
          ddns_address   TEXT DEFAULT '',
          monitor_port   INT DEFAULT 0,
          notes          TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS metrics (
          id              BIGSERIAL PRIMARY KEY,
          time            TIMESTAMPTZ      NOT NULL,
          host_id         INT              REFERENCES hosts(id) ON DELETE CASCADE,
          host            TEXT             NOT NULL,
          device_id       INT              REFERENCES devices(id) ON DELETE SET NULL,
          cpu             DOUBLE PRECISION NOT NULL DEFAULT 0,
          memory          DOUBLE PRECISION NOT NULL DEFAULT 0,
          disk_used       BIGINT           NOT NULL DEFAULT 0,
          disk_total      BIGINT           NOT NULL DEFAULT 0,
          disk_percent    DOUBLE PRECISION NOT NULL DEFAULT 0,
          net_rx_bytes    BIGINT           NOT NULL DEFAULT 0,
          net_tx_bytes    BIGINT           NOT NULL DEFAULT 0,
          latency_ms      DOUBLE PRECISION NOT NULL DEFAULT 0,
          uptime_seconds  BIGINT           NOT NULL DEFAULT 0,
          load_avg        DOUBLE PRECISION NOT NULL DEFAULT 0,
          processes       INT              NOT NULL DEFAULT 0,
          temperature     DOUBLE PRECISION NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS triggers (
          id          SERIAL PRIMARY KEY,
          name        TEXT    NOT NULL,
          expression  TEXT    NOT NULL,
          threshold   FLOAT   NOT NULL,
          enabled     BOOLEAN NOT NULL DEFAULT TRUE,
          device_type TEXT,
          tags        TEXT[]  DEFAULT '{}',
          client_id   INT     REFERENCES clients(id) ON DELETE CASCADE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alerts (
          id          SERIAL PRIMARY KEY,
          trigger_id  INT   REFERENCES triggers(id) ON DELETE CASCADE,
          device_id   INT   REFERENCES devices(id) ON DELETE SET NULL,
          client_id   INT   REFERENCES clients(id) ON DELETE CASCADE,
          host        TEXT  NOT NULL,
          expression  TEXT  NOT NULL,
          value       FLOAT NOT NULL,
          threshold   FLOAT NOT NULL,
          fired_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
      );
    `);

    // Migration helper: Add missing columns to existing tables
    const tables = {
      clients: ['document', 'email', 'phone', 'address', 'city', 'state', 'plan', 'status', 'telegram_token', 'telegram_chat_id', 'alert_email', 'notes'],
      users: ['role', 'client_id'],
      devices: ['client_id', 'ip_address', 'device_type', 'tags', 'snmp_community', 'snmp_version', 'ssh_user', 'ssh_port', 'monitor_ping', 'monitor_snmp', 'monitor_agent', 'ddns_address', 'monitor_port', 'notes'],
      metrics: ['host_id', 'disk_used', 'disk_total', 'net_rx_bytes', 'net_tx_bytes', 'load_avg', 'processes', 'temperature', 'status'],
      triggers: ['device_type', 'tags', 'client_id'],
      alerts: ['client_id']
    };

    for (const [table, columns] of Object.entries(tables)) {
      for (const col of columns) {
        await pool.query(`
          DO $$ 
          BEGIN 
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${table}' AND column_name='${col}') THEN
              ALTER TABLE ${table} ADD COLUMN ${col} TEXT; -- Default to TEXT, adjust types below
            END IF;
          END $$;
        `);
      }
    }

    // Fix types for migrated columns
    await pool.query(`
      ALTER TABLE users ALTER COLUMN client_id TYPE INT USING client_id::integer;
      ALTER TABLE devices ALTER COLUMN client_id TYPE INT USING client_id::integer;
      ALTER TABLE devices ALTER COLUMN ssh_port TYPE INT USING ssh_port::integer;
      ALTER TABLE devices ALTER COLUMN monitor_port TYPE INT USING monitor_port::integer;
      ALTER TABLE devices ALTER COLUMN monitor_ping TYPE BOOLEAN USING monitor_ping::boolean;
      ALTER TABLE devices ALTER COLUMN monitor_snmp TYPE BOOLEAN USING monitor_snmp::boolean;
      ALTER TABLE devices ALTER COLUMN monitor_agent TYPE BOOLEAN USING monitor_agent::boolean;
      ALTER TABLE metrics ALTER COLUMN host_id TYPE INT USING host_id::integer;
      ALTER TABLE metrics ALTER COLUMN disk_used TYPE BIGINT USING disk_used::bigint;
      ALTER TABLE metrics ALTER COLUMN disk_total TYPE BIGINT USING disk_total::bigint;
      ALTER TABLE metrics ALTER COLUMN net_rx_bytes TYPE BIGINT USING net_rx_bytes::bigint;
      ALTER TABLE metrics ALTER COLUMN net_tx_bytes TYPE BIGINT USING net_tx_bytes::bigint;
      ALTER TABLE metrics ALTER COLUMN load_avg TYPE DOUBLE PRECISION USING load_avg::double precision;
      ALTER TABLE metrics ALTER COLUMN processes TYPE INT USING processes::integer;
      ALTER TABLE metrics ALTER COLUMN temperature TYPE DOUBLE PRECISION USING temperature::double precision;
      ALTER TABLE triggers ALTER COLUMN client_id TYPE INT USING client_id::integer;
      ALTER TABLE alerts ALTER COLUMN client_id TYPE INT USING client_id::integer;
    `).catch(() => {}); // Ignore errors if already correct type

    logger("INFO", "Database schema and migrations complete");
  } catch (e) {
    logger("ERROR", "Failed to initialize database", { error: e.message });
  }
}
initDB();

const JWT_SECRET = process.env.JWT_SECRET || "changeme-secret-jwt";
const WEBSOCKET_URL = process.env.WEBSOCKET_URL || "http://websocket:3001";

// ── Logger ───────────────────────────────────────────────────
function logger(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}]`, message, data);
}

// ── Auth middleware ───────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token required" });
  try { 
    req.user = jwt.verify(token, JWT_SECRET); 
    next(); 
  } catch (e) { 
    logger("WARN", "Invalid token attempt");
    res.status(401).json({ error: "Invalid token" }); 
  }
}

// Superadmin only
function superadmin(req, res, next) {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Superadmin only" });
  next();
}

// Filter by client_id
function clientFilter(req) {
  if (req.user.role === "superadmin") {
    return req.query.client_id ? parseInt(req.query.client_id) : null;
  }
  return req.user.client_id;
}

// Health check
app.get("/health", async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    logger("ERROR", "Health check failed", { error: err.message });
    res.status(500).json({ 
      status: "error", 
      database: "disconnected", 
      message: err.message,
      tip: "Verifique se a DATABASE_URL no Railway está correta e aponta para o banco real."
    });
  }
});

app.get("/ready", async (req, res) => {
  try { 
    await pool.query("SELECT 1"); 
    res.json({ status: "ready", timestamp: new Date().toISOString() }); 
  } catch (e) { 
    logger("ERROR", "Readiness check failed");
    res.status(503).json({ status: "not ready", error: e.message }); 
  }
});

// ── Auth ─────────────────────────────────────────────────────
app.get("/auth/status", async (req, res) => {
  try {
    const r = await pool.query("SELECT id FROM users LIMIT 1");
    res.json({ setupDone: r.rows.length > 0 });
  } catch (e) {
    logger("ERROR", "Auth status check failed");
    res.status(500).json({ error: e.message });
  }
});

app.post("/auth/setup", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Required" });
  try {
    const exists = await pool.query("SELECT id FROM users LIMIT 1");
    if (exists.rows.length > 0) return res.status(409).json({ error: "Setup done" });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'superadmin')",
      [username, hash]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign(
      { id: user.id, username, role: user.role, client_id: user.client_id },
      JWT_SECRET, { expiresIn: "7d" }
    );
    res.json({ token, role: user.role, client_id: user.client_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/auth/me", auth, async (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, client_id: req.user.client_id });
});

// ── Clients (somente superadmin) ─────────────────────────────
app.get("/clients", auth, superadmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.*,
        COUNT(DISTINCT d.id) as device_count,
        COUNT(DISTINCT CASE WHEN d.status='online' THEN d.id END) as online_count,
        COUNT(DISTINCT CASE WHEN d.status='offline' THEN d.id END) as offline_count,
        COUNT(DISTINCT u.id) as user_count
      FROM clients c
      LEFT JOIN devices d ON d.client_id = c.id
      LEFT JOIN users u ON u.client_id = c.id
      GROUP BY c.id ORDER BY c.created_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/clients/:id", auth, superadmin, async (req, res) => {
  const r = await pool.query("SELECT * FROM clients WHERE id=$1", [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: "Not found" });
  res.json(r.rows[0]);
});

app.post("/clients", auth, superadmin, async (req, res) => {
  const { name, document, email, phone, address, city, state, plan, status,
          telegram_token, telegram_chat_id, alert_email, notes } = req.body;
  
  console.log(`[API] Creating client: ${name} (User: ${req.user.username})`);

  if (!name) return res.status(400).json({ error: "Name required" });
  try {
    const r = await pool.query(`
      INSERT INTO clients (name, document, email, phone, address, city, state, plan, status,
        telegram_token, telegram_chat_id, alert_email, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [name, document||"", email||"", phone||"", address||"", city||"", state||"",
        plan||"basic", status||"active", telegram_token||"", telegram_chat_id||"", alert_email||"", notes||""]);
    
    console.log(`[API] Client created successfully! ID: ${r.rows[0].id}`);
    res.status(201).json(r.rows[0]);
  } catch (e) { 
    console.error(`[API] Error creating client: ${e.message}`);
    res.status(500).json({ error: e.message }); 
  }
});

app.put("/clients/:id", auth, superadmin, async (req, res) => {
  const { name, document, email, phone, address, city, state, plan, status,
          telegram_token, telegram_chat_id, alert_email, notes } = req.body;
  
  logger("INFO", "Attempting to update client", { id: req.params.id, name });

  try {
    const r = await pool.query(`
      UPDATE clients SET name=$1, document=$2, email=$3, phone=$4, address=$5,
        city=$6, state=$7, plan=$8, status=$9, telegram_token=$10,
        telegram_chat_id=$11, alert_email=$12, notes=$13
      WHERE id=$14 RETURNING *
    `, [name, document||"", email||"", phone||"", address||"", city||"", state||"",
        plan||"basic", status||"active", telegram_token||"", telegram_chat_id||"",
        alert_email||"", notes||"", req.params.id]);
    
    if (r.rows.length === 0) return res.status(404).json({ error: "Client not found" });
    
    logger("INFO", "Client updated successfully", { id: req.params.id });
    res.json(r.rows[0]);
  } catch (e) { 
    logger("ERROR", "Failed to update client", { error: e.message });
    res.status(500).json({ error: e.message }); 
  }
});

app.delete("/clients/:id", auth, superadmin, async (req, res) => {
  await pool.query("DELETE FROM clients WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// Criar usuário para cliente
app.post("/clients/:id/users", auth, superadmin, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Required" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      "INSERT INTO users (username, password_hash, role, client_id) VALUES ($1,$2,'client',$3) RETURNING id, username, role, client_id",
      [username, hash, req.params.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/clients/:id/users", auth, superadmin, async (req, res) => {
  const r = await pool.query(
    "SELECT id, username, role, created_at FROM users WHERE client_id=$1",
    [req.params.id]
  );
  res.json(r.rows);
});

// Stats do cliente
app.get("/clients/:id/stats", auth, superadmin, async (req, res) => {
  const cid = req.params.id;
  const devices = await pool.query("SELECT COUNT(*) FROM devices WHERE client_id=$1", [cid]);
  const online  = await pool.query("SELECT COUNT(*) FROM devices WHERE client_id=$1 AND status='online'", [cid]);
  const offline = await pool.query("SELECT COUNT(*) FROM devices WHERE client_id=$1 AND status='offline'", [cid]);
  const alerts  = await pool.query("SELECT COUNT(*) FROM alerts WHERE client_id=$1 AND fired_at > NOW() - INTERVAL '24 hours'", [cid]);
  res.json({
    devices: parseInt(devices.rows[0].count),
    online:  parseInt(online.rows[0].count),
    offline: parseInt(offline.rows[0].count),
    alerts_24h: parseInt(alerts.rows[0].count),
  });
});

// ── Devices ──────────────────────────────────────────────────
app.get("/devices", auth, async (req, res) => {
  try {
    const cid = clientFilter(req);
    const { type, tag, status } = req.query;
    let query = `
      SELECT d.*,
        c.name as client_name,
        (SELECT time       FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_metric,
        (SELECT cpu        FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_cpu,
        (SELECT memory     FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_memory,
        (SELECT latency_ms FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_latency
      FROM devices d
      LEFT JOIN clients c ON c.id = d.client_id
      WHERE 1=1
    `;
    const params = [];
    if (cid)    { params.push(cid);    query += ` AND d.client_id=$${params.length}`; }
    if (type)   { params.push(type);   query += ` AND d.device_type=$${params.length}`; }
    if (tag)    { params.push(tag);    query += ` AND $${params.length}=ANY(d.tags)`; }
    if (status) { params.push(status); query += ` AND d.status=$${params.length}`; }
    query += " ORDER BY d.created_at DESC";
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/devices", auth, async (req, res) => {
  const {
    name, description, location, device_type, ip_address, tags,
    snmp_community, snmp_version, ssh_user, ssh_port,
    monitor_ping, monitor_snmp, monitor_agent, ddns_address, monitor_port, notes, client_id,
  } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  // client_id: superadmin pode especificar, client usa o seu
  const cid = req.user.role === "superadmin"
    ? (client_id || null)
    : req.user.client_id;

  const token = crypto.randomBytes(32).toString("hex");
  try {
    const r = await pool.query(`
      INSERT INTO devices (name, description, location, token, device_type, ip_address, tags,
        snmp_community, snmp_version, ssh_user, ssh_port, monitor_ping, monitor_snmp,
        monitor_agent, ddns_address, monitor_port, notes, client_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *
    `, [name, description||"", location||"", token, device_type||"other", ip_address||null,
        tags||[], snmp_community||"public", snmp_version||"2c", ssh_user||null, ssh_port||22,
        monitor_ping!==false, monitor_snmp||false, monitor_agent!==false, ddns_address||"",
        parseInt(monitor_port)||0, notes||"", cid]);

    // Executa o monitoramento cloud em background total
    if (ddns_address && monitor_port) {
      setImmediate(() => {
        cloudMonitor(r.rows[0].id).catch(err => logger("ERROR", "Background Monitor Error", err));
      });
    }

    return res.status(201).json(r.rows[0]);
  } catch (e) { 
    logger("ERROR", "Create Device Error", e);
    return res.status(500).json({ error: e.message }); 
  }
});

app.put("/devices/:id", auth, async (req, res) => {
  const {
    name, description, location, device_type, ip_address, tags,
    snmp_community, snmp_version, ssh_user, ssh_port,
    monitor_ping, monitor_snmp, monitor_agent, ddns_address, monitor_port, notes,
  } = req.body;
  try {
    const r = await pool.query(`
      UPDATE devices SET name=$1, description=$2, location=$3, device_type=$4,
        ip_address=$5, tags=$6, snmp_community=$7, snmp_version=$8, ssh_user=$9,
        ssh_port=$10, monitor_ping=$11, monitor_snmp=$12, monitor_agent=$13,
        ddns_address=$14, monitor_port=$15, notes=$16
      WHERE id=$17 RETURNING *
    `, [name, description||"", location||"", device_type||"other", ip_address||null,
        tags||[], snmp_community||"public", snmp_version||"2c", ssh_user||null,
        ssh_port||22, monitor_ping!==false, monitor_snmp||false,
        monitor_agent!==false, ddns_address||"", parseInt(monitor_port)||0,
        notes||"", req.params.id]);

    // Executa o monitoramento cloud em background total
    if (ddns_address && monitor_port) {
      setImmediate(() => {
        cloudMonitor(r.rows[0].id).catch(err => logger("ERROR", "Background Monitor Error", err));
      });
    }

    return res.json(r.rows[0]);
  } catch (e) { 
    logger("ERROR", "Update Device Error", e);
    return res.status(500).json({ error: e.message }); 
  }
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

// ── Tags & Types ──────────────────────────────────────────────
app.get("/tags", auth, async (req, res) => {
  const cid = clientFilter(req);
  let query = "SELECT DISTINCT unnest(tags) as tag FROM devices";
  const params = [];
  if (cid) { params.push(cid); query += ` WHERE client_id=$1`; }
  query += " ORDER BY tag";
  const r = await pool.query(query, params);
  res.json(r.rows.map(row => row.tag));
});

app.get("/device-types", auth, async (req, res) => {
  res.json([
    { value: "server",      label: "Servidor",     icon: "🖥️" },
    { value: "camera",      label: "Câmera IP",    icon: "📷" },
    { value: "router",      label: "Roteador",     icon: "🌐" },
    { value: "switch",      label: "Switch",       icon: "🔀" },
    { value: "routerboard", label: "RouterBoard",  icon: "📡" },
    { value: "unifi",       label: "UniFi",        icon: "📶" },
    { value: "firewall",    label: "Firewall",     icon: "🛡️" },
    { value: "printer",     label: "Impressora",   icon: "🖨️" },
    { value: "iot",         label: "IoT",          icon: "💡" },
    { value: "workstation", label: "Workstation",  icon: "💻" },
    { value: "other",       label: "Outro",        icon: "📦" },
  ]);
});

// ── Triggers ─────────────────────────────────────────────────
app.get("/triggers", auth, async (req, res) => {
  const cid = clientFilter(req);
  let query = "SELECT * FROM triggers WHERE 1=1";
  const params = [];
  if (cid) { params.push(cid); query += ` AND client_id=$${params.length}`; }
  query += " ORDER BY created_at DESC";
  const r = await pool.query(query, params);
  res.json(r.rows);
});

app.post("/triggers", auth, async (req, res) => {
  const { name, expression, threshold, enabled, device_type, tags } = req.body;
  if (!name || !expression || threshold === undefined)
    return res.status(400).json({ error: "name, expression, threshold required" });
  const cid = req.user.role === "superadmin"
    ? (req.body.client_id || null)
    : req.user.client_id;
  try {
    const r = await pool.query(`
      INSERT INTO triggers (name, expression, threshold, enabled, device_type, tags, client_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [name, expression, threshold, enabled!==false, device_type||null, tags||[], cid]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/triggers/:id", auth, async (req, res) => {
  const { name, expression, threshold, enabled, device_type, tags } = req.body;
  try {
    const r = await pool.query(`
      UPDATE triggers SET name=$1,expression=$2,threshold=$3,enabled=$4,device_type=$5,tags=$6
      WHERE id=$7 RETURNING *
    `, [name, expression, threshold, enabled, device_type||null, tags||[], req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/triggers/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM triggers WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.get("/agent/devices", async (req, res) => {
  const token = req.headers["x-device-token"];
  if (!token) return res.status(401).json({ error: "Token required" });
  try {
    const dr = await pool.query("SELECT client_id FROM devices WHERE token=$1", [token]);
    if (dr.rows.length === 0) return res.status(401).json({ error: "Invalid token" });
    const cid = dr.rows[0].client_id;
    const devices = await pool.query(
      "SELECT id, name, ip_address, ddns_address, monitor_port, monitor_ping FROM devices WHERE client_id=$1",
      [cid]
    );
    res.json(devices.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Metrics ───────────────────────────────────────────────────
app.post("/metrics", metricsLimiter, async (req, res) => {
  const deviceToken = req.headers["x-device-token"] || req.body.device_token;
  const { host, cpu, memory, disk_used, disk_total, disk_percent,
          net_rx_bytes, net_tx_bytes, latency_ms, uptime_seconds,
          load_avg, processes, temperature, device_id, status } = req.body;
  if (!host || cpu === undefined || memory === undefined)
    return res.status(400).json({ error: "host, cpu, memory required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let targetDeviceId = null;
    let clientId = null;

    if (deviceToken) {
      const dr = await client.query("SELECT id, client_id FROM devices WHERE token=$1", [deviceToken]);
      if (dr.rows.length > 0) {
        clientId = dr.rows[0].id; // O ID do dispositivo que enviou (o Agent)
        const client_id_owner = dr.rows[0].client_id;
        
        // Se o corpo enviou um device_id específico (ex: sub-dispositivo monitorado pelo agente)
        targetDeviceId = device_id || dr.rows[0].id;
        
        // Atualiza o status do dispositivo (seja o principal ou o monitorado)
        const deviceStatus = status || 'online';
        await client.query(
          "UPDATE devices SET last_seen=NOW(), status=$1 WHERE id=$2",
          [deviceStatus, targetDeviceId]
        );
      }
    }

    const hr = await client.query(
      "INSERT INTO hosts (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
      [host]
    );
    await client.query(`
      INSERT INTO metrics (time,host_id,host,device_id,cpu,memory,disk_used,disk_total,
        disk_percent,net_rx_bytes,net_tx_bytes,latency_ms,uptime_seconds,load_avg,processes,temperature)
      VALUES (NOW(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    `, [hr.rows[0].id, host, targetDeviceId, cpu, memory, disk_used||0, disk_total||0,
        disk_percent||0, net_rx_bytes||0, net_tx_bytes||0, latency_ms||0,
        uptime_seconds||0, load_avg||0, processes||0, temperature||0]);
    await client.query("COMMIT");
    fetch(`${WEBSOCKET_URL}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, cpu, memory, disk_percent: disk_percent||0,
        latency_ms: latency_ms||0, device_id: targetDeviceId, client_id: clientId,
        time: new Date().toISOString() }),
    }).catch(() => {});
    res.status(201).json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.get("/metrics/:host", auth, async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours)||1, 24);
  const r = await pool.query(`
    SELECT time,cpu,memory,disk_percent,net_rx_bytes,net_tx_bytes,
           latency_ms,uptime_seconds,load_avg,processes,temperature
    FROM metrics WHERE host=$1 AND time > NOW()-($2||' hours')::INTERVAL
    ORDER BY time DESC LIMIT 1000
  `, [req.params.host, hours]);
  res.json(r.rows);
});

// ── Alerts ────────────────────────────────────────────────────
app.get("/alerts", auth, async (req, res) => {
  const cid = clientFilter(req);
  let query = `
    SELECT a.*, t.name as trigger_name, d.name as device_name, d.device_type,
           c.name as client_name
    FROM alerts a
    LEFT JOIN triggers t ON a.trigger_id=t.id
    LEFT JOIN devices  d ON a.device_id=d.id
    LEFT JOIN clients  c ON a.client_id=c.id
    WHERE 1=1
  `;
  const params = [];
  if (cid) { params.push(cid); query += ` AND a.client_id=$${params.length}`; }
  query += " ORDER BY a.fired_at DESC LIMIT 200";
  const r = await pool.query(query, params);
  res.json(r.rows);
});

// ── Dashboard stats ───────────────────────────────────────────
app.get("/stats", auth, async (req, res) => {
  const cid = clientFilter(req);
  const where = cid ? `WHERE client_id=${cid}` : "";
  const [total, online, offline, clients_total] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM devices ${where}`),
    pool.query(`SELECT COUNT(*) FROM devices ${where ? where + " AND" : "WHERE"} status='online'`),
    pool.query(`SELECT COUNT(*) FROM devices ${where ? where + " AND" : "WHERE"} status='offline'`),
    req.user.role === "superadmin" ? pool.query("SELECT COUNT(*) FROM clients WHERE status='active'") : Promise.resolve({ rows: [{ count: 0 }] }),
  ]);
  res.json({
    devices: parseInt(total.rows[0].count),
    online:  parseInt(online.rows[0].count),
    offline: parseInt(offline.rows[0].count),
    clients: parseInt(clients_total.rows[0].count),
  });
});

app.get("/hosts", auth, async (req, res) => {
  try {
    const cid = clientFilter(req);
    let query = "SELECT DISTINCT h.* FROM hosts h";
    const params = [];
    
    if (cid) {
      params.push(cid);
      query += ` JOIN devices d ON d.hostname = h.name OR d.ip_address = h.name WHERE d.client_id = $1`;
    }
    
    query += " ORDER BY h.name";
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ── Listar marcas de inversores ───────────────────────────────
app.get("/solar/brands", auth, (req, res) => {
  res.json([
    { value: "growatt",  label: "Growatt",        icon: "🟠", method: "cloud",   fields: ["growatt_user","growatt_pass","growatt_plant_id"] },
    { value: "fronius",  label: "Fronius",         icon: "🔵", method: "local",   fields: ["fronius_ip","fronius_device_id"] },
    { value: "deye",     label: "Deye",            icon: "🟡", method: "cloud",   fields: ["solarman_token","solarman_app_id","solarman_logger_sn"] },
    { value: "solis",    label: "Solis",           icon: "🟤", method: "cloud",   fields: ["solarman_token","solarman_app_id","solarman_logger_sn"] },
    { value: "sma",      label: "SMA",             icon: "⚫", method: "local",   fields: ["api_url"] },
    { value: "goodwe",   label: "GoodWe",          icon: "🟢", method: "cloud",   fields: ["goodwe_user","goodwe_pass","goodwe_station_id"] },
    { value: "huawei",   label: "Huawei FusionSolar", icon: "🔴", method: "cloud", fields: ["huawei_user","huawei_pass","huawei_station_id"] },
    { value: "canadian", label: "Canadian Solar",  icon: "🍁", method: "generic", fields: ["api_url","api_key"] },
    { value: "risen",    label: "Risen Energy",    icon: "🌟", method: "generic", fields: ["api_url","api_key"] },
    { value: "other",    label: "Outro (Genérico)", icon: "☀️", method: "generic", fields: ["api_url","api_key"] },
  ]);
});

// ── CRUD inversores ───────────────────────────────────────────
app.get("/solar/inverters", auth, async (req, res) => {
  try {
    const cid = req.user.role === "superadmin"
      ? (req.query.client_id ? parseInt(req.query.client_id) : null)
      : req.user.client_id;

    let query = `
      SELECT i.*, c.name as client_name,
        (SELECT power_w FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) as last_power,
        (SELECT energy_today_kwh FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) as last_energy_today,
        (SELECT revenue_today FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) as last_revenue_today,
        (SELECT energy_total_kwh FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) as last_energy_total,
        (SELECT revenue_total FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) as last_revenue_total,
        (SELECT inverter_status FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) as last_status,
        (SELECT temperature_c FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) as last_temp,
        (SELECT time FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) as last_update
      FROM solar_inverters i
      LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.status='active'
    `;
    const params = [];
    if (cid) { params.push(cid); query += ` AND i.client_id=$${params.length}`; }
    query += " ORDER BY i.created_at DESC";

    const r = await pool.query(query, params);
    // Não retornar senhas
    const safe = r.rows.map(row => {
      const { growatt_pass, sma_pass, goodwe_pass, huawei_pass, ...rest } = row;
      return rest;
    });
    res.json(safe);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/solar/inverters", auth, async (req, res) => {
  const {
    name, brand, model, location, capacity_kwp, tariff_kwh, client_id,
    growatt_user, growatt_pass, growatt_plant_id,
    fronius_ip, fronius_device_id,
    solarman_token, solarman_app_id, solarman_logger_sn,
    sma_user, sma_pass, sma_plant_id,
    goodwe_user, goodwe_pass, goodwe_station_id,
    huawei_user, huawei_pass, huawei_station_id,
    api_url, api_key, api_type, notes,
  } = req.body;

  if (!name || !brand) return res.status(400).json({ error: "name e brand obrigatórios" });

  const cid = req.user.role === "superadmin" ? (client_id || null) : req.user.client_id;

  try {
    const r = await pool.query(`
      INSERT INTO solar_inverters (
        name, brand, model, location, capacity_kwp, tariff_kwh, client_id,
        growatt_user, growatt_pass, growatt_plant_id,
        fronius_ip, fronius_device_id,
        solarman_token, solarman_app_id, solarman_logger_sn,
        sma_user, sma_pass, sma_plant_id,
        goodwe_user, goodwe_pass, goodwe_station_id,
        huawei_user, huawei_pass, huawei_station_id,
        api_url, api_key, api_type, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      RETURNING id, name, brand, model, location, capacity_kwp, tariff_kwh, client_id, status, created_at
    `, [
      name, brand, model||"", location||"", capacity_kwp||0, tariff_kwh||0.85, cid,
      growatt_user||"", growatt_pass||"", growatt_plant_id||"",
      fronius_ip||"", fronius_device_id||1,
      solarman_token||"", solarman_app_id||"", solarman_logger_sn||"",
      sma_user||"", sma_pass||"", sma_plant_id||"",
      goodwe_user||"", goodwe_pass||"", goodwe_station_id||"",
      huawei_user||"", huawei_pass||"", huawei_station_id||"",
      api_url||"", api_key||"", api_type||"", notes||"",
    ]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/solar/inverters/:id", auth, async (req, res) => {
  const {
    name, brand, model, location, capacity_kwp, tariff_kwh,
    growatt_user, growatt_pass, growatt_plant_id,
    fronius_ip, fronius_device_id,
    solarman_token, solarman_app_id, solarman_logger_sn,
    sma_user, sma_pass, sma_plant_id,
    goodwe_user, goodwe_pass, goodwe_station_id,
    huawei_user, huawei_pass, huawei_station_id,
    api_url, api_key, api_type, notes,
  } = req.body;
  try {
    const r = await pool.query(`
      UPDATE solar_inverters SET
        name=$1, brand=$2, model=$3, location=$4, capacity_kwp=$5, tariff_kwh=$6,
        growatt_user=$7, growatt_pass=COALESCE(NULLIF($8,''), growatt_pass),
        growatt_plant_id=$9, fronius_ip=$10, fronius_device_id=$11,
        solarman_token=$12, solarman_app_id=$13, solarman_logger_sn=$14,
        sma_user=$15, sma_pass=COALESCE(NULLIF($16,''), sma_pass), sma_plant_id=$17,
        goodwe_user=$18, goodwe_pass=COALESCE(NULLIF($19,''), goodwe_pass), goodwe_station_id=$20,
        huawei_user=$21, huawei_pass=COALESCE(NULLIF($22,''), huawei_pass), huawei_station_id=$23,
        api_url=$24, api_key=$25, api_type=$26, notes=$27
      WHERE id=$28 RETURNING id, name, brand, location, status
    `, [
      name, brand, model||"", location||"", capacity_kwp||0, tariff_kwh||0.85,
      growatt_user||"", growatt_pass||"", growatt_plant_id||"",
      fronius_ip||"", fronius_device_id||1,
      solarman_token||"", solarman_app_id||"", solarman_logger_sn||"",
      sma_user||"", sma_pass||"", sma_plant_id||"",
      goodwe_user||"", goodwe_pass||"", goodwe_station_id||"",
      huawei_user||"", huawei_pass||"", huawei_station_id||"",
      api_url||"", api_key||"", api_type||"", notes||"",
      req.params.id
    ]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/solar/inverters/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM solar_inverters WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ── Métricas solares ──────────────────────────────────────────
app.get("/solar/inverters/:id/metrics", auth, async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours)||24, 168);
  const r = await pool.query(`
    SELECT time, power_w, energy_today_kwh, energy_total_kwh,
           revenue_today, revenue_total, inverter_status, temperature_c
    FROM solar_metrics
    WHERE inverter_id=$1 AND time > NOW() - ($2||' hours')::INTERVAL
    ORDER BY time DESC LIMIT 500
  `, [req.params.id, hours]);
  res.json(r.rows);
});

// ── Resumo solar (dashboard) ──────────────────────────────────
app.get("/solar/summary", auth, async (req, res) => {
  try {
    const cid = req.user.role === "superadmin"
      ? (req.query.client_id ? parseInt(req.query.client_id) : null)
      : req.user.client_id;

    const where = cid ? `WHERE client_id=${cid}` : "";

    const [total, power, today, revenue] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM solar_inverters ${where} AND status='active'`.replace("WHERE AND","WHERE")),
      pool.query(`SELECT COALESCE(SUM(sm.power_w),0) as total_power FROM solar_inverters i JOIN LATERAL (SELECT power_w FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) sm ON TRUE ${cid ? `WHERE i.client_id=${cid}` : ""}`),
      pool.query(`SELECT COALESCE(SUM(sm.energy_today_kwh),0) as total_today FROM solar_inverters i JOIN LATERAL (SELECT energy_today_kwh FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) sm ON TRUE ${cid ? `WHERE i.client_id=${cid}` : ""}`),
      pool.query(`SELECT COALESCE(SUM(sm.revenue_today),0) as total_revenue FROM solar_inverters i JOIN LATERAL (SELECT revenue_today FROM solar_metrics WHERE inverter_id=i.id ORDER BY time DESC LIMIT 1) sm ON TRUE ${cid ? `WHERE i.client_id=${cid}` : ""}`),
    ]);

    res.json({
      total_inverters: parseInt(total.rows[0].count),
      total_power_w:   parseFloat(power.rows[0].total_power),
      energy_today_kwh: parseFloat(today.rows[0].total_today),
      revenue_today:   parseFloat(revenue.rows[0].total_revenue),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const dns = require("dns").promises;

// Rota de teste manual para o botão no frontend com diagnóstico aprimorado
app.post("/devices/:id/test", auth, async (req, res) => {
  try {
    const dr = await pool.query("SELECT name, ddns_address, monitor_port FROM devices WHERE id=$1", [req.params.id]);
    if (dr.rows.length === 0) return res.status(404).json({ error: "Dispositivo não encontrado" });
    
    const { name, ddns_address, monitor_port } = dr.rows[0];
    if (!ddns_address || !monitor_port) return res.status(400).json({ error: "DDNS e Porta não configurados" });

    const diag = { 
      dns: { resolved: false, ip: null, error: null },
      tcp: { alive: false, latency: 0, error: null }
    };

    // 1. Diagnóstico de DNS
    try {
      const addresses = await dns.resolve4(ddns_address);
      diag.dns.resolved = true;
      diag.dns.ip = addresses[0];
    } catch (e) {
      diag.dns.error = e.code || e.message;
      return res.json({ 
        alive: false, 
        message: `❌ Erro de DNS: Não foi possível encontrar o endereço "${ddns_address}". Verifique se o seu DDNS Intelbras está ativo.`,
        details: diag
      });
    }

    // 2. Diagnóstico de Porta TCP
    const checkTCP = () => new Promise((resolve) => {
      const socket = new net.Socket();
      const start = Date.now();
      socket.setTimeout(8000); // 8 segundos para redes lentas
      
      socket.on("connect", () => {
        const lat = Date.now() - start;
        socket.destroy();
        resolve({ alive: true, latency: lat, error: null });
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve({ alive: false, latency: 0, error: "TIMEOUT" });
      });

      socket.on("error", (err) => {
        socket.destroy();
        resolve({ alive: false, latency: 0, error: err.code });
      });

      socket.connect(monitor_port, ddns_address);
    });

    const result = await checkTCP();
    diag.tcp = result;

    if (result.alive) {
      res.json({ 
        alive: true, 
        message: `✅ Sucesso! O sistema conseguiu conectar na câmera via ${ddns_address}:${monitor_port} (${result.latency}ms).`,
        details: diag
      });
    } else {
      let msg = `❌ Falha na conexão: A porta ${monitor_port} está fechada no seu roteador.`;
      if (result.error === "ECONNREFUSED") msg = `❌ Conexão recusada: O roteador negou o acesso na porta ${monitor_port}. Verifique o "Virtual Server" no TP-Link.`;
      if (result.error === "TIMEOUT") msg = `❌ Tempo esgotado: O roteador não respondeu na porta ${monitor_port}. Verifique se o redirecionamento de portas está correto.`;
      
      res.json({ 
        alive: false, 
        message: msg,
        details: diag
      });
    }

  } catch (e) { 
    logger("ERROR", "Manual Test Error", e);
    res.status(500).json({ error: e.message }); 
  }
});

// ── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ 
    error: "Route not found",
    path: req.path,
    method: req.method
  });
});

// ── Error Handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger("ERROR", "Unhandled error", { 
    message: err.message, 
    path: req.path,
    method: req.method 
  });
  res.status(err.status || 500).json({ 
    error: err.message || "Internal server error"
  });
});

// ── Server Startup ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  logger("INFO", "🚀 NexusWatch Pro API started", { 
    port: PORT,
    environment: process.env.NODE_ENV || "production"
  });
});

// ── Graceful Shutdown ──────────────────────────────────────────
// --- MONITORAMENTO CLOUD (SEM AGENTE) ---
async function cloudMonitor(deviceId = null) {
  try {
    const queryStr = deviceId 
      ? "SELECT id, name, client_id, ddns_address, monitor_port FROM devices WHERE id=$1"
      : "SELECT id, name, client_id, ddns_address, monitor_port FROM devices WHERE ddns_address <> '' AND monitor_port > 0";
    const queryParams = deviceId ? [deviceId] : [];
    
    const r = await pool.query(queryStr, queryParams);
    if (r.rows.length === 0) return;

    // Função interna para checar um único dispositivo
    const checkOne = async (dev) => {
      const { id, name, client_id, ddns_address, monitor_port } = dev;
      if (!ddns_address || !monitor_port) return;

      const check = () => new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();
        socket.setTimeout(5000);

        socket.on("connect", () => {
          const lat = Date.now() - start;
          socket.destroy();
          resolve({ alive: true, lat, error: null });
        });

        socket.on("timeout", () => {
          socket.destroy();
          resolve({ alive: false, lat: 0, error: "TIMEOUT" });
        });

        socket.on("error", (err) => {
          socket.destroy();
          let msg = err.code;
          if (err.code === "ECONNREFUSED") msg = "REFUSED";
          if (err.code === "ENOTFOUND") msg = "NOTFOUND";
          resolve({ alive: false, lat: 0, error: msg });
        });

        socket.connect(monitor_port, ddns_address);
      });

      const result = await check();
      const status = result.alive ? 'online' : 'offline';
      const errorMsg = result.error || "";
      
      // 1. Atualiza status no banco
      await pool.query(
        "UPDATE devices SET last_seen=NOW(), status=$1, notes=LEFT($2, 200) WHERE id=$3",
        [status, errorMsg ? `Cloud Error: ${errorMsg}` : "", id]
      );

      // 2. Garante que o host existe na tabela hosts
      const hr = await pool.query(
        "INSERT INTO hosts (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
        [name]
      );

      // 3. Registra métrica básica
      await pool.query(`
        INSERT INTO metrics (time, host_id, host, device_id, cpu, memory, latency_ms, status)
        VALUES (NOW(), $1, $2, $3, 0, 0, $4, $5)
      `, [hr.rows[0].id, name, id, result.lat, status]);

      // 4. Envia atualização via WebSocket (em segundo plano)
      fetch(`${WEBSOCKET_URL}/publish`, {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          host: name, cpu: 0, memory: 0, 
          latency_ms: result.lat, device_id: id, 
          client_id: client_id, status: status,
          error: errorMsg, time: new Date().toISOString() 
        }),
      }).catch(() => {});

      if (result.alive) {
        logger("INFO", `[CloudMonitor] ✓ ${name} (${ddns_address}:${monitor_port}) ONLINE`);
      } else {
        logger("WARN", `[CloudMonitor] ❌ ${name} (${ddns_address}:${monitor_port}) OFFLINE: ${errorMsg}`);
      }
    };

    // Se for um dispositivo específico, faz na hora. Senão, faz em paralelo com limite? 
    // Por enquanto, paralelo total (são poucos devices).
    if (deviceId) {
      await checkOne(r.rows[0]);
    } else {
      await Promise.all(r.rows.map(dev => checkOne(dev)));
    }
  } catch (e) {
    logger("ERROR", `[CloudMonitor] Erro: ${e.message}`);
  }
}

// Inicia o monitoramento a cada 1 minuto
setInterval(cloudMonitor, 60000);
// Executa a primeira vez após 10 segundos do boot
setTimeout(cloudMonitor, 10000);

process.on("SIGTERM", () => {
  logger("WARN", "SIGTERM received, shutting down gracefully");
  pool.end(() => {
    logger("INFO", "Database pool closed");
    process.exit(0);
  });
});
