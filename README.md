# FisioCerca

App tipo Uber para fisioterapia a domicilio en Quito. El paciente busca especialistas verificados cerca de su ubicación, reserva, paga dentro de la app y califica la sesión. La plataforma cobra una comisión por cada sesión.

## Prototipo

`prototipo/index.html` es un prototipo navegable que funciona sin instalar nada. Ábrelo en el navegador o publícalo con GitHub Pages. Tiene tres vistas que comparten el mismo estado:

| Vista | Qué muestra |
|---|---|
| **Paciente** | Saludo con «¿Cómo te sientes hoy?» y accesos rápidos. Opción de letra más grande. Buscador «¿Qué te duele?» con mapa del cuerpo y filtro de fisioterapeutas mujeres. Valoración por videollamada. Notificaciones. Descripción del dolor (zona, desde cuándo, tipo, qué lo empeora y comentarios). Citas para un familiar (abuela, mamá) con quién firma y quién acompaña. «Mi fisio no llegó» con devolución automática y $5 de crédito. Ayuda y garantías con preguntas frecuentes. Citas con «Reportar un problema», «Reservar de nuevo» y ayuda. Verificación de identidad como en un banco: celular, cédula y código dactilar, fotos de la cédula y selfie con prueba de vida. Pin exacto de la puerta. Mapa de Quito con fisios cercanos. Perfil con certificaciones y reseñas. Reserva con filtro de señales de alerta, cita para un familiar, orden médica y pago retenido. Consentimiento informado firmado, confirmación de rostro en la puerta, PIN y botón de emergencia. Pestaña Tratamiento: plan, gráfico de dolor, ejercicios en casa con video, documentos y paquetes, protegida con huella. Cuenta con familia, recordatorios, referidos y privacidad. |
| **Fisio** | Pestaña Pacientes con la historia clínica de cada uno (gráfico de dolor, ejercicios y notas SOAP), disponibilidad editable (días, horas, distancia, videollamada) y notificaciones. Registro de un fisio nuevo con documentos profesionales, selfie diaria para conectarse, «Llegué» solo a menos de 150 m, solicitudes con datos del paciente verificado, flujo de viaje, ingreso del PIN, nota de evolución SOAP con ejercicios para casa, avisos de dolor alto del paciente, calificación del paciente y ganancias con la comisión desglosada. Incluye su perfil con documentos y la opción de subir certificados. |
| **Admin** | Casos de soporte con reembolso o suspensión. Revisión de fisios nuevos con su selfie y cédula lado a lado, alertas de emergencia, calculadora de rentabilidad (Negocio) y lista de pasos del lanzamiento (Plan). |

**En tablet** se abre solo en modo tablet: la app ocupa toda la pantalla y Explorar muestra el mapa y la lista lado a lado. El botón «Pantalla completa» oculta la barra del navegador, y agregar `#tablet` al final del enlace fuerza este modo en cualquier equipo.

**Color:** la paleta por defecto es «Sereno», un azul suave y apagado que transmite calma y confianza. En la barra de arriba hay tres círculos para comparar con «Agua» (azul verdoso) y «Lavanda» (azul lila).

Todos los perfiles, pagos y alertas son de ejemplo. El estado se guarda en el navegador y se borra con **Reiniciar demo**.

`prototipo/app.html` es el archivo que se edita. Después de cambiarlo, corre `prototipo/build.sh` para regenerar `index.html`.

## Backend

`backend/` es la API real: Node.js 22, TypeScript, Fastify y PostgreSQL. Incluye:

- Acceso por SMS y verificación de identidad tipo banco.
- Búsqueda de fisios por cercanía.
- Reservas con geocerca, PIN y consentimiento informado.
- Pagos con retención, cobro y devolución, más libro contable y liquidaciones.
- Historia clínica cifrada con registro de accesos.
- Soporte, emergencias y panel de administración.
- Idempotencia en reservas, tareas programadas (vencimientos y recordatorios) y contrato de respuestas tipado.
- 57 pruebas automáticas contra una base de datos real.

Cómo arrancarlo: [`backend/README.md`](backend/README.md). Arquitectura, seguridad y lo que falta para producción: [`docs/backend.md`](docs/backend.md).

## App móvil

`mobile/` es la app real para iPhone, Android y web: Expo, React Native y TypeScript. Una sola app con dos modos:

- **Paciente:** buscar fisios cerca, reservar para sí o para un familiar, describir el dolor, seguir la cita, confirmar el rostro en la puerta, firmar el consentimiento, dar el PIN, calificar y ver su tratamiento.
- **Fisio:** conectarse con la selfie del día, aceptar solicitudes, «Llegué» con geocerca, iniciar con PIN, nota SOAP con ejercicios, ganancias, documentos y horario.

Los tipos de la API se generan del contrato OpenAPI del backend, así que un cambio incompatible en el servidor rompe la compilación de la app antes de llegar a producción. Cómo arrancarla: [`mobile/README.md`](mobile/README.md).

## Documentos

- [`docs/lanzamiento.md`](docs/lanzamiento.md): cómo se lanzaron Uber, inDrive, Rappi, Luna, Portea, Doctoralia y Physitrack, y el plan de lanzamiento de FisioCerca.
- [`docs/empresa-y-ciberseguridad.md`](docs/empresa-y-ciberseguridad.md): pasos para registrar la empresa en Quito, permisos de salud, protección de datos y ciberseguridad.
- [`docs/verificacion-identidad.md`](docs/verificacion-identidad.md): cómo verifican los bancos en Ecuador, la nueva norma de datos biométricos, qué copiamos de Uber e inDrive, y la rentabilidad.
- [`docs/plan-ecuador.md`](docs/plan-ecuador.md): logística, verificación, comisión, trámites legales en Ecuador y hoja de ruta técnica.
