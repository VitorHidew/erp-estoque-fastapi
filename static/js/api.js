function apiKeyHeaders() {
  const k = localStorage.getItem("erp_api_key");
  if (!k || !String(k).trim()) return {};
  return { "X-API-Key": String(k).trim() };
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...apiKeyHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try {
      const j = JSON.parse(raw);
      if (typeof j.detail === "string") detail = j.detail;
      else if (Array.isArray(j.detail)) detail = j.detail.map((e) => e.msg || e).join("; ");
      else if (j.detail) detail = JSON.stringify(j.detail);
    } catch {
      /* manter texto cru */
    }
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function downloadText(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...apiKeyHeaders(), ...(options.headers || {}) } });
  if (!response.ok) throw new Error("Falha ao baixar arquivo");
  return response.text();
}

export async function fetchAuthStatus() {
  return api("/api/auth/status");
}

