import { z } from 'zod';

// Toda la configuración sale de variables de entorno y se valida al arrancar.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  // 32 bytes en base64 para AES-256-GCM. Se genera con: openssl rand -base64 32
  DATA_ENCRYPTION_KEY: z.string().refine(v => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY debe ser 32 bytes en base64'),
  HASH_PEPPER: z.string().min(16),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  SMS_PROVIDER: z.enum(['console']).default('console'),
  PAYMENT_PROVIDER: z.enum(['mock', 'payphone']).default('mock'),
  KYC_PROVIDER: z.enum(['mock']).default('mock'),
  KYC_WEBHOOK_SECRET: z.string().min(16).default('dev-kyc-webhook-secret'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(30),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.PAYMENT_PROVIDER === 'mock') {
    throw new Error('En producción no se puede usar el proveedor de pagos simulado.');
  }
  return parsed.data;
}
