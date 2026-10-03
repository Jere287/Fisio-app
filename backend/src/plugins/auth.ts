import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { one } from '../db/pool.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export type Role = 'patient' | 'physio' | 'admin';
export interface AuthUser { id: string; role: Role; kycStatus: string; fullName: string | null }

declare module 'fastify' {
  interface FastifyRequest { auth: AuthUser; rawBody?: string }
}

// Verifica el token y que la cuenta siga activa en cada petición (una suspensión surte efecto de inmediato).
export function authGuard(ctx: AppContext) {
  return async (req: FastifyRequest) => {
    let payload: { sub: string };
    try {
      payload = await req.jwtVerify<{ sub: string; role: Role }>();
    } catch {
      throw unauthorized('Tu sesión expiró. Vuelve a iniciar sesión.');
    }
    const u = await one<{ id: string; role: Role; kyc_status: string; full_name: string | null; suspended_at: Date | null; deleted_at: Date | null }>(
      ctx.db, 'SELECT id, role, kyc_status, full_name, suspended_at, deleted_at FROM users WHERE id = $1', [payload.sub]);
    if (!u || u.deleted_at) throw unauthorized();
    if (u.suspended_at) throw forbidden('Tu cuenta está suspendida. Escríbenos a soporte.');
    req.auth = { id: u.id, role: u.role, kycStatus: u.kyc_status, fullName: u.full_name };
  };
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    if (!roles.includes(req.auth.role)) throw forbidden();
  };
}

export function requireVerified() {
  return async (req: FastifyRequest) => {
    if (req.auth.kycStatus !== 'approved') throw forbidden('Primero verifica tu identidad.');
  };
}
