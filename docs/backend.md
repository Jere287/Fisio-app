# Backend de FisioCerca

Documento técnico del servidor. El código está en `backend/`.

## 1. Arquitectura

```
App paciente / App fisio / Panel admin
              │  HTTPS + JWT
              ▼
      API (Fastify, Node 22)
      ├─ PostgreSQL 16 (datos, búsqueda geográfica, reglas de integridad)
      ├─ Pasarela de pagos (Payphone / Kushki)       ← adaptador
      ├─ Verificación de identidad (Truora / Didit…)  ← adaptador + webhook
      ├─ SMS (agregador local o Twilio)               ← adaptador
      └─ Push (Firebase Cloud Messaging)              ← pendiente
```

**Monolito modular.** Es un solo servicio, con módulos separados por dominio. Para el tamaño de la empresa es lo correcto: un solo despliegue, una base de datos y transacciones reales. Si algún día hace falta, cada módulo se puede separar.

**Proveedores intercambiables.** SMS, pagos y verificación de identidad tienen una interfaz común. En desarrollo y en pruebas se usan versiones simuladas. En producción se cambia una variable de entorno y se conecta el adaptador real, sin tocar la lógica de negocio.

**Reloj inyectado.** Toda la lógica que depende del tiempo (vencimiento de códigos, «no llegó» a los 20 minutos, cancelación a 12 horas, selfie diaria) usa `ctx.now()`. Así las pruebas avanzan el tiempo sin esperar.

## 2. Modelo de datos

Todo está en `src/db/migrations/001_init.sql`. Los puntos clave:

| Tabla | Para qué |
|---|---|
| `users` | Cuenta por celular. Rol: `patient`, `physio` o `admin`. Estado de verificación. Crédito. Cédula cifrada, más un HMAC para detectar duplicados. |
| `patients` | Quién recibe la atención. Cada usuario tiene uno propio (`self`); los familiares (abuela, hijo) son pacientes del mismo dueño. La historia clínica cuelga de aquí. |
| `consents` | Consentimientos de la LOPDP por tipo y versión: términos, datos de salud, biometría, Registro Civil. |
| `kyc_sessions` | Cada intento de verificación de identidad, con su puntaje facial y su resultado. |
| `physios`, `physio_documents`, `availability` | Perfil profesional, documentos (SENESCYT, MSP, antecedentes) con revisión, y horario semanal. |
| `bookings`, `booking_events` | La cita y su historial de cambios de estado. Una **restricción de exclusión** impide en la propia base de datos que un fisio tenga dos citas activas que se crucen. |
| `clinical_consents` | Consentimiento informado firmado, uno por pareja paciente–fisio. |
| `payments`, `ledger_entries`, `payouts` | Cobros, libro contable y liquidaciones semanales. |
| `clinical_notes`, `exercise_assignments`, `exercise_logs`, `pain_logs`, `clinical_access_log` | Historia clínica: notas SOAP cifradas, ejercicios, adherencia, dolor y registro de quién abrió cada historia. |
| `reviews`, `support_tickets`, `notifications`, `sos_alerts`, `audit_log` | Reseñas, soporte, avisos, emergencias y auditoría. |

## 3. Reglas de negocio implementadas

### Ciclo de la cita

```
pending ─► confirmed ─► en_route ─► arrived ─► in_progress ─► completed
   │           │  └──────── (videollamada) ─────────┘
   ├─► rejected├─► cancelled
   └─► cancelled└─► no_show
```

| Paso | Regla |
|---|---|
| Crear | Exige identidad verificada. Aplica el **triaje de señales de alarma** (ver abajo). Pide el dolor o un comentario. La dirección debe estar dentro de la zona del fisio, el horario dentro de su disponibilidad y con al menos 1 hora de anticipación. **Retiene el pago.** |
| Triaje | Dos niveles. **Emergencia** (dolor de pecho o falta de aire ahora, debilidad repentina, pérdida del control de la orina o las heces): no se reserva y se indica llamar al 911. **Médico primero** (fiebre con el dolor, caída fuerte reciente): se reserva solo si el paciente confirma que un médico ya lo evaluó; el fisio ve las señales en la cita. Las frases son concretas y con tiempo para que una secuela ya diagnosticada (por ejemplo, de un ACV) no se tome como emergencia. |
| Familiar | Si el paciente tiene 75 años o más, es menor o no puede firmar, exige un acompañante. Si no puede firmar, el consentimiento lo firma su representante. |
| Dirección | El fisio la ve solo después de aceptar. Nunca ve el PIN. |
| En camino | La app del fisio envía su ubicación cada ~10 s; el paciente lo ve en el mapa con distancia, tiempo estimado y la hora de la última ubicación. |
| «Llegué» | Solo a menos de **150 m** del punto que marcó el paciente en el mapa. |
| Consentimiento | Se firma una vez por paciente y especialista, con el dedo en la app. La firma llega como SVG (trazo vectorial, se rechaza si trae scripts o atributos de eventos) o como PNG. |
| Iniciar | En visitas a domicilio exige consentimiento firmado, que el paciente confirme el rostro en la puerta y el **PIN** correcto (máximo 5 intentos). |
| Puerta | Si el paciente dice que la persona no es la del perfil: se cancela la cita, se libera el pago, se **suspende al fisio**, se crea una alerta y un caso de seguridad. |
| Terminar | Nota SOAP cifrada, ejercicios para casa, **cobro** y reparto contable. |
| «No llegó» | Desde 20 minutos después de la hora: se cancela, se libera todo y se dan **$5 de crédito**. |
| Cancelar | Gratis hasta 12 horas antes. Después se cobra el 50% de la sesión. Si cancela el fisio: devolución total y $5 de crédito. |

