import { useState, useEffect, useCallback } from 'react';

const API = window.location.hostname === "localhost"
  ? "http://localhost:3000"
  : `${window.location.origin.replace(/\/$/, "")}`;

const getToken = () => localStorage.getItem("token");
const setToken = (t) => localStorage.setItem("token", t);
const removeToken = () => localStorage.removeItem("token");

async function api(path, opts = {}) {
  const token = getToken();

  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });

  if (res.status === 401) {
    removeToken();
    window.location.href = "/login";
    return;
  }

  if (!res.ok) throw await res.json();

  return res.json();
}

const DEVICE_TYPES = [
  { value: "server",      label: "Servidor",    icon: "🖥️" },
  { value: "camera",      label: "Câmera IP",   icon: "📷" },
  { value: "router",      label: "Roteador",    icon: "🌐" },
  { value: "switch",      label: "Switch",      icon: "🔀" },
  { value: "routerboard", label: "RouterBoard", icon: "📡" },
  { value: "unifi",       label: "UniFi",       icon: "📶" },
  { value: "firewall",    label: "Firewall",    icon: "🛡️" },
  { value: "printer",     label: "Impressora",  icon: "🖨️" },
  { value: "iot",         label: "IoT",         icon: "💡" },
  { value: "workstation", label: "Workstation", icon: "💻" },
  { value: "dvr",         label: "DVR",         icon: "📹" },
  { value: "nvr",         label: "NVR",         icon: "🎥" },
  { value: "other",       label: "Outro",       icon: "📦" },
];

const EXPRESSIONS = [
  { value: "cpu",          label: "CPU Usage (%)" },
  { value: "memory",       label: "Memória (%)" },
  { value: "disk_percent", label: "Disco (%)" },
  { value: "latency_ms",   label: "Latência (ms)" },
  { value: "load_avg",     label: "Load Average" },
  { value: "temperature",  label: "Temperatura (°C)" },
];

const PLANS = [
  { value: "basic",      label: "Basic",      color: "#64748b" },
  { value: "pro",        label: "Pro",        color: "#38bdf8" },
  { value: "enterprise", label: "Enterprise", color: "#a78bfa" },
];

const deviceIcon  = (t) => DEVICE_TYPES.find((d) => d.value === t)?.icon || "📦";
const deviceLabel = (t) => DEVICE_TYPES.find((d) => d.value === t)?.label || "Outro";
const planColor   = (p) => PLANS.find((x) => x.value === p)?.color || "#64748b";

