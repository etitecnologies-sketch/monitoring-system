import { useState } from "react";
import { api } from "../api";

export default function Login({ onLogin, setupDone, onSetupDone }) {
  const [u, setU]       = useState("");
  const [p, setP]       = useState("");
  const [error, setErr] = useState("");
  const [loading, setL] = useState(false);

  async function submit() {
    setErr(""); setL(true);
    try {
      if (!setupDone) { await api.setup(u, p); onSetupDone(); }
      const res = await api.login(u, p);
      if (res.token) onLogin(res.token);
      else setErr(res.error || "Login failed");
    } catch { setErr("Connection error"); }
    setL(false);
  }

  return (
    <div style={S.bg}>
      <div style={S.panel}>
        <div style={S.logo}>
          <div style={S.logoIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" fill="#6366f1"/>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="#6366f1" opacity=".4"/>
              <path d="M4.93 4.93L2.1 2.1M19.07 4.93l2.83-2.83M4.93 19.07l-2.83 2.83M19.07 19.07l2.83 2.83" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" opacity=".6"/>
            </svg>
          </div>
          <span style={S.logoText}>NetWatch</span>
        </div>

        <h2 style={S.title}>{setupDone ? "Welcome back" : "Create your account"}</h2>
        <p style={S.sub}>{setupDone ? "Sign in to your dashboard" : "First time setup — create admin account"}</p>

        <div style={S.field}>
          <label style={S.label}>Username</label>
          <input style={S.input} value={u} onChange={e=>setU(e.target.value)} placeholder="admin" />
        </div>
        <div style={S.field}>
          <label style={S.label}>Password</label>
          <input style={S.input} type="password" value={p} onChange={e=>setP(e.target.value)}
            placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()} />
        </div>

        {error && <div style={S.error}>{error}</div>}

        <button style={{...S.btn, opacity: loading?0.7:1}} onClick={submit} disabled={loading}>
          {loading ? "Loading..." : setupDone ? "Sign in" : "Create account & sign in"}
        </button>

        <p style={S.hint}>
          {setupDone ? "Monitor your devices from anywhere" : "You can add more users later from settings"}
        </p>
      </div>
    </div>
  );
}

const S = {
  bg:       { minHeight:"100vh", background:"#0a0a0f", display:"flex", alignItems:"center", justifyContent:"center", padding:24 },
  panel:    { background:"#13131a", border:"1px solid #1e1e2e", borderRadius:20, padding:"40px 36px", width:"100%", maxWidth:380, display:"flex", flexDirection:"column", gap:18 },
  logo:     { display:"flex", alignItems:"center", gap:10, marginBottom:4 },
  logoIcon: { width:42, height:42, background:"#1a1a2e", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center" },
  logoText: { fontSize:22, fontWeight:700, color:"#e2e8f0", letterSpacing:"-0.5px" },
  title:    { fontSize:20, fontWeight:600, color:"#f1f5f9", margin:0 },
  sub:      { fontSize:13, color:"#64748b", margin:0, marginTop:-10 },
  field:    { display:"flex", flexDirection:"column", gap:6 },
  label:    { fontSize:12, fontWeight:500, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.5px" },
  input:    { background:"#0f0f1a", border:"1px solid #1e1e2e", borderRadius:10, padding:"11px 14px",
              color:"#f1f5f9", fontSize:14, outline:"none", transition:"border .2s" },
  error:    { background:"#1a0a0a", border:"1px solid #3f1515", borderRadius:8, padding:"10px 14px",
              color:"#f87171", fontSize:13 },
  btn:      { background:"#6366f1", color:"#fff", border:"none", borderRadius:10, padding:"13px",
              fontSize:15, fontWeight:600, cursor:"pointer", transition:"all .15s" },
  hint:     { fontSize:12, color:"#475569", textAlign:"center", margin:0 },
};
