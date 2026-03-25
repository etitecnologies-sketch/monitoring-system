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
const xmlparser = require("express-xml-bodyparser");

const app = express();

// Middleware de diagnóstico para logar todas as requisições no console do Railway
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  // Redireciona POST na raiz para /push (ajuda câmeras que não deixam mudar o caminho)
  if ((req.url === '/' || req.url === '') && req.method === 'POST') {
    req.url = '/push';
  }
  next();
});

app.get("/", (req, res) => res.json({ status: "online", service: "NexusWatch API", version: "1.0.3" }));
app.get("/push", (req, res) => res.json({ message: "Endpoint pronto para receber POST das câmeras." }));

// ── Security & Middleware ────────────────────────────────────
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(xmlparser({ explicitArray: false, normalize: true })); // Suporte para XML (Intelbras/Hikvision)
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
          ddns_address TEXT DEFAULT '', monitor_port INT DEFAULT 0, notes TEXT DEFAULT '',
          mac_address TEXT DEFAULT '', serial_number TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS metrics (
          id BIGSERIAL PRIMARY KEY, time TIMESTAMPTZ NOT NULL, host_id INT REFERENCES hosts(id) ON DELETE CASCADE,
          host TEXT NOT NULL, device_id INT REFERENCES devices(id) ON DELETE SET NULL,
          cpu FLOAT DEFAULT 0, memory FLOAT DEFAULT 0, disk_percent FLOAT DEFAULT 0,
          latency_ms FLOAT DEFAULT 0, status TEXT DEFAULT 'online',
          solar_voltage FLOAT DEFAULT 0, battery_voltage FLOAT DEFAULT 0,
          battery_percent FLOAT DEFAULT 0, charge_current FLOAT DEFAULT 0,
          load_current FLOAT DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
          id BIGSERIAL PRIMARY KEY, time TIMESTAMPTZ DEFAULT NOW(),
          device_id INT REFERENCES devices(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL, channel INT DEFAULT 0,
          description TEXT, severity TEXT DEFAULT 'info',
          is_read BOOLEAN DEFAULT FALSE
      );
    `);
    
    const migrations = [
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS ddns_address TEXT DEFAULT ''",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS monitor_port INT DEFAULT 0",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS monitor_agent BOOLEAN DEFAULT TRUE",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS monitor_ping BOOLEAN DEFAULT TRUE",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS monitor_snmp BOOLEAN DEFAULT FALSE",
      "ALTER TABLE metrics ADD COLUMN IF NOT EXISTS disk_percent FLOAT DEFAULT 0",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS mac_address TEXT DEFAULT ''",
      "ALTER TABLE devices ADD COLUMN IF NOT EXISTS serial_number TEXT DEFAULT ''"
    ];
    for (let m of migrations) { await pool.query(m).catch(() => {}); }
    
    // Inicia tabelas solares se não existirem
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solar_inverters (
          id              SERIAL PRIMARY KEY,
          client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
          name            TEXT NOT NULL,
          brand           TEXT NOT NULL,
          model           TEXT DEFAULT '',
          location        TEXT DEFAULT '',
          capacity_kwp    FLOAT DEFAULT 0,
          tariff_kwh      FLOAT DEFAULT 0.85,
          status          TEXT DEFAULT 'active',
          growatt_user    TEXT DEFAULT '',
          growatt_pass    TEXT DEFAULT '',
          growatt_plant_id TEXT DEFAULT '',
          fronius_ip      TEXT DEFAULT '',
          fronius_device_id INTEGER DEFAULT 1,
          solarman_token  TEXT DEFAULT '',
          solarman_app_id TEXT DEFAULT '',
          solarman_logger_sn TEXT DEFAULT '',
          sma_user        TEXT DEFAULT '',
          sma_pass        TEXT DEFAULT '',
          sma_plant_id    TEXT DEFAULT '',
          goodwe_user     TEXT DEFAULT '',
          goodwe_pass     TEXT DEFAULT '',
          goodwe_station_id TEXT DEFAULT '',
          huawei_user     TEXT DEFAULT '',
          huawei_pass     TEXT DEFAULT '',
          huawei_station_id TEXT DEFAULT '',
          api_url         TEXT DEFAULT '',
          api_key         TEXT DEFAULT '',
          api_type        TEXT DEFAULT '',
          notes           TEXT DEFAULT '',
          created_at      TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS solar_metrics (
          time            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          inverter_id     INTEGER REFERENCES solar_inverters(id) ON DELETE CASCADE,
          client_id       INTEGER REFERENCES clients(id),
          power_w         FLOAT DEFAULT 0,
          energy_today_kwh FLOAT DEFAULT 0,
          energy_month_kwh FLOAT DEFAULT 0,
          energy_total_kwh FLOAT DEFAULT 0,
          voltage_pv      FLOAT DEFAULT 0,
          voltage_ac      FLOAT DEFAULT 0,
          current_ac      FLOAT DEFAULT 0,
          frequency_hz    FLOAT DEFAULT 50,
          temperature_c   FLOAT DEFAULT 0,
          revenue_today   FLOAT DEFAULT 0,
          revenue_month   FLOAT DEFAULT 0,
          revenue_total   FLOAT DEFAULT 0,
          inverter_status TEXT DEFAULT 'unknown',
          fault_code      TEXT DEFAULT '',
          last_update     TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(e => console.log("Solar Tables Error:", e.message));

    console.log("Database Professional Restore: OK");
  } catch (e) { console.error("DB Restore Error:", e.message); }
}
initDB();

const JWT_SECRET = process.env.JWT_SECRET || "nexuswatch-secret-key-2024";
const WEBSOCKET_URL = (process.env.WEBSOCKET_URL || "").replace(/["'`\s]/g, "").trim();

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
    snmp_community, snmp_version, ssh_user, ssh_port,
    mac_address, serial_number
  } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  const cid = req.user.role === "superadmin" ? (client_id || null) : req.user.client_id;
  const token = crypto.randomBytes(32).toString("hex");
  try {
    const r = await pool.query(`
      INSERT INTO devices (
        name, description, location, token, device_type, ip_address, tags, 
        ddns_address, monitor_port, monitor_ping, monitor_agent, notes, client_id,
        snmp_community, snmp_version, ssh_user, ssh_port,
        mac_address, serial_number
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *
    `, [
      name, description||"", location||"", token, device_type||"other", ip_address||"", tags||[], 
      ddns_address||"", parseInt(monitor_port)||0, monitor_ping!==false, monitor_agent!==false, notes||"", cid,
      snmp_community||"public", snmp_version||"2c", ssh_user||"", parseInt(ssh_port)||22,
      mac_address||"", serial_number||""
    ]);
    res.status(201).json(r.rows[0]);
    if (ddns_address && monitor_port) setImmediate(() => cloudMonitor(r.rows[0].id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/devices/:id", auth, async (req, res) => {
  const { 
    name, description, location, device_type, ip_address, tags, 
    ddns_address, monitor_port, monitor_ping, monitor_agent, notes,
    snmp_community, snmp_version, ssh_user, ssh_port,
    mac_address, serial_number
  } = req.body;
  try {
    const r = await pool.query(`
      UPDATE devices SET 
        name=$1, description=$2, location=$3, device_type=$4, ip_address=$5, tags=$6, 
        ddns_address=$7, monitor_port=$8, monitor_ping=$9, monitor_agent=$10, notes=$11,
        snmp_community=$12, snmp_version=$13, ssh_user=$14, ssh_port=$15,
        mac_address=$16, serial_number=$17
      WHERE id=$18 RETURNING *
    `, [
      name, description||"", location||"", device_type||"other", ip_address||"", tags||[], 
      ddns_address||"", parseInt(monitor_port)||0, monitor_ping!==false, monitor_agent!==false, notes||"",
      snmp_community||"public", snmp_version||"2c", ssh_user||"", parseInt(ssh_port)||22,
      mac_address||"", serial_number||"",
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

// ── Solar Inverters ──────────────────────────────────────────
app.get("/solar/inverters", auth, async (req, res) => {
  try {
    const cid = clientFilter(req);
    let query = `
      SELECT 
        si.*,
        c.name as client_name,
        sm.power_w as last_power,
        sm.energy_today_kwh as last_energy_today,
        sm.energy_total_kwh as last_energy_total,
        sm.revenue_today as last_revenue_today,
        sm.revenue_total as last_revenue_total,
        sm.inverter_status as last_status,
        sm.time as last_update
      FROM solar_inverters si
      LEFT JOIN clients c ON si.client_id = c.id
      LEFT JOIN LATERAL (
        SELECT * FROM solar_metrics 
        WHERE inverter_id = si.id 
        ORDER BY time DESC LIMIT 1
      ) sm ON true
      WHERE 1=1
    `;
    const params = [];
    if (cid) { params.push(cid); query += " AND si.client_id=$1"; }
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/solar/inverters", auth, async (req, res) => {
  const { name, brand, model, location, capacity_kwp, tariff_kwh, client_id, notes, ...creds } = req.body;
  const cid = req.user.role === "superadmin" ? (client_id || null) : req.user.client_id;
  try {
    const r = await pool.query(`
      INSERT INTO solar_inverters (
        name, brand, model, location, capacity_kwp, tariff_kwh, client_id, notes,
        growatt_user, growatt_pass, growatt_plant_id,
        fronius_ip, fronius_device_id,
        solarman_token, solarman_app_id, solarman_logger_sn,
        sma_user, sma_pass, sma_plant_id,
        goodwe_user, goodwe_pass, goodwe_station_id,
        huawei_user, huawei_pass, huawei_station_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING *
    `, [
      name, brand, model||"", location||"", parseFloat(capacity_kwp)||0, parseFloat(tariff_kwh)||0.85, cid, notes||"",
      creds.growatt_user||"", creds.growatt_pass||"", creds.growatt_plant_id||"",
      creds.fronius_ip||"", parseInt(creds.fronius_device_id)||1,
      creds.solarman_token||"", creds.solarman_app_id||"", creds.solarman_logger_sn||"",
      creds.sma_user||"", creds.sma_pass||"", creds.sma_plant_id||"",
      creds.goodwe_user||"", creds.goodwe_pass||"", creds.goodwe_station_id||"",
      creds.huawei_user||"", creds.huawei_pass||"", creds.huawei_station_id||""
    ]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/solar/inverters/:id", auth, async (req, res) => {
  const { name, brand, model, location, capacity_kwp, tariff_kwh, notes, ...creds } = req.body;
  try {
    const r = await pool.query(`
      UPDATE solar_inverters SET
        name=$1, brand=$2, model=$3, location=$4, capacity_kwp=$5, tariff_kwh=$6, notes=$7,
        growatt_user=$8, growatt_pass=$9, growatt_plant_id=$10,
        fronius_ip=$11, fronius_device_id=$12,
        solarman_token=$13, solarman_app_id=$14, solarman_logger_sn=$15,
        sma_user=$16, sma_pass=$17, sma_plant_id=$18,
        goodwe_user=$19, goodwe_pass=$20, goodwe_station_id=$21,
        huawei_user=$22, huawei_pass=$23, huawei_station_id=$24
      WHERE id=$25 RETURNING *
    `, [
      name, brand, model||"", location||"", parseFloat(capacity_kwp)||0, parseFloat(tariff_kwh)||0.85, notes||"",
      creds.growatt_user||"", creds.growatt_pass||"", creds.growatt_plant_id||"",
      creds.fronius_ip||"", parseInt(creds.fronius_device_id)||1,
      creds.solarman_token||"", creds.solarman_app_id||"", creds.solarman_logger_sn||"",
      creds.sma_user||"", creds.sma_pass||"", creds.sma_plant_id||"",
      creds.goodwe_user||"", creds.goodwe_pass||"", creds.goodwe_station_id||"",
      creds.huawei_user||"", creds.huawei_pass||"", creds.huawei_station_id||"",
      req.params.id
    ]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/solar/inverters/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM solar_inverters WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/devices/:id/regenerate-token", auth, async (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  const r = await pool.query("UPDATE devices SET token=$1 WHERE id=$2 RETURNING token", [token, req.params.id]);
  res.json({ token: r.rows[0].token });
});

app.post("/devices/:id/test", auth, async (req, res) => {
  try {
    const dr = await pool.query("SELECT name, ip_address, ddns_address, monitor_port, last_seen, status FROM devices WHERE id=$1", [req.params.id]);
    const { name, ip_address, ddns_address, monitor_port, last_seen, status } = dr.rows[0];
    
    // Se o dispositivo enviou sinal recentemente via Auto Registro (Push), consideramos OK
    const now = new Date();
    const isRecentlySeen = last_seen && (now - new Date(last_seen)) < 120000; // 2 minutos

    if (isRecentlySeen && status === 'online') {
      return res.json({ alive: true, message: `✅ ${name} está conectado via Auto Registro / Cloud Push!` });
    }

    const targetHost = ddns_address || ip_address;
    if (!targetHost || !monitor_port) return res.status(400).json({ error: "Endereço (IP/DDNS) ou Porta não configurados" });
    
    // Se for IP local, avisamos que precisa do Auto Registro
    if (targetHost.startsWith("192.168.") || targetHost.startsWith("10.") || targetHost.startsWith("172.")) {
      return res.json({ 
        alive: false, 
        message: `ℹ️ O dispositivo usa IP local (${targetHost}). Certifique-se de que o Auto Registro está configurado na câmera apontando para o nosso servidor.` 
      });
    }

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
    SELECT m.*, d.name as device_name, d.mac_address, d.serial_number, c.name as client_name
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

// ── PUSH UNIVERSAL (Recepcionista Cloud) ─────────────────────
app.post("/push", metricsLimiter, async (req, res) => {
  const start = Date.now();
  // Tenta pegar o token de várias formas (Header, Body, XML, ou Query)
  const body = req.body || {};
  const xmlData = body.eventnotificationalert || body.event || {};
  const latency = Date.now() - start;

  const token = req.headers["x-device-token"] || 
                body.token || 
                req.query.token || 
                body.ID || 
                body.SN || 
                body.SerialNumber || 
                body.MAC ||
                xmlData.macaddress || 
                xmlData.serialnumber ||
                req.query.id;

  const { 
    status, cpu, memory, disk, 
    event_type, channel, description, severity,
    type,
    solar_v, batt_v, batt_p, charge_a, load_a // Campos para telemetria solar
  } = body;
  
  // Usa a latência enviada pela câmera ou calcula a do processamento
  const finalLatency = body.latency || latency;

  // Normalização de dados solares
  const solar_voltage = solar_v || body.solar_voltage || 0;
  const battery_voltage = batt_v || body.battery_voltage || 0;
  const battery_percent = batt_p || body.battery_percent || 0;
  const charge_current = charge_a || body.charge_current || 0;
  const load_current = load_a || body.load_current || 0;

  // Extração de eventos do XML (Intelbras/Hikvision)
  let finalEventType = event_type || type || xmlData.eventtype || xmlData.event;
  const finalChannel = channel || xmlData.channelid || xmlData.channel || 0;
  let finalDescription = description || xmlData.eventdescription || xmlData.description || "";

  // Mapeamento de Analíticos de Vídeo (Intelbras/Hikvision)
  const eventMap = {
    'videoloss': 'Perda de Vídeo',
    'videoloss_alarm': 'Perda de Vídeo',
    'videoloss_started': 'Perda de Vídeo',
    'videoloss_stopped': 'Vídeo Recuperado',
    'motion': 'Movimento Detectado',
    'motion_detection': 'Movimento Detectado',
    'vca': 'Analítico de Vídeo',
    'linedetection': 'Linha Virtual Atravessada',
    'fielddetection': 'Intrusão em Área',
    'tamperdetection': 'Câmera Obstruída (Tamper)',
    'shelteralarm': 'Câmera Obstruída (Tamper)',
    'diskfull': 'HD Cheio',
    'diskerror': 'Erro no HD'
  };

  if (finalEventType && eventMap[finalEventType.toLowerCase()]) {
    finalDescription = `${eventMap[finalEventType.toLowerCase()]} - Canal: ${finalChannel}`;
    finalEventType = eventMap[finalEventType.toLowerCase()];
  } else if (finalEventType) {
    finalDescription = `${finalEventType} - Canal: ${finalChannel} ${finalDescription}`;
  }

  if (!token) {
    console.log("[Push] Requisição sem identificador recebida:", JSON.stringify(body));
    return res.status(401).json({ error: "Identification (Token/SN/MAC) required" });
  }

  try {
    // Busca por Token ou MAC ou SN (limpando pontuação do MAC se necessário)
    const cleanToken = String(token).replace(/[:-]/g, "").toUpperCase();
    
    const dr = await pool.query(`
      SELECT id, client_id, name 
      FROM devices 
      WHERE token=$1 
         OR UPPER(REPLACE(REPLACE(mac_address, ':', ''), '-', '')) = $2
         OR serial_number = $1
      LIMIT 1
    `, [token, cleanToken]);

    if (dr.rows.length === 0) {
      console.log(`[Push] Token/MAC/SN não encontrado: ${token}`);
      return res.status(401).json({ error: "Invalid identification" });
    }
    const dev = dr.rows[0];

    console.log(`[Push] SINAL DE VIDA: ${dev.name} (${token})`);

    // 1. Atualizar Status
    await pool.query("UPDATE devices SET status=$1, last_seen=NOW() WHERE id=$2", ["online", dev.id]);
    
    // Grava métrica de latência e solar
    await pool.query(`
      INSERT INTO metrics (time, host, device_id, latency_ms, status, solar_voltage, battery_voltage, battery_percent, charge_current, load_current)
      VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [dev.name, dev.id, finalLatency, "online", solar_voltage, battery_voltage, battery_percent, charge_current, load_current]);

    // 2. Registrar Eventos
    if (finalEventType) {
      await pool.query(`
        INSERT INTO events (device_id, event_type, channel, description, severity)
        VALUES ($1, $2, $3, $4, $5)
      `, [dev.id, finalEventType, finalChannel, finalDescription, severity || "info"]);
      
      console.log(`[Push] Evento: ${finalEventType} em ${dev.name}`);

      // ── Alertas (Telegram) ──
      const devDetails = await pool.query("SELECT mac_address, serial_number, device_type FROM devices WHERE id=$1", [dev.id]);
      const { mac_address, serial_number, device_type } = devDetails.rows[0];

      let msg = `🎬 *Alerta NexusWatch*\n\n`;
      msg += `❌ ${dev.name}\n`;
      msg += `Problema: ${finalEventType}\n\n`;
      msg += `Host: ${dev.name}\n`;
      msg += `Data: ${new Date().toLocaleString("pt-BR")}\n`;
      msg += `Equipamento: ${device_type || 'other'} - ${mac_address || 'N/A'} - ${serial_number || 'N/A'}\n`;

      const clientRes = await pool.query("SELECT name, telegram_token, telegram_chat_id, wa_instance, wa_token, wa_number FROM clients WHERE id=$1", [dev.client_id]);
      const cData = clientRes.rows[0];

      if (cData?.name) msg += `Descrição: ${cData.name}\n`;
      msg += `Indicação: Verifique as imagens do Canal ${finalChannel}. ${finalDescription}`;

      // Telegram
      if (cData?.telegram_token && cData?.telegram_chat_id) {
        fetch(`https://api.telegram.org/bot${cData.telegram_token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: cData.telegram_chat_id, text: msg, parse_mode: "Markdown" })
        }).catch(() => {});
      }

      // WhatsApp (Evolution API)
      const waApiUrl = process.env.WA_API_URL;
      const waInstance = cData?.wa_instance || process.env.WA_INSTANCE;
      const waToken = cData?.wa_token || process.env.WA_TOKEN;
      const waNumber = cData?.wa_number || process.env.WA_NUMBER;

      if (waApiUrl && waInstance && waToken && waNumber) {
        fetch(`${waApiUrl.replace(/\/$/, "")}/message/sendText/${waInstance}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": waToken },
          body: JSON.stringify({
            number: waNumber,
            options: { delay: 1200, presence: "composing", linkPreview: false },
            textMessage: { text: msg }
          })
        }).catch((err) => console.error("Erro WhatsApp Ingest:", err.message));
      }
    }

    // 3. WebSocket (Realtime)
    if (WEBSOCKET_URL) {
      fetch(`${WEBSOCKET_URL.replace(/\/$/, "")}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: finalEventType ? "EVENT" : "METRIC",
          device_id: dev.id,
          client_id: dev.client_id,
          name: dev.name,
          status: "online",
          latency_ms: finalLatency,
          solar: {
            voltage: solar_voltage,
            battery_voltage: battery_voltage,
            battery_percent: battery_percent,
            charge_current: charge_current,
            load_current: load_current
          },
          event: finalEventType ? { type: finalEventType, channel: finalChannel, description: finalDescription } : null,
          time: new Date().toISOString()
        }),
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[Push Error]:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/events", auth, async (req, res) => {
  try {
    const cid = clientFilter(req);
    let query = `
      SELECT e.*, d.name as device_name, c.name as client_name
      FROM events e
      JOIN devices d ON d.id = e.device_id
      JOIN clients c ON c.id = d.client_id
      WHERE 1=1
    `;
    const params = [];
    if (cid) { params.push(cid); query += ` AND d.client_id=$1`; }
    query += " ORDER BY e.time DESC LIMIT 100";
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    if (WEBSOCKET_URL) {
      fetch(`${WEBSOCKET_URL}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, cpu, memory, latency_ms, device_id: devId, client_id: cid, time: new Date().toISOString() }),
      }).catch(() => {});
    }

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
      
      // Se for IP privado e não tiver DDNS, o servidor cloud não consegue alcançar.
      // Ignora para não gerar status 'offline' indevido.
      if (isPrivate && !dev.ddns_address) continue;

      const updateStatus = async (status, latency = 0, error = null) => {
        const notePrefix = isPrivate ? "🛡️ VPN " : "☁️ Cloud ";
        await pool.query("UPDATE devices SET status=$1, last_seen=NOW(), notes=$2 WHERE id=$3", [status, error ? `${notePrefix}Error: ${error}` : `${notePrefix}OK`, dev.id]);
        await pool.query("INSERT INTO metrics (time, host, device_id, latency_ms, status) VALUES (NOW(), $1, $2, $3, $4)", [targetHost, dev.id, latency, status]);
        
        if (WEBSOCKET_URL) {
          fetch(`${WEBSOCKET_URL}/publish`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ host: targetHost, latency_ms: latency, status, device_id: dev.id, client_id: dev.client_id, time: new Date().toISOString() }),
          }).catch(() => {});
        }
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

const PORT = process.env.PORT || 3000;
const TCP_PORT = 3001; // Porta para o Registro Automático da Intelbras

// ── Servidor TCP para Registro Automático (Protocolo Binário Intelbras) ──
const tcpServer = net.createServer((socket) => {
  const remoteAddr = socket.remoteAddress;
  console.log(`[TCP] Nova conexão de: ${remoteAddr}`);

  socket.on("data", async (data) => {
    const start = Date.now();
    try {
      // Converte o buffer em string para procurar o Serial Number ou MAC
      const rawData = data.toString("utf8");
      const hexData = data.toString("hex").toUpperCase();
      const latency = Date.now() - start;
      
      console.log(`[TCP] Dados recebidos de ${remoteAddr}: ${rawData.substring(0, 50)}...`);

      // Busca no banco por qualquer dispositivo que tenha o SN ou MAC presente nos dados binários
      // O protocolo da Intelbras envia o SN em texto plano em algum momento
      const devicesRes = await pool.query("SELECT id, name, serial_number, mac_address, client_id FROM devices");
      
      for (const dev of devicesRes.rows) {
        const cleanMac = dev.mac_address ? dev.mac_address.replace(/[:-]/g, "").toUpperCase() : null;
        
        if ((dev.serial_number && rawData.includes(dev.serial_number)) || 
            (cleanMac && hexData.includes(cleanMac))) {
          
          console.log(`[TCP] Dispositivo Identificado: ${dev.name} (${dev.serial_number || dev.mac_address})`);
          
          // Atualiza status para online
          await pool.query("UPDATE devices SET status=$1, last_seen=NOW() WHERE id=$2", ["online", dev.id]);
          
          // Grava métrica de latência
          await pool.query(`
            INSERT INTO metrics (time, host, device_id, latency_ms, status)
            VALUES (NOW(), $1, $2, $3, $4)
          `, [dev.name, dev.id, latency, "online"]);

          // Notifica WebSocket
          const WEBSOCKET_URL = process.env.WEBSOCKET_URL;
          if (WEBSOCKET_URL) {
            fetch(`${WEBSOCKET_URL.replace(/\/$/, "")}/publish`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "METRIC",
                device_id: dev.id,
                client_id: dev.client_id,
                name: dev.name,
                status: "online",
                latency_ms: latency,
                time: new Date().toISOString()
              }),
            }).catch(() => {});
          }
          break; 
        }
      }
    } catch (err) {
      console.error("[TCP Error]:", err.message);
    }
  });

  socket.on("error", (err) => console.error(`[TCP Socket Error]: ${err.message}`));
  socket.setTimeout(120000); // 2 minutos de timeout
  socket.on("timeout", () => socket.end());
});

tcpServer.listen(TCP_PORT, "0.0.0.0", () => {
  console.log(`=========================================`);
  console.log(`📡 TCP Proxy Online na Porta: ${TCP_PORT}`);
  console.log(`=========================================`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`=========================================`);
  console.log(`🚀 NexusWatch API Online na Porta: ${PORT}`);
  console.log(`=========================================`);
});

// Middleware 404 movido para o final de tudo
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
