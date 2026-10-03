import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import * as S from '../schemas.js';
import { audit } from '../context.js';
import { many, one, withTx, type Queryable } from '../db/pool.js';
import { hmac, randomDigits, randomToken, safeEqual } from '../lib/crypto.js';
import { badRequest, conflict, tooMany, unauthorized } from '../lib/errors.js';
import { normalizePhone } from '../lib/ecuador.js';
import { authGuard, type Role } from '../plugins/auth.js';

const OTP_TTL_MIN = 5, OTP_MAX_ATTEMPTS = 5, OTP_MAX_PER_10_MIN = 3;

export async function issueTokens(app: FastifyInstance, ctx: AppContext, q: Queryable, user: { id: string; role: Role }, userAgent?: string) {
  const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: ctx.config.ACCESS_TOKEN_TTL });
  const refreshToken = randomToken();
  const expires = new Date(ctx.now().getTime() + ctx.config.REFRESH_TOKEN_DAYS * 86400000);
  await q.query('INSERT INTO refresh_tokens (user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, $4)',
    [user.id, hmac(ctx.config.HASH_PEPPER, refreshToken), userAgent ?? null, expires]);
  return { accessToken, refreshToken };
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);
  const phoneSchema = z.string().transform((v, c) => normalizePhone(v) ?? (c.addIssue({ code: 'custom', message: 'Celular ecuatoriano inválido (10 dígitos, empieza con 09).' }), z.NEVER));

  // 1. Pedir un código por SMS.
  r.post('/v1/auth/otp', {
    schema: { tags: ['auth'], summary: 'Enviar código de acceso por SMS', body: z.object({ phone: phoneSchema }), response: { 200: z.object({ sent: z.boolean(), expiresInSec: z.number() }) } },
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req) => {
    const { phone } = req.body;
    const recent = await one<{ n: number }>(ctx.db, `SELECT count(*) AS n FROM otp_codes WHERE phone = $1 AND created_at > $2`, [phone, new Date(ctx.now().getTime() - 600000)]);
    if ((recent?.n ?? 0) >= OTP_MAX_PER_10_MIN) throw tooMany('Ya te enviamos varios códigos. Espera 10 minutos.');
    const code = randomDigits(6);
    await ctx.db.query('INSERT INTO otp_codes (phone, code_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)',
      [phone, hmac(ctx.config.HASH_PEPPER, `${phone}:${code}`), new Date(ctx.now().getTime() + OTP_TTL_MIN * 60000), ctx.now()]);
    await ctx.sms.send(phone, `Tu código de FisioCerca es ${code}. Vence en ${OTP_TTL_MIN} minutos. No lo compartas con nadie.`);
    return { sent: true, expiresInSec: OTP_TTL_MIN * 60 };
  });

  // 2. Verificar el código: crea la cuenta si no existe y entrega los tokens.
  r.post('/v1/auth/verify', {
    schema: { tags: ['auth'], summary: 'Verificar código y obtener tokens', body: z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) }), response: { 200: S.Session } },
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (req) => {
    const { phone, code } = req.body;
    const otp = await one<{ id: string; code_hash: string; attempts: number }>(ctx.db,
      `SELECT id, code_hash, attempts FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL AND expires_at > $2 ORDER BY created_at DESC LIMIT 1`,
      [phone, ctx.now()]);
    if (!otp) throw badRequest('otp_expired', 'El código venció. Pide uno nuevo.');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw tooMany('Demasiados intentos con este código. Pide uno nuevo.');
    if (!safeEqual(otp.code_hash, hmac(ctx.config.HASH_PEPPER, `${phone}:${code}`))) {
      // Incremento atómico fuera de cualquier transacción: el intento fallido siempre queda contado.
      await ctx.db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
      throw badRequest('invalid_code', 'El código no es correcto.');
    }
    return withTx(ctx.db, async tx => {
      // Consumo condicional: si dos peticiones llegan a la vez con el mismo código, solo una gana.
      const consumed = await tx.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL AND attempts < $2', [otp.id, OTP_MAX_ATTEMPTS]);
      if (!consumed.rowCount) throw badRequest('otp_expired', 'El código ya se usó. Pide uno nuevo.');
      let user = await one<{ id: string; role: Role; deleted_at: Date | null }>(tx, 'SELECT id, role, deleted_at FROM users WHERE phone = $1', [phone]);
      const isNew = !user;
      if (!user) {
        user = (await one<{ id: string; role: Role; deleted_at: null }>(tx, `INSERT INTO users (phone) VALUES ($1) RETURNING id, role, deleted_at`, [phone]))!;
        await tx.query(`INSERT INTO patients (owner_user_id, full_name, relationship) VALUES ($1, '', 'self')`, [user.id]);
      }
      if (user.deleted_at) throw unauthorized('Esta cuenta fue eliminada.');
      const tokens = await issueTokens(app, ctx, tx, user, req.headers['user-agent']);
      return { ...tokens, user: { id: user.id, role: user.role }, isNew };
    });
  });

  // 3. Renovar el token de acceso. El refresh token rota en cada uso; si se reutiliza uno viejo, se revocan todos.
  r.post('/v1/auth/refresh', {
    schema: { tags: ['auth'], summary: 'Renovar tokens', body: z.object({ refreshToken: z.string().min(20) }), response: { 200: S.Tokens } },
  }, async (req) => {
    const hash = hmac(ctx.config.HASH_PEPPER, req.body.refreshToken);
    type Outcome = { reuse: string } | { tokens: { accessToken: string; refreshToken: string } };
    const result = await withTx<Outcome>(ctx.db, async tx => {
      const t = await one<{ id: string; user_id: string; revoked_at: Date | null; expires_at: Date; role: Role }>(tx,
        `SELECT t.id, t.user_id, t.revoked_at, t.expires_at, u.role FROM refresh_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1 FOR UPDATE OF t`, [hash]);
      if (!t) throw unauthorized('Sesión inválida.');
      if (t.revoked_at) return { reuse: t.user_id };
      if (t.expires_at < ctx.now()) throw unauthorized('Tu sesión expiró.');
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [t.id]);
      return { tokens: await issueTokens(app, ctx, tx, { id: t.user_id, role: t.role }, req.headers['user-agent']) };
    });
    if ('reuse' in result) {
      // Un token ya usado volvió a aparecer: probablemente fue robado. Se cierran todas las sesiones.
      await withTx(ctx.db, async tx => {
        await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [result.reuse]);
        await audit(tx, result.reuse, 'auth.refresh_reuse_detected', null);
      });
      throw unauthorized('Por seguridad cerramos todas tus sesiones. Vuelve a iniciar sesión.');
    }
    return result.tokens;
  });

  r.post('/v1/auth/logout', {
    schema: { tags: ['auth'], body: z.object({ refreshToken: z.string() }) },
  }, async (req) => {
    await ctx.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hmac(ctx.config.HASH_PEPPER, req.body.refreshToken)]);
    return { ok: true };
  });

  r.post('/v1/auth/logout-all', { schema: { tags: ['auth'], summary: 'Cerrar sesión en todos los dispositivos' }, preHandler: auth }, async (req) => {
    await ctx.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.auth.id]);
    return { ok: true };
  });

  // ---------- Mi cuenta ----------
  r.get('/v1/me', { schema: { tags: ['me'], response: { 200: S.Me } }, preHandler: auth }, async (req) => {
    type MeT = z.output<typeof S.Me>;
    const u = await one<MeT['user']>(ctx.db, `SELECT id, phone, role, full_name, email, kyc_status, credit_cents, created_at FROM users WHERE id = $1`, [req.auth.id]);
    const consents = await many<MeT['consents'][number]>(ctx.db, `SELECT kind, version, granted_at FROM consents WHERE user_id = $1 AND revoked_at IS NULL`, [req.auth.id]);
    const physio = await one<NonNullable<MeT['physio']>>(ctx.db, `SELECT status, available FROM physios WHERE user_id = $1`, [req.auth.id]);
    return { user: u!, consents, physio: physio ?? null };
  });

  r.patch('/v1/me', {
    schema: { tags: ['me'], body: z.object({ email: z.string().email().optional() }) },
    preHandler: auth,
  }, async (req) => {
    await ctx.db.query('UPDATE users SET email = COALESCE($2, email) WHERE id = $1', [req.auth.id, req.body.email ?? null]);
    return { ok: true };
  });

  r.post('/v1/me/consents', {
    schema: { tags: ['me'], summary: 'Otorgar un consentimiento (LOPDP)', body: z.object({ kind: z.enum(['terms', 'health_data', 'biometric', 'registro_civil']), version: z.string().min(1) }) },
    preHandler: auth,
  }, async (req) => {
    await ctx.db.query('INSERT INTO consents (user_id, kind, version, ip) VALUES ($1, $2, $3, $4)', [req.auth.id, req.body.kind, req.body.version, req.ip]);
    return { ok: true };
  });

  r.delete('/v1/me/consents/:kind', {
    schema: { tags: ['me'], params: z.object({ kind: z.enum(['terms', 'health_data', 'biometric', 'registro_civil']) }) },
    preHandler: auth,
  }, async (req) => {
    await ctx.db.query('UPDATE consents SET revoked_at = now() WHERE user_id = $1 AND kind = $2 AND revoked_at IS NULL', [req.auth.id, req.params.kind]);
    return { ok: true };
  });

  // Derecho de portabilidad: todos mis datos en un solo JSON.
  r.get('/v1/me/export', { schema: { tags: ['me'] }, preHandler: auth }, async (req) => {
    const id = req.auth.id;
    const [user, patients, bookings, consents, notifications] = await Promise.all([
      one(ctx.db, 'SELECT id, phone, full_name, email, kyc_status, created_at FROM users WHERE id = $1', [id]),
      many(ctx.db, 'SELECT id, full_name, relationship, birth_year FROM patients WHERE owner_user_id = $1', [id]),
      many(ctx.db, 'SELECT id, patient_id, physio_id, mode, status, scheduled_at, total_cents FROM bookings WHERE booked_by = $1', [id]),
      many(ctx.db, 'SELECT kind, version, granted_at, revoked_at FROM consents WHERE user_id = $1', [id]),
      many(ctx.db, 'SELECT body, created_at FROM notifications WHERE user_id = $1', [id]),
    ]);
    await audit(ctx.db, id, 'me.export', id);
    return { user, patients, bookings, consents, notifications };
  });

  // Derecho de eliminación: se anonimiza la cuenta. La historia clínica y las facturas se conservan lo que exige la ley.
  // No se puede eliminar con citas en curso: hay dinero retenido y alguien esperando la visita.
  r.post('/v1/me/delete', { schema: { tags: ['me'], response: { 200: S.Ok } }, preHandler: auth }, async (req) => {
    await withTx(ctx.db, async tx => {
      const active = await one<{ n: number }>(tx, `SELECT count(*) AS n FROM bookings WHERE (booked_by = $1 OR physio_id = $1) AND status IN ('pending', 'confirmed', 'en_route', 'arrived', 'in_progress')`, [req.auth.id]);
      if ((active?.n ?? 0) > 0) throw conflict('active_bookings', 'Tienes citas pendientes o en curso. Cancélalas o espera a que terminen para eliminar tu cuenta.');
      await tx.query(`UPDATE users SET deleted_at = $2, phone = 'deleted:' || id, email = NULL, full_name = NULL, cedula_enc = NULL WHERE id = $1`, [req.auth.id, ctx.now()]);
      await tx.query('UPDATE physios SET available = false WHERE user_id = $1', [req.auth.id]);
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.auth.id]);
      await audit(tx, req.auth.id, 'me.delete', req.auth.id);
    });
    return { ok: true };
  });

  r.get('/v1/notifications', {
    schema: { tags: ['me'], querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.coerce.number().int().optional() }), response: { 200: z.array(S.Notification) } },
    preHandler: auth,
  }, async (req) => many<z.output<typeof S.Notification>>(ctx.db, 'SELECT id, body, data, read_at, created_at FROM notifications WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3',
    [req.auth.id, req.query.before ?? null, req.query.limit]));

  r.post('/v1/notifications/read', { schema: { tags: ['me'] }, preHandler: auth }, async (req) => {
    await ctx.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.auth.id]);
    return { ok: true };
  });
}