### Dinero

- Todo en centavos enteros.
- Comisión del 15%, IVA del 15% sobre la comisión y tarifa de servicio de $0.99 (con IVA incluido).
- Al terminar, el cobro se reparte en asientos (`physio_payable`, `platform_revenue`, `iva_payable`, `promotions`) que **suman exactamente lo cobrado**. Las pruebas lo verifican.
- Sesión de $30: el paciente paga $30.99 y el fisio recibe $24.82.
- Las devoluciones revierten el reparto en la misma proporción.
- Los paquetes (5 sesiones con 10% de descuento, 10 con 15%) se cobran por adelantado; el reparto se registra en cada sesión.
- `POST /v1/admin/payouts/run` liquida lo pendiente de cada fisio.

## 4. Seguridad

| Capa | Qué hace |
|---|---|
| Acceso | Código SMS de 6 dígitos. Se guarda solo su HMAC, vence en 5 minutos, admite 5 intentos y máximo 3 envíos cada 10 minutos por número. |
| Sesiones | Token de acceso JWT de 15 minutos. El token de renovación se guarda hasheado y **rota en cada uso**; si alguien reutiliza uno viejo, se cierran todas las sesiones. En cada petición se revisa que la cuenta no esté suspendida. |
| Roles | Paciente, fisio y admin. Cada ruta exige su rol. Las acciones sobre una cita validan que quien actúa sea su paciente o su fisio. |
| Cifrado | AES-256-GCM, con versión para poder rotar llaves, en notas clínicas, comentarios, dirección, cédula y PIN. |
| Historia clínica | Solo la ven el dueño de la cuenta y los fisios que atendieron a ese paciente. **El administrador no la ve.** Cada acceso queda en `clinical_access_log`. |
| Pagos | La API nunca recibe ni guarda números de tarjeta: la pasarela los tokeniza. Así quedamos fuera del alcance de PCI DSS. |
| Entrada | Todo se valida con Zod. Las consultas SQL siempre van parametrizadas. El tamaño del cuerpo de la petición está limitado. |
| Transporte | Cabeceras de seguridad (Helmet: HSTS, nosniff, protección contra frames), CORS con lista de orígenes y límite de peticiones por IP. |
| Webhooks | Firma HMAC verificada sobre el cuerpo original, con comparación de tiempo constante. |
| LOPDP | Consentimientos por versión, exportación de datos, eliminación desde la app (no se permite con citas activas; anonimiza nombre, teléfono, correo y cédula, y conserva la historia clínica y las facturas por obligación legal) y auditoría de acciones de administración. |
| Dependencias | `npm audit` en CI. Hoy: 0 vulnerabilidades en producción. |

## 5. Fiabilidad y contrato

| Tema | Cómo se resuelve |
|---|---|
| Doble toque o mala señal | `POST /v1/bookings` acepta la cabecera `Idempotency-Key`. Si llega dos veces la misma clave, se devuelve la misma respuesta (con `idempotent-replayed: true`) sin reservar ni retener dos veces. La misma clave con otro contenido responde 422. |
| Trazabilidad | Cada respuesta lleva `x-request-id` (se respeta el que envíe el cliente). Los errores 500 lo incluyen para que soporte encuentre el caso en los logs. |
| Contrato de respuestas | Cada ruta declara su esquema de salida con Zod (`src/schemas.ts`). Un campo que no esté declarado **no sale**, aunque la consulta lo traiga. De ese contrato se genera `openapi.json`, y de él los tipos de la app móvil. El CI falla si `openapi.json` no está al día. |
| Tareas programadas | `src/jobs.ts`, cada minuto, con un candado de PostgreSQL para que solo corra una instancia: vence solicitudes sin respuesta a los 30 minutos (y libera el pago), recordatorios de 24 h y 1 h, aviso si una sesión pasa de 90 minutos y desconexión del fisio con documentos vencidos. Se activan con `JOBS_ENABLED=true`. |

