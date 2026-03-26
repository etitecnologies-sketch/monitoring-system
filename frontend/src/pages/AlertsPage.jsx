import { useState, useEffect } from "react";
import { api } from "../api";

const TYPE_STYLE = {
  offline:   { bg:"rgba(255, 0, 85, 0.05)", border:"rgba(255, 0, 85, 0.3)", icon:"🔴", label:"Offline",   color:"#ff0055", shadow:"0 0 10px rgba(255,0,85,0.2)" },
  online:    { bg:"rgba(0, 242, 255, 0.05)", border:"rgba(0, 242, 255, 0.3)", icon:"🟢", label:"Online",    color:"#00f2ff", shadow:"0 0 10px rgba(0,242,255,0.2)" },
  threshold: { bg:"rgba(255, 174, 0, 0.05)", border:"rgba(255, 174, 0, 0.3)", icon:"🚨", label:"Threshold", color:"#ffae00", shadow:"0 0 10px rgba(255,174,0,0.2)" },
};

const METRIC_LABELS = {
  cpu: "CPU", memory: "Memory", disk_percent: "Disk",
  latency_ms: "Latency", load_avg: "Load Avg", offline: "Offline"
};
const METRIC_UNITS = {
  cpu:"%", memory:"%", disk_percent:"%", latency_ms:"ms", load_avg:"", offline:""
};

