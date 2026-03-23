export function getToken() { return localStorage.getItem("token"); }
export function setToken(t) { localStorage.setItem("token", t); }
export function clearToken() { localStorage.removeItem("token"); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 401) { clearToken(); window.location.reload(); }
  return res.json();
}

export const api = {
  authStatus:      ()          => apiFetch("/auth/status"),
  setup:           (u,p)       => apiFetch("/auth/setup",  { method:"POST", body: JSON.stringify({username:u,password:p}) }),
  login:           (u,p)       => apiFetch("/auth/login",  { method:"POST", body: JSON.stringify({username:u,password:p}) }),
  devices:         ()          => apiFetch("/devices"),
  createDevice:    (d)         => apiFetch("/devices",     { method:"POST", body: JSON.stringify(d) }),
  updateDevice:    (id,d)      => apiFetch(`/devices/${id}`,{ method:"PUT",  body: JSON.stringify(d) }),
  deleteDevice:    (id)        => apiFetch(`/devices/${id}`,{ method:"DELETE" }),
  regenToken:      (id)        => apiFetch(`/devices/${id}/regenerate-token`, { method:"POST" }),
  hosts:           ()          => apiFetch("/hosts"),
  metrics:         (h,hours)   => apiFetch(`/metrics/${h}?hours=${hours}`),
  alerts:          ()          => apiFetch("/alerts"),
};
