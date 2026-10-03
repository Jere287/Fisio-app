import createClient from 'openapi-fetch';
import { session } from '@/auth/session';
import { API_URL } from './config';
import type { paths } from './schema';

// Cliente tipado: las rutas, parámetros y respuestas salen del contrato OpenAPI del backend.
export const client = createClient<paths>({ baseUrl: API_URL });

client.use({
  onRequest({ request }) {
    if (session.accessToken) request.headers.set('authorization', `Bearer ${session.accessToken}`);
    return request;
  },
});

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

type Result<T> = { data?: T; error?: unknown; response: Response };

// Ejecuta una llamada; si el token venció, lo renueva una vez y reintenta. Devuelve los datos o lanza ApiError.
export async function call<T>(fn: () => Promise<Result<T>>): Promise<T> {
  let r: Result<T>;
  try {
    r = await fn();
  } catch {
    throw new ApiError(0, 'network', 'No hay conexión. Revisa tu internet e inténtalo de nuevo.');
  }
  if (r.response.status === 401 && (await session.refresh())) r = await fn();
  if (!r.response.ok) {
    const e = (r.error as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(r.response.status, e?.code ?? 'unknown', e?.message ?? 'Algo salió mal. Inténtalo de nuevo.', e?.details);
  }
  return r.data as T;
}

// Clave de idempotencia: se genera una vez por formulario y se reutiliza en los reintentos.
export const newIdempotencyKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
