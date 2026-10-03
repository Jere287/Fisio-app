import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG, api, approvedPhysio, makeAdmin, setupEnv, teardown, verifiedUser, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let physio: Awaited<ReturnType<typeof approvedPhysio>>;
let patient: Awaited<ReturnType<typeof verifiedUser>>;
let selfId: string;

// Lunes 5 de octubre de 2026. El reloj de prueba arranca a las 08:00 de Quito.
const at = (hourQuito: number, day = 5) => new Date(Date.UTC(2026, 9, day, hourQuito + 5)).toISOString();
const HOME = { lat: -0.1830, lng: -78.4830, address: 'Av. Amazonas y Naciones Unidas, edificio Torre Carolina' };
const PAIN = { zones: ['Rodilla'], since: '1 a 4 semanas', types: ['Punzante'], worse: ['Subir gradas'] };

beforeAll(async () => {
  env = await setupEnv();
  admin = await makeAdmin(env);
  physio = await approvedPhysio(env, admin);
  patient = await verifiedUser(env, 'Daniela Paredes');
  selfId = (await api(env, patient.token).get('/v1/patients')).body[0].id;
});
afterAll(async () => { await teardown(env); });

const book = (hour: number, extra: Record<string, unknown> = {}, token = patient.token) =>
  api(env, token).post('/v1/bookings', { physioId: physio.userId, patientId: selfId, mode: 'home', scheduledAt: at(hour), ...HOME, pain: PAIN, painScore: 6, comments: 'Me duele al subir gradas', ...extra });

async function ledgerSum(bookingId: string) {
  const r = await env.ctx.db.query('SELECT coalesce(sum(amount_cents), 0) AS s FROM ledger_entries WHERE booking_id = $1', [bookingId]);
  return Number(r.rows[0].s);
}

describe('Búsqueda', () => {
  it('encuentra al fisio cerca y no fuera de su zona', async () => {
    const near = await api(env, patient.token).get(`/v1/physios/search?lat=${HOME.lat}&lng=${HOME.lng}`);
    expect(near.body.map((p: any) => p.id)).toContain(physio.userId);
    expect(near.body[0].distanceKm).toBeGreaterThan(2);
    const far = await api(env, patient.token).get('/v1/physios/search?lat=-0.3000&lng=-78.5500'); // Quitumbe, a ~15 km
    expect(far.body.map((p: any) => p.id)).not.toContain(physio.userId);
  });

  it('filtra por especialidad y muestra horarios libres', async () => {
    const neuro = await api(env, patient.token).get(`/v1/physios/search?lat=${HOME.lat}&lng=${HOME.lng}&specialty=neurologica`);
    expect(neuro.body).toHaveLength(0);
    const slots = await api(env, patient.token).get(`/v1/physios/${physio.userId}/slots?date=2026-10-05`);
    expect(slots.body.slots).toContain(at(12));
    expect(slots.body.slots).not.toContain(at(8)); // ya pasó la hora mínima de anticipación
  });

  it('no publica el perfil sin documentos aprobados', async () => {
    const u = await verifiedUser(env, 'Sin Documentos');
    await api(env, u.token).post('/v1/physios/apply', { bio: 'x', university: 'UCE', yearsExperience: 1, specialties: ['deportiva'], gender: 'm', priceCents: 2500, radiusKm: 5, baseLat: -0.2, baseLng: -78.49 });
    const r = await api(env, admin.token).post(`/v1/admin/physios/${u.userId}/decision`, { decision: 'approve' });
    expect(r.status).toBe(422);
    expect(r.body.error.details.missing).toEqual(['senescyt', 'msp', 'criminal_record']);
  });
});