## 6. Mapa de la API

La documentación interactiva completa está en `/docs` (OpenAPI 3). Resumen:

| Área | Rutas principales |
|---|---|
| Acceso | `POST /v1/auth/otp`, `/verify`, `/refresh`, `/logout`, `/logout-all` |
| Mi cuenta | `GET/PATCH /v1/me`, `POST/DELETE /v1/me/consents`, `GET /v1/me/export`, `POST /v1/me/delete`, `GET /v1/notifications` |
| Familia | `GET/POST /v1/patients`, `PATCH /v1/patients/:id` |
| Identidad | `POST /v1/kyc/sessions`, `/kyc/sessions/:id/submit`, `/kyc/agent-call`, `/webhooks/kyc` |
| Fisios | `POST /v1/physios/apply`, `GET/PATCH /v1/physios/me`, `/me/documents`, `PUT /me/availability`, `/me/selfie-check`, `/me/availability-toggle`, `/me/earnings`, `GET /v1/physios/search`, `/physios/:id`, `/physios/:id/slots` |
| Citas | `POST /v1/bookings`, `GET /v1/bookings`, `/bookings/:id`, `/events`. Fisio: `accept`, `reject`, `depart`, `location`, `arrive`, `start`, `complete`. Paciente: `consent`, `door`, `no-show`. Ambos: `cancel`, `sos`, `reviews` |
| Clínico | `GET /v1/exercises`, `GET /v1/patients/:id/record`, `POST /patients/:id/exercise-logs`, `/pain-logs` |
| Paquetes | `POST/GET /v1/packages` |
| Soporte | `POST/GET /v1/support/tickets` |
| Admin | `/v1/admin/physios`, `/documents/:id/decision`, `/physios/:id/decision`, `/kyc/:id/decision`, `/tickets`, `/tickets/:id/resolve`, `/alerts`, `/metrics`, `/payouts/run` |

## 7. Qué falta para producción

Esto es lo que no se puede terminar sin contratos o credenciales de terceros. Cada pieza tiene su interfaz lista.

1. **Adaptador de pagos** (`src/providers/payments.ts`). Implementar `authorize`, `capture`, `void`, `refund` y `charge` con la API de Payphone o Kushki. Hay que confirmar con ellos que soporten **retención y captura posterior**. Si no, se usa cobro inmediato con devolución.
2. **Adaptador de verificación de identidad** (`src/providers/kyc.ts`): SDK móvil del proveedor más su webhook (ya implementado y con firma).
3. **SMS real** (`src/providers/sms.ts`).
4. **Almacenamiento de archivos**: fotos de cédula, selfies y PDF de documentos, con URLs firmadas de subida en S3 o Google Cloud Storage. Hoy la API recibe referencias (`fileKey`, `frontRef`).
5. **Notificaciones push** (Firebase): el punto de conexión está en `notify()`, en `src/context.ts`.
6. **Ubicación en tiempo real**: el seguimiento ya funciona con envío cada ~10 s y consulta cada 5 s. Para más fluidez y menos consumo, conviene WebSockets o Server-Sent Events, y permiso de ubicación en segundo plano para seguir con la pantalla apagada.
7. **Videollamada**: integrar un proveedor (Daily, Twilio Video o Agora) que entregue la sala al iniciar la cita.
8. **Recordatorios por push**: las tareas programadas ya crean las notificaciones; falta enviarlas por Firebase (ver punto 5).
9. **Infraestructura**: PostgreSQL administrado con respaldos diarios y réplica (AWS RDS, Google Cloud SQL o Supabase), secretos en un gestor de secretos, monitoreo de errores (Sentry) y logs centralizados.
10. **Apps móviles**: la app está en `mobile/` (ver su README). Falta compilarla con EAS, publicarla en las tiendas y conectar el SDK del proveedor de identidad y la subida de fotos.

## 8. Cómo desplegar

1. Crear la base de datos PostgreSQL 16 administrada. Las extensiones `pgcrypto`, `cube`, `earthdistance` y `btree_gist` vienen incluidas en RDS, Cloud SQL y Supabase.
2. Construir la imagen con `docker build -t fisiocerca-api backend/` y desplegarla en Cloud Run, AWS App Runner, Railway o Render.
3. Configurar las variables de `.env.example`. Generar los secretos con `openssl rand -base64 32` y guardarlos en el gestor de secretos.
4. La API aplica las migraciones sola al arrancar. Revisar `GET /health`.