// ── Styles ────────────────────────────────────────────────────
const S = {
  app: { minHeight: "100vh", background: "#080c14", color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", display: "flex" },
  sidebar: { width: 230, background: "#0a0f1a", borderRight: "1px solid #1a2535", display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0 },
  logo: { padding: "0 20px 24px", borderBottom: "1px solid #1a2535", marginBottom: 12 },
  logoTitle: { fontSize: 17, fontWeight: 700, color: "#38bdf8", letterSpacing: 1 },
  logoSub: { fontSize: 10, color: "#3a5070", marginTop: 2 },
  navSection: { fontSize: 9, color: "#3a5070", padding: "12px 20px 4px", textTransform: "uppercase", letterSpacing: 2 },
  navItem: (a) => ({ display: "flex", alignItems: "center", gap: 9, padding: "9px 20px", cursor: "pointer", color: a ? "#38bdf8" : "#4a6080", background: a ? "rgba(56,189,248,0.07)" : "transparent", borderLeft: a ? "2px solid #38bdf8" : "2px solid transparent", fontSize: 12, fontWeight: a ? 600 : 400, transition: "all 0.15s", userSelect: "none" }),
  main: { flex: 1, overflow: "auto", padding: 24 },
  pageTitle: { fontSize: 20, fontWeight: 700, color: "#f1f5f9", marginBottom: 4, letterSpacing: 0.5 },
  pageSub: { fontSize: 11, color: "#3a5070", marginBottom: 20 },
  grid: (cols) => ({ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14, marginBottom: 20 }),
  card: { background: "#0a0f1a", border: "1px solid #1a2535", borderRadius: 10, padding: 18 },
  statCard: (c) => ({ background: "#0a0f1a", border: `1px solid ${c}25`, borderRadius: 10, padding: 18 }),
  statVal: (c) => ({ fontSize: 30, fontWeight: 700, color: c, lineHeight: 1 }),
  statLabel: { fontSize: 10, color: "#3a5070", marginTop: 5, textTransform: "uppercase", letterSpacing: 1 },
  badge: (c) => ({ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: `${c}18`, color: c, border: `1px solid ${c}35` }),
  btn: (v = "primary") => ({ padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit", background: v === "primary" ? "#38bdf8" : v === "danger" ? "#ef4444" : v === "purple" ? "#a78bfa" : "#1a2535", color: v === "ghost" ? "#64748b" : "#080c14", transition: "opacity 0.15s" }),
  btnSm: (v = "ghost") => ({ padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "inherit", background: v === "danger" ? "#ef444418" : "#1a2535", color: v === "danger" ? "#ef4444" : "#64748b" }),
  input: { width: "100%", background: "#080c14", border: "1px solid #1a2535", borderRadius: 6, padding: "7px 11px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", boxSizing: "border-box", outline: "none" },
  select: { width: "100%", background: "#080c14", border: "1px solid #1a2535", borderRadius: 6, padding: "7px 11px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", boxSizing: "border-box", outline: "none" },
  label: { fontSize: 10, color: "#3a5070", marginBottom: 3, display: "block", textTransform: "uppercase", letterSpacing: 0.5 },
  fg: { marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 11 },
  th: { padding: "7px 10px", textAlign: "left", color: "#3a5070", borderBottom: "1px solid #1a2535", fontSize: 9, textTransform: "uppercase", letterSpacing: 1 },
  td: { padding: "9px 10px", borderBottom: "1px solid #0d1520", color: "#94a3b8" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modalBox: { background: "#0a0f1a", border: "1px solid #1a2535", borderRadius: 12, padding: 24, width: 540, maxHeight: "92vh", overflowY: "auto" },
  modalTitle: { fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 18 },
  sectionTitle: { fontSize: 10, fontWeight: 700, color: "#38bdf8", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1.5 },
  divider: { borderTop: "1px solid #1a2535", margin: "14px 0" },
  tag: { display: "inline-flex", alignItems: "center", gap: 3, background: "#1a2535", color: "#38bdf8", borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 600, marginRight: 4, marginBottom: 4 },
};

// ── Components ────────────────────────────────────────────────
function Bar({ value, color = "#38bdf8" }) {
  const p = Math.min(value || 0, 100);
  return (
    <div style={{ height: 3, borderRadius: 2, background: "#1a2535", position: "relative", overflow: "hidden", marginTop: 3 }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${p}%`, background: p > 85 ? "#ef4444" : p > 60 ? "#f59e0b" : color, borderRadius: 2, transition: "width 0.5s" }} />
    </div>
  );
}

function TagInput({ value = [], onChange }) {
  const [input, setInput] = useState("");
  const add = (e) => {
    if ((e.key === "Enter" || e.key === ",") && input.trim()) {
      e.preventDefault();
      const tag = input.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
      if (tag && !value.includes(tag)) onChange([...value, tag]);
      setInput("");
    }
  };
  return (
    <div>
      <div style={{ marginBottom: 5, display: "flex", flexWrap: "wrap" }}>
        {value.map((t) => (
          <span key={t} style={S.tag}># {t}
            <span style={{ cursor: "pointer" }} onClick={() => onChange(value.filter((x) => x !== t))}>×</span>
          </span>
        ))}
      </div>
      <input style={S.input} placeholder="Tag + Enter" value={input}
        onChange={(e) => setInput(e.target.value)} onKeyDown={add} />
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────
function AuthPage({ onLogin }) {
  const [step, setStep] = useState(null);
  const [form, setForm] = useState({ username: "", password: "" });
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);

  useEffect(() => {
    api("/auth/status").then((d) => setStep(d.setupDone ? "login" : "setup")).catch(() => setStep("login"));
  }, []);

  const submit = async () => {
    setLoading(true); setErr("");
    try {
      if (step === "setup") {
        await api("/auth/setup", { method: "POST", body: JSON.stringify(form) });
        setStep("login"); return;
      }
      const d = await api("/auth/login", { method: "POST", body: JSON.stringify(form) });
      setToken(d.token); onLogin(d.role, d.client_id);
    } catch (e) { setErr(e.error || "Erro"); }
    finally { setLoading(false); }
  };

  if (!step) return <div style={{ ...S.app, alignItems: "center", justifyContent: "center" }}>Carregando...</div>;

  return (
    <div style={{ ...S.app, alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...S.card, width: 340, textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 6 }}>📡</div>
        <div style={{ ...S.logoTitle, fontSize: 22, marginBottom: 2 }}>NexusWatch Pro</div>
        <div style={{ ...S.logoSub, fontSize: 11, marginBottom: 24 }}>Infrastructure Monitor</div>
        <div style={S.fg}><input style={S.input} placeholder="Usuário" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        <div style={S.fg}><input style={S.input} type="password" placeholder="Senha" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
        {err && <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 10 }}>{err}</div>}
        <button style={{ ...S.btn("primary"), width: "100%" }} onClick={submit} disabled={loading}>
          {loading ? "..." : step === "setup" ? "Criar conta" : "Entrar"}
        </button>
      </div>
    </div>
  );
}

// ── Client Modal ──────────────────────────────────────────────
const EMPTY_CLIENT = {
  name: "", document: "", email: "", phone: "", address: "",
  city: "", state: "", plan: "basic", status: "active",
  telegram_token: "", telegram_chat_id: "", alert_email: "", notes: "",
};

function ClientModal({ client, onSave, onClose }) {
  const [form, setForm] = useState(client || { ...EMPTY_CLIENT });
  const [tab, setTab] = useState("info");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name) return setErr("Nome obrigatório");
    setLoading(true); setErr("");
    try {
      if (client?.id) await api(`/clients/${client.id}`, { method: "PUT", body: JSON.stringify(form) });
      else await api("/clients", { method: "POST", body: JSON.stringify(form) });
      onSave();
    } catch (e) { setErr(e.error || "Erro"); }
    finally { setLoading(false); }
  };

  const tabs = ["info", "contato", "alertas", "notas"];
  const tabLabel = { info: "📋 Info", contato: "📞 Contato", alertas: "🔔 Alertas", notas: "📝 Notas" };

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalTitle}>{client?.id ? "✏️ Editar Cliente" : "➕ Novo Cliente"}</div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {tabs.map((t) => (
            <button key={t} style={{ ...S.btn(tab === t ? "primary" : "ghost"), fontSize: 10, padding: "5px 10px" }}
              onClick={() => setTab(t)}>{tabLabel[t]}</button>
          ))}
        </div>

        {tab === "info" && (
          <>
            <div style={S.grid(2)}>
              <div style={S.fg}><label style={S.label}>Nome *</label><input style={S.input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Empresa ABC Ltda" /></div>
              <div style={S.fg}><label style={S.label}>CNPJ/CPF</label><input style={S.input} value={form.document} onChange={(e) => set("document", e.target.value)} placeholder="00.000.000/0001-00" /></div>
            </div>
            <div style={S.grid(2)}>
              <div style={S.fg}>
                <label style={S.label}>Plano</label>
                <select style={S.select} value={form.plan} onChange={(e) => set("plan", e.target.value)}>
                  {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div style={S.fg}>
                <label style={S.label}>Status</label>
                <select style={S.select} value={form.status} onChange={(e) => set("status", e.target.value)}>
                  <option value="active">✅ Ativo</option>
                  <option value="suspended">⏸ Suspenso</option>
                  <option value="cancelled">❌ Cancelado</option>
                </select>
              </div>
            </div>
          </>
        )}

        {tab === "contato" && (
          <>
            <div style={S.grid(2)}>
              <div style={S.fg}><label style={S.label}>Email</label><input style={S.input} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="contato@empresa.com" /></div>
              <div style={S.fg}><label style={S.label}>Telefone</label><input style={S.input} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(65) 99999-9999" /></div>
            </div>
            <div style={S.fg}><label style={S.label}>Endereço</label><input style={S.input} value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Rua das Flores, 123" /></div>
            <div style={S.grid(2)}>
              <div style={S.fg}><label style={S.label}>Cidade</label><input style={S.input} value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Paraíso do Tocantins" /></div>
              <div style={S.fg}><label style={S.label}>Estado</label><input style={S.input} value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="TO" /></div>
            </div>
          </>
        )}

        {tab === "alertas" && (
          <>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 10, color: "#4a6080" }}>
              💡 Configure o bot Telegram específico deste cliente para ele receber os próprios alertas
            </div>
            <div style={S.fg}><label style={S.label}>Telegram Token do Bot</label><input style={S.input} value={form.telegram_token} onChange={(e) => set("telegram_token", e.target.value)} placeholder="1234567890:AAH..." /></div>
            <div style={S.fg}><label style={S.label}>Telegram Chat ID</label><input style={S.input} value={form.telegram_chat_id} onChange={(e) => set("telegram_chat_id", e.target.value)} placeholder="123456789" /></div>
            <div style={S.fg}><label style={S.label}>Email para Alertas</label><input style={S.input} value={form.alert_email} onChange={(e) => set("alert_email", e.target.value)} placeholder="alertas@empresa.com" /></div>
          </>
        )}

        {tab === "notas" && (
          <div style={S.fg}>
            <label style={S.label}>Notas / Observações</label>
            <textarea style={{ ...S.input, minHeight: 100, resize: "vertical" }} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Informações sobre o cliente, contrato, observações..." />
          </div>
        )}

        {err && <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 10 }}>⚠️ {err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancelar</button>
          <button style={S.btn("primary")} onClick={save} disabled={loading}>{loading ? "..." : "Salvar Cliente"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Clients Page ──────────────────────────────────────────────
function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [modal, setModal] = useState(null);
  const [userModal, setUserModal] = useState(null);
  const [newUser, setNewUser] = useState({ username: "", password: "" });
  const [search, setSearch] = useState("");

  const load = () => api("/clients").then(setClients).catch(() => {});
  useEffect(() => { load(); }, []);

  const del = async (id) => {
    if (!confirm("Remover este cliente e todos os seus devices?")) return;
    await api(`/clients/${id}`, { method: "DELETE" });
    load();
  };

  const createUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await api(`/clients/${userModal}/users`, { method: "POST", body: JSON.stringify(newUser) });
    setUserModal(null); setNewUser({ username: "", password: "" });
  };

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.city || "").toLowerCase().includes(search.toLowerCase())
  );

  const statusColor = { active: "#22c55e", suspended: "#f59e0b", cancelled: "#ef4444" };
  const statusLabel = { active: "● ativo", suspended: "⏸ suspenso", cancelled: "✕ cancelado" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={S.pageTitle}>🏢 Clientes</div>
          <div style={S.pageSub}>Gerenciar clientes — {clients.length} cadastrado(s)</div>
        </div>
        <button style={S.btn("primary")} onClick={() => setModal("new")}>+ Novo Cliente</button>
      </div>

      <div style={{ ...S.card, marginBottom: 16, display: "flex", gap: 10 }}>
        <input style={{ ...S.input, maxWidth: 280 }} placeholder="🔍 Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span style={{ fontSize: 11, color: "#3a5070", alignSelf: "center" }}>{filtered.length} resultado(s)</span>
      </div>

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>{["Cliente", "Plano", "Status", "Devices", "Online", "Offline", "Cidade", "Ações"].map((h) => (
              <th key={h} style={S.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", color: "#3a5070", padding: 28 }}>Nenhum cliente cadastrado</td></tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id}>
                <td style={S.td}>
                  <div style={{ fontWeight: 700, color: "#f1f5f9" }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: "#3a5070" }}>{c.document || "—"}</div>
                </td>
                <td style={S.td}><span style={S.badge(planColor(c.plan))}>{c.plan}</span></td>
                <td style={S.td}><span style={S.badge(statusColor[c.status] || "#64748b")}>{statusLabel[c.status] || c.status}</span></td>
                <td style={{ ...S.td, color: "#38bdf8", fontWeight: 700 }}>{c.device_count || 0}</td>
                <td style={{ ...S.td, color: "#22c55e", fontWeight: 700 }}>{c.online_count || 0}</td>
                <td style={{ ...S.td, color: c.offline_count > 0 ? "#ef4444" : "#3a5070", fontWeight: 700 }}>{c.offline_count || 0}</td>
                <td style={S.td}>{c.city || "—"}</td>
                <td style={S.td}>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button style={S.btnSm()} onClick={() => setModal(c)} title="Editar">✏️</button>
                    <button style={S.btnSm()} onClick={() => setUserModal(c.id)} title="Criar usuário">👤</button>
                    <button style={S.btnSm("danger")} onClick={() => del(c.id)}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(modal === "new" || (modal && modal.id)) && (
        <ClientModal client={modal === "new" ? null : modal} onSave={() => { load(); setModal(null); }} onClose={() => setModal(null)} />
      )}

      {userModal && (
        <div style={S.modal} onClick={() => setUserModal(null)}>
          <div style={{ ...S.modalBox, width: 360 }} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>👤 Criar Acesso do Cliente</div>
            <div style={S.fg}><label style={S.label}>Usuário</label><input style={S.input} value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="cliente_abc" /></div>
            <div style={S.fg}><label style={S.label}>Senha</label><input style={S.input} type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="••••••••" /></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setUserModal(null)}>Cancelar</button>
              <button style={S.btn("primary")} onClick={createUser}>Criar Acesso</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Device Modal ──────────────────────────────────────────────
const EMPTY_DEVICE = {
  name: "", description: "", location: "", device_type: "other",
  ip_address: "", tags: [], snmp_community: "public", snmp_version: "2c",
  ssh_user: "", ssh_port: 22, monitor_ping: true, monitor_snmp: false,
  monitor_agent: true, notes: "", client_id: null,
};

function DeviceModal({ device, clients, userRole, userClientId, onSave, onClose }) {
  const [form, setForm] = useState(device ? { ...device, tags: device.tags || [] } : { ...EMPTY_DEVICE });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name) return setErr("Nome obrigatório");
    setLoading(true); setErr("");
    try {
      if (device?.id) await api(`/devices/${device.id}`, { method: "PUT", body: JSON.stringify(form) });
      else await api("/devices", { method: "POST", body: JSON.stringify(form) });
      onSave();
    } catch (e) { setErr(e.error || "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalTitle}>{device?.id ? "✏️ Editar Device" : "➕ Novo Device"}</div>

        {userRole === "superadmin" && clients && (
          <div style={S.fg}>
            <label style={S.label}>Cliente</label>
            <select style={S.select} value={form.client_id || ""} onChange={(e) => set("client_id", e.target.value ? parseInt(e.target.value) : null)}>
              <option value="">Sem cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div style={S.grid(2)}>
          <div style={S.fg}><label style={S.label}>Nome *</label><input style={S.input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Camera-Entrada" /></div>
          <div style={S.fg}>
            <label style={S.label}>Tipo</label>
            <select style={S.select} value={form.device_type} onChange={(e) => set("device_type", e.target.value)}>
              {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
            </select>
          </div>
        </div>
        <div style={S.grid(2)}>
          <div style={S.fg}><label style={S.label}>Endereço IP / DDNS</label><input style={S.input} value={form.ip_address} onChange={(e) => set("ip_address", e.target.value)} placeholder="192.168.1.100 ou ddns.net" /></div>
          <div style={S.fg}><label style={S.label}>Localização</label><input style={S.input} value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Bloco A / Rack 2" /></div>
        </div>
        <div style={S.fg}><label style={S.label}>Descrição</label><input style={S.input} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
        <div style={S.fg}><label style={S.label}>Tags</label><TagInput value={form.tags} onChange={(v) => set("tags", v)} /></div>

        <div style={S.divider} />
        <div style={S.sectionTitle}>Monitoramento</div>
        <div style={{ display: "flex", gap: 18, marginBottom: 12 }}>
          {[["monitor_agent","Agente"],["monitor_ping","Ping/ICMP"],["monitor_snmp","SNMP"]].map(([k,l]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#94a3b8", cursor: "pointer" }}>
              <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />{l}
            </label>
          ))}
        </div>
        {form.monitor_snmp && (
          <div style={S.grid(2)}>
            <div style={S.fg}><label style={S.label}>SNMP Community</label><input style={S.input} value={form.snmp_community} onChange={(e) => set("snmp_community", e.target.value)} /></div>
            <div style={S.fg}><label style={S.label}>SNMP Versão</label>
              <select style={S.select} value={form.snmp_version} onChange={(e) => set("snmp_version", e.target.value)}>
                <option value="1">v1</option><option value="2c">v2c</option><option value="3">v3</option>
              </select>
            </div>
          </div>
        )}
        <div style={S.grid(2)}>
          <div style={S.fg}><label style={S.label}>Usuário SSH</label><input style={S.input} value={form.ssh_user} onChange={(e) => set("ssh_user", e.target.value)} placeholder="admin" /></div>
          <div style={S.fg}><label style={S.label}>Porta SSH</label><input style={S.input} type="number" value={form.ssh_port} onChange={(e) => set("ssh_port", parseInt(e.target.value)||22)} /></div>
        </div>
        <div style={S.fg}><label style={S.label}>Notas</label><textarea style={{ ...S.input, minHeight: 50, resize: "vertical" }} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>

        {err && <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 10 }}>⚠️ {err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancelar</button>
          <button style={S.btn("primary")} onClick={save} disabled={loading}>{loading ? "..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Devices Page ──────────────────────────────────────────────
function DevicesPage({ userRole, userClientId }) {
  const [devices, setDevices] = useState([]);
  const [clients, setClients] = useState([]);
  const [modal, setModal] = useState(null);
  const [tokenModal, setTokenModal] = useState(null);
  const [filter, setFilter] = useState({ type: "", status: "", client: "", search: "" });

  const load = useCallback(() => {
    api("/devices").then(setDevices).catch(() => {});
    if (userRole === "superadmin") api("/clients").then(setClients).catch(() => {});
  }, [userRole]);

  useEffect(() => { load(); }, [load]);

  const del = async (id) => { if (!confirm("Remover?")) return; await api(`/devices/${id}`, { method: "DELETE" }); load(); };
  const regenToken = async (id) => { const d = await api(`/devices/${id}/regenerate-token`, { method: "POST" }); setTokenModal(d.token); load(); };

  const filtered = devices.filter((d) => {
    if (filter.type && d.device_type !== filter.type) return false;
    if (filter.status && d.status !== filter.status) return false;
    if (filter.client && String(d.client_id) !== filter.client) return false;
    if (filter.search && !d.name.toLowerCase().includes(filter.search.toLowerCase()) && !(d.ip_address||"").includes(filter.search)) return false;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={S.pageTitle}>🖥️ Devices</div>
          <div style={S.pageSub}>{devices.length} device(s) cadastrado(s)</div>
        </div>
        <button style={S.btn("primary")} onClick={() => setModal("new")}>+ Novo Device</button>
      </div>

      <div style={{ ...S.card, marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input style={{ ...S.input, maxWidth: 200 }} placeholder="🔍 Buscar..." value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
        <select style={{ ...S.select, maxWidth: 150 }} value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
          <option value="">Todos os tipos</option>
          {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
        </select>
        <select style={{ ...S.select, maxWidth: 120 }} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Todos status</option>
          <option value="online">🟢 Online</option>
          <option value="offline">🔴 Offline</option>
        </select>
        {userRole === "superadmin" && (
          <select style={{ ...S.select, maxWidth: 180 }} value={filter.client} onChange={(e) => setFilter({ ...filter, client: e.target.value })}>
            <option value="">Todos clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <span style={{ fontSize: 11, color: "#3a5070", alignSelf: "center" }}>{filtered.length} resultado(s)</span>
      </div>

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>{["Tipo", "Nome", "IP/DDNS", userRole === "superadmin" ? "Cliente" : null, "Status", "CPU", "Mem", "Lat", "Tags", "Ações"].filter(Boolean).map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", color: "#3a5070", padding: 28 }}>Nenhum device encontrado</td></tr>}
            {filtered.map((d) => (
              <tr key={d.id}>
                <td style={S.td}><span title={deviceLabel(d.device_type)} style={{ fontSize: 16 }}>{deviceIcon(d.device_type)}</span></td>
                <td style={S.td}><div style={{ fontWeight: 700, color: "#f1f5f9" }}>{d.name}</div><div style={{ fontSize: 9, color: "#3a5070" }}>{d.location||"—"}</div></td>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 10 }}>{d.ip_address||"—"}</td>
                {userRole === "superadmin" && <td style={S.td}><span style={{ fontSize: 10, color: "#38bdf8" }}>{d.client_name||"—"}</span></td>}
                <td style={S.td}><span style={S.badge(d.status==="online"?"#22c55e":"#ef4444")}>{d.status==="online"?"● on":"● off"}</span></td>
                <td style={S.td}>{d.last_cpu!=null?`${d.last_cpu.toFixed(1)}%`:"—"}</td>
                <td style={S.td}>{d.last_memory!=null?`${d.last_memory.toFixed(1)}%`:"—"}</td>
                <td style={S.td}>{d.last_latency!=null?`${Math.round(d.last_latency)}ms`:"—"}</td>
                <td style={S.td}>{(d.tags||[]).map((t) => <span key={t} style={S.tag}>#{t}</span>)}</td>
                <td style={S.td}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button style={S.btnSm()} onClick={() => setModal(d)}>✏️</button>
                    <button style={S.btnSm()} onClick={() => regenToken(d.id)}>🔑</button>
                    <button style={S.btnSm("danger")} onClick={() => del(d.id)}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(modal==="new"||(modal&&modal.id)) && (
        <DeviceModal device={modal==="new"?null:modal} clients={clients} userRole={userRole} userClientId={userClientId}
          onSave={() => { load(); setModal(null); }} onClose={() => setModal(null)} />
      )}
      {tokenModal && (
        <div style={S.modal} onClick={() => setTokenModal(null)}>
          <div style={{ ...S.modalBox, width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>🔑 Token do Device</div>
            <div style={{ ...S.input, wordBreak: "break-all", padding: 10, fontSize: 10, color: "#38bdf8", marginBottom: 14 }}>{tokenModal}</div>
            <button style={{ ...S.btn("primary"), width: "100%" }} onClick={() => { navigator.clipboard.writeText(tokenModal); setTokenModal(null); }}>📋 Copiar e Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────
function Dashboard({ userRole }) {
  const [stats, setStats] = useState({ devices: 0, online: 0, offline: 0, clients: 0 });
  const [devices, setDevices] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [clients, setClients] = useState([]);

  useEffect(() => {
    const load = () => {
      api("/stats").then(setStats).catch(() => {});
      api("/devices").then(setDevices).catch(() => {});
      api("/alerts").then(setAlerts).catch(() => {});
      if (userRole === "superadmin") api("/clients").then(setClients).catch(() => {});
    };
    load(); const t = setInterval(load, 10000); return () => clearInterval(t);
  }, [userRole]);

  const byType = DEVICE_TYPES.map((t) => ({ ...t, count: devices.filter((d) => d.device_type === t.value).length })).filter((t) => t.count > 0);

  return (
    <div>
      <div style={S.pageTitle}>📊 Dashboard</div>
      <div style={S.pageSub}>Visão geral — NexusWatch Pro</div>

      <div style={S.grid(userRole === "superadmin" ? 5 : 4)}>
        {[
          ...(userRole === "superadmin" ? [{ label: "Clientes", value: stats.clients, color: "#a78bfa" }] : []),
          { label: "Total Devices", value: stats.devices, color: "#38bdf8" },
          { label: "Online", value: stats.online, color: "#22c55e" },
          { label: "Offline", value: stats.offline, color: "#ef4444" },
          { label: "Alertas 24h", value: alerts.length, color: "#f59e0b" },
        ].map((s) => (
          <div key={s.label} style={S.statCard(s.color)}>
            <div style={S.statVal(s.color)}>{s.value}</div>
            <div style={S.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={S.grid(userRole === "superadmin" ? 3 : 2)}>
        <div style={S.card}>
          <div style={S.sectionTitle}>Devices por Tipo</div>
          {byType.length === 0 && <div style={{ color: "#3a5070", fontSize: 11 }}>Nenhum device</div>}
          {byType.map((t) => (
            <div key={t.value} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12 }}>{t.icon} {t.label}</span>
              <span style={S.badge("#38bdf8")}>{t.count}</span>
            </div>
          ))}
        </div>

        {userRole === "superadmin" && (
          <div style={S.card}>
            <div style={S.sectionTitle}>Top Clientes</div>
            {clients.slice(0, 6).map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#f1f5f9" }}>{c.name}</div>
                  <div style={{ fontSize: 9, color: "#3a5070" }}>{c.city||"—"}</div>
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  <span style={S.badge("#22c55e")}>{c.online_count||0} on</span>
                  {(c.offline_count||0) > 0 && <span style={S.badge("#ef4444")}>{c.offline_count} off</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={S.card}>
          <div style={S.sectionTitle}>Alertas Recentes</div>
          {alerts.slice(0, 5).length === 0 && <div style={{ color: "#3a5070", fontSize: 11 }}>Nenhum alerta</div>}
          {alerts.slice(0, 5).map((a) => (
            <div key={a.id} style={{ marginBottom: 9, paddingBottom: 9, borderBottom: "1px solid #0d1520" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "#f1f5f9" }}>{a.trigger_name || a.expression}</span>
                <span style={S.badge(a.alert_type==="offline"?"#ef4444":"#f59e0b")}>{a.alert_type==="offline"?"🔴 off":"⚠️"}</span>
              </div>
              <div style={{ fontSize: 10, color: "#3a5070" }}>{a.device_name||a.host} {a.client_name ? `— ${a.client_name}` : ""}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={S.card}>
        <div style={S.sectionTitle}>Devices Online com Métricas</div>
        <div style={S.grid(4)}>
          {devices.filter((d) => d.status==="online" && d.last_cpu!=null).slice(0,8).map((d) => (
            <div key={d.id} style={{ ...S.card, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{deviceIcon(d.device_type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                  {userRole === "superadmin" && <div style={{ fontSize: 9, color: "#3a5070" }}>{d.client_name||"—"}</div>}
                </div>
              </div>
              {[{l:"CPU",v:d.last_cpu,c:"#38bdf8"},{l:"MEM",v:d.last_memory,c:"#a78bfa"}].map((m) => (
                <div key={m.l} style={{ marginBottom: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3a5070" }}>
                    <span>{m.l}</span><span style={{ color: m.c }}>{(m.v||0).toFixed(1)}%</span>
                  </div>
                  <Bar value={m.v} color={m.c} />
                </div>
              ))}
              <div style={{ fontSize: 9, color: "#3a5070", marginTop: 4 }}>📡 {Math.round(d.last_latency||0)}ms</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Alerts Page ───────────────────────────────────────────────
function AlertsPage({ userRole }) {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState("all");
  const [clients, setClients] = useState([]);
  const [clientFilter2, setClientFilter2] = useState("");

  const load = () => {
    api("/alerts").then(setAlerts).catch(() => {});
    if (userRole === "superadmin") api("/clients").then(setClients).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  const filtered = alerts.filter((a) => {
    if (filter === "offline" && a.alert_type !== "offline") return false;
    if (filter === "threshold" && a.alert_type !== "threshold") return false;
    if (clientFilter2 && String(a.client_id) !== clientFilter2) return false;
    return true;
  });

  return (
    <div>
      <div style={S.pageTitle}>🚨 Alertas</div>
      <div style={S.pageSub}>Histórico de alertas — {alerts.length} total</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["all","Todos"],["offline","🔴 Offline"],["threshold","⚠️ Threshold"]].map(([v,l]) => (
          <button key={v} style={S.btn(filter===v?"primary":"ghost")} onClick={() => setFilter(v)}>{l}</button>
        ))}
        {userRole === "superadmin" && (
          <select style={{ ...S.select, maxWidth: 180 }} value={clientFilter2} onChange={(e) => setClientFilter2(e.target.value)}>
            <option value="">Todos os clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>{["Tipo", "Device", userRole==="superadmin"?"Cliente":null, "Métrica", "Valor", "Limite", "Horário"].filter(Boolean).map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", color: "#3a5070", padding: 28 }}>Nenhum alerta</td></tr>}
            {filtered.map((a) => (
              <tr key={a.id}>
                <td style={S.td}><span style={S.badge(a.alert_type==="offline"?"#ef4444":"#f59e0b")}>{a.alert_type==="offline"?"🔴 Offline":"⚠️ Threshold"}</span></td>
                <td style={S.td}>
                  <div style={{ fontWeight: 600, color: "#f1f5f9" }}>{a.device_name||"—"}</div>
                  <div style={{ fontSize: 9, color: "#3a5070", fontFamily: "monospace" }}>{a.host}</div>
                </td>
                {userRole === "superadmin" && <td style={S.td}><span style={{ fontSize: 10, color: "#38bdf8" }}>{a.client_name||"—"}</span></td>}
                <td style={S.td}>{EXPRESSIONS.find((e) => e.value===a.expression)?.label || a.expression}</td>
                <td style={{ ...S.td, color: a.alert_type==="offline"?"#ef4444":"#f59e0b", fontWeight: 700 }}>{a.value!=null?a.value.toFixed(1):"—"}</td>
                <td style={S.td}>{a.threshold!=null?a.threshold:"—"}</td>
                <td style={{ ...S.td, fontSize: 10, color: "#3a5070" }}>{new Date(a.fired_at).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Triggers Page ─────────────────────────────────────────────
function TriggersPage({ userRole }) {
  const [triggers, setTriggers] = useState([]);
  const [clients, setClients] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: "", expression: "cpu", threshold: 80, enabled: true, device_type: "", tags: [], client_id: null });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = () => {
    api("/triggers").then(setTriggers).catch(() => {});
    if (userRole === "superadmin") api("/clients").then(setClients).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name) return;
    try {
      if (modal?.id) await api(`/triggers/${modal.id}`, { method: "PUT", body: JSON.stringify(form) });
      else await api("/triggers", { method: "POST", body: JSON.stringify(form) });
      load(); setModal(null);
    } catch {}
  };

  const del = async (id) => { if (!confirm("Remover?")) return; await api(`/triggers/${id}`, { method: "DELETE" }); load(); };
  const toggle = async (t) => { await api(`/triggers/${t.id}`, { method: "PUT", body: JSON.stringify({ ...t, enabled: !t.enabled }) }); load(); };

  const openNew = () => { setForm({ name: "", expression: "cpu", threshold: 80, enabled: true, device_type: "", tags: [], client_id: null }); setModal({}); };
  const openEdit = (t) => { setForm({ ...t, tags: t.tags||[] }); setModal(t); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div><div style={S.pageTitle}>⚡ Triggers</div><div style={S.pageSub}>Regras de alerta automático</div></div>
        <button style={S.btn("primary")} onClick={openNew}>+ Novo Trigger</button>
      </div>

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{["Status","Nome","Métrica","Limite",userRole==="superadmin"?"Cliente":null,"Ações"].filter(Boolean).map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {triggers.length === 0 && <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", color: "#3a5070", padding: 28 }}>Nenhum trigger</td></tr>}
            {triggers.map((t) => (
              <tr key={t.id}>
                <td style={S.td}><span style={S.badge(t.enabled?"#22c55e":"#3a5070")}>{t.enabled?"● ativo":"○ inativo"}</span></td>
                <td style={{ ...S.td, fontWeight: 600, color: "#f1f5f9" }}>{t.name}</td>
                <td style={S.td}>{EXPRESSIONS.find((e) => e.value===t.expression)?.label||t.expression}</td>
                <td style={{ ...S.td, color: "#f59e0b", fontWeight: 700 }}>{t.threshold}</td>
                {userRole === "superadmin" && <td style={S.td}><span style={{ fontSize: 10, color: "#38bdf8" }}>{clients.find((c) => c.id===t.client_id)?.name||"Todos"}</span></td>}
                <td style={S.td}>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button style={S.btnSm()} onClick={() => toggle(t)}>{t.enabled?"⏸":"▶️"}</button>
                    <button style={S.btnSm()} onClick={() => openEdit(t)}>✏️</button>
                    <button style={S.btnSm("danger")} onClick={() => del(t.id)}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <div style={S.modal} onClick={() => setModal(null)}>
          <div style={{ ...S.modalBox, width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>{modal?.id ? "✏️ Editar Trigger" : "➕ Novo Trigger"}</div>
            <div style={S.fg}><label style={S.label}>Nome *</label><input style={S.input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="CPU Alta — Servidor" /></div>
            <div style={S.grid(2)}>
              <div style={S.fg}><label style={S.label}>Métrica</label>
                <select style={S.select} value={form.expression} onChange={(e) => set("expression", e.target.value)}>
                  {EXPRESSIONS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>
              <div style={S.fg}><label style={S.label}>Limite</label><input style={S.input} type="number" value={form.threshold} onChange={(e) => set("threshold", parseFloat(e.target.value))} /></div>
            </div>
            {userRole === "superadmin" && (
              <div style={S.fg}><label style={S.label}>Aplicar ao cliente</label>
                <select style={S.select} value={form.client_id||""} onChange={(e) => set("client_id", e.target.value?parseInt(e.target.value):null)}>
                  <option value="">Todos os clientes</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div style={S.fg}><label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#94a3b8", cursor: "pointer" }}><input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />Trigger ativo</label></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>Cancelar</button>
              <button style={S.btn("primary")} onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Solar ─────────────────────────────────────────────────────
const BRANDS = [
  { value: "growatt",  label: "Growatt",           icon: "🟠" },
  { value: "fronius",  label: "Fronius",            icon: "🔵" },
  { value: "deye",     label: "Deye",               icon: "🟡" },
  { value: "solis",    label: "Solis",              icon: "🟤" },
  { value: "sma",      label: "SMA",                icon: "⚫" },
  { value: "goodwe",   label: "GoodWe",             icon: "🟢" },
  { value: "huawei",   label: "Huawei FusionSolar", icon: "🔴" },
  { value: "canadian", label: "Canadian Solar",     icon: "🍁" },
  { value: "saj",      label: "SAJ elekeeper",      icon: "🟡" },
  { value: "risen",    label: "Risen Energy",       icon: "🌟" },
  { value: "other",    label: "Outro (Genérico)",   icon: "☀️" },
];

const brandIcon  = (b) => BRANDS.find((x) => x.value === b)?.icon || "☀️";
const brandLabel = (b) => BRANDS.find((x) => x.value === b)?.label || b;

const EMPTY_INVERTER = {
  name: "", brand: "growatt", model: "", location: "",
  capacity_kwp: "", tariff_kwh: "0.85", client_id: null,
  growatt_user: "", growatt_pass: "", growatt_plant_id: "",
  fronius_ip: "", fronius_device_id: 1,
  solarman_token: "", solarman_app_id: "", solarman_logger_sn: "",
  sma_user: "", sma_pass: "", sma_plant_id: "",
  goodwe_user: "", goodwe_pass: "", goodwe_station_id: "",
  huawei_user: "", huawei_pass: "", huawei_station_id: "",
  saj_user: "", saj_pass: "", saj_plant_id: "",
  api_url: "", api_key: "", notes: "",
};

function InverterModal({ inverter, clients, userRole, onSave, onClose }) {
  const [form, setForm] = useState(inverter || { ...EMPTY_INVERTER });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name || !form.brand) return setErr("Nome e marca obrigatórios");
    setLoading(true); setErr("");
    try {
      if (inverter?.id) await api(`/solar/inverters/${inverter.id}`, { method: "PUT", body: JSON.stringify(form) });
      else await api("/solar/inverters", { method: "POST", body: JSON.stringify(form) });
      onSave();
    } catch (e) { setErr(e.error || "Erro ao salvar"); }
    finally { setLoading(false); }
  };

  const brand = form.brand;

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={{ ...S.modalBox, width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalTitle}>{inverter?.id ? "✏️ Editar Inversor" : "➕ Novo Inversor Solar"}</div>

        <div style={S.sectionTitle}>Identificação</div>
        {userRole === "superadmin" && clients && (
          <div style={S.fg}><label style={S.label}>Cliente</label>
            <select style={S.select} value={form.client_id||""} onChange={(e) => set("client_id", e.target.value ? parseInt(e.target.value) : null)}>
              <option value="">Sem cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div style={S.grid(2)}>
          <div style={S.fg}><label style={S.label}>Nome *</label>
            <input style={S.input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Solar - Empresa ABC" />
          </div>
          <div style={S.fg}><label style={S.label}>Marca *</label>
            <select style={S.select} value={form.brand} onChange={(e) => set("brand", e.target.value)}>
              {BRANDS.map((b) => <option key={b.value} value={b.value}>{b.icon} {b.label}</option>)}
            </select>
          </div>
        </div>

        <div style={S.grid(2)}>
          <div style={S.fg}><label style={S.label}>Modelo</label>
            <input style={S.input} value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="ex: MIN 5000TL-X" />
          </div>
          <div style={S.fg}><label style={S.label}>Localização</label>
            <input style={S.input} value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="ex: Telhado principal" />
          </div>
        </div>

        <div style={S.grid(2)}>
          <div style={S.fg}><label style={S.label}>Capacidade instalada (kWp)</label>
            <input style={S.input} type="number" value={form.capacity_kwp} onChange={(e) => set("capacity_kwp", e.target.value)} placeholder="ex: 5.5" />
          </div>
          <div style={S.fg}><label style={S.label}>Tarifa R$/kWh</label>
            <input style={S.input} type="number" step="0.01" value={form.tariff_kwh} onChange={(e) => set("tariff_kwh", e.target.value)} placeholder="0.85" />
            <span style={{ fontSize: 9, color: "#3a5070" }}>Usado para calcular receita</span>
          </div>
        </div>

        <div style={S.divider} />

        <div style={S.sectionTitle}>{brandIcon(brand)} Configuração {brandLabel(brand)}</div>

        {brand === "growatt" && (
          <>
            <div style={S.fg}><label style={S.label}>Usuário ShineServer</label>
              <input style={S.input} value={form.growatt_user} onChange={(e) => set("growatt_user", e.target.value)} placeholder="seu@email.com" />
            </div>
            <div style={S.fg}><label style={S.label}>Senha ShineServer</label>
              <input style={S.input} type="password" value={form.growatt_pass} onChange={(e) => set("growatt_pass", e.target.value)} placeholder="••••••••" />
            </div>
            <div style={S.fg}><label style={S.label}>Plant ID (opcional — deixe vazio para auto)</label>
              <input style={S.input} value={form.growatt_plant_id} onChange={(e) => set("growatt_plant_id", e.target.value)} placeholder="Auto detectado" />
            </div>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, fontSize: 10, color: "#4a6080" }}>
              💡 Acesse <b>server.growatt.com</b> para obter suas credenciais
            </div>
          </>
        )}

        {brand === "fronius" && (
          <>
            <div style={S.fg}><label style={S.label}>IP do Inversor na rede local</label>
              <input style={S.input} value={form.fronius_ip} onChange={(e) => set("fronius_ip", e.target.value)} placeholder="192.168.1.150" />
            </div>
            <div style={S.fg}><label style={S.label}>Device ID (padrão: 1)</label>
              <input style={S.input} type="number" value={form.fronius_device_id} onChange={(e) => set("fronius_device_id", parseInt(e.target.value)||1)} />
            </div>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, fontSize: 10, color: "#4a6080" }}>
              💡 O Fronius precisa estar na mesma rede. Acesse o IP pelo navegador para confirmar
            </div>
          </>
        )}

        {(brand === "deye" || brand === "solis") && (
          <>
            <div style={S.fg}><label style={S.label}>SolarmanPV Token</label>
              <input style={S.input} value={form.solarman_token} onChange={(e) => set("solarman_token", e.target.value)} placeholder="Token da API SolarmanPV" />
            </div>
            <div style={S.fg}><label style={S.label}>App ID</label>
              <input style={S.input} value={form.solarman_app_id} onChange={(e) => set("solarman_app_id", e.target.value)} placeholder="App ID SolarmanPV" />
            </div>
            <div style={S.fg}><label style={S.label}>Logger Serial Number</label>
              <input style={S.input} value={form.solarman_logger_sn} onChange={(e) => set("solarman_logger_sn", e.target.value)} placeholder="Número de série do datalogger" />
            </div>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, fontSize: 10, color: "#4a6080" }}>
              💡 Acesse <b>home.solarmanpv.com</b> → API → Gerar token. O Logger SN está no app ou no equipamento
            </div>
          </>
        )}

        {brand === "sma" && (
          <>
            <div style={S.fg}><label style={S.label}>IP do Inversor SMA (rede local)</label>
              <input style={S.input} value={form.api_url} onChange={(e) => set("api_url", e.target.value)} placeholder="192.168.1.151" />
            </div>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, fontSize: 10, color: "#4a6080" }}>
              💡 SMA Sunny Boy/Tripower com WebConnect. Habilite o acesso na interface web do inversor
            </div>
          </>
        )}

        {brand === "goodwe" && (
          <>
            <div style={S.fg}><label style={S.label}>Usuário SEMS Portal</label>
              <input style={S.input} value={form.goodwe_user} onChange={(e) => set("goodwe_user", e.target.value)} placeholder="seu@email.com" />
            </div>
            <div style={S.fg}><label style={S.label}>Senha SEMS Portal</label>
              <input style={S.input} type="password" value={form.goodwe_pass} onChange={(e) => set("goodwe_pass", e.target.value)} placeholder="••••••••" />
            </div>
            <div style={S.fg}><label style={S.label}>Station ID</label>
              <input style={S.input} value={form.goodwe_station_id} onChange={(e) => set("goodwe_station_id", e.target.value)} placeholder="ID da planta no SEMS" />
            </div>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, fontSize: 10, color: "#4a6080" }}>
              💡 Acesse <b>www.semsportal.com</b> para obter suas credenciais e Station ID
            </div>
          </>
        )}

        {brand === "huawei" && (
          <>
            <div style={S.fg}><label style={S.label}>Usuário FusionSolar</label>
              <input style={S.input} value={form.huawei_user} onChange={(e) => set("huawei_user", e.target.value)} placeholder="seu@email.com" />
            </div>
            <div style={S.fg}><label style={S.label}>Senha FusionSolar</label>
              <input style={S.input} type="password" value={form.huawei_pass} onChange={(e) => set("huawei_pass", e.target.value)} placeholder="••••••••" />
            </div>
            <div style={S.fg}><label style={S.label}>Station ID</label>
              <input style={S.input} value={form.huawei_station_id} onChange={(e) => set("huawei_station_id", e.target.value)} placeholder="ID da planta FusionSolar" />
            </div>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, fontSize: 10, color: "#4a6080" }}>
              💡 Acesse <b>intl.fusionsolar.huawei.com</b> para obter suas credenciais
            </div>
          </>
        )}

        {brand === "saj" && (
          <>
            <div style={S.sectionTitle}>⚙️ Configuração SAJ elekeeper</div>
            <div style={S.fg}><label style={S.label}>E-mail / Usuário elekeeper</label>
              <input style={S.input} value={form.saj_user||""} onChange={(e) => set("saj_user", e.target.value)} placeholder="seu@email.com" />
            </div>
            <div style={S.fg}><label style={S.label}>Senha elekeeper</label>
              <input style={S.input} type="password" value={form.saj_pass||""} onChange={(e) => set("saj_pass", e.target.value)} placeholder="••••••••" />
            </div>
            <div style={S.fg}><label style={S.label}>Plant ID (opcional — auto detectado)</label>
              <input style={S.input} value={form.saj_plant_id||""} onChange={(e) => set("saj_plant_id", e.target.value)} placeholder="Auto detectado" />
            </div>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, fontSize: 10, color: "#4a6080" }}>
              💡 Acesse <b>eop.saj-electric.com</b> e crie uma conta gratuita. Não precisa de instalador!
            </div>
          </>
        )}

        {(brand === "canadian" || brand === "risen" || brand === "other") && (
          <>
            <div style={S.fg}><label style={S.label}>URL da API (endpoint JSON)</label>
              <input style={S.input} value={form.api_url} onChange={(e) => set("api_url", e.target.value)} placeholder="http://192.168.1.100/api/data" />
            </div>
            <div style={S.fg}><label style={S.label}>API Key (se necessário)</label>
              <input style={S.input} value={form.api_key} onChange={(e) => set("api_key", e.target.value)} placeholder="Token ou chave de API" />
            </div>
            <div style={{ ...S.fg, background: "#0d1520", borderRadius: 6, padding: 10, fontSize: 10, color: "#4a6080" }}>
              💡 O sistema tentará extrair automaticamente: power_w, energy_today, energy_total da resposta JSON
            </div>
          </>
        )}

        <div style={S.divider} />
        <div style={S.fg}><label style={S.label}>Notas</label>
          <textarea style={{ ...S.input, minHeight: 50, resize: "vertical" }} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Informações adicionais..." />
        </div>

        {err && <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 10 }}>⚠️ {err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancelar</button>
          <button style={S.btn("primary")} onClick={save} disabled={loading}>{loading ? "..." : "Salvar Inversor"}</button>
        </div>
      </div>
    </div>
  );
}

function SolarPage({ userRole }) {
  const [inverters, setInverters] = useState([]);
  const [clients, setClients] = useState([]);
  const [summary, setSummary] = useState({ total_inverters: 0, total_power_w: 0, energy_today_kwh: 0, revenue_today: 0 });
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ brand: "", client: "" });

  const load = useCallback(() => {
    api("/solar/inverters").then(setInverters).catch(() => {});
    api("/solar/summary").then(setSummary).catch(() => {});
    if (userRole === "superadmin") api("/clients").then(setClients).catch(() => {});
  }, [userRole]);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const del = async (id) => { if (!confirm("Remover inversor?")) return; await api(`/solar/inverters/${id}`, { method: "DELETE" }); load(); };

  const filtered = inverters.filter((inv) => {
    if (filter.brand && inv.brand !== filter.brand) return false;
    if (filter.client && String(inv.client_id) !== filter.client) return false;
    return true;
  });

  const statusColor = { generating: "#22c55e", idle: "#f59e0b", offline: "#ef4444", fault: "#ef4444", unknown: "#3a5070" };
  const statusLabel = { generating: "⚡ Gerando", idle: "😴 Aguardando", offline: "🔴 Offline", fault: "⚠️ Falha", unknown: "❓ Desconhecido" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={S.pageTitle}>☀️ Solar</div>
          <div style={S.pageSub}>Monitoramento de inversores fotovoltaicos</div>
        </div>
        <button style={S.btn("primary")} onClick={() => setModal("new")}>+ Novo Inversor</button>
      </div>

      <div style={S.grid(4)}>
        {[
          { label: "Inversores", value: summary.total_inverters, color: "#f59e0b", suffix: "" },
          { label: "Potência Atual", value: (summary.total_power_w/1000).toFixed(2), color: "#38bdf8", suffix: " kW" },
          { label: "Energia Hoje", value: (summary.energy_today_kwh||0).toFixed(2), color: "#22c55e", suffix: " kWh" },
          { label: "Receita Hoje", value: `R$ ${(summary.revenue_today||0).toFixed(2)}`, color: "#a78bfa", suffix: "" },
        ].map((s) => (
          <div key={s.label} style={S.statCard(s.color)}>
            <div style={S.statVal(s.color)}>{s.value}{s.suffix}</div>
            <div style={S.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.card, marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <select style={{ ...S.select, maxWidth: 160 }} value={filter.brand} onChange={(e) => setFilter({ ...filter, brand: e.target.value })}>
          <option value="">Todas as marcas</option>
          {BRANDS.map((b) => <option key={b.value} value={b.value}>{b.icon} {b.label}</option>)}
        </select>
        {userRole === "superadmin" && (
          <select style={{ ...S.select, maxWidth: 180 }} value={filter.client} onChange={(e) => setFilter({ ...filter, client: e.target.value })}>
            <option value="">Todos os clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <span style={{ fontSize: 11, color: "#3a5070", alignSelf: "center" }}>{filtered.length} inversor(es)</span>
      </div>

      <div style={S.grid(3)}>
        {filtered.length === 0 && (
          <div style={{ ...S.card, gridColumn: "1/-1", textAlign: "center", padding: 40, color: "#3a5070" }}>
            ☀️ Nenhum inversor cadastrado. Clique em <b>+ Novo Inversor</b> para começar!
          </div>
        )}
        {filtered.map((inv) => {
          const status = inv.last_status || "unknown";
          const power  = (inv.last_power || 0) / 1000;
          const energy = inv.last_energy_today || 0;
          const revenue = inv.last_revenue_today || 0;
          const totalEnergy = inv.last_energy_total || 0;
          const totalRevenue = inv.last_revenue_total || 0;

          return (
            <div key={inv.id} style={{ ...S.card, border: `1px solid ${statusColor[status]}25` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 22 }}>{brandIcon(inv.brand)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{inv.name}</div>
                  <div style={{ fontSize: 10, color: "#3a5070" }}>{brandLabel(inv.brand)} {inv.model ? `— ${inv.model}` : ""}</div>
                </div>
                <span style={S.badge(statusColor[status])}>{statusLabel[status] || status}</span>
              </div>

              {inv.location && <div style={{ fontSize: 10, color: "#3a5070", marginBottom: 10 }}>📍 {inv.location}</div>}
              {userRole === "superadmin" && inv.client_name && (
                <div style={{ fontSize: 10, color: "#38bdf8", marginBottom: 10 }}>🏢 {inv.client_name}</div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  { label: "Potência", value: `${power.toFixed(2)} kW`, color: "#38bdf8", icon: "⚡" },
                  { label: "Hoje", value: `${energy.toFixed(2)} kWh`, color: "#22c55e", icon: "☀️" },
                  { label: "Receita Hoje", value: `R$ ${revenue.toFixed(2)}`, color: "#a78bfa", icon: "💰" },
                  { label: "Total", value: `${totalEnergy.toFixed(0)} kWh`, color: "#f59e0b", icon: "📊" },
                ].map((m) => (
                  <div key={m.label} style={{ background: "#080c14", borderRadius: 6, padding: 8 }}>
                    <div style={{ fontSize: 9, color: "#3a5070" }}>{m.icon} {m.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#0d1520", borderRadius: 6, padding: 8, marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, color: "#3a5070" }}>💵 Receita Total Acumulada</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#a78bfa" }}>R$ {totalRevenue.toFixed(2)}</span>
              </div>

              {inv.capacity_kwp > 0 && (
                <div style={{ fontSize: 10, color: "#3a5070", marginBottom: 10 }}>
                  🔋 Capacidade: <b style={{ color: "#94a3b8" }}>{inv.capacity_kwp} kWp</b>
                  {" | "}Tarifa: <b style={{ color: "#94a3b8" }}>R$ {inv.tariff_kwh}/kWh</b>
                </div>
              )}

              {inv.last_update && (
                <div style={{ fontSize: 9, color: "#3a5070", marginBottom: 10 }}>
                  🕐 {new Date(inv.last_update).toLocaleString("pt-BR")}
                </div>
              )}

              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ ...S.btn("ghost"), fontSize: 10, flex: 1 }} onClick={() => setModal(inv)}>✏️ Editar</button>
                <button style={{ ...S.btnSm("danger") }} onClick={() => del(inv.id)}>🗑️</button>
              </div>
            </div>
          );
        })}
      </div>

      {(modal === "new" || (modal && modal.id)) && (
        <InverterModal
          inverter={modal === "new" ? null : modal}
          clients={clients}
          userRole={userRole}
          onSave={() => { load(); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [userRole, setUserRole] = useState("superadmin");
  const [userClientId, setUserClientId] = useState(null);
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    if (authed) {
      api("/auth/me").then((u) => { setUserRole(u.role); setUserClientId(u.client_id); }).catch(() => {});
    }
  }, [authed]);

  if (!authed) return <AuthPage onLogin={(role, cid) => { setUserRole(role); setUserClientId(cid); setAuthed(true); }} />;

  const isSuperAdmin = userRole === "superadmin";

  const NAV_SUPERADMIN = [
    { section: "GERAL" },
    { id: "dashboard", label: "Dashboard",  icon: "📊" },
    { section: "GERENCIAR" },
    { id: "clients",   label: "Clientes",   icon: "🏢" },
    { id: "devices",   label: "Devices",    icon: "🖥️" },
    { id: "triggers",  label: "Triggers",   icon: "⚡" },
    { id: "alerts",    label: "Alertas",    icon: "🚨" },
    { id: "solar", label: "Solar", icon: "☀️" },
  ];

  const NAV_CLIENT = [
    { section: "MENU" },
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "devices",   label: "Devices",   icon: "🖥️" },
    { id: "alerts",    label: "Alertas",   icon: "🚨" },
  ];

  const NAV = isSuperAdmin ? NAV_SUPERADMIN : NAV_CLIENT;

  const PAGES = {
    dashboard: <Dashboard userRole={userRole} />,
    clients:   <ClientsPage />,
    devices:   <DevicesPage userRole={userRole} userClientId={userClientId} />,
    triggers:  <TriggersPage userRole={userRole} />,
    alerts:    <AlertsPage userRole={userRole} />,
    solar: <SolarPage userRole={userRole} />,
  };

  return (
    <div style={S.app}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#080c14}::-webkit-scrollbar-thumb{background:#1a2535;border-radius:3px}input[type=checkbox]{accent-color:#38bdf8}@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap')`}</style>

      <div style={S.sidebar}>
        <div style={S.logo}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>📡</div>
          <div style={S.logoTitle}>NexusWatch Pro</div>
          <div style={S.logoSub}>{isSuperAdmin ? "⚡ Superadmin" : "👤 Cliente"}</div>
        </div>

        {NAV.map((n, i) =>
          n.section
            ? <div key={i} style={S.navSection}>{n.section}</div>
            : <div key={n.id} style={S.navItem(page===n.id)} onClick={() => setPage(n.id)}>
                <span>{n.icon}</span><span>{n.label}</span>
              </div>
        )}

        <div style={{ marginTop: "auto", padding: "0 16px" }}>
          <button style={{ ...S.btn("ghost"), width: "100%", fontSize: 10 }} onClick={() => { removeToken(); setAuthed(false); }}>
            ⏻ Sair
          </button>
        </div>
      </div>

      <div style={S.main}>{PAGES[page] || PAGES.dashboard}</div>
    </div>
  );
}