describe('Reserva a domicilio de principio a fin', () => {
  let id: string, pin: string;

  it('una señal de emergencia bloquea la reserva aunque haya autorización médica', async () => {
    const r = await book(12, { redFlags: ['chest_pain_or_breathless'], medicalClearance: true });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('red_flags_emergency');
  });

  it('una señal de «médico primero» pide autorización y con ella se puede reservar', async () => {
    const sin = await book(13, { redFlags: ['major_trauma'] });
    expect(sin.body.error.code).toBe('red_flags_medical');
    const con = await book(13, { redFlags: ['major_trauma'], medicalClearance: true });
    expect(con.status).toBe(201);
    expect(con.body.redFlags).toEqual(['major_trauma']);
    expect(con.body.medicalClearance).toBe(true);
  });

  it('crea la reserva y retiene el pago', async () => {
    const r = await book(12);
    expect(r.status).toBe(201);
    expect(r.body.totalCents).toBe(3099);
    expect(r.body.pin).toMatch(/^\d{4}$/);
    id = r.body.id; pin = r.body.pin;
    const pay = await env.ctx.db.query('SELECT status, amount_cents FROM payments WHERE booking_id = $1', [id]);
    expect(pay.rows[0]).toMatchObject({ status: 'authorized', amount_cents: 3099 });
  });

  it('no deja reservar el mismo horario dos veces', async () => {
    const r = await book(12);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('slot_taken');
  });

  it('el fisio no ve la dirección hasta aceptar, ni el PIN nunca', async () => {
    const p = api(env, physio.token);
    const before = await p.get(`/v1/bookings/${id}`);
    expect(before.body.address).toBeNull();
    expect(before.body.pin).toBeUndefined();
    expect(before.body.patient.name).toBe('Daniela P.');
    expect((await p.post(`/v1/bookings/${id}/accept`)).status).toBe(200);
    const after = await p.get(`/v1/bookings/${id}`);
    expect(after.body.address).toContain('Amazonas');
  });

  it('«Llegué» solo funciona a menos de 150 m', async () => {
    const p = api(env, physio.token);
    await p.post(`/v1/bookings/${id}/depart`);
    // En camino, el paciente ve dónde va el fisio y desde cuándo es esa ubicación.
    const loc = await p.post(`/v1/bookings/${id}/location`, { lat: -0.1900, lng: -78.4830 });
    expect(loc.body.distanceM).toBeGreaterThan(700);
    const seen = await api(env, patient.token).get(`/v1/bookings/${id}`);
    expect(seen.body.physioLocation).toMatchObject({ lat: -0.19, lng: -78.483 });
    expect(seen.body.physioLocation.at).toBeTruthy();
    const far = await p.post(`/v1/bookings/${id}/arrive`, { lat: -0.1900, lng: -78.4830 });
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe('too_far');
    const near = await p.post(`/v1/bookings/${id}/arrive`, { lat: -0.1831, lng: -78.4831 });
    expect(near.status).toBe(200);
  });

  it('exige consentimiento, rostro confirmado y PIN correcto para empezar', async () => {
    const p = api(env, physio.token), c = api(env, patient.token);
    expect((await p.post(`/v1/bookings/${id}/start`, { pin })).body.error.code).toBe('consent_required');
    expect((await c.post(`/v1/bookings/${id}/consent`, { signerName: 'Daniela Paredes', signerIsPatient: true, signaturePngBase64: PNG })).status).toBe(200);
    expect((await p.post(`/v1/bookings/${id}/start`, { pin })).body.error.code).toBe('door_unconfirmed');
    expect((await c.post(`/v1/bookings/${id}/door`, { matches: true })).status).toBe(200);
    const wrong = await p.post(`/v1/bookings/${id}/start`, { pin: pin === '0000' ? '1111' : '0000' });
    expect(wrong.body.error.code).toBe('wrong_pin');
    const attempts = await env.ctx.db.query('SELECT pin_attempts FROM bookings WHERE id = $1', [id]);
    expect(attempts.rows[0].pin_attempts).toBe(1);
    expect((await p.post(`/v1/bookings/${id}/start`, { pin })).status).toBe(200);
  });

  it('al terminar guarda la nota cifrada, cobra y reparte el dinero', async () => {
    const r = await api(env, physio.token).post(`/v1/bookings/${id}/complete`, {
      subjective: 'Dolor al subir gradas', objective: 'Flexión 125°', assessment: 'Tendinopatía rotuliana leve', plan: 'Fortalecimiento progresivo',
      painBefore: 6, painAfter: 3, exercises: ['puente', 'pared'],
    });
    expect(r.status).toBe(200);
    const pay = await env.ctx.db.query('SELECT status, captured_cents FROM payments WHERE booking_id = $1', [id]);
    expect(pay.rows[0]).toMatchObject({ status: 'captured', captured_cents: 3099 });
    expect(await ledgerSum(id)).toBe(3099);
    const physioNet = await env.ctx.db.query(`SELECT amount_cents FROM ledger_entries WHERE booking_id = $1 AND account = 'physio_payable'`, [id]);
    expect(physioNet.rows[0].amount_cents).toBe(2482);
    const raw = await env.ctx.db.query('SELECT assessment_enc FROM clinical_notes WHERE booking_id = $1', [id]);
    expect(raw.rows[0].assessment_enc).not.toContain('Tendinopatía');
  });

  it('la historia clínica la ven el paciente y su fisio, nadie más, y queda registrado', async () => {
    const own = await api(env, patient.token).get(`/v1/patients/${selfId}/record`);
    expect(own.body.notes[0].assessment).toBe('Tendinopatía rotuliana leve');
    expect(own.body.exercises.map((e: any) => e.code).sort()).toEqual(['pared', 'puente']);
    expect((await api(env, physio.token).get(`/v1/patients/${selfId}/record`)).status).toBe(200);
    const stranger = await verifiedUser(env, 'Persona Ajena');
    expect((await api(env, stranger.token).get(`/v1/patients/${selfId}/record`)).status).toBe(403);
    expect((await api(env, admin.token).get(`/v1/patients/${selfId}/record`)).status).toBe(403);
    const log = await env.ctx.db.query('SELECT count(*) AS n FROM clinical_access_log WHERE patient_id = $1', [selfId]);
    expect(Number(log.rows[0].n)).toBe(2);
  });

  it('las dos partes se califican y se actualiza el promedio', async () => {
    expect((await api(env, patient.token).post(`/v1/bookings/${id}/reviews`, { stars: 5, tags: ['Puntual'], comment: 'Excelente' })).status).toBe(200);
    expect((await api(env, physio.token).post(`/v1/bookings/${id}/reviews`, { stars: 5 })).status).toBe(200);
    expect((await api(env, patient.token).post(`/v1/bookings/${id}/reviews`, { stars: 1 })).status).toBe(409);
    const prof = await api(env, patient.token).get(`/v1/physios/${physio.userId}`);
    expect(prof.body.rating).toBe(5);
    expect(prof.body.reviews[0].comment).toBe('Excelente');
  });

  it('el dolor alto después de los ejercicios avisa al fisio', async () => {
    const r = await api(env, patient.token).post(`/v1/patients/${selfId}/pain-logs`, { value: 8 });
    expect(r.body.physioAlerted).toBe(true);
    const n = await api(env, physio.token).get('/v1/notifications');
    expect(n.body.some((x: any) => x.body.includes('dolor 8/10'))).toBe(true);
  });

  it('el fisio ve sus ganancias y se liquidan en el pago semanal', async () => {
    const e = await api(env, physio.token).get('/v1/physios/me/earnings');
    expect(e.body.pendingCents).toBe(2482);
    const run = await api(env, admin.token).post('/v1/admin/payouts/run');
    expect(run.body.find((x: any) => x.physioId === physio.userId).amountCents).toBe(2482);
    expect((await api(env, physio.token).get('/v1/physios/me/earnings')).body.pendingCents).toBe(0);
  });
});

