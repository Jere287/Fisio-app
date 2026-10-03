import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppContext } from './context.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './modules/auth.js';
import { patientRoutes } from './modules/patients.js';
import { kycRoutes } from './modules/kyc.js';
import { physioRoutes } from './modules/physios.js';
import { bookingRoutes } from './modules/bookings.js';
import { clinicalRoutes } from './modules/clinical.js';
import { supportRoutes } from './modules/support.js';
import { adminRoutes } from './modules/admin.js';
import { recordingRoutes } from './modules/recordings.js';
import { packageRoutes } from './modules/packages.js';

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: ctx.config.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    bodyLimit: 1_500_000, // firmas del consentimiento en PNG
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Guardamos el cuerpo original para verificar la firma de los webhooks.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    try { done(null, body ? JSON.parse(body as string) : {}); }
    catch { done(new AppError(400, 'invalid_json', 'El cuerpo no es JSON válido.'), undefined); }
  });

  await app.register(helmet);
  await app.register(cors, { origin: ctx.config.CORS_ORIGINS.split(',').map(s => s.trim()), credentials: true });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // En pruebas se desactiva salvo que la prueba lo pida explícitamente.
    allowList: req => ctx.config.NODE_ENV === 'test' && !req.headers['x-test-rate-limit'],
    errorResponseBuilder: (_req, c) => ({ statusCode: 429, code: 'too_many_requests', message: `Demasiados intentos. Intenta de nuevo en ${c.after}.` }),
  });
  await app.register(jwt, { secret: ctx.config.JWT_SECRET });
  await app.register(swagger, {
    openapi: { info: { title: 'FisioCerca API', version: '0.1.0', description: 'Fisioterapia a domicilio en Quito' }, components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } } },
    transform: jsonSchemaTransform,
  });
  if (ctx.config.NODE_ENV !== 'production') await app.register(swaggerUi, { routePrefix: '/docs' });

  app.decorateRequest('auth', null as never);
  // Cada respuesta lleva su identificador para rastrearla en los registros.
  app.addHook('onSend', async (req, reply, payload) => { reply.header('x-request-id', req.id); return payload; });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({ error: { code: 'validation', message: 'Revisa los datos enviados.', details: err.validation.map(v => ({ path: v.instancePath, message: v.message })) } });
    }
    if (err.code === '23P01') return reply.status(409).send({ error: { code: 'slot_taken', message: 'Ese horario ya no está disponible. Elige otro.' } });
    if (err.code === '23505') return reply.status(409).send({ error: { code: 'duplicate', message: 'Ese registro ya existe.' } });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Algo salió mal. Ya lo estamos revisando.', requestId: req.id } });
  });

  app.get('/health', { schema: { hide: true } }, async () => {
    await ctx.db.query('SELECT 1');
    return { ok: true };
  });

  await authRoutes(app, ctx);
  await patientRoutes(app, ctx);
  await kycRoutes(app, ctx);
  await physioRoutes(app, ctx);
  await bookingRoutes(app, ctx);
  await clinicalRoutes(app, ctx);
  await supportRoutes(app, ctx);
  await packageRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await recordingRoutes(app, ctx);
  return app;
}
