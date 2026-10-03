import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { audit, notify } from '../context.js';
import { many, one, withTx } from '../db/pool.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { fromLocal, localParts } from '../lib/time.js';
import { authGuard, requireRole, requireVerified } from '../plugins/auth.js';

export const SPECIALTIES = ['deportiva', 'traumatologica', 'neurologica', 'geriatrica', 'respiratoria', 'piso_pelvico', 'pediatrica'] as const;
const SELFIE_VALID_HOURS = 18;
const MAX_SEARCH_KM = 15;
const QUITO = { latMin: -0.45, latMax: 0.05, lngMin: -78.65, lngMax: -78.25 };
const lat = z.number().min(QUITO.latMin).max(QUITO.latMax);
const lng = z.number().min(QUITO.lngMin).max(QUITO.lngMax);

export const durationFor = (mode: 'home' | 'video') => (mode === 'home' ? 60 : 30);

export async function physioRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);

  const profile = z.object({
    bio: z.string().max(800),
    university: z.string().max(120),
    yearsExperience: z.number().int().min(0).max(60),
    specialties: z.array(z.enum(SPECIALTIES)).min(1),
    gender: z.enum(['f', 'm', 'x']),
    womenOnly: z.boolean().default(false),
    offersVideo: z.boolean().default(false),
    priceCents: z.number().int().min(500).max(50000),
    videoPriceCents: z.number().int().min(500).max(50000).default(1500),
    radiusKm: z.number().min(1).max(30),
    baseLat: lat, baseLng: lng,
  });

  // Postulación: solo para usuarios con identidad verificada.
  r.post('/v1/physios/apply', { schema: { tags: ['physios'], summary: 'Postular como fisioterapeuta', body: profile }, preHandler: [auth, requireVerified()] }, async (req) => {
    const b = req.body;
    const exists = await one(ctx.db, 'SELECT 1 FROM physios WHERE user_id = $1', [req.auth.id]);
    if (exists) throw conflict('already_applied', 'Ya enviaste tu postulación.');
    await ctx.db.query(`INSERT INTO physios (user_id, bio, university, years_experience, specialties, gender, women_only, offers_video, price_cents, video_price_cents, radius_km, base_lat, base_lng)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [req.auth.id, b.bio, b.university, b.yearsExperience, b.specialties, b.gender, b.womenOnly, b.offersVideo, b.priceCents, b.videoPriceCents, b.radiusKm, b.baseLat, b.baseLng]);
    return { status: 'applied' };
  });

  r.get('/v1/physios/me', { schema: { tags: ['physios'] }, preHandler: auth }, async (req) => {
    const p = await one(ctx.db, 'SELECT * FROM physios WHERE user_id = $1', [req.auth.id]);
    if (!p) throw notFound('Perfil de fisioterapeuta');
    const documents = await many(ctx.db, 'SELECT id, kind, title, reference, status, expires_at FROM physio_documents WHERE physio_id = $1 ORDER BY created_at', [req.auth.id]);
    const availability = await many(ctx.db, 'SELECT weekday, start_min, end_min FROM availability WHERE physio_id = $1 ORDER BY weekday, start_min', [req.auth.id]);
    return { ...p, documents, availability };
  });

  r.patch('/v1/physios/me', { schema: { tags: ['physios'], body: profile.partial() }, preHandler: auth }, async (req) => {
    const b = req.body;
    const cols: Record<string, unknown> = { bio: b.bio, university: b.university, years_experience: b.yearsExperience, specialties: b.specialties, women_only: b.womenOnly, offers_video: b.offersVideo,
      price_cents: b.priceCents, video_price_cents: b.videoPriceCents, radius_km: b.radiusKm, base_lat: b.baseLat, base_lng: b.baseLng };
    const set = Object.entries(cols).filter(([, v]) => v !== undefined);
    if (!set.length) return { ok: true };
    const res = await ctx.db.query(`UPDATE physios SET ${set.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE user_id = $1`, [req.auth.id, ...set.map(([, v]) => v)]);
    if (!res.rowCount) throw notFound('Perfil de fisioterapeuta');
    return { ok: true };
  });

  r.post('/v1/physios/me/documents', {
    schema: { tags: ['physios'], body: z.object({ kind: z.enum(['senescyt', 'msp', 'criminal_record', 'certificate']), title: z.string().min(3).max(160), reference: z.string().max(80).optional(), fileKey: z.string().max(300).optional(), expiresAt: z.string().date().optional() }) },
    preHandler: auth,
  }, async (req) => {
    const b = req.body;
    const p = await one(ctx.db, 'SELECT 1 FROM physios WHERE user_id = $1', [req.auth.id]);
    if (!p) throw notFound('Perfil de fisioterapeuta');
    return one(ctx.db, `INSERT INTO physio_documents (physio_id, kind, title, reference, file_key, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, kind, title, status`,
      [req.auth.id, b.kind, b.title, b.reference ?? null, b.fileKey ?? null, b.expiresAt ?? null]);
  });

  r.put('/v1/physios/me/availability', {
    schema: { tags: ['physios'], summary: 'Reemplazar el horario semanal', body: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1440), endMin: z.number().int().min(0).max(1440) }).refine(s => s.endMin > s.startMin, 'La hora de fin debe ser posterior al inicio')).max(30) },
    preHandler: [auth, requireRole('physio')],
  }, async (req) => {
    await withTx(ctx.db, async tx => {
      await tx.query('DELETE FROM availability WHERE physio_id = $1', [req.auth.id]);
      for (const s of req.body) await tx.query('INSERT INTO availability (physio_id, weekday, start_min, end_min) VALUES ($1, $2, $3, $4)', [req.auth.id, s.weekday, s.startMin, s.endMin]);
    });
    return { ok: true };
  });

  // Selfie diaria (como el Real-Time ID Check de Uber): evita que otra persona use la cuenta.
  r.post('/v1/physios/me/selfie-check', { schema: { tags: ['physios'], body: z.object({ selfieRef: z.string().min(1) }) }, preHandler: [auth, requireRole('physio')] }, async (req) => {
    const m = await ctx.kyc.faceMatch(req.auth.id, req.body.selfieRef);
    if (!m.match) {
      await audit(ctx.db, req.auth.id, 'physio.selfie_mismatch', req.auth.id, { score: m.score });
      throw unprocessable('selfie_mismatch', 'La selfie no coincide con tu foto verificada. Inténtalo con buena luz.');
    }
    await ctx.db.query('UPDATE physios SET last_selfie_at = $2 WHERE user_id = $1', [req.auth.id, ctx.now()]);
    return { ok: true, score: m.score };
  });

  r.post('/v1/physios/me/availability-toggle', { schema: { tags: ['physios'], body: z.object({ available: z.boolean() }) }, preHandler: [auth, requireRole('physio')] }, async (req) => {
    const p = await one<{ status: string; last_selfie_at: Date | null }>(ctx.db, 'SELECT status, last_selfie_at FROM physios WHERE user_id = $1', [req.auth.id]);
    if (!p || p.status !== 'approved') throw forbidden('Tu perfil todavía no está aprobado.');
    if (req.body.available) {
      const valid = await one<{ n: number }>(ctx.db, `SELECT count(DISTINCT kind) AS n FROM physio_documents WHERE physio_id = $1 AND status = 'approved'
        AND kind IN ('senescyt', 'msp', 'criminal_record') AND (expires_at IS NULL OR expires_at >= $2::date)`, [req.auth.id, localParts(ctx.now()).date]);
      if ((valid?.n ?? 0) < 3) throw unprocessable('documents_expired', 'Tienes un documento vencido. Súbelo de nuevo para recibir pacientes.');
    }
    if (req.body.available && (!p.last_selfie_at || ctx.now().getTime() - p.last_selfie_at.getTime() > SELFIE_VALID_HOURS * 3600000)) {
      throw unprocessable('selfie_required', 'Antes de conectarte, toma tu selfie del día.');
    }
    await ctx.db.query('UPDATE physios SET available = $2 WHERE user_id = $1', [req.auth.id, req.body.available]);
    return { available: req.body.available };
  });

  // Búsqueda por cercanía: solo fisios aprobados cuya zona de cobertura incluye la ubicación del paciente.
  r.get('/v1/physios/search', {
    schema: {
      tags: ['physios'], summary: 'Buscar fisioterapeutas cerca',
      querystring: z.object({
        lat: z.coerce.number().pipe(lat), lng: z.coerce.number().pipe(lng),
        specialty: z.enum(SPECIALTIES).optional(),
        women: z.coerce.boolean().optional(),
        video: z.coerce.boolean().optional(),
        availableNow: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
    },
    preHandler: auth,
  }, async (req) => {
    const q = req.query;
    const rows = await many<Record<string, any>>(ctx.db, `
      SELECT p.user_id AS id, u.full_name, p.specialties, p.price_cents, p.video_price_cents, p.offers_video, p.gender, p.women_only,
             p.years_experience, p.available, p.rating_sum, p.rating_count, p.radius_km,
             round(p.base_lat::numeric, 2) AS approx_lat, round(p.base_lng::numeric, 2) AS approx_lng,
             earth_distance(ll_to_earth($1, $2), ll_to_earth(p.base_lat, p.base_lng)) AS meters
      FROM physios p JOIN users u ON u.id = p.user_id
      WHERE p.status = 'approved' AND u.suspended_at IS NULL AND u.deleted_at IS NULL
        AND earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(p.base_lat, p.base_lng)
        AND earth_distance(ll_to_earth($1, $2), ll_to_earth(p.base_lat, p.base_lng)) <= p.radius_km * 1000
        AND ($4::text IS NULL OR $4 = ANY(p.specialties))
        AND ($5::boolean IS NOT TRUE OR p.gender = 'f')
        AND ($6::boolean IS NOT TRUE OR p.offers_video)
        AND ($7::boolean IS NOT TRUE OR p.available)
      ORDER BY meters LIMIT $8`,
      [q.lat, q.lng, MAX_SEARCH_KM * 1000, q.specialty ?? null, q.women ?? null, q.video ?? null, q.availableNow ?? null, q.limit]);
    return rows.map(({ meters, rating_sum, rating_count, ...p }) => ({
      ...p, distanceKm: Math.round(meters / 100) / 10, rating: rating_count ? Math.round((rating_sum / rating_count) * 10) / 10 : null, ratingCount: rating_count,
    }));
  });

  r.get('/v1/physios/:id', { schema: { tags: ['physios'], params: z.object({ id: z.string().uuid() }) }, preHandler: auth }, async (req) => {
    const p = await one<Record<string, any>>(ctx.db, `SELECT p.user_id AS id, u.full_name, p.bio, p.university, p.years_experience, p.specialties, p.gender, p.women_only, p.offers_video,
      p.price_cents, p.video_price_cents, p.radius_km, p.rating_sum, p.rating_count FROM physios p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1 AND p.status = 'approved'`, [req.params.id]);
    if (!p) throw notFound('Fisioterapeuta');
    const certificates = await many(ctx.db, `SELECT kind, title FROM physio_documents WHERE physio_id = $1 AND status = 'approved' ORDER BY kind, created_at`, [p.id]);
    const reviews = await many(ctx.db, `SELECT r.stars, r.tags, r.comment, r.created_at, split_part(u.full_name, ' ', 1) AS author
      FROM reviews r JOIN users u ON u.id = r.author_id WHERE r.target_id = $1 AND r.direction = 'patient_to_physio' ORDER BY r.created_at DESC LIMIT 10`, [p.id]);
    const { rating_sum, rating_count, ...rest } = p;
    return { ...rest, rating: rating_count ? Math.round((rating_sum / rating_count) * 10) / 10 : null, ratingCount: rating_count, certificates, reviews };
  });

  // Horarios libres de un día: horario semanal menos citas ya tomadas y horas pasadas.
  r.get('/v1/physios/:id/slots', {
    schema: { tags: ['physios'], params: z.object({ id: z.string().uuid() }), querystring: z.object({ date: z.string().date(), mode: z.enum(['home', 'video']).default('home') }) },
    preHandler: auth,
  }, async (req) => {
    const dur = durationFor(req.query.mode);
    const weekday = localParts(fromLocal(req.query.date, 12 * 60)).weekday;
    const windows = await many<{ start_min: number; end_min: number }>(ctx.db, 'SELECT start_min, end_min FROM availability WHERE physio_id = $1 AND weekday = $2 ORDER BY start_min', [req.params.id, weekday]);
    const busy = await many<{ scheduled_at: Date; ends_at: Date }>(ctx.db, `SELECT scheduled_at, ends_at FROM bookings WHERE physio_id = $1
      AND status IN ('pending', 'confirmed', 'en_route', 'arrived', 'in_progress') AND scheduled_at < $3 AND ends_at > $2`,
      [req.params.id, fromLocal(req.query.date, 0), fromLocal(req.query.date, 1440)]);
    const minStart = ctx.now().getTime() + 60 * 60000; // al menos 1 hora de anticipación
    const slots: string[] = [];
    for (const w of windows) {
      for (let m = w.start_min; m + dur <= w.end_min; m += 60) {
        const start = fromLocal(req.query.date, m), end = new Date(start.getTime() + dur * 60000);
        if (start.getTime() < minStart) continue;
        if (busy.some(b => b.scheduled_at < end && b.ends_at > start)) continue;
        slots.push(start.toISOString());
      }
    }
    return { date: req.query.date, mode: req.query.mode, durationMin: dur, slots };
  });

  // ---------- Revisión del equipo ----------
  r.get('/v1/admin/physios', { schema: { tags: ['admin'], querystring: z.object({ status: z.enum(['applied', 'approved', 'rejected', 'suspended']).default('applied') }) }, preHandler: [auth, requireRole('admin')] }, async (req) => {
    const list = await many<Record<string, any>>(ctx.db, `SELECT p.user_id AS id, u.full_name, u.kyc_status, p.specialties, p.price_cents, p.created_at FROM physios p JOIN users u ON u.id = p.user_id WHERE p.status = $1 ORDER BY p.created_at`, [req.query.status]);
    for (const p of list) p.documents = await many(ctx.db, 'SELECT id, kind, title, reference, status, expires_at FROM physio_documents WHERE physio_id = $1', [p.id]);
    return list;
  });

  r.post('/v1/admin/documents/:id/decision', {
    schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(['approved', 'rejected']) }) },
    preHandler: [auth, requireRole('admin')],
  }, async (req) => {
    const res = await ctx.db.query('UPDATE physio_documents SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1', [req.params.id, req.body.decision, req.auth.id]);
    if (!res.rowCount) throw notFound('Documento');
    await audit(ctx.db, req.auth.id, 'document.decision', req.params.id, { decision: req.body.decision });
    return { ok: true };
  });

  // Aprobar exige cédula verificada y título SENESCYT, registro MSP y antecedentes penales aprobados.
  r.post('/v1/admin/physios/:id/decision', {
    schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(['approve', 'reject', 'suspend']), reason: z.string().max(300).optional() }) },
    preHandler: [auth, requireRole('admin')],
  }, async (req) => {
    const id = req.params.id;
    await withTx(ctx.db, async tx => {
      const p = await one<{ kyc_status: string }>(tx, 'SELECT u.kyc_status FROM physios p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1 FOR UPDATE OF p', [id]);
      if (!p) throw notFound('Fisioterapeuta');
      if (req.body.decision === 'approve') {
        const docs = await many<{ kind: string }>(tx, `SELECT DISTINCT kind FROM physio_documents WHERE physio_id = $1 AND status = 'approved' AND (expires_at IS NULL OR expires_at > now())`, [id]);
        const missing = ['senescyt', 'msp', 'criminal_record'].filter(k => !docs.some(d => d.kind === k));
        if (p.kyc_status !== 'approved') missing.unshift('identidad');
        if (missing.length) throw unprocessable('documents_missing', 'Faltan documentos aprobados para publicar el perfil.', { missing });
        await tx.query(`UPDATE physios SET status = 'approved' WHERE user_id = $1`, [id]);
        await tx.query(`UPDATE users SET role = 'physio' WHERE id = $1`, [id]);
        await notify(tx, id, '¡Tu perfil fue aprobado! Ya apareces en las búsquedas cuando te conectas.');
      } else {
        await tx.query(`UPDATE physios SET status = $2, available = false WHERE user_id = $1`, [id, req.body.decision === 'reject' ? 'rejected' : 'suspended']);
        await notify(tx, id, req.body.decision === 'reject' ? `Tu postulación no fue aprobada. ${req.body.reason ?? ''}`.trim() : 'Tu cuenta de especialista está suspendida mientras revisamos un caso.');
      }
      await audit(tx, req.auth.id, 'physio.decision', id, req.body);
    });
    return { ok: true };
  });
}
