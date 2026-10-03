import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { api, login, makeAdmin, newPhone, setupEnv, teardown, verifiedUser, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await teardown(env); });

describe('Acceso con código SMS', () => {
  it('rechaza un código incorrecto y cuenta el intento', async () => {
    const phone = newPhone();
    await api(env).post('/v1/auth/otp', { phone });
    const bad = await api(env).post('/v1/auth/verify', { phone, code: '000000' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_code');
    const row = await env.ctx.db.query('SELECT attempts FROM otp_codes ORDER BY created_at DESC LIMIT 1');
    expect(row.rows[0].attempts).toBe(1);
  });

  it('crea la cuenta con su paciente «self» y entrega tokens', async () => {
    const u = await login(env);
    const me = await api(env, u.token).get('/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.user.kyc_status).toBe('none');
    const patients = await api(env, u.token).get('/v1/patients');
    expect(patients.body).toHaveLength(1);
    expect(patients.body[0].relationship).toBe('self');
  });

  it('limita los envíos de código por número', async () => {
    const phone = newPhone();
    for (let i = 0; i < 3; i++) expect((await api(env).post('/v1/auth/otp', { phone })).status).toBe(200);
    expect((await api(env).post('/v1/auth/otp', { phone })).status).toBe(429);
  });

  it('limita las peticiones de acceso por IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await env.app.inject({ method: 'POST', url: '/v1/auth/otp', payload: { phone: newPhone() }, headers: { 'x-test-rate-limit': '1' } });
      statuses.push(r.statusCode);
    }
    expect(statuses.slice(0, 10).every(s => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('rechaza celulares que no son ecuatorianos', async () => {
    const r = await api(env).post('/v1/auth/otp', { phone: '12345' });
    expect(r.status).toBe(400);
  });

  it('rota el refresh token y detecta la reutilización de uno viejo', async () => {
    const u = await login(env);
    const r1 = await api(env).post('/v1/auth/refresh', { refreshToken: u.refresh });
    expect(r1.status).toBe(200);
    const reuse = await api(env).post('/v1/auth/refresh', { refreshToken: u.refresh });
    expect(reuse.status).toBe(401);
    // Por seguridad, también se revocó el token nuevo.
    const r2 = await api(env).post('/v1/auth/refresh', { refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(401);
  });

  it('exige token en rutas privadas', async () => {
    expect((await api(env).get('/v1/me')).status).toBe(401);
  });
});

describe('Verificación de identidad', () => {
  it('exige los consentimientos de biometría y Registro Civil', async () => {
    const u = await login(env);
    const r = await api(env, u.token).post('/v1/kyc/sessions');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('consent_required');
  });

  it('aprueba, manda a revisión o rechaza según el proveedor', async () => {
    expect((await verifiedUser(env, 'Ana Uno', 'V4343V4242')).kyc.status).toBe('approved');
    expect((await verifiedUser(env, 'Ana Dos', 'V4343V9999')).kyc.status).toBe('review');
    expect((await verifiedUser(env, 'Ana Tres', 'Z4343V4242')).kyc.status).toBe('rejected');
  });

  it('valida la cédula y no permite la misma cédula en dos cuentas', async () => {
    const u = await login(env);
    const a = api(env, u.token);
    await a.post('/v1/me/consents', { kind: 'biometric', version: '1' });
    await a.post('/v1/me/consents', { kind: 'registro_civil', version: '1' });
    const s = await a.post('/v1/kyc/sessions');
    const bad = await a.post(`/v1/kyc/sessions/${s.body.sessionId}/submit`, { fullName: 'Persona Prueba', cedula: '1710034066', dactilar: 'V4343V4242', frontRef: 'f', backRef: 'b', selfieRef: 's' });
    expect(bad.body.error.code).toBe('invalid_cedula');
    const first = await env.ctx.db.query(`SELECT cedula_enc FROM users WHERE kyc_status = 'approved' AND cedula_enc IS NOT NULL LIMIT 1`);
    const usedCedula = env.ctx.cipher.decrypt(first.rows[0].cedula_enc);
    const dup = await a.post(`/v1/kyc/sessions/${s.body.sessionId}/submit`, { fullName: 'Persona Prueba', cedula: usedCedula, dactilar: 'V4343V4242', frontRef: 'f', backRef: 'b', selfieRef: 's' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('cedula_in_use');
  });

  it('bloquea por 24 horas después de 3 verificaciones rechazadas', async () => {
    const u = await login(env);
    const a = api(env, u.token);
    await a.post('/v1/me/consents', { kind: 'biometric', version: '1' });
    await a.post('/v1/me/consents', { kind: 'registro_civil', version: '1' });
    for (let i = 0; i < 3; i++) {
      const s = await a.post('/v1/kyc/sessions');
      const r = await a.post(`/v1/kyc/sessions/${s.body.sessionId}/submit`, { fullName: 'Intento Fallido', cedula: '1710034065', dactilar: 'Z1234A1234', frontRef: 'f', backRef: 'b', selfieRef: 's' });
      expect(r.body.status).toBe('rejected');
    }
    const blocked = await a.post('/v1/kyc/sessions');
    expect(blocked.status).toBe(429);
    env.clock.advance(24 * 60 + 1);
    expect((await a.post('/v1/kyc/sessions')).status).toBe(200);
  });

  it('guarda la cédula cifrada', async () => {
    const r = await env.ctx.db.query(`SELECT cedula_enc FROM users WHERE cedula_enc IS NOT NULL LIMIT 1`);
    expect(r.rows[0].cedula_enc).toMatch(/^v1\./);
  });

  it('el webhook del proveedor exige firma válida', async () => {
    const u = await verifiedUser(env, 'Revisión Pendiente', 'V1111V9999');
    const s = await env.ctx.db.query('SELECT provider_ref FROM kyc_sessions WHERE user_id = $1', [u.userId]);
    const body = JSON.stringify({ ref: s.rows[0].provider_ref, status: 'approved' });
    const unsigned = await env.app.inject({ method: 'POST', url: '/v1/webhooks/kyc', payload: body, headers: { 'content-type': 'application/json', 'x-signature': 'x' } });
    expect(unsigned.statusCode).toBe(401);
    const sig = createHmac('sha256', 'kyc-webhook-secret-123').update(body).digest('hex');
    const ok = await env.app.inject({ method: 'POST', url: '/v1/webhooks/kyc', payload: body, headers: { 'content-type': 'application/json', 'x-signature': sig } });
    expect(ok.statusCode).toBe(200);
    const me = await api(env, u.token).get('/v1/me');
    expect(me.body.user.kyc_status).toBe('approved');
  });

  it('solo un administrador decide las revisiones manuales', async () => {
    const u = await verifiedUser(env, 'Manual Review', 'V2222V9999');
    const s = await env.ctx.db.query('SELECT id FROM kyc_sessions WHERE user_id = $1', [u.userId]);
    expect((await api(env, u.token).post(`/v1/admin/kyc/${s.rows[0].id}/decision`, { decision: 'approved' })).status).toBe(403);
    const admin = await makeAdmin(env);
    expect((await api(env, admin.token).post(`/v1/admin/kyc/${s.rows[0].id}/decision`, { decision: 'approved' })).status).toBe(200);
  });
});

describe('Derechos de datos (LOPDP)', () => {
  it('exporta mis datos y elimina la cuenta', async () => {
    const u = await login(env);
    const ex = await api(env, u.token).get('/v1/me/export');
    expect(ex.status).toBe(200);
    expect(ex.body.user.id).toBe(u.userId);
    expect((await api(env, u.token).post('/v1/me/delete')).status).toBe(200);
    expect((await api(env, u.token).get('/v1/me')).status).toBe(401);
  });
});
