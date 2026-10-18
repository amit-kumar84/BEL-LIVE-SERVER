// BEL Cyber Network Operations Status — loopback API client.
const API = 'http://127.0.0.1:8000';

function formatErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((item) => formatErrorDetail(item)).filter(Boolean).join('; ');
  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>;
    const location = Array.isArray(record.loc) ? record.loc.filter((item) => item !== 'body').join(' > ') : '';
    const message = formatErrorDetail(record.msg ?? record.message ?? record.detail);
    return location && message ? `${location}: ${message}` : message || JSON.stringify(detail);
  }
  return detail == null ? '' : String(detail);
}

export async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    if (response.status === 401 && token) {
      window.dispatchEvent(new Event('bel-cybernoc-auth-expired'));
    }
    const detail = formatErrorDetail(body.detail ?? body.message ?? body);
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function websocketUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://127.0.0.1:8000/api/ws`;
}