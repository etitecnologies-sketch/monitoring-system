import { useState, useEffect } from "react";
import { api } from "../api";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";

function fmtBytes(b) {
  if (!b) return "0 B";
  const gb=b/(1024**3); if(gb>=1) return gb.toFixed(2)+" GB";
  return (b/(1024**2)).toFixed(1)+" MB";
}
function fmtUptime(s) {
  if (!s) return "—";
  const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60);
  if(d>0) return `${d}d ${h}h`;
  if(h>0) return `${h}h ${m}m`;
  return `${m}m`;
}
function statusColor(val, warn, crit) {
  if(val>=crit) return "#ff0055"; // Pink/Red neon
  if(val>=warn) return "#ffae00"; // Orange neon
  return "#00f2ff"; // Cyan neon
}

function MiniGauge({ value=0, warn=60, crit=80, size=68 }) {
  const c = statusColor(value,warn,crit);
  const r=(size/2)-7, circ=2*Math.PI*r;
  const dash=circ*0.75, offset=dash*(1-Math.min(value,100)/100);
  return (
    <svg width={size} height={size} style={{transform:"rotate(135deg)", filter: `drop-shadow(0 0 3px ${c}66)`}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={7}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c} strokeWidth={7}
        strokeDasharray={`${Math.max(dash-offset,0)} ${circ}`} strokeLinecap="round"
        style={{transition:"stroke-dasharray .8s cubic-bezier(0.4, 0, 0.2, 1)"}}/>
    </svg>
  );
}

function StatBadge({ label, value, color, unit="" }) {
  return (
    <div style={{
      background: "rgba(10, 15, 26, 0.4)",
      border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: 12,
      padding: "12px 15px",
      minWidth: 100,
      boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
    }}>
      <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:6,fontWeight:600}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color,textShadow:`0 0 10px ${color}44`}}>{value}<span style={{fontSize:12,marginLeft:2,opacity:0.7}}>{unit}</span></div>
    </div>
  );
}

