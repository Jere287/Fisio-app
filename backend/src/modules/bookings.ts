import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import * as S from '../schemas.js';
import { audit, notify, notifyAdmins } from '../context.js';
import { many, one, withTx, type Queryable, type Tx } from '../db/pool.js';
import { randomDigits, safeEqual, sha256 } from '../lib/crypto.js';
import { RED_FLAGS, isEmergencyFlag } from '../lib/ecuador.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { ARRIVAL_RADIUS_M, distanceMeters } from '../lib/geo.js';
import { LATE_CANCEL_HOURS, LATE_CANCEL_RATE, NO_SHOW_CREDIT_CENTS, quote } from '../lib/pricing.js';
import { localParts } from '../lib/time.js';
import { authGuard, requireVerified } from '../plugins/auth.js';
import { idempotency } from '../plugins/idempotency.js';
import { ageOf, ownPatient } from './patients.js';
import { durationFor } from './physios.js';
import { authorizeBooking, captureBooking, capturePartial, releaseBooking, type BookingMoney } from './money.js';

export type Status = 'pending' | 'confirmed' | 'en_route' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'rejected' | 'no_show';
export interface BookingRow extends BookingMoney {
  patient_id: string; mode: 'home' | 'video'; status: Status; scheduled_at: Date; ends_at: Date; duration_min: number;
  address_enc: string | null; lat: number | null; lng: number | null; pain: Record<string, unknown>; pain_score: number | null; comments_enc: string | null;
  companion: string | null; companion_name: string | null; pin_enc: string; pin_attempts: number; physio_lat: number | null; physio_lng: number | null;
  red_flags: string[]; medical_clearance: boolean; physio_location_at: Date | null;
  patient_lat: number | null; patient_lng: number | null; patient_location_at: Date | null;
  recording_patient_at: Date | null; recording_physio_at: Date | null; door_confirmed_at: Date | null; started_at: Date | null; completed_at: Date | null; cancelled_at: Date | null; cancel_reason: string | null; created_at: Date;
}

const ACTIVE: Status[] = ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress'];
const NO_SHOW_GRACE_MIN = 20;
const MAX_PIN_ATTEMPTS = 5;
// Seguimiento mutuo: empieza 30 minutos antes de la hora (o al salir, si sale antes) y termina en la puerta.
export const TRACKING_LEAD_MIN = 30;
const trackingFrom = (b: BookingRow) => new Date(b.scheduled_at.getTime() - TRACKING_LEAD_MIN * 60000);
// ¿Se muestra la ubicación de cada parte a la otra?
const trackingVisible = (b: BookingRow, now: Date) => b.mode === 'home' && (b.status === 'en_route' || (b.status === 'confirmed' && now >= trackingFrom(b)));
// ¿Se registra la ubicación? También durante la visita, pero solo para el equipo de seguridad (no se muestra).
const trackingRecorded = (b: BookingRow, now: Date) => trackingVisible(b, now) || (b.mode === 'home' && ['arrived', 'in_progress'].includes(b.status));
// La ubicación del teléfono de quien reservó solo dice algo si esa persona estará en la visita.
const bookerPresent = (b: BookingRow, relationship: string | undefined) => relationship === 'self' || b.companion === 'booker';

// Transiciones permitidas. Cualquier otra se rechaza con 409.
const TRANSITIONS: Record<Status, Status[]> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['en_route', 'in_progress', 'cancelled', 'no_show'],
  en_route: ['arrived', 'cancelled', 'no_show'],
  arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [], cancelled: [], rejected: [], no_show: [],
};

const STATUS_TEXT: Partial<Record<Status, string>> = {
  confirmed: 'confirmó tu cita', en_route: 'va en camino', arrived: 'llegó a tu puerta', completed: 'terminó la sesión. ¿Cómo te fue?', rejected: 'no puede atenderte en ese horario. Elige otro especialista.',
};

