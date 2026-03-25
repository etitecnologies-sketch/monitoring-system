import { useState, useEffect } from "react";
import { api } from "../api";

const S = {
  page: { padding: "30px", minHeight: "100vh" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px" },
  pageTitle: { fontSize: "28px", fontWeight: "700", color: "#fff", letterSpacing: "-0.5px" },
  addBtn: { 
    background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)", 
    color: "#fff", border: "none", borderRadius: "12px", padding: "12px 24px", 
    cursor: "pointer", fontWeight: "600", boxShadow: "0 4px 15px rgba(99, 102, 241, 0.3)"
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "24px" },
  card: { 
    background: "rgba(19, 19, 26, 0.7)", backdropFilter: "blur(12px)", 
    border: "1px solid rgba(255, 255, 255, 0.05)", borderRadius: "20px", 
    padding: "24px", position: "relative", overflow: "hidden"
  },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" },
  deviceName: { fontSize: "18px", fontWeight: "600", color: "#fff" },
  deviceSub: { fontSize: "13px", color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace" },
  deviceInfo: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "20px", padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "12px" },
  infoItem: { display: "flex", flexDirection: "column", gap: "4px" },
  infoLabel: { fontSize: "10px", color: "#64748b", textTransform: "uppercase" },
  infoValue: { fontSize: "13px", color: "#e2e8f0", fontWeight: "500" },
  actions: { display: "flex", gap: "10px", marginTop: "24px" },
  editBtn: { flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0", borderRadius: "10px", padding: "8px", fontSize: "13px", cursor: "pointer" },
  delBtn: { flex: 1, background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.1)", color: "#f87171", borderRadius: "10px", padding: "8px", fontSize: "13px", cursor: "pointer" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#13131a", border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "24px", padding: "32px", width: "100%", maxWidth: "700px" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px" },
  modalTitle: { fontSize: "22px", fontWeight: "700", color: "#fff" },
  closeBtn: { background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: "24px" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" },
  formGroup: { display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" },
  label: { fontSize: "12px", color: "#94a3b8", fontWeight: "600", textTransform: "uppercase" },
  input: { background: "rgba(0, 0, 0, 0.2)", border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "12px", padding: "12px 16px", color: "#fff", fontSize: "14px", outline: "none" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "20px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "24px" },
  saveBtn: { background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)", color: "#fff", border: "none", borderRadius: "12px", padding: "12px 30px", cursor: "pointer", fontWeight: "600" },
  cancelBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", borderRadius: "12px", padding: "12px 24px", cursor: "pointer" },
  tokenAlert: { background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "16px", padding: "20px", marginBottom: "24px" },
};

function StatusBadge({ status, lastSeen }) {
  const isOnline = status === "online" || (lastSeen && (Date.now() - new Date(lastSeen)) < 120000);
  const color = isOnline ? "#10b981" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", background: `${color}15`, padding: "6px 12px", borderRadius: "100px", border: `1px solid ${color}30` }}>
      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: color, boxShadow: `0 0 10px ${color}` }}></div>
      <span style={{ fontSize: "11px", fontWeight: "700", color, textTransform: "uppercase" }}>{isOnline ? "Online" : "Offline"}</span>
    </div>
  );
}

function DeviceModal({ device, onClose, onSave }) {
  const [name, setName] = useState(device?.name || "");
  const [desc, setDesc] = useState(device?.description || "");
  const [loc, setLoc] = useState(device?.location || "");
  const [type, setType] = useState(device?.device_type || "camera");
  const [ip, setIp] = useState(device?.ip_address || "");
  const [ddns, setDdns] = useState(device?.ddns_address || "");
  const [port, setPort] = useState(device?.monitor_port || "");
  const [tags, setTags] = useState(device?.tags?.join(", ") || "");
  const [ping, setPing] = useState(device?.monitor_ping !== false);
  const [agent, setAgent] = useState(device?.monitor_agent !== false);
  const [mac, setMac] = useState(device?.mac_address || "");
  const [sn, setSn] = useState(device?.serial_number || "");
  const [loading, setLoading] = useState(false);
  const [newToken, setNewToken] = useState(null);

  async function save() {
    if (!name.trim()) return;
    setLoading(true);
    const data = { 
      name: name.trim(), description: desc, location: loc, device_type: type,
      ip_address: ip, ddns_address: ddns, monitor_port: parseInt(port) || 0,
      tags: tags.split(",").map(t => t.trim()).filter(t => t),
      monitor_ping: ping, monitor_agent: agent,
      mac_address: mac, serial_number: sn
    };
    try {
      if (device) await api.updateDevice(device.id, data);
      else {
        const res = await api.createDevice(data);
        if (res.token) { setNewToken(res.token); onSave(); return; }
      }
      onSave();
      onClose();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>{device ? `Configurar: ${device.name}` : "Cadastrar Novo Dispositivo"}</span>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        {newToken && (
          <div style={S.tokenAlert}>
            <p style={{ color: "#10b981", fontWeight: "600", marginBottom: "10px" }}>✓ Dispositivo cadastrado! Token para o agente:</p>
            <code style={{ display: "block", background: "#000", padding: "15px", borderRadius: "10px", fontSize: "13px", color: "#34d399", wordBreak: "break-all" }}>{newToken}</code>
            <button onClick={onClose} style={{ ...S.saveBtn, marginTop: "20px", width: "100%" }}>Entendido</button>
          </div>
        )}

        {!newToken && (
          <>
            <div style={S.formGrid}>
              <div>
                <div style={S.formGroup}><label style={S.label}>Nome *</label><input style={S.input} value={name} onChange={e=>setName(e.target.value)} /></div>
                <div style={S.formGroup}><label style={S.label}>Tipo</label>
                  <select style={S.input} value={type} onChange={e=>setType(e.target.value)}>
                    <option value="camera">📷 Câmera / DVR</option>
                    <option value="server">🖥️ Servidor</option>
                    <option value="router">🌐 Roteador</option>
                    <option value="switch">🔀 Switch</option>
                  </select>
                </div>
                <div style={S.formGroup}><label style={S.label}>Tags</label><input style={S.input} value={tags} onChange={e=>setTags(e.target.value)} placeholder="Ex: porto, dvr" /></div>
                <div style={S.formGroup}><label style={S.label}>Localização</label><input style={S.input} value={loc} onChange={e=>setLoc(e.target.value)} /></div>
                <div style={{...S.formGroup, border: "1px solid #6366f155", padding: "10px", borderRadius: "12px", background: "#6366f105"}}>
                  <label style={{...S.label, color: "#818cf8"}}>🆔 MAC Address</label>
                  <input style={S.input} value={mac} onChange={e=>setMac(e.target.value)} placeholder="00:11:22:33:44:55" />
                </div>
                <div style={{...S.formGroup, border: "1px solid #a78bfa55", padding: "10px", borderRadius: "12px", background: "#a78bfa05"}}>
                  <label style={{...S.label, color: "#c084fc"}}>🏷️ Serial Number (SN)</label>
                  <input style={S.input} value={sn} onChange={e=>setSn(e.target.value)} placeholder="SN123456789" />
                </div>
              </div>
              <div>
                <div style={S.formGroup}><label style={S.label}>DDNS / DNS (Remoto)</label><input style={S.input} value={ddns} onChange={e=>setDdns(e.target.value)} placeholder="ex: camera.ddns-intelbras.com.br" /></div>
                <div style={S.formGroup}><label style={S.label}>Porta de Serviço (TCP)</label><input style={S.input} type="number" value={port} onChange={e=>setPort(e.target.value)} placeholder="37777" /></div>
                <div style={S.formGroup}><label style={S.label}>IP Local</label><input style={S.input} value={ip} onChange={e=>setIp(e.target.value)} /></div>
                {device?.token && (
                  <div style={S.formGroup}>
                    <label style={S.label}>Token de Acesso (Leitura)</label>
                    <input style={{ ...S.input, color: "#10b981", cursor: "default" }} value={device.token} readOnly />
                  </div>
                )}
                <div style={{ display: "flex", gap: "20px", marginTop: "10px" }}>
                  <label style={{ color: "#fff", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="checkbox" checked={ping} onChange={e=>setPing(e.target.checked)} /> Ping/ICMP
                  </label>
                  <label style={{ color: "#fff", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="checkbox" checked={agent} onChange={e=>setAgent(e.target.checked)} /> Agente Local
                  </label>
                </div>
              </div>
            </div>
            <div style={S.modalFoot}>
              <button onClick={onClose} style={S.cancelBtn}>Cancelar</button>
              <button onClick={save} disabled={loading} style={S.saveBtn}>{loading ? "..." : "Salvar Alterações"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [modal, setModal] = useState(null);

  const load = async () => {
    try { const d = await api.devices(); setDevices(Array.isArray(d) ? d : []); }
    catch (e) { console.error(e); }
  };

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h2 style={S.pageTitle}>🚀 CENTRAL DE DISPOSITIVOS (v1.0.2)</h2>
        <button onClick={() => setModal("new")} style={S.addBtn}>+ Novo Dispositivo</button>
      </div>
      <div style={S.grid}>
        {devices.map(dev => (
          <div key={dev.id} style={S.card}>
            <div style={S.cardHead}>
              <div style={{ flex: 1 }}>
                <div style={S.deviceName}>{dev.name}</div>
                <div style={S.deviceSub}>{dev.ddns_address || dev.ip_address || "---"}</div>
              </div>
              <StatusBadge status={dev.status} lastSeen={dev.last_seen} />
            </div>
            
            <div style={{...S.deviceInfo, border: "1px solid rgba(99, 102, 241, 0.2)", background: "rgba(99, 102, 241, 0.05)", display: "block"}}>
              <div style={{ background: "rgba(16, 185, 129, 0.1)", padding: "12px", borderRadius: "10px", border: "1px dashed #10b981", marginBottom: "15px" }}>
                <span style={{fontSize: "10px", color: "#34d399", fontWeight: "800", display: "block", marginBottom: "4px"}}>🔑 TOKEN DO DISPOSITIVO</span>
                <code style={{ color: "#fff", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", wordBreak: "break-all" }}>{dev.token}</code>
              </div>
              
              <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px"}}>
                <div style={{background: "rgba(99, 102, 241, 0.1)", padding: "8px", borderRadius: "8px", border: "1px solid rgba(99, 102, 241, 0.2)"}}>
                  <span style={{fontSize: "9px", color: "#818cf8", display: "block", textTransform: "uppercase"}}>🆔 MAC Address</span>
                  <span style={{fontSize: "13px", color: "#fff", fontWeight: "600"}}>{dev.mac_address || "---"}</span>
                </div>
                <div style={{background: "rgba(167, 139, 250, 0.1)", padding: "8px", borderRadius: "8px", border: "1px solid rgba(167, 139, 250, 0.2)"}}>
                  <span style={{fontSize: "9px", color: "#c084fc", display: "block", textTransform: "uppercase"}}>🏷️ Serial Number</span>
                  <span style={{fontSize: "13px", color: "#fff", fontWeight: "600"}}>{dev.serial_number || "---"}</span>
                </div>
                <div style={S.infoItem}><span style={S.infoLabel}>Tipo</span><span style={S.infoValue}>{dev.device_type?.toUpperCase()}</span></div>
                <div style={S.infoItem}><span style={S.infoLabel}>Latência</span><span style={{ ...S.infoValue, color: "#10b981" }}>{dev.last_latency ? `${dev.last_latency}ms` : "---"}</span></div>
              </div>
            </div>

            <div style={S.actions}>
              <button onClick={() => setModal(dev)} style={S.editBtn}>Configurar</button>
              <button onClick={async () => { if (confirm("Remover?")) { await api.deleteDevice(dev.id); load(); } }} style={S.delBtn}>Remover</button>
            </div>
          </div>
        ))}
      </div>
      {modal && <DeviceModal device={modal === "new" ? null : modal} onClose={() => setModal(null)} onSave={load} />}
    </div>
  );
}
