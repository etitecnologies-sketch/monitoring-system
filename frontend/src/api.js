// ── Config ────────────────────────────────────────────────
// Tenta usar a variável de ambiente, senão usa URL relativa (que o Nginx fará o proxy)
const API_BASE = import.meta.env.VITE_API_URL || "";

const WS_URL = import.meta.env.VITE_WS_URL || 
  (window.location.hostname === "localhost" ? "http://localhost:3001" : 
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}/socket.io`);

const DEFAULT_TIMEOUT = 10000; // 10s
const MAX_RETRIES = 2;

console.log(`[API] Initialized with base URL: ${API_BASE}`);

// ── Token Management ──────────────────────────────────────
export function getToken() {
  return localStorage.getItem("token");
}

export function setToken(token) {
  if (!token) {
    localStorage.removeItem("token");
    return;
  }
  localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

// ── Error Handling ────────────────────────────────────────
class APIError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.data = data;
  }
}

function logError(error, context) {
  console.error(`[API] ${context}:`, {
    message: error.message,
    status: error.status,
    data: error.data,
  });
}

// ── Fetch with Retry and Timeout ──────────────────────────
async function apiFetch(
  path,
  options = {},
  retryCount = 0
) {
  const token = getToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    // Handle 401 - Token invalid
    if (response.status === 401) {
      clearToken();
      window.location.href = "/login";
      throw new APIError("Unauthorized", 401, { error: "Token expired or invalid" });
    }

    // Try to parse JSON response
    let data;
    try {
      data = await response.json();
    } catch (e) {
      data = { error: "Invalid JSON response" };
    }

    // Handle error responses
    if (!response.ok) {
      const errorMsg = data?.error || `HTTP ${response.status}`;
      throw new APIError(errorMsg, response.status, data);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle AbortError (timeout)
    if (error.name === "AbortError") {
      const timeoutError = new APIError(
        "Request timeout",
        408,
        { error: "Request took too long" }
      );
      logError(timeoutError, path);

      // Retry on timeout
      if (retryCount < MAX_RETRIES) {
        console.warn(`[API] Retrying ${path} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        return new Promise((resolve) =>
          setTimeout(() => resolve(apiFetch(path, options, retryCount + 1)), 1000)
        );
      }
      throw timeoutError;
    }

    // Handle APIError and other errors
    if (error instanceof APIError) {
      logError(error, path);
      throw error;
    }

    // Handle network errors
    const networkError = new APIError(
      error.message || "Network request failed",
      0,
      { error: error.message }
    );
    logError(networkError, path);
    throw networkError;
  }
}

// ── API Client ────────────────────────────────────────────
export const api = {
  // Auth endpoints
  authStatus: () =>
    apiFetch("/auth/status"),

  setup: (username, password) =>
    apiFetch("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  login: (username, password) =>
    apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  authMe: () =>
    apiFetch("/auth/me"),

  // Devices endpoints
  devices: (filters) => {
    const params = new URLSearchParams(filters || {}).toString();
    const path = params ? `/devices?${params}` : "/devices";
    return apiFetch(path);
  },

  createDevice: (deviceData) =>
    apiFetch("/devices", {
      method: "POST",
      body: JSON.stringify(deviceData),
    }),

  updateDevice: (id, deviceData) =>
    apiFetch(`/devices/${id}`, {
      method: "PUT",
      body: JSON.stringify(deviceData),
    }),

  deleteDevice: (id) =>
    apiFetch(`/devices/${id}`, {
      method: "DELETE",
    }),

  regenToken: (id) =>
    apiFetch(`/devices/${id}/regenerate-token`, {
      method: "POST",
    }),

  // Hosts and Metrics
  hosts: () =>
    apiFetch("/hosts"),

  metrics: (host, hours = 1) =>
    apiFetch(`/metrics/${host}?hours=${Math.min(parseInt(hours) || 1, 168)}`),

  // Alerts
  alerts: () =>
    apiFetch("/alerts"),

  // Triggers
  triggers: () =>
    apiFetch("/triggers"),

  createTrigger: (triggerData) =>
    apiFetch("/triggers", {
      method: "POST",
      body: JSON.stringify(triggerData),
    }),

  updateTrigger: (id, triggerData) =>
    apiFetch(`/triggers/${id}`, {
      method: "PUT",
      body: JSON.stringify(triggerData),
    }),

  deleteTrigger: (id) =>
    apiFetch(`/triggers/${id}`, {
      method: "DELETE",
    }),

  // Dashboard stats
  stats: (clientId) => {
    const params = clientId ? `?client_id=${clientId}` : "";
    return apiFetch(`/stats${params}`);
  },

  // Device types
  deviceTypes: () =>
    apiFetch("/device-types"),

  // Tags
  tags: () =>
    apiFetch("/tags"),

  // Clients (admin only)
  clients: () =>
    apiFetch("/clients"),

  createClient: (clientData) =>
    apiFetch("/clients", {
      method: "POST",
      body: JSON.stringify(clientData),
    }),

  updateClient: (id, clientData) =>
    apiFetch(`/clients/${id}`, {
      method: "PUT",
      body: JSON.stringify(clientData),
    }),

  deleteClient: (id) =>
    apiFetch(`/clients/${id}`, {
      method: "DELETE",
    }),

  clientStats: (id) =>
    apiFetch(`/clients/${id}/stats`),

  // Solar endpoints
  solarBrands: () =>
    apiFetch("/solar/brands"),

  solarInverters: (clientId) => {
    const params = clientId ? `?client_id=${clientId}` : "";
    return apiFetch(`/solar/inverters${params}`);
  },

  createSolarInverter: (inverterData) =>
    apiFetch("/solar/inverters", {
      method: "POST",
      body: JSON.stringify(inverterData),
    }),

  updateSolarInverter: (id, inverterData) =>
    apiFetch(`/solar/inverters/${id}`, {
      method: "PUT",
      body: JSON.stringify(inverterData),
    }),

  deleteSolarInverter: (id) =>
    apiFetch(`/solar/inverters/${id}`, {
      method: "DELETE",
    }),

  solarMetrics: (inverterId, hours = 24) =>
    apiFetch(`/solar/inverters/${inverterId}/metrics?hours=${Math.min(parseInt(hours) || 24, 168)}`),

  solarSummary: (clientId) => {
    const params = clientId ? `?client_id=${clientId}` : "";
    return apiFetch(`/solar/summary${params}`);
  },
};
