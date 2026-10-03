import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/jobs.js';
import { PNG, api, approvedPhysio, makeAdmin, setupEnv, teardown, verifiedUser, type TestEnv } from './helpers.js';

let env: TestEnv;
let physio: Awaited<ReturnType<typeof approvedPhysio>>;
let patient: Awaited<ReturnType<typeof verifiedUser>>;
let selfId: string;

const at = (hourQuito: number, day: number) => new Date(Date.UTC(2026, 9, day, hourQuito + 5)).toISOString();
const HOME = { lat: -0.1830, lng: -78.4830, address: 'Av. Amazonas y Naciones Unidas' };
const body = (scheduledAt: string, extra: Record<string, unknown> = {}) =>
  ({ physioId: physio.userId, patientId: selfId, mode: 'home', scheduledAt, ...HOME, pain: { zones: ['Rodilla'] }, ...extra });

async function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
  const r = await env.app.inject({ method: 'POST', url, payload: payload as object, headers: { authorization: `Bearer ${patient.token}`, ...headers } });
  return { status: r.statusCode, body: JSON.parse(r.body), headers: r.headers };
}

beforeAll(async () => {
  env = await setupEnv();
  const admin = await makeAdmin(env);
  physio = await approvedPhysio(env, admin);
  patient = await verifiedUser(env);
  selfId = (await api(env, patient.token).get('/v1/patients')).body[0].id;
});
afterAll(async () => { await teardown(env); });

