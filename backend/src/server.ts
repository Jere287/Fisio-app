import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { FieldCipher } from './lib/crypto.js';
import { ConsoleSms } from './providers/sms.js';
import { createPaymentProvider } from './providers/payments.js';
import { createKycProvider } from './providers/kyc.js';
import { startScheduler } from './jobs.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);
const ctx = {
  config, db,
  cipher: new FieldCipher(config.DATA_ENCRYPTION_KEY),
  sms: new ConsoleSms(msg => console.log(msg)),
  payments: createPaymentProvider(config.PAYMENT_PROVIDER),
  kyc: createKycProvider(config.KYC_PROVIDER),
  now: () => new Date(),
};
const app = await buildApp(ctx);
const stopJobs = config.JOBS_ENABLED ? startScheduler(ctx, (msg, data) => app.log.info(data ?? {}, msg)) : () => {};

const close = async () => { stopJobs(); await app.close(); await db.end(); process.exit(0); };
process.on('SIGTERM', close);
process.on('SIGINT', close);
await app.listen({ port: config.PORT, host: config.HOST });