describe('Garantías y casos especiales', () => {
  it('«Mi fisio no llegó»: devolución total y $5 de crédito que se usa en la próxima reserva', async () => {
    const r = await book(14);
    const id = r.body.id;
    await api(env, physio.token).post(`/v1/bookings/${id}/accept`);
    const early = await api(env, patient.token).post(`/v1/bookings/${id}/no-show`);
    expect(early.body.error.code).toBe('too_early');
    env.clock.advance((14 - 8) * 60 + 21);
    const ok = await api(env, patient.token).post(`/v1/bookings/${id}/no-show`);
    expect(ok.status).toBe(200);
    const pay = await env.ctx.db.query('SELECT status FROM payments WHERE booking_id = $1', [id]);
    expect(pay.rows[0].status).toBe('voided');
    const me = await api(env, patient.token).get('/v1/me');
    expect(me.body.user.credit_cents).toBe(500);
    const next = await book(16, { scheduledAt: at(10, 6) });
    expect(next.body.creditCents).toBe(500);
    expect(next.body.totalCents).toBe(2599);
    await api(env, patient.token).post(`/v1/bookings/${next.body.id}/cancel`, {});
    expect((await api(env, patient.token).get('/v1/me')).body.user.credit_cents).toBe(500); // cancelación a tiempo: vuelve el crédito
  });

  it('cancelación con menos de 12 horas cobra el 50% de la sesión', async () => {
    const r = await book(0, { scheduledAt: at(19, 6) }); // martes 19:00, mañana
    const id = r.body.id;
    await api(env, physio.token).post(`/v1/bookings/${id}/accept`);
    env.clock.advance(20 * 60); // ahora faltan menos de 12 horas
    const c = await api(env, patient.token).post(`/v1/bookings/${id}/cancel`, {});
    expect(c.body.lateFeeCents).toBe(1500);
    const pay = await env.ctx.db.query('SELECT status, captured_cents FROM payments WHERE booking_id = $1', [id]);
    expect(pay.rows[0]).toMatchObject({ status: 'captured', captured_cents: 1500 });
    expect(await ledgerSum(id)).toBe(1500);
  });

  it('cita para la abuela de 84 años exige un acompañante', async () => {
    const fam = await api(env, patient.token).post('/v1/patients', { fullName: 'Carmen Paredes', relationship: 'Abuela', birthYear: 1942, canConsent: false });
    const base = { patientId: fam.body.id, scheduledAt: at(9, 7) };
    const alone = await book(0, { ...base, companion: 'none' });
    expect(alone.body.error.code).toBe('companion_required');
    const ok = await book(0, { ...base, companion: 'booker' });
    expect(ok.status).toBe(201);
    expect(ok.body.patient).toMatchObject({ name: 'Carmen Paredes', relationship: 'Abuela', canConsent: false });
    const sign = await api(env, patient.token).post(`/v1/bookings/${ok.body.id}/consent`, { signerName: 'Carmen Paredes', signerIsPatient: true, signaturePngBase64: PNG });
    expect(sign.body.error.code).toBe('representative_required');
  });

  it('si la persona en la puerta no coincide: se cancela, se suspende al fisio y se alerta', async () => {
    const other = await approvedPhysio(env, admin, { lat: -0.1800, lng: -78.4800 });
    const r = await api(env, patient.token).post('/v1/bookings', { physioId: other.userId, patientId: selfId, mode: 'home', scheduledAt: at(11, 7), ...HOME, pain: PAIN });
    const p = api(env, other.token);
    await p.post(`/v1/bookings/${r.body.id}/accept`);
    await p.post(`/v1/bookings/${r.body.id}/depart`);
    await p.post(`/v1/bookings/${r.body.id}/arrive`, { lat: HOME.lat, lng: HOME.lng });
    const d = await api(env, patient.token).post(`/v1/bookings/${r.body.id}/door`, { matches: false });
    expect(d.body.cancelled).toBe(true);
    const st = await env.ctx.db.query('SELECT status FROM physios WHERE user_id = $1', [other.userId]);
    expect(st.rows[0].status).toBe('suspended');
    const alerts = await api(env, admin.token).get('/v1/admin/alerts');
    expect(alerts.body.length).toBeGreaterThan(0);
  });

  it('videollamada: empieza sin PIN pero con consentimiento', async () => {
    const r = await api(env, patient.token).post('/v1/bookings', { physioId: physio.userId, patientId: selfId, mode: 'video', scheduledAt: at(15, 7), pain: PAIN });
    expect(r.status).toBe(201);
    expect(r.body.totalCents).toBe(1500 + 99); // el crédito ya se usó en la cita de la abuela
    expect(r.body.pin).toBeNull();
    const p = api(env, physio.token);
    await p.post(`/v1/bookings/${r.body.id}/accept`);
    expect((await p.post(`/v1/bookings/${r.body.id}/start`)).status).toBe(200); // consentimiento ya firmado con esta fisio
  });

  it('reclamo: el administrador devuelve una parte y el libro cuadra', async () => {
    const done = await env.ctx.db.query(`SELECT id FROM bookings WHERE status = 'completed' AND mode = 'home' LIMIT 1`);
    const bookingId = done.rows[0].id;
    const t = await api(env, patient.token).post('/v1/support/tickets', { bookingId, reason: 'billing', description: 'Me cobraron de más' });
    expect(t.status).toBe(201);
    const res = await api(env, admin.token).post(`/v1/admin/tickets/${t.body.id}/resolve`, { action: 'refund', refundCents: 1000, resolution: 'Devolvimos $10.00' });
    expect(res.body.refundedCents).toBe(1000);
    expect(await ledgerSum(bookingId)).toBe(3099 - 1000);
    const pay = await env.ctx.db.query('SELECT status, refunded_cents FROM payments WHERE booking_id = $1', [bookingId]);
    expect(pay.rows[0]).toMatchObject({ status: 'partially_refunded', refunded_cents: 1000 });
  });

  it('paquete de 5 sesiones: la reserva sale en $0 y el fisio cobra su parte al terminar', async () => {
    const pk = await api(env, patient.token).post('/v1/packages', { physioId: physio.userId, sessions: 5 });
    expect(pk.body.priceCents).toBe(13500);
    const r = await book(0, { scheduledAt: at(17, 7), usePackage: true });
    expect(r.body.totalCents).toBe(0);
    expect(r.body.usesPackage).toBe(true);
    const left = await api(env, patient.token).get('/v1/packages');
    expect(left.body[0].sessions_left).toBe(4);
  });

  it('una tarjeta rechazada no deja la reserva creada', async () => {
    await env.ctx.db.query('UPDATE physios SET price_cents = 2914 WHERE user_id = $1', [physio.userId]); // 2914 + 99 = 3013 → rechazo simulado
    await env.ctx.db.query('UPDATE users SET credit_cents = 0 WHERE id = $1', [patient.userId]);
    const r = await book(0, { scheduledAt: at(10, 8) });
    expect(r.status).toBe(402);
    const n = await env.ctx.db.query(`SELECT count(*) AS n FROM bookings WHERE scheduled_at = $1`, [at(10, 8)]);
    expect(Number(n.rows[0].n)).toBe(0);
    await env.ctx.db.query('UPDATE physios SET price_cents = 3000 WHERE user_id = $1', [physio.userId]);
  });

  it('un fisio sin selfie del día no puede conectarse', async () => {
    env.clock.advance(24 * 60);
    const r = await api(env, physio.token).post('/v1/physios/me/availability-toggle', { available: true });
    expect(r.body.error.code).toBe('selfie_required');
  });
});
