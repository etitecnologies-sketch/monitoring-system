import { useState, useEffect } from "react";
import { api } from "../api";

const TYPE_STYLE = {
  offline:   { bg:"#1a0a0a", border:"#f8717130", icon:"🔴", label:"Offline",   color:"#f87171" },
  online:    { bg:"#0d1f14", border:"#10b98130", icon:"🟢", label:"Online",    color:"#10b981" },
  threshold: { bg:"#1c1007", border:"#fb923c30", icon:"🚨", label:"Threshold", color:"#fb923c" },
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
    <div style={{padding:"24px 28px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:"#f1f5f9",margin:"0 0 6px",letterSpacing:"-0.5px"}}>Alerts</h1>
          <p style={{fontSize:13,color:"#475569",margin:0}}>{alerts.length} alerts in history</p>
        </div>
        <button onClick={load} style={{background:"#1a1a2e",border:"1px solid #2d2d50",color:"#94a3b8",
          borderRadius:9,padding:"8px 16px",fontSize:13,cursor:"pointer"}}>
          ↻ Refresh
        </button>
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {[["all","All","#6366f1"],["offline","Offline","#f87171"],["threshold","Threshold","#fb923c"]].map(([k,label,c])=>(
          <button key={k} onClick={()=>setFilter(k)}
            style={{background:filter===k?`${c}20`:"#0d0d16",border:`1px solid ${filter===k?c+"50":"#1a1a2a"}`,
              color:filter===k?c:"#475569",borderRadius:8,padding:"7px 14px",fontSize:13,cursor:"pointer",
              display:"flex",alignItems:"center",gap:6}}>
            {label}
            <span style={{background:filter===k?`${c}30`:"#1a1a2a",color:filter===k?c:"#475569",
              borderRadius:20,padding:"1px 7px",fontSize:11,fontWeight:600}}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {loading && <div style={{color:"#475569",textAlign:"center",padding:60}}>Loading alerts...</div>}

      {!loading && filtered.length === 0 && (
        <div style={{textAlign:"center",padding:"80px 24px"}}>
          <div style={{fontSize:48,marginBottom:14}}>✅</div>
          <p style={{color:"#f1f5f9",fontWeight:600,margin:"0 0 8px"}}>No alerts {filter!=="all"?`of type "${filter}" `:""}found</p>
          <p style={{color:"#475569",fontSize:13,margin:0}}>Everything looks healthy!</p>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map(a=>{
          const t = TYPE_STYLE[a.alert_type] || TYPE_STYLE.threshold;
          const metricLabel = METRIC_LABELS[a.expression] || a.expression;
          const unit = METRIC_UNITS[a.expression] ?? "%";
          return (
            <div key={a.id} style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:12,
              padding:"14px 18px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <span style={{fontSize:20,flexShrink:0}}>{t.icon}</span>
              <div style={{flex:1,minWidth:160}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <span style={{fontSize:13,fontWeight:600,color:t.color}}>
                    {a.trigger_name || (a.alert_type==="offline"?"Device Offline":"Alert")}
                  </span>
                  <span style={{fontSize:11,background:`${t.color}20`,color:t.color,
                    borderRadius:20,padding:"1px 8px"}}>{t.label}</span>
                </div>
                <div style={{fontSize:12,color:"#64748b"}}>
                  {a.device_name ? (
                    <><span style={{color:"#94a3b8"}}>{a.device_name}</span>
                    {a.serial_number && <span style={{fontSize:10,background:"rgba(255,255,255,0.05)",padding:"1px 6px",borderRadius:4,marginLeft:6}}>SN: {a.serial_number}</span>}
                    {a.mac_address && <span style={{fontSize:10,background:"rgba(255,255,255,0.05)",padding:"1px 6px",borderRadius:4,marginLeft:6}}>MAC: {a.mac_address}</span>}
                    <span style={{margin:"0 6px",color:"#2d2d50"}}>·</span></>
                  ):null}
                  <code style={{color:"#64748b",fontSize:11}}>{a.host}</code>
                </div>
              </div>
              {a.expression !== "offline" && (
                <div style={{textAlign:"right",minWidth:100}}>
                  <div style={{fontSize:16,fontWeight:700,color:t.color}}>
                    {parseFloat(a.value).toFixed(1)}{unit}
                  </div>
                  <div style={{fontSize:11,color:"#3f3f5a"}}>
                    limit {parseFloat(a.threshold).toFixed(0)}{unit}
                  </div>
                </div>
              )}
              <div style={{textAlign:"right",minWidth:130}}>
                <div style={{fontSize:12,color:"#475569"}}>{new Date(a.fired_at).toLocaleDateString()}</div>
                <div style={{fontSize:12,color:"#3f3f5a"}}>{new Date(a.fired_at).toLocaleTimeString()}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
