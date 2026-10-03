import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { audit, notify } from '../context.js';
import { one, withTx } from '../db/pool.js';
import { hmac, safeEqual } from '../lib/crypto.js';
import { cedulaError, dactilarOk } from '../lib/ecuador.js';
import { conflict, notFound, tooMany, unauthorized, unprocessable } from '../lib/errors.js';
import { authGuard, requireRole } from '../plugins/auth.js';

const MAX_FAILED_PER_DAY = 3;

export async function kycRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);

  // Inicia una verificación. Exige los consentimientos de biometría y de consulta al Registro Civil.
  r.post('/v1/kyc/sessions', { schema: { tags: ['kyc'], summary: 'Iniciar verificación de identidad' }, preHandler: auth }, async (req) => {
    const consents = await one<{ n: number }>(ctx.db,
      `SELECT count(DISTINCT kind) AS n FROM consents WHERE user_id = $1 AND kind IN ('biometric', 'registro_civil') AND revoked_at IS NULL`, [req.auth.id]);
    if ((consents?.n ?? 0) < 2) throw unprocessable('consent_required', 'Necesitamos tu autorización para usar tu rostro y consultar el Registro Civil. También puedes verificarte por videollamada con un agente.');
    if (req.auth.kycStatus === 'approved') throw conflict('already_verified', 'Tu identidad ya está verificada.');
    const failed = await one<{ n: number }>(ctx.db, `SELECT count(*) AS n FROM kyc_sessions WHERE user_id = $1 AND status = 'rejected' AND created_at > $2`,
      [req.auth.id, new Date(ctx.now().getTime() - 86400000)]);
    if ((failed?.n ?? 0) >= MAX_FAILED_PER_DAY) throw tooMany('Por seguridad bloqueamos nuevos intentos por 24 horas. Puedes verificarte con un agente.');
    const s = await ctx.kyc.createSession(req.auth.id);
    const row = await one<{ id: string }>(ctx.db, `INSERT INTO kyc_sessions (user_id, provider, provider_ref, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, [req.auth.id, ctx.kyc.name, s.ref, ctx.now()]);
    await ctx.db.query(`UPDATE users SET kyc_status = 'pending' WHERE id = $1`, [req.auth.id]);
    return { sessionId: row!.id, uploadUrls: s.uploadUrls };
  });

  // Envía cédula, código dactilar y las fotos ya subidas. El proveedor responde aprobado, revisión o rechazo.
  r.post('/v1/kyc/sessions/:id/submit', {
    schema: {
      tags: ['kyc'], params: z.object({ id: z.string().uuid() }),
      body: z.object({
        fullName: z.string().min(5).max(120),
        cedula: z.string(), dactilar: z.string().transform(s => s.toUpperCase()),
        frontRef: z.string().min(1), backRef: z.string().min(1), selfieRef: z.string().min(1),
      }),
    },
    preHandler: auth,
  }, async (req) => {
    const b = req.body;
    const cErr = cedulaError(b.cedula);
    if (cErr) throw unprocessable('invalid_cedula', cErr);
    if (!dactilarOk(b.dactilar)) throw unprocessable('invalid_dactilar', 'El código dactilar tiene el formato letra, 4 números, letra, 4 números.');
    const s = await one<{ id: string; provider_ref: string; status: string }>(ctx.db, 'SELECT id, provider_ref, status FROM kyc_sessions WHERE id = $1 AND user_id = $2', [req.params.id, req.auth.id]);
    if (!s) throw notFound('Sesión de verificación');
    if (s.status !== 'pending') throw conflict('session_closed', 'Esta verificación ya terminó. Inicia una nueva.');
    const cedulaHash = hmac(ctx.config.HASH_PEPPER, `cedula:${b.cedula}`);
    const dup = await one(ctx.db, 'SELECT 1 FROM users WHERE cedula_hash = $1 AND id <> $2', [cedulaHash, req.auth.id]);
    if (dup) throw conflict('cedula_in_use', 'Esta cédula ya está registrada en otra cuenta. Escríbenos a soporte.');

    const result = await ctx.kyc.verify({ ref: s.provider_ref, cedula: b.cedula, dactilar: b.dactilar, frontRef: b.frontRef, backRef: b.backRef, selfieRef: b.selfieRef });
    await withTx(ctx.db, async tx => {
      await tx.query('UPDATE kyc_sessions SET status = $2, face_score = $3, reason = $4, decided_at = now() WHERE id = $1', [s.id, result.status, result.faceScore, result.reason ?? null]);
      if (result.status === 'rejected') {
        await tx.query(`UPDATE users SET kyc_status = 'rejected' WHERE id = $1`, [req.auth.id]);
      } else {
        await tx.query(`UPDATE users SET kyc_status = $2, full_name = $3, cedula_enc = $4, cedula_hash = $5 WHERE id = $1`,
          [req.auth.id, result.status, b.fullName, ctx.cipher.encrypt(b.cedula), cedulaHash]);
        await tx.query(`UPDATE patients SET full_name = $2 WHERE owner_user_id = $1 AND relationship = 'self'`, [req.auth.id, b.fullName]);
      }
      await notify(tx, req.auth.id, { approved: 'Tu identidad está verificada.', review: 'Un agente revisará tu verificación en menos de 2 horas.', rejected: 'No pudimos verificar tu identidad. Revisa tu código dactilar e inténtalo de nuevo.' }[result.status]);
    });
    return { status: result.status, reason: result.reason ?? null };
  });

  // Alternativa sin biometría (exigida por la norma de datos biométricos): videollamada con un agente.
  r.post('/v1/kyc/agent-call', {
    schema: { tags: ['kyc'], body: z.object({ slot: z.string().datetime() }) },
    preHandler: auth,
  }, async (req) => {
    await ctx.db.query(`UPDATE users SET kyc_status = 'pending_agent' WHERE id = $1 AND kyc_status <> 'approved'`, [req.auth.id]);
    await audit(ctx.db, req.auth.id, 'kyc.agent_call_requested', req.auth.id, { slot: req.body.slot });
    return { status: 'pending_agent' };
  });

  // Webhook del proveedor (decisiones asíncronas). Se verifica la firma HMAC del cuerpo original.
  r.post('/v1/webhooks/kyc', {
    schema: { tags: ['webhooks'], body: z.object({ ref: z.string(), status: z.enum(['approved', 'rejected']), faceScore: z.number().optional() }) },
  }, async (req) => {
    const sig = String(req.headers['x-signature'] ?? '');
    if (!req.rawBody || !safeEqual(sig, hmac(ctx.config.KYC_WEBHOOK_SECRET, req.rawBody))) throw unauthorized('Firma inválida.');
    await decide(ctx, null, { ref: req.body.ref }, req.body.status);
    return { ok: true };
  });

  // Revisión manual del equipo para los casos en «review».
  r.post('/v1/admin/kyc/:id/decision', {
    schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(['approved', 'rejected']) }) },
    preHandler: [auth, requireRole('admin')],
  }, async (req) => {
    await decide(ctx, req.auth.id, { id: req.params.id }, req.body.decision);
    return { ok: true };
  });
}

async function decide(ctx: AppContext, actorId: string | null, by: { id?: string; ref?: string }, decision: 'approved' | 'rejected') {
  await withTx(ctx.db, async tx => {
    const s = await one<{ id: string; user_id: string }>(tx, `SELECT id, user_id FROM kyc_sessions WHERE ${by.id ? 'id' : 'provider_ref'} = $1 FOR UPDATE`, [by.id ?? by.ref]);
    if (!s) throw notFound('Sesión de verificación');
    await tx.query('UPDATE kyc_sessions SET status = $2, decided_at = now() WHERE id = $1', [s.id, decision]);
    await tx.query('UPDATE users SET kyc_status = $2 WHERE id = $1', [s.user_id, decision]);
    await notify(tx, s.user_id, decision === 'approved' ? 'Tu identidad está verificada. Ya puedes reservar.' : 'No pudimos verificar tu identidad. Escríbenos a soporte.');
    await audit(tx, actorId, 'kyc.decision', s.id, { decision });
  });
}
