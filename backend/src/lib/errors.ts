// Errores de negocio con código estable (para la app) y mensaje en español (para la persona).
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Necesitas iniciar sesión.') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'No tienes permiso para esta acción.') => new AppError(403, 'forbidden', msg);
export const notFound = (what = 'Recurso') => new AppError(404, 'not_found', `${what} no encontrado.`);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
export const unprocessable = (code: string, msg: string, details?: unknown) => new AppError(422, code, msg, details);
export const tooMany = (msg: string) => new AppError(429, 'too_many_requests', msg);
