import { inject } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { FieldCipher } from '../src/lib/crypto.js';
import { ConsoleSms } from '../src/providers/sms.js';
import { MockPayments } from '../src/providers/payments.js';
import { MockKyc } from '../src/providers/kyc.js';

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]).toString('base64');

// Reloj controlable: las pruebas avanzan el tiempo sin esperar.
export class Clock { t = new Date('2026-10-05T13:00:00Z'); now = () => new Date(this.t); advance(min: number) { this.t = new Date(this.t.getTime() + min * 60000); } }

export interface TestEnv { app: FastifyInstance; ctx: AppContext; sms: ConsoleSms; payments: MockPayments; clock: Clock }

export async function setupEnv(): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: inject('testDb'), JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), HASH_PEPPER: 'test-pepper-123456', KYC_WEBHOOK_SECRET: 'kyc-webhook-secret-123',
  } as NodeJS.ProcessEnv);
  const db = createPool(config.DATABASE_URL);
  await migrate(db, () => {});
  const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'exercises')`)).rows.map(r => r.tablename);
  await db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const sms = new ConsoleSms(), payments = new MockPayments(), clock = new Clock();
  const ctx: AppContext = { config, db, cipher: new FieldCipher(config.DATA_ENCRYPTION_KEY), sms, payments, kyc: new MockKyc(), now: clock.now };
  const app = await buildApp(ctx, { logger: false });
  return { app, ctx, sms, payments, clock };
}

export async function teardown(env: TestEnv) { await env.app.close(); await env.ctx.db.end(); }

export function api(env: TestEnv, token?: string) {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await env.app.inject({ method, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return {
    get: (u: string) => call('GET', u), post: (u: string, p?: unknown) => call('POST', u, p ?? {}),
    put: (u: string, p: unknown) => call('PUT', u, p), patch: (u: string, p: unknown) => call('PATCH', u, p),
  };
}

let phoneSeq = 10000000;
export const newPhone = () => `09${String(phoneSeq++).padStart(8, '0')}`;

export async function login(env: TestEnv, phone = newPhone()) {
  await api(env).post('/v1/auth/otp', { phone });
  const e164 = `+593${phone.slice(1)}`;
  const code = env.sms.lastCodeFor(e164)!;
  const r = await api(env).post('/v1/auth/verify', { phone, code });
  return { token: r.body.accessToken as string, refresh: r.body.refreshToken as string, userId: r.body.user.id as string, phone };
}

// Cédulas válidas generadas (provincia 17, dígito verificador correcto).
let cedSeq = 100000;
export function nextCedula(): string {
  const base = `171${String(cedSeq++).padStart(6, '0')}`;
  let sum = 0;
  for (let i = 0; i < 9; i++) { let p = Number(base[i]) * (i % 2 ? 1 : 2); if (p > 9) p -= 9; sum += p; }
  return base + ((10 - (sum % 10)) % 10);
}

export async function verifiedUser(env: TestEnv, name = 'Daniela Paredes', dactilar = 'V4343V4242') {
  const u = await login(env);
  const a = api(env, u.token);
  await a.post('/v1/me/consents', { kind: 'biometric', version: '2026-10' });
  await a.post('/v1/me/consents', { kind: 'registro_civil', version: '2026-10' });
  const s = await a.post('/v1/kyc/sessions');
  const r = await a.post(`/v1/kyc/sessions/${s.body.sessionId}/submit`, { fullName: name, cedula: nextCedula(), dactilar, frontRef: 'f', backRef: 'b', selfieRef: 's' });
  return { ...u, kyc: r.body };
}

export async function makeAdmin(env: TestEnv) {
  const u = await login(env);
  await env.ctx.db.query(`UPDATE users SET role = 'admin', kyc_status = 'approved', full_name = 'Admin' WHERE id = $1`, [u.userId]);
  return u;
}

// Fisio aprobado, con horario de lunes a sábado de 8:00 a 20:00 y conectado.
export async function approvedPhysio(env: TestEnv, admin: { token: string }, opts: { lat?: number; lng?: number; video?: boolean; gender?: 'f' | 'm' } = {}) {
  const u = await verifiedUser(env, 'Andrea Salazar');
  const a = api(env, u.token);
  await a.post('/v1/physios/apply', { bio: 'Fisioterapia deportiva', university: 'PUCE', yearsExperience: 6, specialties: ['deportiva', 'traumatologica'], gender: opts.gender ?? 'f',
    offersVideo: opts.video ?? true, priceCents: 3000, radiusKm: 8, baseLat: opts.lat ?? -0.2050, baseLng: opts.lng ?? -78.4880 });
  const ad = api(env, admin.token);
  for (const kind of ['senescyt', 'msp', 'criminal_record'] as const) {
    const d = await a.post('/v1/physios/me/documents', { kind, title: kind, reference: 'REF-1' });
    await ad.post(`/v1/admin/documents/${d.body.id}/decision`, { decision: 'approved' });
  }
  const dec = await ad.post(`/v1/admin/physios/${u.userId}/decision`, { decision: 'approve' });
  if (dec.status !== 200) throw new Error(JSON.stringify(dec.body));
  const relogin = await login(env, u.phone); // el rol cambió a physio
  const p = api(env, relogin.token);
  await p.put('/v1/physios/me/availability', [0, 1, 2, 3, 4, 5].map(weekday => ({ weekday, startMin: 480, endMin: 1200 })));
  await p.post('/v1/physios/me/selfie-check', { selfieRef: 'selfie-hoy' });
  await p.post('/v1/physios/me/availability-toggle', { available: true });
  return { ...relogin, userId: u.userId };
}

export { inject };
