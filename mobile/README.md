# FisioCerca — app móvil

App para iPhone, Android y web hecha con Expo (SDK 57), React Native y TypeScript. Una sola app con dos modos: paciente y fisio. El modo se decide al entrar, según el rol y la verificación de la cuenta.

## Arrancar

Necesitas el backend en marcha (ver [`../backend/README.md`](../backend/README.md)) con datos de ejemplo (`npm run seed`).

```bash
npm install
EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start
```

- Teléfono: abre la app **Expo Go** y escanea el código QR. Usa la IP de tu computadora en `EXPO_PUBLIC_API_URL` (no `localhost`) y agrégala a `CORS_ORIGINS` del backend si pruebas en web.
- Web: tecla `w`.

Cuentas de ejemplo (el código SMS aparece en el log del backend):

| Rol | Teléfono |
|---|---|
| Paciente | 0987654321 |
| Fisio | 0990000001 |

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | Revisa los tipos con TypeScript. |
| `npm run lint` | ESLint con la configuración de Expo y las reglas de React 19. |
| `npm test` | Pruebas unitarias de formatos y validaciones de Ecuador (cédula, celular, hora de Quito). |
| `npm run api:types` | Regenera `src/api/schema.d.ts` desde `../backend/openapi.json`. |
| `npm run export:web` | Compila la versión web en `dist/`. |

## Cómo está organizada

```
src/
  app/            pantallas (Expo Router: cada archivo es una ruta)
    index.tsx     puerta de entrada: login, verificación o modo paciente/fisio
    (patient)/    pestañas del paciente: Explorar, Citas, Tratamiento, Cuenta
    (physio)/     pestañas del fisio: Agenda, Ganancias, Perfil
    physio/[id]   perfil público del fisio y selección de horario
    book.tsx      reserva: para quién, señales de alerta, dolor, dirección
    booking/[id]  la cita en curso, con las acciones de cada parte
  api/            cliente tipado, tipos de dominio y consultas (TanStack Query)
  auth/           sesión, renovación de tokens y almacenamiento seguro
  features/       pantallas compartidas por los dos modos
  lib/            formatos, validaciones de Ecuador, ubicación, etiquetas
  theme/          paleta Sereno (clara y oscura) y medidas
  ui/             componentes base, íconos y panel de firma
```

### Decisiones de diseño

- **Tipos generados del contrato.** `src/api/schema.d.ts` sale del OpenAPI del backend y `src/api/types.ts` deriva de ahí los tipos de dominio. Si el servidor cambia una respuesta, la app deja de compilar hasta adaptarse. El CI revisa que los tipos estén al día.
- **Sesión segura.** El token de acceso vive solo en memoria. El de renovación se guarda en el llavero del sistema (`expo-secure-store`, solo en este dispositivo). Si un token vence, la app lo renueva una sola vez aunque haya varias peticiones a la vez y repite la petición.
- **Reservas idempotentes.** El formulario genera una `Idempotency-Key` y la reutiliza en los reintentos: un doble toque o una mala señal nunca crean dos citas ni dos cobros.
- **Datos vivos sin WebSockets (por ahora).** La cita activa se consulta cada 5 s y la lista cada 15 s. Al terminar una acción se invalidan las consultas afectadas.
- **Firma en SVG.** El consentimiento se firma con el dedo y se envía como trazo vectorial: pesa pocos kilobytes y no necesita librerías nativas extra.
- **Hora de Quito siempre.** Las fechas se muestran en UTC−5, aunque el teléfono esté en otra zona horaria.
- **Accesible.** Botones con rol y estado, campos con etiqueta, tamaños de toque de 48 px y modo oscuro.

## Prueba de punta a punta

`e2e/flujo-completo.cjs` recorre el flujo principal con dos navegadores a la vez:

1. El paciente busca y reserva.
2. El fisio acepta, sale y marca «Llegué».
3. El paciente confirma el rostro en la puerta y firma.
4. El fisio prueba un PIN incorrecto y luego el correcto, escribe la nota SOAP y termina.
5. El paciente califica.
6. El fisio ve sus ganancias.

```bash
# 1) Backend con SMS_PROVIDER=console, CORS_ORIGINS=http://localhost:8099 y datos de ejemplo, guardando su log
# 2) Web compilada apuntando a ese backend y servida en el puerto 8099
EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo export --platform web
npx serve dist -l 8099 -s
# 3) La prueba (necesita Playwright instalado)
APP_URL=http://localhost:8099 API_LOG=../backend/api.log node e2e/flujo-completo.cjs
```

Las capturas quedan en `e2e/capturas/`.

## Pendiente para publicar

- Subir las fotos (cédula, selfie, documentos) con URLs prefirmadas. Hoy se envía una referencia; está marcado con `TODO` en el código.
- Integrar el SDK del proveedor de verificación de identidad para la prueba de vida.
- Notificaciones push (Expo Notifications + Firebase/APNs).
- Mapa en vivo del fisio en camino.
- Compilar con EAS Build y publicar en App Store y Google Play.
- `npm audit` marca alertas en dependencias de las herramientas de Expo (compilación y servidor de desarrollo). No viajan dentro de la app; se resuelven al actualizar el SDK.
