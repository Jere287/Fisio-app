import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { many, one, withTx } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { authGuard, requireVerified } from '../plugins/auth.js';
import { idempotency } from '../plugins/idempotency.js';

// 5 sesiones con 10% de descuento o 10 con 15%. Vencen a los 6 meses; lo no usado se devuelve.
export const PACKAGE_DISCOUNT: Record<number, number> = { 5: 0.10, 10: 0.15 };

export async function packageRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);
  const idem = idempotency(ctx);

  r.post('/v1/packages', {
    schema: { tags: ['packages'], body: z.object({ physioId: z.string().uuid(), sessions: z.union([z.literal(5), z.literal(10)]) }) },
    preHandler: [auth, requireVerified(), idem.preHandler],
    onSend: idem.onSend,
  }, async (req, reply) => {
    const p = await one<{ price_cents: number }>(ctx.db, `SELECT price_cents FROM physios WHERE user_id = $1 AND status = 'approved'`, [req.body.physioId]);
    if (!p) throw notFound('Fisioterapeuta');
    const n = req.body.sessions, price = Math.round(p.price_cents * n * (1 - PACKAGE_DISCOUNT[n]!));
    const { ref } = await ctx.payments.charge(price, `pkg:${req.auth.id}`);
    const expires = new Date(ctx.now().getTime() + 183 * 86400000);
    const pkg = await withTx(ctx.db, async tx => {
      const row = await one<{ id: string }>(tx, 'INSERT INTO packages (owner_user_id, physio_id, sessions_total, sessions_left, price_cents, expires_at) VALUES ($1, $2, $3, $3, $4, $5) RETURNING id',
        [req.auth.id, req.body.physioId, n, price, expires]);
      await tx.query(`INSERT INTO payments (package_id, provider, provider_ref, status, amount_cents, captured_cents) VALUES ($1, $2, $3, 'captured', $4, $4)`, [row!.id, ctx.payments.name, ref, price]);
      return row!;
    });
    reply.status(201);
    return { id: pkg.id, sessions: n, priceCents: price, expiresAt: expires };
  });

  r.get('/v1/packages', { schema: { tags: ['packages'] }, preHandler: auth }, async (req) =>
    many(ctx.db, 'SELECT id, physio_id, sessions_total, sessions_left, price_cents, expires_at FROM packages WHERE owner_user_id = $1 ORDER BY created_at DESC', [req.auth.id]));
}