describe('Idempotencia', () => {
  it('repetir la misma reserva con la misma clave no reserva ni retiene dos veces', async () => {
    const key = 'reserva-123456';
    const a = await post('/v1/bookings', body(at(12, 6)), { 'idempotency-key': key });
    const b = await post('/v1/bookings', body(at(12, 6)), { 'idempotency-key': key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
    const n = await env.ctx.db.query('SELECT count(*) AS n FROM payments WHERE booking_id = $1', [a.body.id]);
    expect(Number(n.rows[0].n)).toBe(1);
    expect(env.payments.txs.size).toBe(1);
  });

  it('la misma clave con otra solicitud se rechaza', async () => {
    const r = await post('/v1/bookings', body(at(14, 6)), { 'idempotency-key': 'reserva-123456' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('idempotency_mismatch');
  });

  it('cada respuesta trae su identificador de petición', async () => {
    const r = await post('/v1/bookings', body(at(15, 6)), { 'x-request-id': 'trace-abc-123' });
    expect(r.headers['x-request-id']).toBe('trace-abc-123');
  });
});

describe('Firma del consentimiento en SVG', () => {
  it('acepta un trazo SVG y rechaza uno con scripts', async () => {
    const r = await post('/v1/bookings', body(at(11, 9)));
    const bad = await post(`/v1/bookings/${r.body.id}/consent`, { signerName: 'Daniela Paredes', signerIsPatient: true, signatureSvg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10" onload="alert(1)"/></svg>' });
    expect(bad.body.error.code).toBe('invalid_signature');
    const ok = await post(`/v1/bookings/${r.body.id}/consent`, { signerName: 'Daniela Paredes', signerIsPatient: true, signatureSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path d="M10 50 C40 10 80 90 120 40" stroke="#000" fill="none"/></svg>' });
    expect(ok.status).toBe(200);
  });
});

describe('Tareas programadas', () => {
  it('vence las solicitudes sin respuesta a los 30 minutos y libera el pago', async () => {
    const r = await post('/v1/bookings', body(at(16, 6)));
    expect((await runJobs(env.ctx)).expired).toBe(0);
    env.clock.advance(31);
    const out = await runJobs(env.ctx);
    expect(out.expired).toBeGreaterThanOrEqual(1);
    const b = await api(env, patient.token).get(`/v1/bookings/${r.body.id}`);
    expect(b.body.status).toBe('rejected');
    const pay = await env.ctx.db.query('SELECT status FROM payments WHERE booking_id = $1', [r.body.id]);
    expect(pay.rows[0].status).toBe('voided');
  });

  it('envía el recordatorio de 24 horas y el de 1 hora una sola vez', async () => {
    const r = await post('/v1/bookings', body(at(10, 7)));
    await api(env, physio.token).post(`/v1/bookings/${r.body.id}/accept`);
    env.clock.t = new Date(new Date(at(10, 7)).getTime() - 20 * 3600000); // faltan 20 horas
    expect((await runJobs(env.ctx)).reminders24h).toBe(1);
    expect((await runJobs(env.ctx)).reminders24h).toBe(0);
    env.clock.t = new Date(new Date(at(10, 7)).getTime() - 50 * 60000); // faltan 50 minutos
    expect((await runJobs(env.ctx)).reminders1h).toBe(1);
    expect((await runJobs(env.ctx)).reminders1h).toBe(0);
    const n = await api(env, patient.token).get('/v1/notifications');
    expect(n.body.some((x: any) => x.body.includes('empieza en una hora'))).toBe(true);
  });

  it('pregunta si todo está bien cuando la sesión pasa de 90 minutos', async () => {
    const r = await post('/v1/bookings', { ...body(at(9, 8)), mode: 'video', address: undefined, lat: undefined, lng: undefined });
    const p = api(env, physio.token);
    await p.post(`/v1/bookings/${r.body.id}/accept`);
    await post(`/v1/bookings/${r.body.id}/consent`, { signerName: 'Daniela Paredes', signerIsPatient: true, signaturePngBase64: PNG });
    env.clock.t = new Date(at(9, 8));
    expect((await p.post(`/v1/bookings/${r.body.id}/start`)).status).toBe(200);
    env.clock.advance(91);
    expect((await runJobs(env.ctx)).longSessions).toBe(1);
    expect((await runJobs(env.ctx)).longSessions).toBe(0);
  });

  it('desconecta al fisio cuando vence su certificado de antecedentes', async () => {
    await env.ctx.db.query(`UPDATE physio_documents SET expires_at = '2026-10-01' WHERE physio_id = $1 AND kind = 'criminal_record'`, [physio.userId]);
    expect((await runJobs(env.ctx)).expiredDocuments).toBe(1);
    const p = await env.ctx.db.query('SELECT available FROM physios WHERE user_id = $1', [physio.userId]);
    expect(p.rows[0].available).toBe(false);
    await api(env, physio.token).post('/v1/physios/me/selfie-check', { selfieRef: 'hoy' });
    const t = await api(env, physio.token).post('/v1/physios/me/availability-toggle', { available: true });
    expect(t.body.error.code).toBe('documents_expired');
  });
});

describe('Contrato de respuestas', () => {
  it('el perfil propio del fisio trae documentos y horario, sin acumulados internos', async () => {
    const r = await api(env, physio.token).get('/v1/physios/me');
    expect(r.status).toBe(200);
    expect(r.body.documents.length).toBeGreaterThanOrEqual(3);
    expect(r.body.documents[0].expires_at === null || /^\d{4}-\d{2}-\d{2}$/.test(r.body.documents[0].expires_at)).toBe(true);
    expect(r.body).not.toHaveProperty('rating_sum');
    expect(r.body).not.toHaveProperty('base_lat');
  });

  it('la cita indica si quien la mira ya la calificó', async () => {
    const r = await post('/v1/bookings', { ...body(at(11, 12)), mode: 'video', address: undefined, lat: undefined, lng: undefined });
    const p = api(env, physio.token);
    await p.post(`/v1/bookings/${r.body.id}/accept`);
    await post(`/v1/bookings/${r.body.id}/consent`, { signerName: 'Daniela Paredes', signerIsPatient: true, signaturePngBase64: PNG });
    env.clock.t = new Date(at(11, 12));
    await p.post(`/v1/bookings/${r.body.id}/start`);
    expect((await p.post(`/v1/bookings/${r.body.id}/complete`, { assessment: 'Mejora del rango', plan: 'Continuar ejercicios' })).status).toBe(200);
    expect((await api(env, patient.token).get(`/v1/bookings/${r.body.id}`)).body.reviewed).toBe(false);
    await post(`/v1/bookings/${r.body.id}/reviews`, { stars: 5 });
    expect((await api(env, patient.token).get(`/v1/bookings/${r.body.id}`)).body.reviewed).toBe(true);
    expect((await p.get(`/v1/bookings/${r.body.id}`)).body.reviewed).toBe(false);
  });
});
