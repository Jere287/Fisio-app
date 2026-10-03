import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { audit, notify } from '../context.js';
import * as S from '../schemas.js';
import { many, one, withTx, type Queryable } from '../db/pool.js';
import { sha256 } from '../lib/crypto.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { authGuard, requireRole } from '../plugins/auth.js';
import { lockBooking, type BookingRow } from './bookings.js';

// Grabación de audio de seguridad de la visita.
// - Solo audio: en fisioterapia el paciente puede estar parcialmente descubierto; el video sería desproporcionado.
// - Cualquiera de las dos partes la activa; la otra recibe un aviso y lo ve en la cita.
// - El teléfono sube el audio por tramos (si le quitan el teléfono, lo ya subido queda a salvo).
// - Se guarda cifrado. Nadie lo escucha: ni el paciente, ni el fisio, ni el personal en general.
//   Solo el equipo de seguridad, si la cita tiene un reporte o una alerta, y cada acceso queda auditado.
// - Se borra a los 30 días, salvo que la cita siga en revisión.

export const MAX_SEGMENT_BYTES = 25 * 1024 * 1024;
const UPLOAD_GRACE_MS = 2 * 3600000; // el último tramo puede llegar hasta 2 horas después de terminar
const AUDIO_TYPES = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/3gpp'];

type Party = 'patient' | 'physio';
function partyOf(b: BookingRow, userId: string): Party {
  if (b.booked_by === userId) return 'patient';
  if (b.physio_id === userId) return 'physio';
  throw forbidden();
}
const column = (p: Party) => (p === 'patient' ? 'recording_patient_at' : 'recording_physio_at');

// Una cita «en revisión» (con reporte o alerta) conserva su respaldo y habilita el acceso de seguridad.
export async function underReview(q: Queryable, bookingId: string): Promise<boolean> {
  return !!(await one(q, `SELECT 1 WHERE EXISTS (SELECT 1 FROM support_tickets WHERE booking_id = $1) OR EXISTS (SELECT 1 FROM sos_alerts WHERE booking_id = $1)`, [bookingId]));
}

