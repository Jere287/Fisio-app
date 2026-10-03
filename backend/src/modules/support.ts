import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { audit, notify, notifyAdmins } from '../context.js';
import { many, one, withTx } from '../db/pool.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { NO_SHOW_CREDIT_CENTS } from '../lib/pricing.js';
import { authGuard, requireRole } from '../plugins/auth.js';
import { refundBooking } from './money.js';

export async function supportRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);

  r.post('/v1/support/tickets', {
    schema: { tags: ['support'], body: z.object({ bookingId: z.string().uuid().optional(), reason: z.enum(['no_show', 'late', 'billing', 'conduct', 'other']), description: z.string().max(2000).optional() }) },
    preHandler: auth,
  }, async (req, reply) => {
    const b = req.body;
    if (b.bookingId) {
      const bk = await one<{ booked_by: string; physio_id: string }>(ctx.db, 'SELECT booked_by, physio_id FROM bookings WHERE id = $1', [b.bookingId]);
      if (!bk) throw notFound('Cita');
      if (bk.booked_by !== req.auth.id && bk.physio_id !== req.auth.id) throw forbidden();
    }
    const priority = b.reason === 'conduct' ? 'high' : 'normal';
    const t = await one<{ id: number }>(ctx.db, 'INSERT INTO support_tickets (booking_id, user_id, reason, description, priority) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [b.bookingId ?? null, req.auth.id, b.reason, b.description ?? null, priority]);
    await notifyAdmins(ctx.db, priority === 'high' ? `Caso de seguridad #${t!.id}: revisar de inmediato.` : `Nuevo caso de soporte #${t!.id}.`, { ticketId: t!.id });
    reply.status(201);
    return { id: t!.id, priority };
  });

  r.get('/v1/support/tickets', { schema: { tags: ['support'] }, preHandler: auth }, async (req) =>
    many(ctx.db, 'SELECT id, booking_id, reason, status, resolution, refund_cents, created_at FROM support_tickets WHERE user_id = $1 ORDER BY id DESC', [req.auth.id]));

  r.get('/v1/admin/tickets', { schema: { tags: ['admin'], querystring: z.object({ status: z.enum(['open', 'resolved']).default('open') }) }, preHandler: [auth, requireRole('admin')] }, async (req) =>
    many(ctx.db, `SELECT t.*, u.full_name AS user_name FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.status = $1 ORDER BY t.priority = 'high' DESC, t.id`, [req.query.status]));

  // Resolver: devolver (total o parcial), suspender al especialista o cerrar.
  r.post('/v1/admin/tickets/:id/resolve', {
    schema: { tags: ['admin'], params: z.object({ id: z.coerce.number().int() }), body: z.object({ action: z.enum(['refund', 'suspend', 'close']), refundCents: z.number().int().positive().optional(), resolution: z.string().min(3).max(500) }) },
    preHandler: [auth, requireRole('admin')],
  }, async (req) => withTx(ctx.db, async tx => {
    const t = await one<{ id: number; booking_id: string | null; user_id: string; reason: string; status: string }>(tx, 'SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!t) throw notFound('Caso');
    if (t.status === 'resolved') throw conflict('already_resolved', 'Este caso ya está resuelto.');
    let refunded = 0;
    if (req.body.action === 'refund') {
      if (!t.booking_id) throw conflict('no_booking', 'Este caso no está ligado a una cita.');
      const pay = await one<{ captured_cents: number; refunded_cents: number }>(tx, 'SELECT captured_cents, refunded_cents FROM payments WHERE booking_id = $1', [t.booking_id]);
      refunded = await refundBooking(ctx, tx, t.booking_id, req.body.refundCents ?? (pay ? pay.captured_cents - pay.refunded_cents : 0));
      if (['no_show', 'late'].includes(t.reason)) await tx.query('UPDATE users SET credit_cents = credit_cents + $2 WHERE id = $1', [t.user_id, NO_SHOW_CREDIT_CENTS]);
    }
    if (req.body.action === 'suspend') {
      if (!t.booking_id) throw conflict('no_booking', 'Este caso no está ligado a una cita.');
      const bk = await one<{ physio_id: string }>(tx, 'SELECT physio_id FROM bookings WHERE id = $1', [t.booking_id]);
      await tx.query(`UPDATE physios SET status = 'suspended', available = false WHERE user_id = $1`, [bk!.physio_id]);
    }
    await tx.query(`UPDATE support_tickets SET status = 'resolved', resolution = $2, refund_cents = $3, resolved_by = $4, resolved_at = now() WHERE id = $1`, [t.id, req.body.resolution, refunded, req.auth.id]);
    await notify(tx, t.user_id, `Resolvimos tu caso #${t.id}: ${req.body.resolution}`, { ticketId: t.id });
    await audit(tx, req.auth.id, 'ticket.resolve', String(t.id), { action: req.body.action, refunded });
    return { ok: true, refundedCents: refunded };
  }));
}