function HostCard({ host, data, deviceMap }) {
  const [tab, setTab]         = useState("live");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const device  = data.device_id ? deviceMap[data.device_id] : null;
  const isOnline= data.status === "online" && data.time && (Date.now()-new Date(data.time))<60000;
  const cpu     = +(data.cpu||0).toFixed(1);
  const mem     = +(data.memory||0).toFixed(1);
  const disk    = +(data.disk_percent||0).toFixed(1);
  const lat     = +(data.latency_ms||0).toFixed(0);
  const load    = +(data.load_avg||0).toFixed(2);
  const temp    = +(data.temperature||0).toFixed(0);
  const procs   = data.processes||0;

  async function loadHistory() {
    setLoading(true);
    const rows = await api.metrics(host, 24);
    setHistory(rows.reverse().map(r=>({
      time: new Date(r.time).toLocaleTimeString(),
      cpu:  +parseFloat(r.cpu||0).toFixed(1),
      mem:  +parseFloat(r.memory||0).toFixed(1),
      disk: +parseFloat(r.disk_percent||0).toFixed(1),
      lat:  +parseFloat(r.latency_ms||0).toFixed(0),
    })));
    setLoading(false);
  }
  useEffect(()=>{ if(tab==="history") loadHistory(); },[tab]);

  const realtimeData = (data.history||[]).slice(-40).map(h=>({
    time: new Date(h.time).toLocaleTimeString(),
    cpu:  +parseFloat(h.cpu||0).toFixed(1),
    mem:  +parseFloat(h.memory||0).toFixed(1),
    disk: +parseFloat(h.disk_percent||0).toFixed(1),
    lat:  +parseFloat(h.latency_ms||0).toFixed(0),
  }));
  const chartData = tab==="live" ? realtimeData : history;

  const isMobile = window.innerWidth < 768;

  return (
    <div style={{
      background: "rgba(15, 15, 24, 0.6)",
      backdropFilter: "blur(10px)",
      border: `1px solid ${isOnline?"rgba(0, 242, 255, 0.2)":"rgba(255, 0, 85, 0.15)"}`,
      borderRadius: 20,
      padding: isMobile ? 16 : 24,
      transition: "all 0.4s ease",
      boxShadow: isOnline ? "0 10px 30px rgba(0, 242, 255, 0.05)" : "none",
      position: "relative",
      overflow: "hidden"
    }}>
      {/* Decorative corner */}
      <div style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 40,
        height: 40,
        background: `linear-gradient(45deg, transparent 50%, ${isOnline?"#00f2ff22":"#ff005522"} 50%)`,
      }} />

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexDirection: isMobile ? "column" : "row", gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:14,width: "100%", minWidth:0}}>
          <div style={{position:"relative",flexShrink:0}}>
            <div style={{
              width: 44,
              height: 44,
              background: isOnline ? "rgba(0, 242, 255, 0.05)" : "rgba(255, 0, 85, 0.05)",
              border: `1px solid ${isOnline ? "rgba(0, 242, 255, 0.3)" : "rgba(255, 0, 85, 0.3)"}`,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: isOnline ? "0 0 15px rgba(0, 242, 255, 0.1)" : "none"
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke={isOnline?"#00f2ff":"#ff0055"} strokeWidth="1.5"/>
                <path d="M8 21h8M12 17v4" stroke={isOnline?"#00f2ff":"#ff0055"} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span style={{
              position: "absolute",
              bottom: -2,
              right: -2,
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: isOnline ? "#00f2ff" : "#ff0055",
              border: "2px solid #0f0f18",
              boxShadow: isOnline ? "0 0 10px #00f2ff" : "0 0 10px #ff0055"
            }}/>
          </div>
          <div style={{minWidth:0, flex: 1}}>
            <div style={{fontSize:isMobile ? 16 : 18,fontWeight:700,color:"#fff",letterSpacing:0.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{host}</div>
            <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1,marginTop:2, display:"flex", gap:8}}>
              <span>{device?.name || "Dispositivo Desconhecido"}</span>
              {device?.serial_number && <span style={{color:"#475569"}}>SN: {device.serial_number}</span>}
              {device?.mac_address && <span style={{color:"#475569"}}>MAC: {device.mac_address}</span>}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:6, width: isMobile ? "100%" : "auto"}}>
          {["live", "history"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              flex: isMobile ? 1 : "none",
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid",
              borderColor: tab===t ? "rgba(0, 242, 255, 0.3)" : "rgba(255,255,255,0.05)",
              background: tab===t ? "rgba(0, 242, 255, 0.1)" : "transparent",
              color: tab===t ? "#00f2ff" : "#64748b",
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              cursor: "pointer",
              transition: "all 0.2s"
            }}>
              {t==="live" ? "Real-time" : "24h History"}
            </button>
          ))}
        </div>
      </div>

      {/* Main Gauges */}
      <div style={{display:"flex",justifyContent:"space-around",alignItems:"center",marginBottom:20,background:"rgba(255,255,255,0.02)",padding:isMobile ? "12px 6px" : "20px 10px",borderRadius:16,border:"1px solid rgba(255,255,255,0.03)"}}>
        <div style={{textAlign:"center"}}>
          <MiniGauge size={isMobile ? 54 : 68} value={cpu} warn={60} crit={85}/>
          <div style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:1.2,marginTop:6,fontWeight:600}}>CPU</div>
          <div style={{fontSize:14,fontWeight:700,color:statusColor(cpu,60,85)}}>{cpu}%</div>
        </div>
        <div style={{textAlign:"center"}}>
          <MiniGauge size={isMobile ? 54 : 68} value={mem} warn={75} crit={90}/>
          <div style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:1.2,marginTop:6,fontWeight:600}}>RAM</div>
          <div style={{fontSize:14,fontWeight:700,color:statusColor(mem,75,90)}}>{mem}%</div>
        </div>
        <div style={{textAlign:"center"}}>
          <MiniGauge size={isMobile ? 54 : 68} value={disk} warn={80} crit={95}/>
          <div style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:1.2,marginTop:6,fontWeight:600}}>DISK</div>
          <div style={{fontSize:14,fontWeight:700,color:statusColor(disk,80,95)}}>{disk}%</div>
        </div>
      </div>

      {/* Chart Section */}
      <div style={{height:isMobile ? 120 : 160,marginBottom:20,position:"relative"}}>
        {loading && <div style={{position:"absolute",inset:0,background:"rgba(15,15,24,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10,borderRadius:8,fontSize:12,color:"#00f2ff",letterSpacing:2}}>SCANNING...</div>}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00f2ff" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#00f2ff" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false}/>
            <XAxis dataKey="time" hide/>
            <YAxis hide domain={[0,100]}/>
            <Tooltip
              contentStyle={{background:"rgba(10,15,26,0.9)",border:"1px solid rgba(0,242,255,0.3)",borderRadius:8,fontSize:10,color:"#fff",backdropFilter:"blur(4px)"}}
              itemStyle={{padding:0}}
            />
            <Area type="monotone" dataKey="cpu" stroke="#00f2ff" strokeWidth={2} fillOpacity={1} fill="url(#colorCpu)" animationDuration={1000}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Footer Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:10}}>
        <StatBadge label="Latency" value={lat} unit="ms" color="#00f2ff"/>
        <StatBadge label="Load" value={load} color="#a78bfa"/>
        <StatBadge label="Temp" value={temp} unit="°" color={statusColor(temp, 65, 80)}/>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",marginTop:16,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.05)"}}>
        <div style={{fontSize:9,color:"#475569",display:"flex",alignItems:"center",gap:5}}>
          <span style={{width:5,height:5,borderRadius:"50%",background:isOnline?"#00f2ff":"#ff0055"}}/>
          UPTIME: {fmtUptime(data.uptime_seconds)}
        </div>
        <div style={{fontSize:9,color:"#475569"}}>PROCS: {procs}</div>
      </div>
    </div>
  );

