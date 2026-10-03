import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import * as S from '../schemas.js';
import { notify } from '../context.js';
import { many, one } from '../db/pool.js';
import { forbidden, notFound } from '../lib/errors.js';
import { localParts } from '../lib/time.js';
import { authGuard } from '../plugins/auth.js';
import { ownPatient } from './patients.js';

const HIGH_PAIN = 7;

export async function clinicalRoutes(app: FastifyInstance, ctx: AppContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = authGuard(ctx);
  const idParam = z.object({ id: z.string().uuid() });

  r.get('/v1/exercises', { schema: { tags: ['clinical'], response: { 200: z.array(S.Exercise) } }, preHandler: auth }, async () =>
    many<z.output<typeof S.Exercise>>(ctx.db, 'SELECT code, name, dose, instructions, video_url FROM exercises ORDER BY name'));

  // Historia clínica: la ven el dueño de la cuenta y los fisios que atendieron a ese paciente. Cada acceso queda registrado.
  r.get('/v1/patients/:id/record', { schema: { tags: ['clinical'], summary: 'Historia clínica', params: idParam, response: { 200: S.ClinicalRecord } }, preHandler: auth }, async (req) => {
    const p = await one<{ id: string; owner_user_id: string; full_name: string; relationship: string; birth_year: number | null }>(ctx.db, 'SELECT * FROM patients WHERE id = $1', [req.params.id]);
    if (!p) throw notFound('Paciente');
    const isOwner = p.owner_user_id === req.auth.id;
    const treats = !isOwner && await one(ctx.db, `SELECT 1 FROM bookings WHERE patient_id = $1 AND physio_id = $2 AND status IN ('confirmed', 'en_route', 'arrived', 'in_progress', 'completed') LIMIT 1`, [p.id, req.auth.id]);
    if (!isOwner && !treats) throw forbidden('Solo el paciente y su especialista tratante pueden ver esta historia clínica.');
    await ctx.db.query('INSERT INTO clinical_access_log (patient_id, actor_id, action) VALUES ($1, $2, $3)', [p.id, req.auth.id, 'view_record']);

    const notes = await many<Record<string, any>>(ctx.db, `SELECT n.id, n.created_at, n.pain_before, n.pain_after, n.subjective_enc, n.objective_enc, n.assessment_enc, n.plan_enc, u.full_name AS physio_name
      FROM clinical_notes n JOIN users u ON u.id = n.physio_id WHERE n.patient_id = $1 ORDER BY n.created_at`, [p.id]);
    const exercises = await many<z.output<typeof S.Exercise>>(ctx.db, `SELECT e.code, e.name, e.dose, e.instructions, e.video_url FROM exercise_assignments a JOIN exercises e ON e.code = a.exercise_code WHERE a.patient_id = $1 ORDER BY e.name`, [p.id]);
    const since = new Date(ctx.now().getTime() - 6 * 86400000);
    const logs = await many<{ done_on: string; n: number }>(ctx.db, `SELECT done_on::text, count(*) AS n FROM exercise_logs WHERE patient_id = $1 AND done_on >= $2::date GROUP BY done_on`, [p.id, localParts(since).date]);
    const pain = await many<{ value: number; created_at: Date }>(ctx.db, 'SELECT value, created_at FROM pain_logs WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 30', [p.id]);
    const daysComplete = logs.filter(l => exercises.length && l.n >= exercises.length).length;
    return {
      patient: { id: p.id, name: p.full_name, relationship: p.relationship, birthYear: p.birth_year },
      notes: notes.map(n => ({
        id: n.id, date: n.created_at, physio: n.physio_name, painBefore: n.pain_before, painAfter: n.pain_after,
        subjective: ctx.cipher.decryptOpt(n.subjective_enc), objective: ctx.cipher.decryptOpt(n.objective_enc),
        assessment: ctx.cipher.decrypt(n.assessment_enc), plan: ctx.cipher.decrypt(n.plan_enc),
      })),
      exercises, painLogs: pain, adherence: { daysCompleteLast7: daysComplete, percent: Math.round((daysComplete / 7) * 100) },
    };
  });

  r.post('/v1/patients/:id/exercise-logs', {
    schema: { tags: ['clinical'], params: idParam, body: z.object({ exerciseCode: z.string().max(40) }) },
    preHandler: auth,
  }, async (req) => {
    await ownPatient(ctx.db, req.auth.id, req.params.id);
    const assigned = await one(ctx.db, 'SELECT 1 FROM exercise_assignments WHERE patient_id = $1 AND exercise_code = $2', [req.params.id, req.body.exerciseCode]);
    if (!assigned) throw notFound('Ejercicio asignado');
    await ctx.db.query('INSERT INTO exercise_logs (patient_id, exercise_code, done_on) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [req.params.id, req.body.exerciseCode, localParts(ctx.now()).date]);
    return { ok: true };
  });

  // Dolor después de los ejercicios. Desde 7/10 se avisa al fisio tratante.
  r.post('/v1/patients/:id/pain-logs', {
    schema: { tags: ['clinical'], params: idParam, body: z.object({ value: z.number().int().min(0).max(10) }) },
    preHandler: auth,
  }, async (req) => {
    const p = await ownPatient(ctx.db, req.auth.id, req.params.id);
    await ctx.db.query('INSERT INTO pain_logs (patient_id, value) VALUES ($1, $2)', [p.id, req.body.value]);
    let alerted = false;
    if (req.body.value >= HIGH_PAIN) {
      const last = await one<{ physio_id: string }>(ctx.db, 'SELECT physio_id FROM clinical_notes WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 1', [p.id]);
      if (last) {
        const [first, second] = p.full_name.split(' ');
        await notify(ctx.db, last.physio_id, `${first} ${second ? second[0] + '.' : ''} reportó dolor ${req.body.value}/10 en sus ejercicios.`.replace('  ', ' '), { patientId: p.id });
        alerted = true;
      }
    }
    return { ok: true, physioAlerted: alerted };
  });
}
