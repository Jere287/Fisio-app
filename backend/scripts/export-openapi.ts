// Genera openapi.json a partir de las rutas reales. La app móvil genera sus tipos desde este archivo.
import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { FieldCipher } from '../src/lib/crypto.js';
import { ConsoleSms } from '../src/providers/sms.js';
import { MockPayments } from '../src/providers/payments.js';
import { MockKyc } from '../src/providers/kyc.js';
import { MemoryStorage } from '../src/providers/storage.js';

const config = loadConfig({
  NODE_ENV: 'development', DATABASE_URL: 'postgres://localhost/none', JWT_SECRET: 'x'.repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), HASH_PEPPER: 'x'.repeat(16),
} as NodeJS.ProcessEnv);
const db = createPool(config.DATABASE_URL); // no se conecta: solo se leen las rutas
const app = await buildApp({ config, db, cipher: new FieldCipher(config.DATA_ENCRYPTION_KEY), sms: new ConsoleSms(), payments: new MockPayments(), kyc: new MockKyc(), storage: new MemoryStorage(), now: () => new Date() }, { logger: false });
await app.ready();
writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(app.swagger(), null, 2) + '\n');
await app.close();
await db.end();
console.log('openapi.json actualizado');
