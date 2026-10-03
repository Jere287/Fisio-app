import { session } from '@/auth/session';
import { ApiError } from './client';
import { API_URL } from './config';

// Subida de archivos binarios (el cliente tipado solo maneja JSON). Renueva la sesión si hace falta.
export async function uploadBinary<T>(path: string, body: Blob, contentType: string): Promise<T> {
  const send = () => fetch(`${API_URL}${path}`, { method: 'POST', body, headers: { 'content-type': contentType, ...(session.accessToken ? { authorization: `Bearer ${session.accessToken}` } : {}) } });
  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && (await session.refresh())) res = await send();
  } catch {
    throw new ApiError(0, 'network', 'No hay conexión. Lo reintentaremos.');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) throw new ApiError(res.status, json.error?.code ?? 'unknown', json.error?.message ?? 'No se pudo subir el archivo.');
  return json as T;
}
