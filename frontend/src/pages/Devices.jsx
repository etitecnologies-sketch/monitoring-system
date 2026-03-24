import { useState, useEffect } from "react";
import { api } from "../api";

function StatusBadge({ status, lastSeen }) {
  const isOnline = lastSeen && (Date.now() - new Date(lastSeen)) < 30000;
  const color = isOnline ? "#00f2ff" : status === "pending" ? "#ffae00" : "#ff0055";
  const label = isOnline ? "ONLINE" : status === "pending" ? "PENDING" : "OFFLINE";
  return (
    <span style={{ 
      display:"inline-flex", 
      alignItems:"center", 
      gap:6, 
      fontSize:10,
      background: `${color}15`,
      color, 
      border:`1px solid ${color}40`, 
      borderRadius:4, 
      padding:"4px 10px", 
      fontWeight:700,
      letterSpacing: 1,
      textShadow: `0 0 8px ${color}44`
    }}>
      <span style={{ 
        width:6, 
        height:6, 
        borderRadius:"50%", 
        background:color, 
        display:"inline-block",
        boxShadow: `0 0 8px ${color}`
      }}/>
      {label}
    </span>
  );
}

function TokenBox({ token }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(token);
    setCopied(true); setTimeout(()=>setCopied(false), 2000);
  }
  return (
    <div style={{ 
      background:"rgba(5, 5, 10, 0.6)", 
      border:"1px solid rgba(56, 189, 248, 0.2)", 
      borderRadius:8,
      padding:"10px 14px", 
      display:"flex", 
      alignItems:"center", 
      gap:10, 
      marginTop:10 
    }}>
      <code style={{ 
        flex:1, 
        fontSize:12, 
        color:"#38bdf8", 
        overflow:"hidden", 
        textOverflow:"ellipsis", 
        whiteSpace:"nowrap",
        fontFamily: "'JetBrains Mono', monospace"
      }}>
        {show ? token : "••••••••••••••••••••••••••••••••"}
      </code>
      <button onClick={()=>setShow(s=>!s)} style={{...S.iconBtn, color: "#64748b"}} title={show?"Hide":"Show"}>
        {show ? "🙈" : "👁"}
      </button>
      <button onClick={copy} style={{...S.iconBtn, color: copied ? "#00f2ff" : "#64748b"}} title="Copy">
        {copied ? "✓" : "📋"}
      </button>
    </div>
  );
}

