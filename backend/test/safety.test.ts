import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/jobs.js';
import { api, approvedPhysio, makeAdmin, setupEnv, teardown, verifiedUser, type TestEnv } from './helpers.js';

let env: TestEnv;
let physio: Awaited<ReturnType<typeof approvedPhysio>>;
let patient: Awaited<ReturnType<typeof verifiedUser>>;
let selfId: string, grandmaId: string;

const at = (hourQuito: number, day: number) => new Date(Date.UTC(2026, 9, day, hourQuito + 5));
const HOME = { lat: -0.1830, lng: -78.4830 };
const FAR = { lat: -0.1930, lng: -78.4900 };
const book = async (when: Date, patientId: string, extra: Record<string, unknown> = {}) => {
  const r = await api(env, patient.token).post('/v1/bookings', { physioId: physio.userId, patientId, mode: 'home', scheduledAt: when.toISOString(), ...HOME, address: 'Av. Amazonas y Naciones Unidas', pain: { zones: ['Rodilla'] }, ...extra });
  expect(r.status).toBe(201);
  expect((await api(env, physio.token).post(`/v1/bookings/${r.body.id}/accept`)).status).toBe(200);
  return r.body.id as string;
};

beforeAll(async () => {
  env = await setupEnv();
  physio = await approvedPhysio(env, await makeAdmin(env));
  patient = await verifiedUser(env);
  selfId = (await api(env, patient.token).get('/v1/patients')).body[0].id;
  grandmaId = (await api(env, patient.token).post('/v1/patients', { fullName: 'Carmen Paredes', relationship: 'Abuela', birthYear: 1950, canConsent: true })).body.id;
});
afterAll(async () => { await teardown(env); });

describe('Seguimiento mutuo desde 30 minutos antes', () => {
  let id: string;

  it('antes de la ventana nadie comparte ni ve la ubicación', async () => {
    id = await book(at(10, 6), selfId);
    const r = await api(env, physio.token).post(`/v1/bookings/${id}/location`, FAR);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('tracking_closed');
    const v = await api(env, patient.token).get(`/v1/bookings/${id}`);
    expect(v.body.tracking).toMatchObject({ active: false, shareMine: false });
    expect(new Date(v.body.tracking.from).getTime()).toBe(at(10, 6).getTime() - 30 * 60000);
  });

  it('a 30 minutos se abre: avisa a los dos y cada uno ve al otro', async () => {
    env.clock.t = new Date(at(10, 6).getTime() - 29 * 60000);
    expect((await runJobs(env.ctx)).trackingStarted).toBe(1);
    expect((await runJobs(env.ctx)).trackingStarted).toBe(0);
    const p = api(env, physio.token), c = api(env, patient.token);
    expect((await p.get(`/v1/bookings/${id}`)).body.tracking).toMatchObject({ active: true, shareMine: true });
    expect((await c.get(`/v1/bookings/${id}`)).body.tracking).toMatchObject({ active: true, shareMine: true });

    // El fisio aún no sale, pero el paciente ya lo ve en el mapa.
    expect((await p.post(`/v1/bookings/${id}/location`, FAR)).body.distanceM).toBeGreaterThan(1000);
    expect((await c.get(`/v1/bookings/${id}`)).body.physioLocation).toMatchObject(FAR);

    // El paciente comparte la suya: el fisio sabe que hay alguien en el domicilio.
    expect((await c.post(`/v1/bookings/${id}/patient-location`, { lat: -0.1831, lng: -78.4831 })).status).toBe(200);
    expect((await p.get(`/v1/bookings/${id}`)).body.patientLocation).toMatchObject({ atHome: true });
    await c.post(`/v1/bookings/${id}/patient-location`, FAR);
    expect((await p.get(`/v1/bookings/${id}`)).body.patientLocation.atHome).toBe(false);
    await c.post(`/v1/bookings/${id}/patient-location`, HOME);
    const n = await c.get('/v1/notifications');
    expect(n.body.some((x: { body: string }) => x.body.includes('dónde está tu fisio'))).toBe(true);
  });

  it('al llegar deja de mostrarse, pero el recorrido sigue guardándose para seguridad', async () => {
    const p = api(env, physio.token);
    await p.post(`/v1/bookings/${id}/depart`);
    await p.post(`/v1/bookings/${id}/arrive`, HOME);
    expect((await api(env, patient.token).get(`/v1/bookings/${id}`)).body.physioLocation).toBeNull();
    expect((await p.get(`/v1/bookings/${id}`)).body.patientLocation).toBeNull();
    expect((await p.post(`/v1/bookings/${id}/location`, HOME)).status).toBe(200);
    const trail = await env.ctx.db.query('SELECT role FROM booking_locations WHERE booking_id = $1', [id]);
    expect(trail.rows.filter(r => r.role === 'physio').length).toBe(2);
    expect(trail.rows.filter(r => r.role === 'patient').length).toBe(3);
  });

  it('si quien reservó no estará en la visita, su ubicación no se pide ni se acepta', async () => {
    const other = await book(at(14, 6), grandmaId, { companion: 'other', companionName: 'Rosa (cuidadora)' });
    env.clock.t = new Date(at(14, 6).getTime() - 10 * 60000);
    const c = api(env, patient.token);
    expect((await c.get(`/v1/bookings/${other}`)).body.tracking).toMatchObject({ active: true, shareMine: false });
    const r = await c.post(`/v1/bookings/${other}/patient-location`, HOME);
    expect(r.body.error.code).toBe('not_present');
    // El fisio sí comparte; queda un recorrido sin reportes que se borrará.
    expect((await api(env, physio.token).post(`/v1/bookings/${other}/location`, FAR)).status).toBe(200);
  });

  it('a los 30 días se borra el recorrido, salvo el de citas con alerta o reporte', async () => {
    await api(env, patient.token).post(`/v1/bookings/${id}/sos`, { note: 'prueba' });
    env.clock.advance(31 * 24 * 60);
    expect((await runJobs(env.ctx)).purgedSafety).toBe(1);
    const left = await env.ctx.db.query('SELECT DISTINCT booking_id FROM booking_locations');
    expect(left.rows.map(r => r.booking_id)).toEqual([id]);
  });
});

