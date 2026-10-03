import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { audit, notify } from '../context.js';
import { many, one, withTx } from '../db/pool.js';
import { authGuard, requireRole } from '../plugins/auth.js';

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);
  const admin = [auth, requireRole('admin')];

  r.get('/v1/admin/alerts', { schema: { tags: ['admin'] }, preHandler: admin }, async () =>
    many(ctx.db, `SELECT a.*, u.full_name AS user_name FROM sos_alerts a JOIN users u ON u.id = a.user_id WHERE a.status = 'open' ORDER BY a.id DESC`));

  r.post('/v1/admin/alerts/:id/ack', { schema: { tags: ['admin'], params: z.object({ id: z.coerce.number().int() }) }, preHandler: admin }, async (req) => {
    await ctx.db.query(`UPDATE sos_alerts SET status = 'acknowledged' WHERE id = $1`, [req.params.id]);
    await audit(ctx.db, req.auth.id, 'alert.ack', String(req.params.id));
    return { ok: true };
  });

  // Métricas del negocio en un rango de fechas.
  r.get('/v1/admin/metrics', {
    schema: { tags: ['admin'], querystring: z.object({ from: z.string().datetime(), to: z.string().datetime() }) },
    preHandler: admin,
  }, async (req) => {
    const p = [req.query.from, req.query.to];
    const byStatus = await many(ctx.db, 'SELECT status, count(*) AS n FROM bookings WHERE created_at BETWEEN $1 AND $2 GROUP BY status', p);
    const ledger = await many<{ account: string; total: number }>(ctx.db, 'SELECT account, sum(amount_cents) AS total FROM ledger_entries WHERE created_at BETWEEN $1 AND $2 GROUP BY account', p);
    const gmv = await one<{ total: number }>(ctx.db, 'SELECT coalesce(sum(captured_cents - refunded_cents), 0) AS total FROM payments WHERE created_at BETWEEN $1 AND $2', p);
    const repeat = await one<{ rate: number }>(ctx.db, `SELECT coalesce(avg((n > 1)::int), 0) AS rate FROM (SELECT booked_by, count(*) AS n FROM bookings WHERE status = 'completed' AND created_at BETWEEN $1 AND $2 GROUP BY booked_by) x`, p);
    return { bookingsByStatus: byStatus, ledger: Object.fromEntries(ledger.map(l => [l.account, l.total])), gmvCents: gmv?.total ?? 0, repeatRate: repeat?.rate ?? 0 };
  });

  // Liquidación semanal: suma lo que se le debe a cada fisio y lo marca como pagado en el libro.
  r.post('/v1/admin/payouts/run', { schema: { tags: ['admin'] }, preHandler: admin }, async (req) => withTx(ctx.db, async tx => {
    const due = await many<{ physio_id: string; total: number }>(tx, `SELECT physio_id, sum(amount_cents) AS total FROM ledger_entries WHERE account = 'physio_payable' AND payout_id IS NULL GROUP BY physio_id HAVING sum(amount_cents) > 0`);
    const created = [];
    for (const d of due) {
      const p = await one<{ id: string }>(tx, 'INSERT INTO payouts (physio_id, amount_cents) VALUES ($1, $2) RETURNING id', [d.physio_id, d.total]);
      await tx.query(`UPDATE ledger_entries SET payout_id = $2 WHERE physio_id = $1 AND account = 'physio_payable' AND payout_id IS NULL`, [d.physio_id, p!.id]);
      await notify(tx, d.physio_id, `Programamos tu pago semanal de $${(d.total / 100).toFixed(2)}.`, { payoutId: p!.id });
      created.push({ physioId: d.physio_id, payoutId: p!.id, amountCents: d.total });
    }
    await audit(tx, req.auth.id, 'payouts.run', null, { count: created.length });
    return created;
  }));

  // Lo que ve el fisio en «Ganancias».
  r.get('/v1/physios/me/earnings', { schema: { tags: ['physios'] }, preHandler: [auth, requireRole('physio')] }, async (req) => {
    const pending = await one<{ total: number }>(ctx.db, `SELECT coalesce(sum(amount_cents), 0) AS total FROM ledger_entries WHERE physio_id = $1 AND account = 'physio_payable' AND payout_id IS NULL`, [req.auth.id]);
    const payouts = await many(ctx.db, 'SELECT id, amount_cents, status, created_at FROM payouts WHERE physio_id = $1 ORDER BY created_at DESC LIMIT 20', [req.auth.id]);
    const sessions = await many(ctx.db, `SELECT b.id, b.scheduled_at, b.price_cents, sum(l.amount_cents) FILTER (WHERE l.account = 'physio_payable') AS net_cents
      FROM bookings b JOIN ledger_entries l ON l.booking_id = b.id WHERE b.physio_id = $1 GROUP BY b.id ORDER BY b.scheduled_at DESC LIMIT 50`, [req.auth.id]);
    return { pendingCents: pending?.total ?? 0, payouts, sessions };
  });
}
