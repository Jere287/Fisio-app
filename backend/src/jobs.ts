import type { AppContext } from './context.js';
import { notify } from './context.js';
import { many, withTx } from './db/pool.js';
import { localParts } from './lib/time.js';
import { TRACKING_LEAD_MIN, lockBooking, transition } from './modules/bookings.js';
import { releaseBooking } from './modules/money.js';
import { purgeRecordings } from './modules/recordings.js';

export const PENDING_TIMEOUT_MIN = 30;
const LONG_SESSION_MIN = 90;
export const SAFETY_RETENTION_DAYS = 30;
// Una cita con reporte o alerta conserva su respaldo (recorrido y grabaciones) mientras se investiga.
const UNDER_REVIEW = `EXISTS (SELECT 1 FROM support_tickets t WHERE t.booking_id = x.booking_id) OR EXISTS (SELECT 1 FROM sos_alerts s WHERE s.booking_id = x.booking_id)`;
const LOCK_ID = 727001; // candado de PostgreSQL: solo una instancia corre las tareas a la vez

const minutesFrom = (ctx: AppContext, min: number) => new Date(ctx.now().getTime() + min * 60000);

// Solicitudes que el fisio no respondió a tiempo: se rechazan solas y se libera el pago.
async function expirePending(ctx: AppContext): Promise<number> {
  const due = await many<{ id: string }>(ctx.db, `SELECT id FROM bookings WHERE status = 'pending' AND created_at < $1`, [minutesFrom(ctx, -PENDING_TIMEOUT_MIN)]);
  for (const { id } of due) {
    await withTx(ctx.db, async tx => {
      const b = await lockBooking(tx, id);
      if (b.status !== 'pending') return;
      await transition(tx, b, 'rejected', null, { reason: 'timeout' });
      await releaseBooking(ctx, tx, b);
      await notify(tx, b.physio_id, 'Se venció una solicitud que no respondiste. Responder rápido mejora tu posición en las búsquedas.', { bookingId: b.id });
    });
  }
  return due.length;
}

async function reminders(ctx: AppContext): Promise<{ day: number; hour: number }> {
  const now = ctx.now();
  const hour = await many<{ id: string; booked_by: string; physio_id: string }>(ctx.db,
    `UPDATE bookings SET reminder_1h_at = $1, reminder_24h_at = coalesce(reminder_24h_at, $1)
     WHERE status = 'confirmed' AND reminder_1h_at IS NULL AND scheduled_at > $1 AND scheduled_at <= $2 RETURNING id, booked_by, physio_id`, [now, minutesFrom(ctx, 60)]);
  const day = await many<{ id: string; booked_by: string; physio_id: string }>(ctx.db,
    `UPDATE bookings SET reminder_24h_at = $1
     WHERE status = 'confirmed' AND reminder_24h_at IS NULL AND scheduled_at > $2 AND scheduled_at <= $3 RETURNING id, booked_by, physio_id`, [now, minutesFrom(ctx, 60), minutesFrom(ctx, 24 * 60)]);
  for (const b of hour) {
    await notify(ctx.db, b.booked_by, 'Tu sesión empieza en una hora. Ten a mano tu PIN.', { bookingId: b.id });
    await notify(ctx.db, b.physio_id, 'Tienes una sesión en una hora. Recuerda salir con tiempo.', { bookingId: b.id });
  }
  for (const b of day) await notify(ctx.db, b.booked_by, 'Mañana tienes tu sesión de fisioterapia. Si no puedes, cancela gratis hasta 12 horas antes.', { bookingId: b.id });
  return { day: day.length, hour: hour.length };
}

