const configuredApiUrl = import.meta.env.VITE_API_URL;
const API_URL = configuredApiUrl === undefined ? 'http://localhost:4000' : configuredApiUrl;

export function getApiUrl() {
  return API_URL;
}

export function getToken() {
  return localStorage.getItem('meterflow.token');
}

export function setSession(session) {
  localStorage.setItem('meterflow.token', session.token);
  localStorage.setItem('meterflow.user', JSON.stringify(session.user));
}

export function getUser() {
  const raw = localStorage.getItem('meterflow.user');
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem('meterflow.token');
  localStorage.removeItem('meterflow.user');
}

export async function api(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'request_failed');
  }
  return data;
}