describe('Grabación de audio de seguridad', () => {
  let id: string, other: string, adminToken: string;
  const AUDIO = Buffer.from('ftypM4A audio de prueba '.repeat(200));
  const upload = (token: string, booking: string, seq: number, body = AUDIO, type = 'audio/mp4') => env.app.inject({
    method: 'POST', url: `/v1/bookings/${booking}/recordings?seq=${seq}&startedAt=${encodeURIComponent(env.clock.now().toISOString())}&durationMs=600000`,
    headers: { authorization: `Bearer ${token}`, 'content-type': type }, payload: body,
  });
  const arrived = async (when: Date) => {
    const b = await book(when, selfId);
    env.clock.t = new Date(when.getTime() - 5 * 60000);
    await api(env, physio.token).post(`/v1/bookings/${b}/depart`);
    expect((await api(env, physio.token).post(`/v1/bookings/${b}/arrive`, HOME)).status).toBe(200);
    return b;
  };

  beforeAll(async () => {
    adminToken = (await makeAdmin(env)).token;
    env.clock.t = new Date('2026-11-10T13:00:00Z');
    id = await arrived(new Date(Date.UTC(2026, 10, 11, 15)));
  });

  it('se activa durante la visita y la otra parte lo sabe', async () => {
    expect((await upload(physio.token, id, 0)).statusCode).toBe(409);
    expect((await api(env, physio.token).post(`/v1/bookings/${id}/recording/start`)).status).toBe(200);
    expect((await api(env, physio.token).post(`/v1/bookings/${id}/recording/start`)).status).toBe(200); // repetir no duplica el aviso
    const seen = await api(env, patient.token).get(`/v1/bookings/${id}`);
    expect(seen.body.recording).toEqual({ patient: false, physio: true });
    const n = (await api(env, patient.token).get('/v1/notifications')).body.filter((x: { body: string }) => x.body.includes('grabación de audio'));
    expect(n.length).toBe(1);
  });

  it('el audio se guarda cifrado, con su huella, y un reintento no lo duplica', async () => {
    const r = await upload(physio.token, id, 0);
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).duplicate).toBe(false);
    expect(JSON.parse((await upload(physio.token, id, 0)).body).duplicate).toBe(true);
    const files = [...(env.ctx.storage as unknown as { files: Map<string, Buffer> }).files.values()];
    expect(files.length).toBe(1);
    expect(files[0]!.includes(Buffer.from('audio de prueba'))).toBe(false);
  });

  it('solo sube quien activó la grabación, solo audio y solo las partes de la cita', async () => {
    expect(JSON.parse((await upload(patient.token, id, 0)).body).error.code).toBe('recording_not_started');
    expect(JSON.parse((await upload(physio.token, id, 1, AUDIO, 'audio/flac')).body).error.code).toBe('unsupported_audio');
    const stranger = await verifiedUser(env);
    expect((await upload(stranger.token, id, 1)).statusCode).toBe(403);
  });

  it('nadie lo escucha si no hay un reporte; con reporte, solo seguridad y queda auditado', async () => {
    const list = () => api(env, adminToken).get(`/v1/admin/bookings/${id}/recordings`);
    expect((await list()).body.error.code).toBe('not_under_review');
    expect((await api(env, patient.token).get(`/v1/admin/bookings/${id}/recordings`)).status).toBe(403);
    await api(env, patient.token).post('/v1/support/tickets', { bookingId: id, reason: 'conduct', description: 'Comentarios inapropiados durante la sesión' });
    const l = await list();
    expect(l.status).toBe(200);
    expect(l.body).toHaveLength(1);
    const audio = await env.app.inject({ method: 'GET', url: `/v1/admin/recordings/${l.body[0].id}/audio`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toContain('audio/mp4');
    expect(audio.rawPayload.equals(AUDIO)).toBe(true);
    const log = await env.ctx.db.query(`SELECT 1 FROM audit_log WHERE action = 'recording.listen' AND target = $1`, [l.body[0].id]);
    expect(log.rowCount).toBe(1);
  });

  it('a los 30 días se borra, salvo que la cita esté en revisión', async () => {
    other = await arrived(new Date(Date.UTC(2026, 10, 12, 15)));
    await api(env, patient.token).post(`/v1/bookings/${other}/recording/start`);
    expect((await upload(patient.token, other, 0)).statusCode).toBe(201);
    env.clock.advance(31 * 24 * 60);
    await runJobs(env.ctx);
    const rows = await env.ctx.db.query('SELECT booking_id, deleted_at FROM session_recordings');
    expect(rows.rows.find(r => r.booking_id === other).deleted_at).not.toBeNull();
    expect(rows.rows.find(r => r.booking_id === id).deleted_at).toBeNull();
    expect((env.ctx.storage as unknown as { files: Map<string, Buffer> }).files.size).toBe(1);
  });
});