export default function Dashboard({ hosts }) {
  const [devices, setDevices] = useState([]);
  useEffect(()=>{
    api.devices().then(d=>setDevices(Array.isArray(d)?d:[]));
    const t=setInterval(()=>api.devices().then(d=>setDevices(Array.isArray(d)?d:[])),15000);
    return()=>clearInterval(t);
  },[]);

  const deviceMap = Object.fromEntries(devices.map(d=>[d.id,d]));
  const hostList  = Object.entries(hosts);
  const online    = hostList.filter(([,d])=>d.status === "online" && d.time && (Date.now()-new Date(d.time))<60000).length;

  return (
    <div style={{padding:"24px 28px"}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:22,fontWeight:700,color:"#f1f5f9",margin:"0 0 6px",letterSpacing:"-0.5px"}}>Live Dashboard</h1>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:13,color:"#475569"}}>{hostList.length} devices registered</span>
          <span style={{display:"flex",alignItems:"center",gap:5,fontSize:13,color:"#10b981"}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:"#10b981",display:"inline-block"}}/>
            {online} online
          </span>
          <span style={{display:"flex",alignItems:"center",gap:5,fontSize:13,color:"#f87171"}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:"#f87171",display:"inline-block"}}/>
            {hostList.length-online} offline
          </span>
        </div>
      </div>

      {hostList.length===0 ? (
        <div style={{textAlign:"center",padding:"80px 24px"}}>
          <div style={{fontSize:52,marginBottom:16}}>📡</div>
          <p style={{color:"#f1f5f9",fontWeight:600,fontSize:17,margin:"0 0 8px"}}>No devices reporting yet</p>
          <p style={{color:"#475569",fontSize:14,margin:0}}>Go to Devices tab, add a device and install the agent.</p>
        </div>
      ) : (
        <div style={{
          display: "grid", 
          gridTemplateColumns: window.innerWidth < 768 ? "1fr" : "repeat(auto-fill,minmax(480px,1fr))", 
          gap: 20 
        }}>
          {hostList.map(([host,data])=>(
            <HostCard key={host} host={host} data={data} deviceMap={deviceMap}/>
          ))}
        </div>
      )}
    </div>
  );
}
