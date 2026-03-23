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
  if(val>=crit) return "#f87171";
  if(val>=warn) return "#fb923c";
  return "#10b981";
}

function MiniGauge({ value=0, warn=60, crit=80, size=68 }) {
  const c = statusColor(value,warn,crit);
  const r=(size/2)-7, circ=2*Math.PI*r;
  const dash=circ*0.75, offset=dash*(1-Math.min(value,100)/100);
  return (
    <svg width={size} height={size} style={{transform:"rotate(135deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1a2a" strokeWidth={7}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c} strokeWidth={7}
        strokeDasharray={`${Math.max(dash-offset,0)} ${circ}`} strokeLinecap="round"
        style={{transition:"stroke-dasharray .5s ease"}}/>
    </svg>
  );
}

function StatBadge({ label, value, color, unit="" }) {
  return (
    <div style={{background:"#0d0d16",border:"1px solid #1a1a2a",borderRadius:10,padding:"10px 12px",minWidth:90}}>
      <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:5}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700,color}}>{value}{unit}</div>
    </div>
  );
}

function HostCard({ host, data, deviceMap }) {
  const [tab, setTab]         = useState("live");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const device  = data.device_id ? deviceMap[data.device_id] : null;
  const isOnline= data.time && (Date.now()-new Date(data.time))<30000;
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

  return (
    <div style={{background:"#0f0f18",border:`1px solid ${isOnline?"#6366f128":"#1a1a2a"}`,borderRadius:16,padding:20,transition:"border-color .3s"}}>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <div style={{position:"relative",flexShrink:0}}>
            <div style={{width:42,height:42,background:isOnline?"#0d1f14":"#0f0f18",border:`1px solid ${isOnline?"#10b98140":"#1a1a2a"}`,
              borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke={isOnline?"#10b981":"#475569"} strokeWidth="1.5"/>
                <path d="M8 21h8M12 17v4" stroke={isOnline?"#10b981":"#475569"} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span style={{position:"absolute",bottom:-2,right:-2,width:10,height:10,borderRadius:"50%",
              background:isOnline?"#10b981":"#f87171",border:"2px solid #0f0f18",
              boxShadow:isOnline?"0 0 8px #10b98199":"0 0 8px #f8717199"}}/>
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontSize:15,fontWeight:700,color:"#f1f5f9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {device?.name || host}
            </div>
            <div style={{fontSize:11,color:"#475569",marginTop:2}}>
              {device?.location ? `📍 ${device.location}` : `🖥 ${host}`}
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:600,color:isOnline?"#10b981":"#f87171",
            background:isOnline?"#0d1f14":"#1a0a0a",border:`1px solid ${isOnline?"#10b98140":"#f8717140"}`,
            borderRadius:20,padding:"3px 10px",display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:isOnline?"#10b981":"#f87171",display:"inline-block"}}/>
            {isOnline?"Online":"Offline"}
          </span>
          <div style={{display:"flex",gap:3}}>
            {["live","history"].map(t=>(
              <button key={t} onClick={()=>setTab(t)}
                style={{background:tab===t?"#1e1e36":"transparent",border:`1px solid ${tab===t?"#6366f160":"#1a1a2a"}`,
                  color:tab===t?"#a5b4fc":"#475569",cursor:"pointer",padding:"4px 10px",borderRadius:7,fontSize:11}}>
                {t==="live"?"⚡ Live":"📈 24h"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Gauges principais */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        {[
          {label:"CPU",val:cpu,warn:60,crit:80,unit:"%"},
          {label:"Memory",val:mem,warn:70,crit:85,unit:"%"},
          {label:"Disk",val:disk,warn:70,crit:90,unit:"%"},
        ].map(({label,val,warn,crit,unit})=>(
          <div key={label} style={{background:"#0d0d16",borderRadius:12,padding:"12px 8px",textAlign:"center",position:"relative"}}>
            <MiniGauge value={val} warn={warn} crit={crit}/>
            <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-60%)",
              fontSize:14,fontWeight:700,color:statusColor(val,warn,crit)}}>
              {val}%
            </div>
            <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.6px",marginTop:4}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Stats extras */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
        <StatBadge label="Latency" value={lat} color={statusColor(lat,200,500)} unit="ms"/>
        <StatBadge label="Load avg" value={load} color={statusColor(load,2,5)} />
        <StatBadge label="Uptime"  value={fmtUptime(data.uptime_seconds)} color="#6366f1"/>
        <StatBadge label="Processes" value={procs} color="#94a3b8"/>
        {temp>0 && <StatBadge label="Temp" value={temp} color={statusColor(temp,60,80)} unit="°C"/>}
        <div style={{background:"#0d0d16",border:"1px solid #1a1a2a",borderRadius:10,padding:"10px 12px",flex:1,minWidth:120}}>
          <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:5}}>Network</div>
          <div style={{fontSize:12,color:"#60a5fa"}}>↓ {fmtBytes(data.net_rx_bytes)}</div>
          <div style={{fontSize:12,color:"#a78bfa",marginTop:2}}>↑ {fmtBytes(data.net_tx_bytes)}</div>
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <div style={{textAlign:"center",color:"#475569",padding:24,fontSize:13}}>Loading history...</div>
      ) : chartData.length > 0 ? (
        <div style={{background:"#0d0d16",borderRadius:12,padding:"12px 8px 4px"}}>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={chartData} margin={{top:0,right:4,bottom:0,left:-24}}>
              <defs>
                {[["cpu","#6366f1"],["mem","#f59e0b"],["disk","#10b981"]].map(([k,c])=>(
                  <linearGradient key={k} id={`g${k}${host}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={c} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={c} stopOpacity={0}/>
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2a" vertical={false}/>
              <XAxis dataKey="time" tick={{fontSize:9,fill:"#3f3f5a"}} interval="preserveStartEnd"/>
              <YAxis domain={[0,100]} unit="%" tick={{fontSize:9,fill:"#3f3f5a"}}/>
              <Tooltip contentStyle={{background:"#0f0f18",border:"1px solid #1e1e2e",borderRadius:8,fontSize:12}}
                labelStyle={{color:"#94a3b8"}} formatter={v=>`${v}%`}/>
              <Legend wrapperStyle={{fontSize:11}}/>
              <Area type="monotone" dataKey="cpu"  stroke="#6366f1" fill={`url(#gcpu${host})`}  dot={false} strokeWidth={1.5} name="CPU"/>
              <Area type="monotone" dataKey="mem"  stroke="#f59e0b" fill={`url(#gmem${host})`}  dot={false} strokeWidth={1.5} name="Memory"/>
              <Area type="monotone" dataKey="disk" stroke="#10b981" fill={`url(#gdisk${host})`} dot={false} strokeWidth={1.5} name="Disk"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{textAlign:"center",color:"#3f3f5a",padding:20,fontSize:12}}>No data yet</div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12}}>
        <span style={{fontSize:11,color:"#3f3f5a"}}>
          {data.time ? `Updated ${new Date(data.time).toLocaleTimeString()}` : "Waiting for data..."}
        </span>
        {data.device_id && <span style={{fontSize:11,color:"#3f3f5a"}}>ID #{data.device_id}</span>}
      </div>
    </div>
  );
}

export default function Dashboard({ hosts }) {
  const [devices, setDevices] = useState([]);
  useEffect(()=>{
    api.devices().then(d=>setDevices(Array.isArray(d)?d:[]));
    const t=setInterval(()=>api.devices().then(d=>setDevices(Array.isArray(d)?d:[])),15000);
    return()=>clearInterval(t);
  },[]);

  const deviceMap = Object.fromEntries(devices.map(d=>[d.id,d]));
  const hostList  = Object.entries(hosts);
  const online    = hostList.filter(([,d])=>d.time&&(Date.now()-new Date(d.time))<30000).length;

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
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(480px,1fr))",gap:20}}>
          {hostList.map(([host,data])=>(
            <HostCard key={host} host={host} data={data} deviceMap={deviceMap}/>
          ))}
        </div>
      )}
    </div>
  );
}