export default function AlertsPage() {
  const [alerts, setAlerts]   = useState([]);
  const [filter, setFilter]   = useState("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await api.alerts();
    setAlerts(Array.isArray(data)?data:[]);
    setLoading(false);
  }

  useEffect(()=>{ load(); const t=setInterval(load,30000); return()=>clearInterval(t); },[]);

  const filtered = filter==="all" ? alerts : alerts.filter(a=>a.alert_type===filter);
  const counts   = { all:alerts.length, offline:alerts.filter(a=>a.alert_type==="offline").length,
                     threshold:alerts.filter(a=>a.alert_type==="threshold").length };

  return (
    <div style={{padding:"32px 40px", maxWidth: 1200, margin: "0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:32,flexWrap:"wrap",gap:16}}>
        <div>
          <h1 style={{fontSize:36,fontWeight:800,color:"#fff",margin:"0 0 8px",letterSpacing:"-0.5px", textShadow:"0 0 15px rgba(0,242,255,0.4)"}}>Alerts History</h1>
          <p style={{fontSize:16,color:"#94a3b8",margin:0, fontWeight: 500}}>{alerts.length} alerts recorded</p>
        </div>
        <button onClick={load} style={{background:"rgba(26, 26, 46, 0.8)",border:"1px solid rgba(0, 242, 255, 0.3)",color:"#00f2ff",
          borderRadius:12,padding:"10px 24px",fontSize:15,fontWeight:600,cursor:"pointer",boxShadow:"0 0 10px rgba(0,242,255,0.1)", transition:"all 0.2s"}}>
          ↻ Refresh
        </button>
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:12,marginBottom:32,flexWrap:"wrap"}}>
        {[["all","All","#00f2ff"],["offline","Offline","#ff0055"],["threshold","Threshold","#ffae00"]].map(([k,label,c])=>(
          <button key={k} onClick={()=>setFilter(k)}
            style={{
              background:filter===k?`${c}20`:"rgba(13, 13, 22, 0.6)",
              border:`1px solid ${filter===k?c:"rgba(255,255,255,0.05)"}`,
              color:filter===k?c:"#94a3b8",
              borderRadius:10,padding:"10px 20px",fontSize:15,fontWeight:600,cursor:"pointer",
              display:"flex",alignItems:"center",gap:10,
              boxShadow:filter===k?`0 0 12px ${c}40`:"none",
              backdropFilter:"blur(10px)", transition:"all 0.2s"
            }}>
            {label}
            <span style={{background:filter===k?`${c}40`:"rgba(255,255,255,0.1)",color:filter===k?"#fff":"#cbd5e1",
              borderRadius:20,padding:"2px 10px",fontSize:13,fontWeight:700}}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {loading && <div style={{color:"#00f2ff",textAlign:"center",padding:60,fontSize:18,fontWeight:600,textShadow:"0 0 10px rgba(0,242,255,0.5)"}}>Scanning history...</div>}

      {!loading && filtered.length === 0 && (
        <div style={{textAlign:"center",padding:"80px 24px",background:"rgba(15,15,25,0.4)",borderRadius:24,border:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{fontSize:64,marginBottom:20,filter:"drop-shadow(0 0 15px rgba(0,255,100,0.4))"}}>✅</div>
          <p style={{color:"#fff",fontWeight:700,fontSize:22,margin:"0 0 10px",letterSpacing:"0.5px"}}>No alerts {filter!=="all"?`of type "${filter}" `:""}found</p>
          <p style={{color:"#94a3b8",fontSize:16,margin:0}}>System is operating optimally.</p>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {filtered.map(a=>{
          const t = TYPE_STYLE[a.alert_type] || TYPE_STYLE.threshold;
          const metricLabel = METRIC_LABELS[a.expression] || a.expression;
          const unit = METRIC_UNITS[a.expression] ?? "%";
          return (
            <div key={a.id} style={{
              background:t.bg, border:`1px solid ${t.border}`, borderRadius:16,
              padding:"20px 24px", display:"flex", alignItems:"center", gap:20, flexWrap:"wrap",
              boxShadow: t.shadow, backdropFilter:"blur(12px)", transition:"transform 0.2s"
            }}>
              <span style={{fontSize:28,flexShrink:0,filter:`drop-shadow(0 0 8px ${t.color})`}}>{t.icon}</span>
              <div style={{flex:1,minWidth:200}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6}}>
                  <span style={{fontSize:18,fontWeight:800,color:t.color,letterSpacing:"0.5px",textShadow:`0 0 8px ${t.color}66`}}>
                    {a.trigger_name || (a.alert_type==="offline"?"DEVICE OFFLINE":"ALERT TRIGGERED")}
                  </span>
                  <span style={{fontSize:12,fontWeight:700,background:`${t.color}20`,color:t.color,
                    borderRadius:20,padding:"3px 10px", border:`1px solid ${t.color}40`,textTransform:"uppercase"}}>{t.label}</span>
                </div>
                <div style={{fontSize:15,color:"#cbd5e1",fontWeight:500,display:"flex",alignItems:"center",flexWrap:"wrap",gap:8}}>
                  {a.device_name ? (
                    <>
                      <span style={{color:"#fff",fontWeight:700}}>{a.device_name}</span>
                      {a.serial_number && <span style={{fontSize:12,background:"rgba(255,255,255,0.1)",padding:"3px 8px",borderRadius:6,color:"#94a3b8",fontFamily:"monospace"}}>SN: {a.serial_number}</span>}
                      {a.mac_address && <span style={{fontSize:12,background:"rgba(255,255,255,0.1)",padding:"3px 8px",borderRadius:6,color:"#94a3b8",fontFamily:"monospace"}}>MAC: {a.mac_address}</span>}
                    </>
                  ):null}
                  <code style={{color:"#64748b",fontSize:13,background:"rgba(0,0,0,0.3)",padding:"3px 8px",borderRadius:6}}>{a.host}</code>
                </div>
              </div>
              {a.expression !== "offline" && (
                <div style={{textAlign:"right",minWidth:120,background:"rgba(0,0,0,0.2)",padding:"10px 16px",borderRadius:12,border:"1px solid rgba(255,255,255,0.03)"}}>
                  <div style={{fontSize:24,fontWeight:800,color:t.color,textShadow:`0 0 10px ${t.color}66`}}>
                    {parseFloat(a.value).toFixed(1)}<span style={{fontSize:16,opacity:0.8}}>{unit}</span>
                  </div>
                  <div style={{fontSize:13,color:"#64748b",fontWeight:600,marginTop:2,textTransform:"uppercase"}}>
                    limit {parseFloat(a.threshold).toFixed(0)}{unit}
                  </div>
                </div>
              )}
              <div style={{textAlign:"right",minWidth:150,borderLeft:"1px solid rgba(255,255,255,0.05)",paddingLeft:20}}>
                <div style={{fontSize:15,color:"#cbd5e1",fontWeight:600,marginBottom:4}}>
                  {new Date(a.fired_at).toLocaleDateString("pt-BR")}
                </div>
                <div style={{fontSize:15,color:"#64748b",fontFamily:"monospace"}}>
                  {new Date(a.fired_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
