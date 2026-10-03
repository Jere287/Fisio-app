import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { one } from '../db/pool.js';
import { sha256 } from '../lib/crypto.js';
import { badRequest, conflict, unprocessable } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest { idempotencyKey?: string }
}

// Encabezado «Idempotency-Key» (mismo contrato que Stripe): la primera respuesta se guarda y se repite tal cual.
// Debe ir después de la autenticación porque la clave es por usuario.
export function idempotency(ctx: AppContext) {
  const preHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const key = req.headers['idempotency-key'];
    if (key === undefined) return;
    if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) throw badRequest('invalid_idempotency_key', 'La clave de idempotencia debe tener entre 8 y 100 caracteres.');
    const route = req.routeOptions.url ?? req.url;
    const hash = sha256(JSON.stringify(req.body ?? {}));
    const ins = await ctx.db.query(`INSERT INTO idempotency_keys (user_id, key, route, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [req.auth.id, key, route, hash]);
    if (ins.rowCount) { req.idempotencyKey = key; return; }
    const prev = await one<{ route: string; request_hash: string; status_code: number | null; response: unknown }>(ctx.db,
      'SELECT route, request_hash, status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2', [req.auth.id, key]);
    if (!prev || prev.route !== route || prev.request_hash !== hash) throw unprocessable('idempotency_mismatch', 'Esta clave ya se usó con otra solicitud.');
    if (prev.status_code === null) throw conflict('request_in_progress', 'Tu solicitud anterior todavía se está procesando.');
    reply.header('idempotent-replayed', 'true');
    return reply.status(prev.status_code).send(prev.response);
  };

  const onSend = async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (!req.idempotencyKey) return payload;
    if (reply.statusCode >= 500) {
      // Error nuestro: se libera la clave para que el reintento se procese de nuevo.
      await ctx.db.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [req.auth.id, req.idempotencyKey]);
    } else {
      await ctx.db.query('UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE user_id = $1 AND key = $2',
        [req.auth.id, req.idempotencyKey, reply.statusCode, typeof payload === 'string' ? payload : JSON.stringify(payload ?? null)]);
    }
    return payload;
  };

  return { preHandler, onSend };
}