export async function lockBooking(tx: Tx, id: string): Promise<BookingRow> {
  const b = await one<BookingRow>(tx, 'SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
  if (!b) throw notFound('Cita');
  return b;
}

export async function transition(tx: Tx, b: BookingRow, to: Status, actorId: string | null, data: Record<string, unknown> = {}, extraSql = '', extraParams: unknown[] = []) {
  if (!TRANSITIONS[b.status].includes(to)) throw conflict('invalid_transition', `La cita está «${b.status}» y no puede pasar a «${to}».`);
  await tx.query(`UPDATE bookings SET status = $2${extraSql} WHERE id = $1`, [b.id, to, ...extraParams]);
  await tx.query('INSERT INTO booking_events (booking_id, actor_id, type, data) VALUES ($1, $2, $3, $4)', [b.id, actorId, to, data]);
  const physio = await one<{ full_name: string }>(tx, 'SELECT full_name FROM users WHERE id = $1', [b.physio_id]);
  const msg = STATUS_TEXT[to];
  if (msg) await notify(tx, b.booked_by, `${(physio?.full_name ?? 'Tu fisio').split(' ')[0]} ${msg}`, { bookingId: b.id, status: to });
  b.status = to;
}

function role(b: BookingRow, userId: string): 'patient' | 'physio' {
  if (b.booked_by === userId) return 'patient';
  if (b.physio_id === userId) return 'physio';
  throw forbidden();
}
const asPatient = (b: BookingRow, userId: string) => { if (b.booked_by !== userId) throw forbidden(); };
const asPhysio = (b: BookingRow, userId: string) => { if (b.physio_id !== userId) throw forbidden(); };

// Lo que ve cada parte. El paciente ve su PIN; el fisio ve la dirección solo después de aceptar.
async function view(ctx: AppContext, q: Queryable, b: BookingRow, viewer: 'patient' | 'physio') {
  const viewerId = viewer === 'patient' ? b.booked_by : b.physio_id;
  const reviewed = b.status === 'completed' && !!(await one(q, 'SELECT 1 FROM reviews WHERE booking_id = $1 AND author_id = $2', [b.id, viewerId]));
  const patient = await one<{ full_name: string; relationship: string; birth_year: number | null; can_consent: boolean }>(q, 'SELECT full_name, relationship, birth_year, can_consent FROM patients WHERE id = $1', [b.patient_id]);
  const physio = await one<{ full_name: string }>(q, 'SELECT full_name FROM users WHERE id = $1', [b.physio_id]);
  const booker = await one<{ full_name: string; kyc_status: string }>(q, 'SELECT full_name, kyc_status FROM users WHERE id = $1', [b.booked_by]);
  const consent = await one(q, 'SELECT signed_at FROM clinical_consents WHERE patient_id = $1 AND physio_id = $2', [b.patient_id, b.physio_id]);
  const short = (n?: string | null) => { const [a, c] = (n ?? '').split(' '); return c ? `${a} ${c[0]}.` : a ?? ''; };
  const now = ctx.now();
  const visible = trackingVisible(b, now);
  const live = ['arrived', 'in_progress'].includes(b.status);
  const present = bookerPresent(b, patient?.relationship);
  const tracking = {
    from: trackingFrom(b), active: visible,
    // Si la app de quien mira debe enviar su ubicación ahora mismo.
    shareMine: trackingRecorded(b, now) && (viewer === 'physio' || present),
  };
  const base = {
    id: b.id, mode: b.mode, status: b.status, scheduledAt: b.scheduled_at, durationMin: b.duration_min,
    pain: b.pain, painScore: b.pain_score, comments: ctx.cipher.decryptOpt(b.comments_enc),
    priceCents: b.price_cents, feeCents: b.fee_cents, creditCents: b.credit_cents, totalCents: b.total_cents, usesPackage: !!b.package_id,
    consentSigned: !!consent, doorConfirmed: !!b.door_confirmed_at, reviewed, redFlags: b.red_flags, medicalClearance: b.medical_clearance,
    patient: { name: viewer === 'physio' ? short(patient?.full_name) : patient?.full_name, relationship: patient?.relationship, age: patient?.birth_year ? ctx.now().getUTCFullYear() - patient.birth_year : null, canConsent: patient?.can_consent },
    companion: b.companion, companionName: b.companion_name, tracking,
    // Quién está grabando el audio de seguridad ahora mismo: las dos partes lo ven.
    recording: { patient: live && !!b.recording_patient_at, physio: live && !!b.recording_physio_at },
  };
  if (viewer === 'patient') {
    return { ...base, address: ctx.cipher.decryptOpt(b.address_enc), lat: b.lat, lng: b.lng, physio: { id: b.physio_id, name: physio?.full_name }, pin: b.mode === 'home' ? ctx.cipher.decrypt(b.pin_enc) : null,
      physioLocation: visible && b.physio_lat != null ? { lat: b.physio_lat, lng: b.physio_lng, at: b.physio_location_at } : null };
  }
  const showAddress = b.status !== 'pending';
  return { ...base, address: showAddress ? ctx.cipher.decryptOpt(b.address_enc) : null, lat: showAddress ? b.lat : null, lng: showAddress ? b.lng : null,
    bookedBy: { name: short(booker?.full_name), verified: booker?.kyc_status === 'approved' },
    patientLocation: visible && present && b.patient_lat != null && b.patient_lng != null && b.lat != null && b.lng != null
      ? { lat: b.patient_lat, lng: b.patient_lng, at: b.patient_location_at, atHome: distanceMeters({ lat: b.patient_lat, lng: b.patient_lng }, { lat: b.lat, lng: b.lng }) <= ARRIVAL_RADIUS_M }
      : null };
}

export async function bookingRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);
  const idParam = z.object({ id: z.string().uuid() });
  const idem = idempotency(ctx);

  // ---------- Crear una reserva ----------
  r.post('/v1/bookings', {
    schema: {
      tags: ['bookings'], summary: 'Reservar una sesión',
      body: z.object({
        physioId: z.string().uuid(), patientId: z.string().uuid(), mode: z.enum(['home', 'video']), scheduledAt: z.string().datetime(),
        address: z.string().min(5).max(300).optional(), lat: z.number().optional(), lng: z.number().optional(),
        redFlags: z.array(z.enum(RED_FLAGS)).max(RED_FLAGS.length).default([]),
        medicalClearance: z.boolean().default(false),
        pain: z.object({ zones: z.array(z.string().max(40)).max(10).default([]), since: z.string().max(40).optional(), types: z.array(z.string().max(40)).max(10).default([]), worse: z.array(z.string().max(40)).max(10).default([]), history: z.string().max(500).optional() }).default({ zones: [], types: [], worse: [] }),
        painScore: z.number().int().min(0).max(10).optional(),
        comments: z.string().max(2000).optional(),
        companion: z.enum(['booker', 'other', 'none']).optional(),
        companionName: z.string().max(120).optional(),
        usePackage: z.boolean().default(false),
      }),
      response: { 201: S.Booking },
    },
    preHandler: [auth, requireVerified(), idem.preHandler],
    onSend: idem.onSend,
  }, async (req, reply) => {
    const b = req.body;
    const redFlags = [...new Set(b.redFlags)];
    if (redFlags.some(isEmergencyFlag)) {
      throw unprocessable('red_flags_emergency', 'Estos síntomas pueden ser una emergencia: llama al 911 o acude a emergencias ahora.', { redFlags });
    }
    if (redFlags.length && !b.medicalClearance) {
      throw unprocessable('red_flags_medical', 'Antes de la fisioterapia, un médico debe revisar estos síntomas. Si ya te evaluó y te indicó fisioterapia, confírmalo para continuar.', { redFlags });
    }
    if (!b.pain.zones.length && !(b.comments && b.comments.trim().length > 4)) throw unprocessable('pain_required', 'Cuéntanos dónde te duele o describe tu dolor.');
    const patient = await ownPatient(ctx.db, req.auth.id, b.patientId);
    const age = ageOf(patient, ctx.now());
    const isThird = patient.relationship !== 'self';
    if (isThird && ((age !== null && (age >= 75 || age < 18)) || !patient.can_consent) && (!b.companion || b.companion === 'none')) {
      throw unprocessable('companion_required', 'Para menores de edad, personas de 75 años o más, o quien no puede firmar, un adulto responsable debe estar presente.');
    }
    const physio = await one<{ status: string; offers_video: boolean; price_cents: number; video_price_cents: number; radius_km: number; base_lat: number; base_lng: number }>(ctx.db,
      'SELECT status, offers_video, price_cents, video_price_cents, radius_km, base_lat, base_lng FROM physios WHERE user_id = $1', [b.physioId]);
    if (!physio || physio.status !== 'approved') throw notFound('Fisioterapeuta');
    if (b.physioId === req.auth.id) throw unprocessable('self_booking', 'No puedes reservar contigo mismo.');
    if (b.mode === 'video' && !physio.offers_video) throw unprocessable('video_unavailable', 'Este especialista no atiende por videollamada.');
    if (b.mode === 'home') {
      if (!b.address || b.lat === undefined || b.lng === undefined) throw unprocessable('address_required', 'Necesitamos la dirección y el punto exacto de tu puerta.');
      if (distanceMeters({ lat: b.lat, lng: b.lng }, { lat: physio.base_lat, lng: physio.base_lng }) > physio.radius_km * 1000) {
        throw unprocessable('out_of_area', 'Tu dirección está fuera de la zona que cubre este especialista.');
      }
    }
    const start = new Date(b.scheduledAt), dur = durationFor(b.mode), end = new Date(start.getTime() + dur * 60000);
    if (start.getTime() < ctx.now().getTime() + 60 * 60000) throw unprocessable('too_soon', 'Reserva con al menos una hora de anticipación.');
    const lp = localParts(start);
    const fits = await one(ctx.db, 'SELECT 1 FROM availability WHERE physio_id = $1 AND weekday = $2 AND start_min <= $3 AND end_min >= $4', [b.physioId, lp.weekday, lp.minutes, lp.minutes + dur]);
    if (!fits) throw unprocessable('outside_schedule', 'El especialista no atiende en ese horario.');

    const created = await withTx(ctx.db, async tx => {
      let packageId: string | null = null;
      if (b.usePackage) {
        if (b.mode !== 'home') throw unprocessable('package_home_only', 'Los paquetes son para sesiones a domicilio.');
        const pkg = await one<{ id: string }>(tx, `SELECT id FROM packages WHERE owner_user_id = $1 AND physio_id = $2 AND sessions_left > 0 AND expires_at > $3 ORDER BY expires_at LIMIT 1 FOR UPDATE`, [req.auth.id, b.physioId, ctx.now()]);
        if (!pkg) throw unprocessable('no_package', 'No tienes sesiones disponibles en un paquete con este especialista.');
        packageId = pkg.id;
        await tx.query('UPDATE packages SET sessions_left = sessions_left - 1 WHERE id = $1', [pkg.id]);
      }
      const user = await one<{ credit_cents: number }>(tx, 'SELECT credit_cents FROM users WHERE id = $1 FOR UPDATE', [req.auth.id]);
      const qt = quote(b.mode === 'home' ? physio.price_cents : physio.video_price_cents, user!.credit_cents, !!packageId);
      if (qt.creditCents) await tx.query('UPDATE users SET credit_cents = credit_cents - $2 WHERE id = $1', [req.auth.id, qt.creditCents]);
      const row = await one<BookingRow>(tx, `INSERT INTO bookings (booked_by, patient_id, physio_id, mode, scheduled_at, duration_min, ends_at, address_enc, lat, lng, pain, pain_score, comments_enc,
          companion, companion_name, price_cents, fee_cents, credit_cents, package_id, total_cents, pin_enc, created_at, red_flags, medical_clearance)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24) RETURNING *`,
        [req.auth.id, patient.id, b.physioId, b.mode, start, dur, end, ctx.cipher.encryptOpt(b.mode === 'home' ? b.address : null), b.mode === 'home' ? b.lat : null, b.mode === 'home' ? b.lng : null,
          b.pain, b.painScore ?? null, ctx.cipher.encryptOpt(b.comments), isThird ? b.companion ?? null : null, b.companionName ?? null,
          qt.priceCents, qt.feeCents, qt.creditCents, packageId, qt.totalCents, ctx.cipher.encrypt(randomDigits(4)), ctx.now(), redFlags, redFlags.length > 0]);
      await authorizeBooking(ctx, tx, row!);
      await tx.query(`INSERT INTO booking_events (booking_id, actor_id, type) VALUES ($1, $2, 'created')`, [row!.id, req.auth.id]);
      await notify(tx, b.physioId, `Nueva solicitud${b.mode === 'video' ? ' por videollamada' : ''}. Tienes 30 minutos para responder.`, { bookingId: row!.id });
      return row!;
    });
    reply.status(201);
    return view(ctx, ctx.db, created, 'patient');
  });

  r.get('/v1/bookings', {
    schema: { tags: ['bookings'], summary: 'Mis citas (paginado por fecha)', querystring: z.object({ as: z.enum(['patient', 'physio']).default('patient'), limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().datetime().optional() }), response: { 200: z.array(S.Booking) } },
    preHandler: auth,
  }, async (req) => {
    const col = req.query.as === 'physio' ? 'physio_id' : 'booked_by';
    const rows = await many<BookingRow>(ctx.db, `SELECT * FROM bookings WHERE ${col} = $1 AND ($2::timestamptz IS NULL OR scheduled_at < $2) ORDER BY scheduled_at DESC LIMIT $3`,
      [req.auth.id, req.query.before ?? null, req.query.limit]);
    return Promise.all(rows.map(b => view(ctx, ctx.db, b, req.query.as)));
  });

  r.get('/v1/bookings/:id', { schema: { tags: ['bookings'], params: idParam, response: { 200: S.Booking } }, preHandler: auth }, async (req) => {
    const b = await one<BookingRow>(ctx.db, 'SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!b) throw notFound('Cita');
    return view(ctx, ctx.db, b, role(b, req.auth.id));
  });

  r.get('/v1/bookings/:id/events', { schema: { tags: ['bookings'], params: idParam }, preHandler: auth }, async (req) => {
    const b = await one<BookingRow>(ctx.db, 'SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!b) throw notFound('Cita');
    role(b, req.auth.id);
    return many(ctx.db, 'SELECT type, data, created_at FROM booking_events WHERE booking_id = $1 ORDER BY id', [b.id]);
  });

  // ---------- Acciones del fisio ----------
  const physioAction = (path: string, summary: string, handler: (tx: Tx, b: BookingRow, req: any) => Promise<unknown>, body?: z.ZodTypeAny, response: z.ZodTypeAny = S.Ok) =>
    r.post(`/v1/bookings/:id/${path}`, { schema: { tags: ['bookings'], summary, params: idParam, ...(body ? { body } : {}), response: { 200: response } }, preHandler: auth }, async (req) => {
      const out = await withTx(ctx.db, async tx => { const b = await lockBooking(tx, req.params.id); asPhysio(b, req.auth.id); return handler(tx, b, req); });
      return out ?? { ok: true };
    });

  physioAction('accept', 'Aceptar la solicitud', async (tx, b, req) => transition(tx, b, 'confirmed', req.auth.id));

  physioAction('reject', 'Rechazar la solicitud', async (tx, b, req) => {
    await transition(tx, b, 'rejected', req.auth.id);
    await releaseBooking(ctx, tx, b);
  });

  physioAction('depart', 'Salir hacia la dirección', async (tx, b, req) => {
    if (b.mode !== 'home') throw unprocessable('not_home_visit', 'Esta cita es por videollamada.');
    await transition(tx, b, 'en_route', req.auth.id);
  });

  physioAction('location', 'Enviar ubicación en vivo (fisio)', async (tx, b, req) => {
    if (!trackingRecorded(b, ctx.now())) throw conflict('tracking_closed', `La ubicación se comparte desde ${TRACKING_LEAD_MIN} minutos antes de la cita hasta que termina.`);
    await tx.query('UPDATE bookings SET physio_lat = $2, physio_lng = $3, physio_location_at = $4 WHERE id = $1', [b.id, req.body.lat, req.body.lng, ctx.now()]);
    await tx.query(`INSERT INTO booking_locations (booking_id, user_id, role, lat, lng, at) VALUES ($1, $2, 'physio', $3, $4, $5)`, [b.id, req.auth.id, req.body.lat, req.body.lng, ctx.now()]);
    return { ok: true, distanceM: Math.round(distanceMeters(req.body, { lat: b.lat!, lng: b.lng! })) };
  }, z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), z.object({ ok: z.boolean(), distanceM: z.number() }));

  // «Llegué» solo dentro de 150 m del punto que marcó el paciente.
  physioAction('arrive', 'Marcar llegada (geocerca)', async (tx, b, req) => {
    const d = distanceMeters(req.body, { lat: b.lat!, lng: b.lng! });
    if (d > ARRIVAL_RADIUS_M) throw unprocessable('too_far', `Estás a ${Math.round(d)} m. El botón se activa a menos de ${ARRIVAL_RADIUS_M} m de la dirección.`, { distanceM: Math.round(d) });
    await transition(tx, b, 'arrived', req.auth.id, { distanceM: Math.round(d) }, ', physio_lat = $3, physio_lng = $4', [req.body.lat, req.body.lng]);
  }, z.object({ lat: z.number(), lng: z.number() }));

  // Iniciar: a domicilio exige rostro confirmado en la puerta, consentimiento firmado y el PIN del paciente.
  // El PIN se valida antes de abrir la transacción para que un intento fallido quede registrado aunque se lance un error.
  r.post('/v1/bookings/:id/start', {
    schema: { tags: ['bookings'], summary: 'Iniciar la sesión', params: idParam, body: z.object({ pin: z.string().regex(/^\d{4}$/).optional() }).default({}) },
    preHandler: auth,
  }, async (req) => {
    const pre = await one<BookingRow>(ctx.db, 'SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!pre) throw notFound('Cita');
    asPhysio(pre, req.auth.id);
    if (pre.mode === 'home') {
      if (pre.pin_attempts >= MAX_PIN_ATTEMPTS) throw new AppError(423, 'pin_locked', 'Demasiados intentos de PIN. Contacta a soporte.');
      if (!req.body.pin || !safeEqual(req.body.pin, ctx.cipher.decrypt(pre.pin_enc))) {
        await ctx.db.query('UPDATE bookings SET pin_attempts = pin_attempts + 1 WHERE id = $1', [pre.id]);
        throw unprocessable('wrong_pin', 'PIN incorrecto. Pídelo de nuevo al paciente.');
      }
    }
    await withTx(ctx.db, async tx => {
      const b = await lockBooking(tx, req.params.id);
      const consent = await one(tx, 'SELECT 1 FROM clinical_consents WHERE patient_id = $1 AND physio_id = $2', [b.patient_id, b.physio_id]);
      if (!consent) throw unprocessable('consent_required', 'El paciente o su representante debe firmar el consentimiento informado.');
      if (b.mode === 'home') {
        if (b.status !== 'arrived') throw conflict('invalid_transition', 'Primero marca tu llegada.');
        if (!b.door_confirmed_at) throw unprocessable('door_unconfirmed', 'El paciente debe confirmar que eres la persona del perfil.');
      }
      await transition(tx, b, 'in_progress', req.auth.id, {}, ', started_at = $3', [ctx.now()]);
    });
    return { ok: true };
  });

  // Terminar: nota SOAP cifrada, ejercicios para casa, cobro y reparto contable.
  physioAction('complete', 'Terminar la sesión con la nota clínica', async (tx, b, req) => {
    const n = req.body;
    await transition(tx, b, 'completed', req.auth.id, {}, ', completed_at = $3', [ctx.now()]);
    await tx.query(`INSERT INTO clinical_notes (booking_id, patient_id, physio_id, subjective_enc, objective_enc, assessment_enc, plan_enc, pain_before, pain_after)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [b.id, b.patient_id, b.physio_id, ctx.cipher.encryptOpt(n.subjective), ctx.cipher.encryptOpt(n.objective), ctx.cipher.encrypt(n.assessment), ctx.cipher.encrypt(n.plan), n.painBefore ?? null, n.painAfter ?? null]);
    if (n.exercises) {
      await tx.query('DELETE FROM exercise_assignments WHERE patient_id = $1 AND physio_id = $2', [b.patient_id, b.physio_id]);
      for (const code of n.exercises) await tx.query('INSERT INTO exercise_assignments (patient_id, exercise_code, physio_id) VALUES ($1, $2, $3) ON CONFLICT (patient_id, exercise_code) DO UPDATE SET physio_id = EXCLUDED.physio_id, assigned_at = now()', [b.patient_id, code, b.physio_id]);
    }
    await captureBooking(ctx, tx, b);
  }, z.object({
    subjective: z.string().max(4000).optional(), objective: z.string().max(4000).optional(),
    assessment: z.string().min(3).max(4000), plan: z.string().min(3).max(4000),
    painBefore: z.number().int().min(0).max(10).optional(), painAfter: z.number().int().min(0).max(10).optional(),
    exercises: z.array(z.string().max(40)).max(20).optional(),
  }));

  // ---------- Acciones del paciente ----------
  const patientAction = (path: string, summary: string, handler: (tx: Tx, b: BookingRow, req: any) => Promise<unknown>, body?: z.ZodTypeAny, response: z.ZodTypeAny = S.Ok) =>
    r.post(`/v1/bookings/:id/${path}`, { schema: { tags: ['bookings'], summary, params: idParam, ...(body ? { body } : {}), response: { 200: response } }, preHandler: auth }, async (req) => {
      const out = await withTx(ctx.db, async tx => { const b = await lockBooking(tx, req.params.id); asPatient(b, req.auth.id); return handler(tx, b, req); });
      return out ?? { ok: true };
    });

  // Consentimiento informado: una vez por pareja paciente–fisio.
  patientAction('consent', 'Firmar el consentimiento informado', async (tx, b, req) => {
    const p = await one<{ full_name: string; can_consent: boolean }>(tx, 'SELECT full_name, can_consent FROM patients WHERE id = $1', [b.patient_id]);
    if (req.body.signerIsPatient && !p!.can_consent) throw unprocessable('representative_required', 'Esta persona no puede firmar por sí misma. Debe firmar su representante.');
    // La firma llega como PNG (base64) o como trazo vectorial SVG. Se guarda solo su huella SHA-256.
    let signature: Buffer;
    if (req.body.signatureSvg) {
      const svg: string = req.body.signatureSvg;
      if (!/^<svg[\s>]/.test(svg) || /<script|on\w+=|javascript:/i.test(svg) || !/<path\b/.test(svg)) throw unprocessable('invalid_signature', 'La firma no es válida. Vuelve a firmar.');
      signature = Buffer.from(svg, 'utf8');
    } else {
      signature = Buffer.from(req.body.signaturePngBase64 ?? '', 'base64');
      if (signature.length < 100 || signature.subarray(1, 4).toString() !== 'PNG') throw unprocessable('invalid_signature', 'La firma debe ser una imagen PNG.');
    }
    await tx.query(`INSERT INTO clinical_consents (patient_id, physio_id, signer_name, signer_is_patient, signature_sha256) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (patient_id, physio_id) DO NOTHING`, [b.patient_id, b.physio_id, req.body.signerName, req.body.signerIsPatient, sha256(signature)]);
    await tx.query(`INSERT INTO booking_events (booking_id, actor_id, type) VALUES ($1, $2, 'consent_signed')`, [b.id, req.auth.id]);
  }, z.object({
    signerName: z.string().min(3).max(120), signerIsPatient: z.boolean(),
    signaturePngBase64: z.string().min(100).max(1_400_000).optional(),
    signatureSvg: z.string().min(30).max(200_000).optional(),
  }).refine(v => !!v.signaturePngBase64 !== !!v.signatureSvg, 'Envía la firma en un solo formato: PNG o SVG.'));

  // ¿La persona en la puerta es la del perfil? Si no, se cancela, se suspende al fisio y se alerta a seguridad.
  patientAction('door', 'Confirmar identidad del fisio en la puerta', async (tx, b, req) => {
    if (b.status !== 'arrived') throw conflict('invalid_state', 'El especialista todavía no marcó su llegada.');
    if (req.body.matches) {
      await tx.query('UPDATE bookings SET door_confirmed_at = $2 WHERE id = $1', [b.id, ctx.now()]);
      return { ok: true };
    }
    await transition(tx, b, 'cancelled', req.auth.id, { reason: 'identity_mismatch' }, ', cancelled_at = $3, cancel_reason = $4', [ctx.now(), 'identity_mismatch']);
    await releaseBooking(ctx, tx, b);
    await tx.query(`UPDATE physios SET status = 'suspended', available = false WHERE user_id = $1`, [b.physio_id]);
    await tx.query(`INSERT INTO sos_alerts (booking_id, user_id, lat, lng, note) VALUES ($1, $2, $3, $4, 'La persona en la puerta no coincide con el perfil')`, [b.id, req.auth.id, b.lat, b.lng]);
    await tx.query(`INSERT INTO support_tickets (booking_id, user_id, reason, description, priority) VALUES ($1, $2, 'conduct', 'Identidad no coincide en la puerta', 'high')`, [b.id, req.auth.id]);
    await notifyAdmins(tx, 'ALERTA: identidad no coincide en una visita. Especialista suspendido.', { bookingId: b.id });
    await audit(tx, req.auth.id, 'booking.identity_mismatch', b.id);
    return { ok: true, cancelled: true };
  }, z.object({ matches: z.boolean() }));

  // Ubicación de quien reservó, solo si estará en la visita: el fisio ve si hay alguien en el domicilio antes de ir.
  patientAction('patient-location', 'Enviar ubicación en vivo (paciente)', async (tx, b, req) => {
    if (!trackingRecorded(b, ctx.now())) throw conflict('tracking_closed', `La ubicación se comparte desde ${TRACKING_LEAD_MIN} minutos antes de la cita hasta que termina.`);
    const p = await one<{ relationship: string }>(tx, 'SELECT relationship FROM patients WHERE id = $1', [b.patient_id]);
    if (!bookerPresent(b, p?.relationship)) throw unprocessable('not_present', 'Tu ubicación solo se comparte si vas a estar en la visita.');
    await tx.query('UPDATE bookings SET patient_lat = $2, patient_lng = $3, patient_location_at = $4 WHERE id = $1', [b.id, req.body.lat, req.body.lng, ctx.now()]);
    await tx.query(`INSERT INTO booking_locations (booking_id, user_id, role, lat, lng, at) VALUES ($1, $2, 'patient', $3, $4, $5)`, [b.id, req.auth.id, req.body.lat, req.body.lng, ctx.now()]);
    return { ok: true, distanceM: Math.round(distanceMeters(req.body, { lat: b.lat!, lng: b.lng! })) };
  }, z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), z.object({ ok: z.boolean(), distanceM: z.number() }));

  // «Mi fisio no llegó»: después de 20 minutos se cancela sin costo, se libera todo y se da crédito.
  patientAction('no-show', 'Reportar que el fisio no llegó', async (tx, b, req) => {
    if (b.mode !== 'home') throw unprocessable('not_home_visit', 'Para videollamadas usa «Reportar un problema».');
    if (ctx.now().getTime() < b.scheduled_at.getTime() + NO_SHOW_GRACE_MIN * 60000) {
      throw unprocessable('too_early', `Puedes reportarlo ${NO_SHOW_GRACE_MIN} minutos después de la hora acordada.`);
    }
    await transition(tx, b, 'no_show', req.auth.id, {}, ', cancelled_at = $3, cancel_reason = $4', [ctx.now(), 'no_show']);
    await releaseBooking(ctx, tx, b);
    await tx.query('UPDATE users SET credit_cents = credit_cents + $2 WHERE id = $1', [b.booked_by, NO_SHOW_CREDIT_CENTS]);
    await tx.query(`INSERT INTO support_tickets (booking_id, user_id, reason, description, status, resolution, resolved_at) VALUES ($1, $2, 'no_show', 'Reportado desde la cita', 'resolved', 'Devolución automática y $5 de crédito', now())`, [b.id, req.auth.id]);
    await notify(tx, b.booked_by, 'Cancelamos tu cita sin costo, liberamos lo retenido y te dimos $5 de crédito.', { bookingId: b.id });
    await notify(tx, b.physio_id, 'El paciente reportó que no llegaste a la cita. Esto afecta tu índice de cumplimiento.', { bookingId: b.id });
    return { ok: true, creditCents: NO_SHOW_CREDIT_CENTS };
  });

  // ---------- Cancelar (paciente o fisio) ----------
  r.post('/v1/bookings/:id/cancel', { schema: { tags: ['bookings'], params: idParam, body: z.object({ reason: z.string().max(300).optional() }) }, preHandler: auth }, async (req) =>
    withTx(ctx.db, async tx => {
      const b = await lockBooking(tx, req.params.id);
      const who = role(b, req.auth.id);
      if (!['pending', 'confirmed', 'en_route'].includes(b.status)) throw conflict('invalid_state', 'Esta cita ya no se puede cancelar.');
      const hoursLeft = (b.scheduled_at.getTime() - ctx.now().getTime()) / 3600000;
      const late = who === 'patient' && b.status !== 'pending' && hoursLeft < LATE_CANCEL_HOURS;
      await transition(tx, b, 'cancelled', req.auth.id, { by: who, late }, ', cancelled_at = $3, cancel_reason = $4', [ctx.now(), req.body.reason ?? `cancelled_by_${who}`]);
      if (late) {
        await capturePartial(ctx, tx, b, Math.round(b.price_cents * LATE_CANCEL_RATE));
      } else {
        await releaseBooking(ctx, tx, b);
      }
      if (who === 'physio') {
        await tx.query('UPDATE users SET credit_cents = credit_cents + $2 WHERE id = $1', [b.booked_by, NO_SHOW_CREDIT_CENTS]);
        await notify(tx, b.booked_by, 'Tu especialista canceló la cita. Te devolvimos todo y te dimos $5 de crédito.', { bookingId: b.id });
      } else {
        await notify(tx, b.physio_id, 'El paciente canceló su cita.', { bookingId: b.id });
      }
      return { ok: true, lateFeeCents: late ? Math.round(b.price_cents * LATE_CANCEL_RATE) : 0 };
    }));

  // ---------- Botón de emergencia ----------
  r.post('/v1/bookings/:id/sos', { schema: { tags: ['bookings'], params: idParam, body: z.object({ lat: z.number().optional(), lng: z.number().optional(), note: z.string().max(300).optional() }) }, preHandler: auth }, async (req) => {
    const b = await one<BookingRow>(ctx.db, 'SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!b) throw notFound('Cita');
    role(b, req.auth.id);
    const a = await one<{ id: number }>(ctx.db, 'INSERT INTO sos_alerts (booking_id, user_id, lat, lng, note) VALUES ($1, $2, $3, $4, $5) RETURNING id', [b.id, req.auth.id, req.body.lat ?? null, req.body.lng ?? null, req.body.note ?? null]);
    await notifyAdmins(ctx.db, 'ALERTA DE EMERGENCIA en una cita activa.', { bookingId: b.id, alertId: a!.id });
    return { alertId: a!.id, emergencyNumber: '911' };
  });

  // ---------- Reseñas (en ambas direcciones) ----------
  r.post('/v1/bookings/:id/reviews', {
    schema: { tags: ['bookings'], params: idParam, body: z.object({ stars: z.number().int().min(1).max(5), tags: z.array(z.string().max(30)).max(8).default([]), comment: z.string().max(1000).optional() }) },
    preHandler: auth,
  }, async (req) => withTx(ctx.db, async tx => {
    const b = await lockBooking(tx, req.params.id);
    const who = role(b, req.auth.id);
    if (b.status !== 'completed') throw conflict('not_completed', 'Solo puedes calificar sesiones terminadas.');
    const direction = who === 'patient' ? 'patient_to_physio' : 'physio_to_patient';
    await tx.query('INSERT INTO reviews (booking_id, author_id, target_id, direction, stars, tags, comment) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [b.id, req.auth.id, who === 'patient' ? b.physio_id : b.booked_by, direction, req.body.stars, req.body.tags, req.body.comment ?? null]);
    if (who === 'patient') await tx.query('UPDATE physios SET rating_sum = rating_sum + $2, rating_count = rating_count + 1 WHERE user_id = $1', [b.physio_id, req.body.stars]);
    return { ok: true };
  }));
}

export { ACTIVE };
