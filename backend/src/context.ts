import type { Config } from './config.js';
import type { Db, Queryable } from './db/pool.js';
import { FieldCipher } from './lib/crypto.js';
import type { SmsProvider } from './providers/sms.js';
import type { PaymentProvider } from './providers/payments.js';
import type { KycProvider } from './providers/kyc.js';
import type { ObjectStorage } from './providers/storage.js';

// Dependencias compartidas por todos los módulos. Se inyectan para poder cambiarlas en pruebas.
export interface AppContext {
  config: Config;
  db: Db;
  cipher: FieldCipher;
  sms: SmsProvider;
  payments: PaymentProvider;
  kyc: KycProvider;
  storage: ObjectStorage;
  now: () => Date;
}

export async function notify(q: Queryable, userId: string, body: string, data: Record<string, unknown> = {}) {
  await q.query('INSERT INTO notifications (user_id, body, data) VALUES ($1, $2, $3)', [userId, body, data]);
  // Aquí se conecta el envío push (Firebase Cloud Messaging / APNs).
}

export async function notifyAdmins(q: Queryable, body: string, data: Record<string, unknown> = {}) {
  await q.query(`INSERT INTO notifications (user_id, body, data) SELECT id, $1, $2 FROM users WHERE role = 'admin' AND deleted_at IS NULL`, [body, data]);
}

export async function audit(q: Queryable, actorId: string | null, action: string, target: string | null, data: Record<string, unknown> = {}) {
  await q.query('INSERT INTO audit_log (actor_id, action, target, data) VALUES ($1, $2, $3, $4)', [actorId, action, target, data]);
}