// Se abre el seguimiento mutuo: se avisa a las dos partes que ya pueden verse en el mapa.
async function trackingStart(ctx: AppContext): Promise<number> {
  const rows = await many<{ id: string; booked_by: string; physio_id: string }>(ctx.db,
    `UPDATE bookings SET tracking_notified_at = $1
     WHERE status = 'confirmed' AND mode = 'home' AND tracking_notified_at IS NULL AND scheduled_at > $1 AND scheduled_at <= $2 RETURNING id, booked_by, physio_id`,
    [ctx.now(), minutesFrom(ctx, TRACKING_LEAD_MIN)]);
  for (const b of rows) {
    await notify(ctx.db, b.physio_id, 'Tu visita empieza pronto. Abre la cita: el paciente ya ve tu ubicación y tú ves si está en el domicilio.', { bookingId: b.id, kind: 'tracking' });
    await notify(ctx.db, b.booked_by, 'Tu visita empieza pronto. Ya puedes ver en el mapa dónde está tu fisio.', { bookingId: b.id, kind: 'tracking' });
  }
  return rows.length;
}

// Borra el respaldo de seguridad vencido (recorridos y grabaciones) de más de 30 días, sin reporte ni alerta.
async function purgeSafetyData(ctx: AppContext): Promise<number> {
  const cutoff = minutesFrom(ctx, -SAFETY_RETENTION_DAYS * 24 * 60);
  const r = await ctx.db.query(`DELETE FROM booking_locations x WHERE x.at < $1 AND NOT (${UNDER_REVIEW})`, [cutoff]);
  return (r.rowCount ?? 0) + (await purgeRecordings(ctx, cutoff));
}

// Sesiones de más de 90 minutos: se pregunta a las dos partes si todo está bien.
async function longSessions(ctx: AppContext): Promise<number> {
  const rows = await many<{ id: string; booked_by: string; physio_id: string }>(ctx.db,
    `UPDATE bookings SET long_session_alert_at = $1 WHERE status = 'in_progress' AND long_session_alert_at IS NULL AND started_at < $2 RETURNING id, booked_by, physio_id`,
    [ctx.now(), minutesFrom(ctx, -LONG_SESSION_MIN)]);
  for (const b of rows) for (const u of [b.booked_by, b.physio_id]) await notify(ctx.db, u, 'La sesión ya pasó de 90 minutos. ¿Todo está bien? Si necesitas ayuda, usa el botón de emergencia.', { bookingId: b.id, kind: 'long_session' });
  return rows.length;
}

// Documentos vencidos (por ejemplo, antecedentes penales cada 6 meses): el fisio se desconecta hasta renovarlo.
async function expiredDocuments(ctx: AppContext): Promise<number> {
  const rows = await many<{ physio_id: string; title: string }>(ctx.db,
    `UPDATE physio_documents SET status = 'rejected' WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at < $1::date RETURNING physio_id, title`, [localParts(ctx.now()).date]);
  for (const d of rows) {
    await ctx.db.query('UPDATE physios SET available = false WHERE user_id = $1', [d.physio_id]);
    await notify(ctx.db, d.physio_id, `Venció tu documento «${d.title}». Súbelo de nuevo para seguir recibiendo pacientes.`);
  }
  return rows.length;
}

export async function runJobs(ctx: AppContext) {
  const expired = await expirePending(ctx);
  const r = await reminders(ctx);
  const long = await longSessions(ctx);
  const docs = await expiredDocuments(ctx);
  const tracking = await trackingStart(ctx);
  const purged = await purgeSafetyData(ctx);
  return { expired, reminders24h: r.day, reminders1h: r.hour, trackingStarted: tracking, longSessions: long, expiredDocuments: docs, purgedSafety: purged };
}

// Corre cada minuto. Con varias instancias, el candado evita que dos ejecuten lo mismo.
export function startScheduler(ctx: AppContext, log: (msg: string, data?: unknown) => void): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const client = await ctx.db.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
      if (!rows[0].ok) return;
      try {
        const out = await runJobs(ctx);
        if (Object.values(out).some(n => n > 0)) log('Tareas programadas ejecutadas', out);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
      }
    } catch (err) {
      log('Falló una tarea programada', { error: (err as Error).message });
    } finally {
      client.release();
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
}
