import { API_URL } from '@/api/config';
import { secureStorage } from './storage';

const REFRESH_KEY = 'fisiocerca.refresh';

// El token de acceso (15 min) vive solo en memoria. El de renovación, en el almacenamiento seguro.
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export const session = {
  get accessToken() { return accessToken; },

  async save(tokens: { accessToken: string; refreshToken: string }) {
    accessToken = tokens.accessToken;
    await secureStorage.set(REFRESH_KEY, tokens.refreshToken);
    listeners.forEach(l => l(true));
  },

  async clear() {
    const refreshToken = await secureStorage.get(REFRESH_KEY);
    accessToken = null;
    await secureStorage.remove(REFRESH_KEY);
    listeners.forEach(l => l(false));
    if (refreshToken) {
      fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) }).catch(() => {});
    }
  },

  // Renueva los tokens. Si varias peticiones fallan a la vez, todas esperan la misma renovación.
  refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const refreshToken = await secureStorage.get(REFRESH_KEY);
        if (!refreshToken) return false;
        const res = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
        if (!res.ok) { await session.clear(); return false; }
        await session.save(await res.json());
        return true;
      } catch {
        return false; // sin conexión: se conserva la sesión para reintentar
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  },

  onChange(fn: (signedIn: boolean) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