export async function recordingRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);
  const idParam = z.object({ id: z.string().uuid() });

  // El audio llega como cuerpo binario (audio/*), con su propio límite de tamaño.
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: MAX_SEGMENT_BYTES }, (_req, body, done) => done(null, body));

  r.post('/v1/bookings/:id/recording/start', {
    schema: { tags: ['recordings'], summary: 'Activar la grabación de audio de seguridad', params: idParam, response: { 200: S.Ok } }, preHandler: auth,
  }, async req => withTx(ctx.db, async tx => {
    const b = await lockBooking(tx, req.params.id);
    const who = partyOf(b, req.auth.id);
    if (b.mode !== 'home') throw unprocessable('home_only', 'La grabación de seguridad es para visitas a domicilio.');
    if (!['arrived', 'in_progress'].includes(b.status)) throw conflict('invalid_state', 'La grabación se activa cuando el fisio ya llegó.');
    const res = await tx.query(`UPDATE bookings SET ${column(who)} = $2 WHERE id = $1 AND ${column(who)} IS NULL`, [b.id, ctx.now()]);
    if (res.rowCount) {
      await tx.query(`INSERT INTO booking_events (booking_id, actor_id, type) VALUES ($1, $2, 'recording_started')`, [b.id, req.auth.id]);
      const other = who === 'patient' ? b.physio_id : b.booked_by;
      await notify(tx, other, `${who === 'patient' ? 'El paciente' : 'Tu fisio'} activó la grabación de audio de seguridad de la visita. Se guarda cifrada y solo se revisa si hay un reporte.`, { bookingId: b.id, kind: 'recording' });
    }
    return { ok: true };
  }));

  r.post('/v1/bookings/:id/recording/stop', {
    schema: { tags: ['recordings'], summary: 'Detener la grabación de audio de seguridad', params: idParam, response: { 200: S.Ok } }, preHandler: auth,
  }, async req => withTx(ctx.db, async tx => {
    const b = await lockBooking(tx, req.params.id);
    const who = partyOf(b, req.auth.id);
    const res = await tx.query(`UPDATE bookings SET ${column(who)} = NULL WHERE id = $1 AND ${column(who)} IS NOT NULL`, [b.id]);
    if (res.rowCount) await tx.query(`INSERT INTO booking_events (booking_id, actor_id, type) VALUES ($1, $2, 'recording_stopped')`, [b.id, req.auth.id]);
    return { ok: true };
  }));

  // Subida de un tramo de audio. Repetir el mismo tramo (reintento por mala señal) no lo duplica.
  r.post('/v1/bookings/:id/recordings', {
    schema: {
      tags: ['recordings'], summary: 'Subir un tramo de la grabación (cuerpo binario audio/*)', params: idParam,
      querystring: z.object({ seq: z.coerce.number().int().min(0).max(1000), startedAt: z.string().datetime(), durationMs: z.coerce.number().int().min(0).max(4 * 3600000) }),
      response: { 201: z.object({ ok: z.boolean(), id: z.uuid(), duplicate: z.boolean() }) },
    },
    preHandler: auth,
  }, async (req, reply) => {
    const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!AUDIO_TYPES.includes(type)) throw unprocessable('unsupported_audio', 'Formato de audio no admitido.');
    const audio = req.body as unknown;
    if (!Buffer.isBuffer(audio) || audio.length === 0) throw unprocessable('empty_audio', 'El tramo de audio está vacío.');
    const b = await one<BookingRow>(ctx.db, 'SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!b) throw notFound('Cita');
    const who = partyOf(b, req.auth.id);
    const started = await one(ctx.db, `SELECT 1 FROM booking_events WHERE booking_id = $1 AND actor_id = $2 AND type = 'recording_started'`, [b.id, req.auth.id]);
    if (!started) throw conflict('recording_not_started', 'Primero activa la grabación.');
    const ended = b.completed_at ?? b.cancelled_at;
    const open = ['arrived', 'in_progress'].includes(b.status) || (!!ended && ctx.now().getTime() - ended.getTime() <= UPLOAD_GRACE_MS);
    if (!open) throw conflict('recording_closed', 'Ya pasó el tiempo para subir audio de esta cita.');

    const id = randomUUID(), key = `recordings/${b.id}/${id}.bin`;
    const prev = await one<{ id: string }>(ctx.db, 'SELECT id FROM session_recordings WHERE booking_id = $1 AND recorded_by = $2 AND seq = $3', [b.id, req.auth.id, req.query.seq]);
    if (prev) { reply.status(201); return { ok: true, id: prev.id, duplicate: true }; }
    await ctx.storage.put(key, ctx.cipher.encryptBytes(audio));
    try {
      await ctx.db.query(`INSERT INTO session_recordings (id, booking_id, recorded_by, role, seq, started_at, duration_ms, bytes, content_type, storage_key, sha256, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, b.id, req.auth.id, who, req.query.seq, new Date(req.query.startedAt), req.query.durationMs, audio.length, type, key, sha256(audio), ctx.now()]);
    } catch (err) {
      await ctx.storage.delete(key); // dos subidas simultáneas del mismo tramo: gana una, la otra se descarta
      if ((err as { code?: string }).code === '23505') { reply.status(201); return { ok: true, id: (await one<{ id: string }>(ctx.db, 'SELECT id FROM session_recordings WHERE booking_id = $1 AND recorded_by = $2 AND seq = $3', [b.id, req.auth.id, req.query.seq]))!.id, duplicate: true }; }
      throw err;
    }
    reply.status(201);
    return { ok: true, id, duplicate: false };
  });

  // ---------- Equipo de seguridad ----------
  const admin = [auth, requireRole('admin')];
  const Recording = z.object({ id: z.uuid(), role: z.enum(['patient', 'physio']), seq: z.number(), started_at: S.isoDate, duration_ms: z.number(), bytes: z.number(), content_type: z.string(), sha256: z.string() });

  r.get('/v1/admin/bookings/:id/recordings', {
    schema: { tags: ['admin'], summary: 'Grabaciones de una cita en revisión', params: idParam, response: { 200: z.array(Recording) } }, preHandler: admin,
  }, async req => {
    if (!(await underReview(ctx.db, req.params.id))) throw new AppError(403, 'not_under_review', 'Las grabaciones solo se revisan si la cita tiene un reporte o una alerta.');
    await audit(ctx.db, req.auth.id, 'recording.list', req.params.id);
    return many<z.output<typeof Recording>>(ctx.db, `SELECT id, role, seq, started_at, duration_ms, bytes, content_type, sha256 FROM session_recordings
      WHERE booking_id = $1 AND deleted_at IS NULL ORDER BY role, seq`, [req.params.id]);
  });

  r.get('/v1/admin/recordings/:id/audio', {
    schema: { tags: ['admin'], summary: 'Escuchar un tramo (queda auditado)', params: idParam }, preHandler: admin,
  }, async (req, reply) => {
    const rec = await one<{ booking_id: string; storage_key: string; content_type: string; sha256: string }>(ctx.db,
      'SELECT booking_id, storage_key, content_type, sha256 FROM session_recordings WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!rec) throw notFound('Grabación');
    if (!(await underReview(ctx.db, rec.booking_id))) throw new AppError(403, 'not_under_review', 'Las grabaciones solo se revisan si la cita tiene un reporte o una alerta.');
    const audio = ctx.cipher.decryptBytes(await ctx.storage.get(rec.storage_key));
    if (sha256(audio) !== rec.sha256) throw new AppError(500, 'integrity_error', 'La grabación no coincide con su huella original.');
    await audit(ctx.db, req.auth.id, 'recording.listen', req.params.id, { bookingId: rec.booking_id });
    return reply.header('cache-control', 'no-store').type(rec.content_type).send(audio);
  });
}

// Borrado a los 30 días de las grabaciones de citas sin reporte ni alerta.
export async function purgeRecordings(ctx: AppContext, cutoff: Date): Promise<number> {
  const due = await many<{ id: string; storage_key: string }>(ctx.db, `SELECT r.id, r.storage_key FROM session_recordings r
    WHERE r.deleted_at IS NULL AND r.created_at < $1
      AND NOT EXISTS (SELECT 1 FROM support_tickets t WHERE t.booking_id = r.booking_id)
      AND NOT EXISTS (SELECT 1 FROM sos_alerts s WHERE s.booking_id = r.booking_id)`, [cutoff]);
  for (const rec of due) {
    await ctx.storage.delete(rec.storage_key);
    await ctx.db.query('UPDATE session_recordings SET deleted_at = $2 WHERE id = $1', [rec.id, ctx.now()]);
  }
  return due.length;
}
