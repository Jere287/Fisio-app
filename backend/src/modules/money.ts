import type { AppContext } from '../context.js';
import { many, one, type Tx } from '../db/pool.js';
import { split } from '../lib/pricing.js';

export interface BookingMoney {
  id: string; booked_by: string; physio_id: string; package_id: string | null;
  price_cents: number; fee_cents: number; credit_cents: number; total_cents: number;
}
interface PaymentRow { id: string; provider_ref: string; status: string; amount_cents: number; captured_cents: number; refunded_cents: number }

async function writeSplit(tx: Tx, b: BookingMoney, price: number, fee: number, credit: number) {
  const s = split(price, fee, credit);
  const rows: [string, number][] = [['physio_payable', s.physioPayable], ['platform_revenue', s.platformRevenue], ['iva_payable', s.ivaPayable], ['promotions', s.promotions]];
  for (const [account, amount] of rows) {
    if (amount === 0) continue;
    await tx.query('INSERT INTO ledger_entries (booking_id, physio_id, account, amount_cents) VALUES ($1, $2, $3, $4)', [b.id, b.physio_id, account, amount]);
  }
}

// Retiene el total en la tarjeta al reservar. Si el crédito cubre todo o se usa un paquete, no hay retención.
export async function authorizeBooking(ctx: AppContext, tx: Tx, b: BookingMoney) {
  if (b.total_cents === 0) return;
  const { ref } = await ctx.payments.authorize(b.total_cents, b.id);
  try {
    await tx.query(`INSERT INTO payments (booking_id, provider, provider_ref, status, amount_cents) VALUES ($1, $2, $3, 'authorized', $4)`, [b.id, ctx.payments.name, ref, b.total_cents]);
  } catch (err) {
    await ctx.payments.void(ref).catch(() => {});
    throw err;
  }
}

// Cobra al terminar la sesión y reparte el dinero en el libro contable.
export async function captureBooking(ctx: AppContext, tx: Tx, b: BookingMoney) {
  if (b.package_id) {
    const pkg = await one<{ price_cents: number; sessions_total: number }>(tx, 'SELECT price_cents, sessions_total FROM packages WHERE id = $1', [b.package_id]);
    await writeSplit(tx, b, Math.round(pkg!.price_cents / pkg!.sessions_total), 0, 0);
    return;
  }
  const pay = await one<PaymentRow>(tx, 'SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE', [b.id]);
  if (pay) {
    await ctx.payments.capture(pay.provider_ref, pay.amount_cents);
    await tx.query(`UPDATE payments SET status = 'captured', captured_cents = $2, updated_at = now() WHERE id = $1`, [pay.id, pay.amount_cents]);
  }
  await writeSplit(tx, b, b.price_cents, b.fee_cents, b.credit_cents);
}

// Cancelación tardía: se cobra una parte del precio (va al fisio, menos comisión) y se libera el resto.
export async function capturePartial(ctx: AppContext, tx: Tx, b: BookingMoney, amountCents: number) {
  if (b.package_id) { await writeSplit(tx, b, amountCents, 0, 0); return; }
  if (b.credit_cents) await tx.query('UPDATE users SET credit_cents = credit_cents + $2 WHERE id = $1', [b.booked_by, b.credit_cents]);
  const pay = await one<PaymentRow>(tx, 'SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE', [b.id]);
  if (!pay) return;
  const amount = Math.min(amountCents, pay.amount_cents);
  await ctx.payments.capture(pay.provider_ref, amount);
  await tx.query(`UPDATE payments SET status = 'captured', captured_cents = $2, updated_at = now() WHERE id = $1`, [pay.id, amount]);
  await writeSplit(tx, b, amount, 0, 0);
}

// Libera todo: anula la retención, devuelve el crédito y la sesión del paquete.
export async function releaseBooking(ctx: AppContext, tx: Tx, b: BookingMoney) {
  const pay = await one<PaymentRow>(tx, 'SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE', [b.id]);
  if (pay && pay.status === 'authorized') {
    await ctx.payments.void(pay.provider_ref);
    await tx.query(`UPDATE payments SET status = 'voided', updated_at = now() WHERE id = $1`, [pay.id]);
  }
  if (b.credit_cents) await tx.query('UPDATE users SET credit_cents = credit_cents + $2 WHERE id = $1', [b.booked_by, b.credit_cents]);
  if (b.package_id) await tx.query('UPDATE packages SET sessions_left = sessions_left + 1 WHERE id = $1', [b.package_id]);
}

// Devolución después del cobro (reclamos). Revierte el reparto en la misma proporción.
export async function refundBooking(ctx: AppContext, tx: Tx, bookingId: string, amountCents: number): Promise<number> {
  const pay = await one<PaymentRow & { physio_id: string }>(tx,
    `SELECT p.*, b.physio_id FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.booking_id = $1 FOR UPDATE OF p`, [bookingId]);
  if (!pay || pay.captured_cents === 0) return 0;
  const amount = Math.min(amountCents, pay.captured_cents - pay.refunded_cents);
  if (amount <= 0) return 0;
  await ctx.payments.refund(pay.provider_ref, amount);
  const refunded = pay.refunded_cents + amount;
  await tx.query(`UPDATE payments SET refunded_cents = $2, status = $3, updated_at = now() WHERE id = $1`,
    [pay.id, refunded, refunded === pay.captured_cents ? 'refunded' : 'partially_refunded']);
  const sums = await many<{ account: string; total: number }>(tx,
    `SELECT account, sum(amount_cents) AS total FROM ledger_entries WHERE booking_id = $1 AND account IN ('physio_payable', 'platform_revenue', 'iva_payable') GROUP BY account`, [bookingId]);
  const base = sums.reduce((a, s) => a + s.total, 0);
  let assigned = 0;
  for (const s of sums) {
    const part = s.account === 'platform_revenue' ? 0 : Math.round((s.total * amount) / base);
    if (part) await tx.query('INSERT INTO ledger_entries (booking_id, physio_id, account, amount_cents) VALUES ($1, $2, $3, $4)', [bookingId, pay.physio_id, s.account, -part]);
    assigned += part;
  }
  // La plataforma absorbe el redondeo para que la suma revertida sea exactamente lo devuelto.
  await tx.query(`INSERT INTO ledger_entries (booking_id, physio_id, account, amount_cents) VALUES ($1, $2, 'platform_revenue', $3)`, [bookingId, pay.physio_id, -(amount - assigned)]);
  return amount;
}