function DeviceModal({ device, onClose, onSave }) {
  const [name, setName]     = useState(device?.name || "");
  const [desc, setDesc]     = useState(device?.description || "");
  const [loc, setLoc]       = useState(device?.location || "");
  const [type, setType]     = useState(device?.device_type || "server");
  const [ip, setIp]         = useState(device?.ip_address || "");
  const [ddns, setDdns]     = useState(device?.ddns_address || "");
  const [port, setPort]     = useState(device?.monitor_port || "");
  const [ping, setPing]     = useState(device?.monitor_ping !== false);
  const [agent, setAgent]   = useState(device?.monitor_agent !== false);
  const [tags, setTags]     = useState(device?.tags?.join(", ") || "");
  
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [newToken, setNewToken] = useState(null);

  const deviceTypes = [
    { value: "server", label: "Servidor", icon: "🖥️" },
    { value: "camera", label: "Câmera IP / DVR", icon: "📷" },
    { value: "router", label: "Roteador", icon: "🌐" },
    { value: "switch", label: "Switch", icon: "🔀" },
    { value: "other", label: "Outro", icon: "📦" },
  ];

  async function save() {
    if (!name.trim()) return;
    setLoading(true);
    const data = { 
      name: name.trim(), 
      description: desc, 
      location: loc,
      device_type: type,
      ip_address: ip,
      ddns_address: ddns,
      monitor_port: parseInt(port) || 0,
      monitor_ping: ping,
      monitor_agent: agent,
      tags: tags.split(",").map(t => t.trim()).filter(t => t !== ""),
      notes: device?.notes || ""
    };
    
    try {
      console.log("[Save] Sending data:", data);
      if (device) {
        const res = await api.updateDevice(device.id, data);
        console.log("[Save] Update response:", res);
      } else {
        const res = await api.createDevice(data);
        console.log("[Save] Create response:", res);
        setNewToken(res.token);
        onSave(res);
        setLoading(false);
        return;
      }
      onSave();
      onClose();
    } catch (err) {
      console.error("[Save] Error detail:", err);
      alert("Erro ao salvar: " + (err.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }

  async function testConn() {
    if (!ddns || !port) return alert("Configure DDNS e Porta para testar");
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testDevice(device.id);
      setTestResult(res);
    } catch (err) {
      setTestResult({ alive: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }

  async function regenToken() {
    if (!confirm("Regenerate token? The old token will stop working.")) return;
    const res = await api.regenToken(device.id);
    setNewToken(res.token);
  }

  return (
    <div style={S.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{...S.modal, maxWidth: 700}}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>{device ? `Edit: ${device.name}` : "Add new device"}</span>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        {newToken && (
          <div style={S.tokenAlert}>
            <div style={{ fontSize:13, fontWeight:600, color:"#10b981", marginBottom:4 }}>
              ✓ Device created! Save this token — it won't be shown again.
            </div>
            <TokenBox token={newToken} />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Coluna 1: Básico */}
          <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
            <div style={S.formGroup}>
              <label style={S.label}>Nome do Dispositivo *</label>
              <input style={S.input} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex: Camera Portaria" />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Tipo</label>
              <select style={S.input} value={type} onChange={e=>setType(e.target.value)}>
                {deviceTypes.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Localização</label>
              <input style={S.input} value={loc} onChange={e=>setLoc(e.target.value)} placeholder="Ex: Matriz / SP" />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Tags (separadas por vírgula)</label>
              <input style={S.input} value={tags} onChange={e=>setTags(e.target.value)} placeholder="camera, intelbras, porto" />
            </div>
          </div>

          {/* Coluna 2: Conectividade */}
          <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
            <div style={S.formGroup}>
              <label style={S.label}>Endereço DDNS / No-IP</label>
              <input style={S.input} value={ddns} onChange={e=>setDdns(e.target.value)} placeholder="exemplo.ddns-intelbras.com.br" />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Porta de Serviço (TCP)</label>
              <input style={S.input} type="number" value={port} onChange={e=>setPort(e.target.value)} placeholder="37777" />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>IP Local</label>
              <input style={S.input} value={ip} onChange={e=>setIp(e.target.value)} placeholder="192.168.0.102" />
            </div>
            
            <div style={{ background: "rgba(99, 102, 241, 0.05)", padding: 12, borderRadius: 10, border: "1px solid rgba(99, 102, 241, 0.1)" }}>
              <label style={{ ...S.label, marginBottom: 8, display: "block" }}>Opções de Monitoramento</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none" }}>
                  <input type="checkbox" checked={ping} onChange={e=>setPing(e.target.checked)} /> Ping
                </label>
                <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none" }}>
                  <input type="checkbox" checked={agent} onChange={e=>setAgent(e.target.checked)} /> Agente
                </label>
              </div>
            </div>
          </div>
        </div>

        {device && (
          <div style={{ borderTop: "1px solid #1e1e2e", paddingTop: 15, marginTop: 5 }}>
             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={S.label}>Teste de Nuvem</label>
                <button onClick={testConn} disabled={testing || !ddns || !port} style={{...S.editBtn, background: "#10b98120", borderColor: "#10b98140", color: "#10b981"}}>
                  {testing ? "Testando..." : "⚡ Testar Agora"}
                </button>
             </div>
             {testResult && (
               <div style={{ marginTop: 10, padding: 10, borderRadius: 8, fontSize: 12, background: testResult.alive ? "#064e3b" : "#450a0a", color: testResult.alive ? "#34d399" : "#f87171" }}>
                 {testResult.alive ? "✅ " : "❌ "} {testResult.message}
               </div>
             )}
          </div>
        )}

        <div style={S.modalFoot}>
          <button onClick={onClose} style={S.cancelBtn}>Cancelar</button>
          {!newToken && (
            <button onClick={save} disabled={loading||!name.trim()} style={S.saveBtn}>
              {loading ? "Salvando..." : "Salvar Alterações"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentInstructions({ device }) {
  const [open, setOpen] = useState(false);
  if (!open) return (
    <button onClick={()=>setOpen(true)} style={{ ...S.iconBtn, fontSize:11, padding:"4px 8px", color:"#6366f1" }}>
      Setup guide
    </button>
  );
  const cmd = `INGEST_URL=https://your-api/metrics DEVICE_TOKEN=${device.token||"YOUR_TOKEN"} ./agent`;
  return (
    <div style={{ marginTop:8, background:"#0a0a0f", border:"1px solid #1e1e2e", borderRadius:8, padding:12 }}>
      <p style={{ fontSize:12, color:"#94a3b8", margin:"0 0 8px" }}>Run the agent on this device:</p>
      <code style={{ fontSize:11, color:"#a5b4fc", display:"block", wordBreak:"break-all" }}>{cmd}</code>
      <button onClick={()=>setOpen(false)} style={{ ...S.iconBtn, marginTop:8, fontSize:11 }}>Close</button>
    </div>
  );
}

export default function Devices() {
  const [devices, setDevices]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null); // null | "new" | device obj
  const [search, setSearch]     = useState("");

  async function load() {
    setLoading(true);
    const d = await api.devices();
    setDevices(Array.isArray(d) ? d : []);
    setLoading(false);
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return ()=>clearInterval(t); }, []);

  async function remove(dev) {
    if (!confirm(`Delete "${dev.name}"? All its metrics will be unlinked.`)) return;
    await api.deleteDevice(dev.id);
    load();
  }

  const filtered = devices.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.location?.toLowerCase().includes(search.toLowerCase()) ||
    d.description?.toLowerCase().includes(search.toLowerCase())
  );

  const online  = devices.filter(d => d.last_seen && (Date.now()-new Date(d.last_seen))<30000).length;
  const offline = devices.length - online;

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h2 style={S.pageTitle}>Devices</h2>
          <p style={S.pageSub}>
            <span style={S.pill("#10b981","#052e16")}>{online} online</span>
            <span style={S.pill("#64748b","#0f172a")}>{offline} offline</span>
            <span style={{ color:"#475569", fontSize:13 }}>{devices.length} total registered</span>
          </p>
        </div>
        <button onClick={()=>setModal("new")} style={S.addBtn}>+ Add device</button>
      </div>

      <div style={S.searchRow}>
        <input style={S.searchInput} value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search by name, location or description..." />
      </div>

      {loading && <div style={S.empty}>Loading devices...</div>}

      {!loading && filtered.length === 0 && (
        <div style={S.emptyState}>
          <div style={{ fontSize:48, marginBottom:16 }}>📡</div>
          <p style={{ color:"#f1f5f9", fontWeight:600, margin:"0 0 8px" }}>
            {search ? "No devices found" : "No devices yet"}
          </p>
          <p style={{ color:"#475569", fontSize:14, margin:"0 0 24px" }}>
            {search ? "Try a different search term" : "Add your first device and install the agent on it"}
          </p>
          {!search && <button onClick={()=>setModal("new")} style={S.addBtn}>+ Add first device</button>}
        </div>
      )}

      <div style={S.grid}>
        {filtered.map(dev => {
          const isOnline = dev.last_seen && (Date.now()-new Date(dev.last_seen))<30000;
          return (
            <div key={dev.id} style={{ ...S.card, borderColor: isOnline?"#10b98130":"#1e1e2e" }}>
              <div style={S.cardHead}>
                <div style={S.deviceIcon(isOnline)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={isOnline?"#10b981":"#475569"}>
                    <rect x="2" y="3" width="20" height="14" rx="2" stroke={isOnline?"#10b981":"#475569"} strokeWidth="1.5" fill="none"/>
                    <path d="M8 21h8M12 17v4" stroke={isOnline?"#10b981":"#475569"} strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={S.deviceName}>{dev.name}</div>
                  {dev.location && <div style={S.deviceSub}>📍 {dev.location}</div>}
                </div>
                <StatusBadge status={dev.status} lastSeen={dev.last_seen} />
              </div>

              {dev.description && <p style={S.deviceDesc}>{dev.description}</p>}

              {isOnline && (
                <div style={S.metricsRow}>
                  <div style={S.metricMini}>
                    <span style={S.metricLabel}>CPU</span>
                    <span style={{ ...S.metricVal, color: dev.last_cpu>80?"#f87171":dev.last_cpu>60?"#fb923c":"#10b981" }}>
                      {parseFloat(dev.last_cpu||0).toFixed(1)}%
                    </span>
                    <div style={S.bar}><div style={{ ...S.barFill("#6366f1"), width:`${Math.min(dev.last_cpu||0,100)}%` }}/></div>
                  </div>
                  <div style={S.metricMini}>
                    <span style={S.metricLabel}>Memory</span>
                    <span style={{ ...S.metricVal, color: dev.last_memory>80?"#f87171":dev.last_memory>60?"#fb923c":"#10b981" }}>
                      {parseFloat(dev.last_memory||0).toFixed(1)}%
                    </span>
                    <div style={S.bar}><div style={{ ...S.barFill("#f59e0b"), width:`${Math.min(dev.last_memory||0,100)}%` }}/></div>
                  </div>
                </div>
              )}

              {dev.last_seen && (
                <p style={S.lastSeen}>Last seen: {new Date(dev.last_seen).toLocaleString()}</p>
              )}

              {dev.hostname && <p style={S.lastSeen}>Hostname: <code style={{ color:"#94a3b8" }}>{dev.hostname}</code></p>}

              <div style={S.cardFoot}>
                <AgentInstructions device={dev} />
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={()=>setModal(dev)} style={S.editBtn}>Edit</button>
                  <button onClick={()=>remove(dev)} style={S.delBtn}>Delete</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modal && (
        <DeviceModal
          device={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { load(); if (modal !== "new") setModal(null); }}
        />
      )}
    </div>
  );
}

const S = {
  page:        { padding:24 },
  header:      { display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20, flexWrap:"wrap", gap:12 },
  pageTitle:   { fontSize:22, fontWeight:700, color:"#f1f5f9", margin:"0 0 8px" },
  pageSub:     { display:"flex", alignItems:"center", gap:10, margin:0 },
  pill:        (c,bg) => ({ fontSize:12, fontWeight:500, color:c, background:bg, border:`1px solid ${c}40`,
                            borderRadius:20, padding:"2px 10px" }),
  addBtn:      { background:"#6366f1", color:"#fff", border:"none", borderRadius:10,
                padding:"10px 18px", fontSize:14, fontWeight:600, cursor:"pointer" },
  searchRow:   { marginBottom:20 },
  searchInput: { width:"100%", background:"#13131a", border:"1px solid #1e1e2e", borderRadius:10,
                padding:"11px 16px", color:"#f1f5f9", fontSize:14, outline:"none", boxSizing:"border-box" },
  grid:        { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:16 },
  card:        { background:"#13131a", border:"1px solid #1e1e2e", borderRadius:16, padding:20,
                display:"flex", flexDirection:"column", gap:12, transition:"border-color .2s" },
  cardHead:    { display:"flex", alignItems:"center", gap:12 },
  deviceIcon:  (on) => ({ width:44, height:44, background: on?"#052e16":"#0f172a",
                           borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }),
  deviceName:  { fontSize:16, fontWeight:600, color:"#f1f5f9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  deviceSub:   { fontSize:12, color:"#64748b", marginTop:2 },
  deviceDesc:  { fontSize:13, color:"#94a3b8", margin:0, lineHeight:1.5 },
  metricsRow:  { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 },
  metricMini:  { background:"#0a0a0f", borderRadius:8, padding:"10px 12px" },
  metricLabel: { display:"block", fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:4 },
  metricVal:   { display:"block", fontSize:20, fontWeight:700, marginBottom:6 },
  bar:         { height:4, background:"#1e1e2e", borderRadius:2, overflow:"hidden" },
  barFill:     (c) => ({ height:"100%", background:c, borderRadius:2, transition:"width .5s" }),
  lastSeen:    { fontSize:12, color:"#475569", margin:0 },
  cardFoot:    { display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8, marginTop:4 },
  editBtn:     { background:"#1e1e2e", border:"1px solid #2d2d3d", color:"#94a3b8", borderRadius:8,
                padding:"6px 14px", fontSize:13, cursor:"pointer" },
  delBtn:      { background:"transparent", border:"1px solid #3f1515", color:"#f87171", borderRadius:8,
                padding:"6px 14px", fontSize:13, cursor:"pointer" },
  iconBtn:     { background:"transparent", border:"none", cursor:"pointer", fontSize:14, padding:4, color:"#64748b" },
  empty:       { color:"#475569", textAlign:"center", padding:40 },
  emptyState:  { textAlign:"center", padding:"80px 24px" },
  overlay:     { position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex",
                alignItems:"center", justifyContent:"center", zIndex:1000, padding:24 },
  modal:       { background:"#13131a", border:"1px solid #1e1e2e", borderRadius:20, padding:28,
                width:"100%", maxWidth:480, display:"flex", flexDirection:"column", gap:18,
                maxHeight:"90vh", overflowY:"auto" },
  modalHead:   { display:"flex", justifyContent:"space-between", alignItems:"center" },
  modalTitle:  { fontSize:18, fontWeight:700, color:"#f1f5f9" },
  closeBtn:    { background:"transparent", border:"none", color:"#64748b", cursor:"pointer", fontSize:18 },
  tokenAlert:  { background:"#052e16", border:"1px solid #10b98130", borderRadius:12, padding:16 },
  formGroup:   { display:"flex", flexDirection:"column", gap:6 },
  label:       { fontSize:12, fontWeight:500, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.5px" },
  input:       { background:"#0a0a0f", border:"1px solid #1e1e2e", borderRadius:10, padding:"11px 14px",
                color:"#f1f5f9", fontSize:14, outline:"none" },
  regenBtn:    { background:"transparent", border:"1px solid #1e1e2e", color:"#64748b", borderRadius:8,
                padding:"6px 12px", fontSize:12, cursor:"pointer", marginTop:6 },
  modalFoot:   { display:"flex", justifyContent:"flex-end", gap:10, marginTop:4 },
  cancelBtn:   { background:"transparent", border:"1px solid #1e1e2e", color:"#64748b", borderRadius:10,
                padding:"10px 18px", fontSize:14, cursor:"pointer" },
  saveBtn:     { background:"#6366f1", color:"#fff", border:"none", borderRadius:10,
                padding:"10px 20px", fontSize:14, fontWeight:600, cursor:"pointer" },
};
