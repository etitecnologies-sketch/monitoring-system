import { useState, useEffect } from "react";
import { api } from "../api";

function StatusBadge({ status, lastSeen }) {
  const isOnline = lastSeen && (Date.now() - new Date(lastSeen)) < 60000;
  const color = isOnline ? "#10b981" : status === "pending" ? "#f59e0b" : "#ef4444";
  return (
    <span style={{ 
      background: `${color}20`, color, border: `1px solid ${color}40`,
      borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700
    }}>
      {isOnline ? "ONLINE" : status?.toUpperCase() || "OFFLINE"}
    </span>
  );
}

function DeviceModal({ device, onClose, onSave }) {
  const [name, setName] = useState(device?.name || "");
  const [desc, setDesc] = useState(device?.description || "");
  const [loc, setLoc] = useState(device?.location || "");
  const [type, setType] = useState(device?.device_type || "server");
  const [ip, setIp] = useState(device?.ip_address || "");
  const [ddns, setDdns] = useState(device?.ddns_address || "");
  const [port, setPort] = useState(device?.monitor_port || "");
  const [loading, setLoading] = useState(false);
  const [newToken, setNewToken] = useState(null);

  async function save() {
    if (!name.trim()) return;
    setLoading(true);
    const data = { 
      name: name.trim(), description: desc, location: loc, device_type: type,
      ip_address: ip, ddns_address: ddns, monitor_port: parseInt(port) || 0
    };
    try {
      if (device) {
        await api.updateDevice(device.id, data);
      } else {
        const res = await api.createDevice(data);
        if (res.token) setNewToken(res.token);
      }
      onSave();
      if (device || !newToken) onClose();
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
          <span style={S.modalTitle}>{device ? "Editar Dispositivo" : "Novo Dispositivo"}</span>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        {newToken && (
          <div style={S.tokenAlert}>
            <p style={{ color: "#10b981", fontWeight: 600, fontSize: 13 }}>✓ Criado! Salve este token:</p>
            <code style={{ display: "block", background: "#000", padding: 10, borderRadius: 6, marginTop: 5, fontSize: 12, wordBreak: "break-all" }}>{newToken}</code>
            <button onClick={onClose} style={{ ...S.saveBtn, marginTop: 10, width: "100%" }}>Concluído</button>
          </div>
        )}

        {!newToken && (
          <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
            <div style={S.formGroup}><label style={S.label}>Nome *</label><input style={S.input} value={name} onChange={e=>setName(e.target.value)} /></div>
            <div style={S.formGroup}><label style={S.label}>DDNS / DNS</label><input style={S.input} value={ddns} onChange={e=>setDdns(e.target.value)} placeholder="ex: camera.ddns-intelbras.com.br" /></div>
            <div style={S.formGroup}><label style={S.label}>Porta TCP</label><input style={S.input} type="number" value={port} onChange={e=>setPort(e.target.value)} placeholder="37777" /></div>
            <div style={S.formGroup}><label style={S.label}>IP Local</label><input style={S.input} value={ip} onChange={e=>setIp(e.target.value)} /></div>
            <div style={S.formGroup}><label style={S.label}>Localização</label><input style={S.input} value={loc} onChange={e=>setLoc(e.target.value)} /></div>
            <div style={S.modalFoot}>
              <button onClick={onClose} style={S.cancelBtn}>Cancelar</button>
              <button onClick={save} disabled={loading} style={S.saveBtn}>{loading ? "Salvando..." : "Salvar"}</button>
            </div>
          </div>
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
        <h2 style={S.pageTitle}>Dispositivos</h2>
        <button onClick={() => setModal("new")} style={S.addBtn}>+ Adicionar</button>
      </div>
      <div style={S.grid}>
        {devices.map(dev => (
          <div key={dev.id} style={S.card}>
            <div style={S.cardHead}>
              <div style={{ flex: 1 }}>
                <div style={S.deviceName}>{dev.name}</div>
                <div style={S.deviceSub}>{dev.ddns_address || dev.ip_address}</div>
              </div>
              <StatusBadge status={dev.status} lastSeen={dev.last_seen} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={() => setModal(dev)} style={S.editBtn}>Editar</button>
              <button onClick={async () => { if (confirm("Excluir?")) { await api.deleteDevice(dev.id); load(); } }} style={S.delBtn}>Excluir</button>
            </div>
          </div>
        ))}
      </div>
      {modal && <DeviceModal device={modal === "new" ? null : modal} onClose={() => setModal(null)} onSave={load} />}
    </div>
  );
}

const S = {
  page: { padding: 24 },
  header: { display: "flex", justifyContent: "space-between", marginBottom: 20 },
  pageTitle: { fontSize: 22, fontWeight: 700, color: "#fff" },
  addBtn: { background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 },
  card: { background: "#13131a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 20 },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  deviceName: { fontSize: 16, fontWeight: 600, color: "#fff" },
  deviceSub: { fontSize: 12, color: "#64748b", marginTop: 4 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#13131a", border: "1px solid #1e1e2e", borderRadius: 16, padding: 24, width: "100%", maxWidth: 400 },
  modalHead: { display: "flex", justifyContent: "space-between", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 700, color: "#fff" },
  closeBtn: { background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18 },
  formGroup: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, color: "#94a3b8", textTransform: "uppercase" },
  input: { background: "#0a0a0f", border: "1px solid #1e1e2e", borderRadius: 8, padding: "10px", color: "#fff" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 },
  saveBtn: { background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer" },
  cancelBtn: { background: "transparent", border: "1px solid #1e1e2e", color: "#64748b", borderRadius: 8, padding: "10px 20px", cursor: "pointer" },
  editBtn: { background: "#1e1e2e", border: "none", color: "#94a3b8", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" },
  delBtn: { background: "transparent", border: "1px solid #3f1515", color: "#f87171", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" },
  tokenAlert: { background: "#052e16", border: "1px solid #10b98130", borderRadius: 8, padding: 16 },
};
