import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import * as S from '../schemas.js';
import { many, one, type Queryable } from '../db/pool.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { authGuard } from '../plugins/auth.js';

export interface PatientRow { id: string; owner_user_id: string; full_name: string; relationship: string; birth_year: number | null; can_consent: boolean }

export async function ownPatient(q: Queryable, userId: string, patientId: string): Promise<PatientRow> {
  const p = await one<PatientRow>(q, 'SELECT * FROM patients WHERE id = $1', [patientId]);
  if (!p) throw notFound('Paciente');
  if (p.owner_user_id !== userId) throw forbidden();
  return p;
}

export const ageOf = (p: PatientRow, now: Date) => (p.birth_year ? now.getUTCFullYear() - p.birth_year : null);

export async function patientRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);
  const body = z.object({
    fullName: z.string().min(3).max(120),
    relationship: z.string().min(2).max(40),   // «Abuela», «Mamá», «Hijo»
    birthYear: z.number().int().min(1900).max(2100).optional(),
    canConsent: z.boolean().default(true),
  });

  r.get('/v1/patients', { schema: { tags: ['patients'], summary: 'Yo y mis familiares', response: { 200: z.array(S.Patient) } }, preHandler: auth }, async (req) =>
    many(ctx.db, `SELECT id, full_name, relationship, birth_year, can_consent FROM patients WHERE owner_user_id = $1 ORDER BY relationship <> 'self', created_at`, [req.auth.id]));

  r.post('/v1/patients', { schema: { tags: ['patients'], summary: 'Agregar un familiar', body, response: { 200: S.Patient } }, preHandler: auth }, async (req) => {
    if (req.body.relationship.toLowerCase() === 'self') throw conflict('invalid_relationship', 'Usa otro parentesco.');
    return one(ctx.db, `INSERT INTO patients (owner_user_id, full_name, relationship, birth_year, can_consent) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, full_name, relationship, birth_year, can_consent`, [req.auth.id, req.body.fullName, req.body.relationship, req.body.birthYear ?? null, req.body.canConsent]);
  });

  r.patch('/v1/patients/:id', { schema: { tags: ['patients'], params: z.object({ id: z.string().uuid() }), body: body.partial() }, preHandler: auth }, async (req) => {
    const p = await ownPatient(ctx.db, req.auth.id, req.params.id);
    if (p.relationship === 'self' && req.body.relationship) throw conflict('invalid_relationship', 'No puedes cambiar tu propio parentesco.');
    return one(ctx.db, `UPDATE patients SET full_name = COALESCE($2, full_name), relationship = COALESCE($3, relationship), birth_year = COALESCE($4, birth_year), can_consent = COALESCE($5, can_consent)
      WHERE id = $1 RETURNING id, full_name, relationship, birth_year, can_consent`, [p.id, req.body.fullName ?? null, req.body.relationship ?? null, req.body.birthYear ?? null, req.body.canConsent ?? null]);
  });
}
