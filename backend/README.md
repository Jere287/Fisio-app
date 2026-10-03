# FisioCerca API

Backend de FisioCerca: Node.js 22, TypeScript, Fastify y PostgreSQL. La arquitectura, la seguridad y el camino a producción están en [`../docs/backend.md`](../docs/backend.md).

## Arrancar en local

Con Docker:

```sh
docker compose up --build        # API en http://localhost:3000, documentación en /docs
docker compose exec api node dist/db/seed.js   # datos de ejemplo (opcional)
```

Sin Docker, con PostgreSQL 16 instalado:

```sh
npm install
cp .env.example .env              # completa DATA_ENCRYPTION_KEY con: openssl rand -base64 32
npm run db:local                  # levanta un PostgreSQL local y muestra su URL
npm run seed                      # migra y carga fisios de ejemplo en Quito
npm run dev                       # http://localhost:3000/docs
```

Para entrar: `POST /v1/auth/otp` con el celular y luego `POST /v1/auth/verify` con el código. En desarrollo el código aparece en la consola del servidor. Los usuarios de ejemplo son:

| Rol | Celular |
|---|---|
| Administrador | 0990000000 |
| Fisio (Andrea Salazar) | 0990000001 |
| Paciente (Daniela Paredes, con su abuela Carmen) | 0987654321 |

## Pruebas

```sh
npm test          # levanta un PostgreSQL temporal, migra y corre todo
npm run typecheck
```

Las pruebas recorren los flujos reales contra la base de datos, sin simular la base:

- Acceso por SMS.
- Verificación de identidad.
- Búsqueda geográfica.
- Reserva completa con geocerca, consentimiento y PIN.
- Cobro y reparto contable.
- Historia clínica con control de acceso.
- «No llegó», cancelación tardía, cita para un familiar, identidad que no coincide, videollamada, reclamos con devolución y paquetes.

En CI se usa el servicio de PostgreSQL de GitHub Actions mediante `TEST_DATABASE_URL`.

## Estructura

```
src/
  app.ts              servidor, seguridad, errores, documentación OpenAPI
  server.ts           arranque: configuración, migraciones y proveedores reales
  config.ts           variables de entorno validadas
  context.ts          dependencias compartidas, notificaciones y auditoría
  db/                 conexión, migraciones SQL, datos de ejemplo
  lib/                cifrado, cédula, geolocalización, precios, hora de Quito
  plugins/auth.ts     verificación de tokens y roles
  providers/          SMS, pagos y verificación de identidad (simulados ↔ reales)
  modules/            auth, patients, kyc, physios, bookings, money, clinical, support, packages, admin
test/                 pruebas unitarias y de integración
```
