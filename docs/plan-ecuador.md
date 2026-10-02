# Plan FisioCerca: Quito, Ecuador

> Documento de trabajo. Verifiquen los trámites legales y tributarios con un abogado y un contador antes de lanzar.

## 1. Cómo funciona

1. El **paciente** se registra con cédula, celular verificado por SMS, selfie y tarjeta.
2. Busca en el mapa a los fisios cercanos y filtra por especialidad, precio, calificación y disponibilidad ("Ahora" o "Agendar").
3. Reserva. El pago se **retiene** en la tarjeta, sin cobrarse.
4. El **fisio** ve al paciente (foto, verificación, calificación, motivo y zona) y acepta o rechaza en 30 minutos. Solo al aceptar ve la dirección exacta.
5. El fisio inicia el viaje y el paciente lo sigue en el mapa.
6. Al llegar, el paciente le da un **PIN de 4 dígitos**. Sin PIN no se puede iniciar la sesión.
7. Al terminar la sesión **se cobra** la tarjeta. Los dos se califican; el paciente no ve la calificación que recibe.
8. El fisio recibe su pago cada semana, ya sin la comisión.

## 2. Verificación

### Fisioterapeuta (antes de aparecer en la app)

| Documento | Dónde se verifica |
|---|---|
| Cédula de identidad | Dígito verificador (automático) y Registro Civil (con un proveedor de verificación) |
| Título de tercer nivel | Consulta pública de títulos de la SENESCYT |
| Registro del título en salud | Ministerio de Salud Pública (ACESS) |
| Antecedentes penales | Certificado en línea del Ministerio del Interior, renovado cada 6 meses |
| Selfie vs. foto de la cédula | Proveedor de verificación de identidad (por ejemplo Truora, Incode o MetaMap) |
| Certificaciones y cursos | Revisión manual del equipo, 24 a 48 horas |

Al inicio todo esto puede hacerse a mano desde el panel de administración. El prototipo ya incluye ese panel.

### Paciente

- Cédula, selfie, celular verificado por SMS y tarjeta registrada.
- Los fisios pueden ver la calificación del paciente antes de aceptar. Las fisios pueden elegir atender solo a mujeres.

### Durante la cita

- Chat y llamadas dentro de la app, con número enmascarado.
- Seguimiento en vivo compartido con un contacto de confianza.
- Botón de emergencia para ambos, que avisa al equipo y muestra el ECU 911.
- Protocolo de incidentes: suspender la cuenta, contactar a las dos partes y guardar evidencia.

## 3. Comisión y pagos

- **Modelo:** el paciente le paga a la plataforma, que se queda con su comisión y transfiere el resto al fisio.
- **Pasarelas en Ecuador:** Payphone, Kushki, Datafast y DeUna (pago con QR desde la app del banco). Confirmen cuál permite dividir pagos o liquidar a terceros, y si no, liquiden por transferencia semanal.
- **Comisión sugerida:** 15%, y 0% los primeros 3 meses para los fisios fundadores del grupo. Uber cobra cerca del 25%, pero aquí el riesgo de que el paciente y el fisio sigan por fuera de la app es más alto.

Ejemplo con una sesión de $30:

| Concepto | Valor |
|---|---|
| Paciente paga | $30.00 |
| Comisión FisioCerca (15%) | −$4.50 |
| IVA 15% sobre la comisión | −$0.68 |
| **Fisio recibe** | **$24.82** |
| Costo de la pasarela (aprox. 4–5%, lo asume la plataforma) | ≈ $1.35 |

Los servicios de salud tienen tarifa 0% de IVA, pero la comisión de intermediación de la plataforma sí paga IVA. Confirmen el tratamiento exacto con un contador.

**Para que no se salten la app:** pago garantizado, agenda y recordatorios, notas clínicas, paquetes de sesiones prepagadas, reseñas que solo cuentan si la sesión se pagó en la app, y una comisión más baja en sesiones recurrentes.

## 4. Trámites en Ecuador

1. **Empresa:** una SAS (Sociedad por Acciones Simplificada) se constituye en línea en la Superintendencia de Compañías, y pueden ser 2 socios. Firmen también un pacto de socios.
2. **RUC** en el SRI, facturación electrónica y cuenta bancaria empresarial.
3. **Marca** en el SENADI. Busquen antes que el nombre esté libre (clases 9 y 44).
4. **Términos y condiciones:** la plataforma es intermediaria, los fisios son profesionales independientes y la atención clínica es su responsabilidad.
5. **Protección de datos:** la Ley Orgánica de Protección de Datos Personales (2021) trata los datos de salud como **sensibles**. Necesitan consentimiento expreso, una política de privacidad y un responsable de protección de datos.
6. **Tiendas de apps:** Apple Developer (US$99 al año) y Google Play (US$25 una vez), ambas a nombre de la empresa. Como el servicio se da físicamente, pueden usar su propia pasarela de pagos.
7. **Seguro** de responsabilidad civil profesional, ya sea negociado para el grupo o exigido a cada fisio.

## 5. Hoja de ruta

**Fase 0, validar (2 a 4 semanas):**
- Encuesta al grupo de WhatsApp: cuántos se suman, en qué sectores de Quito, cuánto cobran y qué comisión aceptan.
- Piloto manual con este prototipo y reservas por WhatsApp, cobrando con links de pago de Payphone.

**Fase 1, MVP (2 a 4 meses):**
- App con React Native (Expo) o Flutter para iOS y Android.
- Backend con Supabase (Postgres + PostGIS para buscar por cercanía) o Firebase.
- Mapas con Google Maps Platform o Mapbox.
- Pagos con Payphone o Kushki.
- Panel de administración para verificar a los fisios.

**Fase 2:** verificación automática, paquetes, facturación electrónica para los fisios, suscripción "Fisio Pro" y expansión a Valle de los Chillos, Cumbayá y luego Guayaquil y Cuenca.

Lancen solo en Quito, con 30 a 50 fisios fundadores, para que siempre haya alguien cerca.
