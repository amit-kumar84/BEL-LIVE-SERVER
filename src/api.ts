// BEL Cyber Network Operations Status — loopback API client.
const API = 'http://127.0.0.1:8000';

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
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function websocketUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://127.0.0.1:8000/api/ws`;
}