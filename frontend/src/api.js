const BASE = import.meta.env.VITE_API_URL ?? "";

export async function api(path, { method = "GET", body } = {}) {
  const token = sessionStorage.getItem("token");
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) {
      let user = null;
      try { user = JSON.parse(sessionStorage.getItem("user") || "null"); } catch { /* corrupted local session */ }
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");
      window.dispatchEvent(new CustomEvent("attendance-auth-expired", { detail: { role: user?.role } }));
    }
    throw Object.assign(
      new Error(data.error?.message ?? "The request could not be completed."),
      { code: data.error?.code, status: response.status }
    );
  }
  return data;
}

export async function login(loginId, password) {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: { loginId, ...(password ? { password } : {}) },
  });
  sessionStorage.setItem("token", data.token);
  sessionStorage.setItem("user", JSON.stringify(data.user));
  return data.user;
}

export function logout() {
  const token = sessionStorage.getItem("token");
  if (token) {
    void fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
}
