# Verificación de identidad y seguridad

Cómo verificar a pacientes y especialistas con el mismo nivel que la banca digital en Ecuador, y qué copiar de Uber e inDrive. Investigación de octubre de 2026.

## 1. Cómo lo hacen los bancos en Ecuador

La apertura de cuentas y la firma electrónica 100% remotas combinan cuatro capas:

1. **Algo que sabes:** número de cédula + **código dactilar** (los 10 caracteres del reverso, junto a la huella). Es lo mismo que pide el Registro Civil en sus trámites en línea.
2. **Algo que tienes:** el celular, verificado con un código SMS, y la cédula física, fotografiada por los dos lados.
3. **Algo que eres:** selfie con **prueba de vida** (parpadear, girar la cabeza), comparada con la foto de la cédula y con la foto que tiene el **Registro Civil**.
4. **Consulta a la fuente oficial:** el Registro Civil (DIGERCIC) ofrece a empresas privadas un servicio web de consulta **demográfica o demográfica + biométrica**. Requiere una solicitud formal y autorización de la DIGERCIC. El Banco Central habilitó en 2026 la firma electrónica remota con validación biométrica mediante proveedores autorizados (Latinus y Sodig).

**Qué hacer en FisioCerca:** no conectarse directo al Registro Civil al inicio. Contratar un proveedor que ya tenga ese acceso y un SDK de captura y prueba de vida. Opciones para cotizar: Truora, Didit, Incode, MetaMap, Scanovate (a través de Gruppo Avanti), Latinus o Sodig.

**Costos de referencia:** la consulta de cédula cuesta entre $0.02 y $0.20 según el proveedor (ApiConsult, Didit). Un flujo completo (documento + prueba de vida + comparación facial + Registro Civil) suele costar entre $0.50 y $1.50. La calculadora del prototipo usa $1.20 por paciente y $4.00 por fisio (incluye la revisión manual de títulos y antecedentes).

## 2. Lo que exige la ley (importante y reciente)

- **LOPDP (2021):** los datos biométricos y los de salud son **datos sensibles**. Para usarlos se necesita consentimiento previo, libre, específico, informado, inequívoco y **explícito**.
- **Resolución SPDP-SPD-2026-0039-R (9 de septiembre de 2026), norma general de datos biométricos:**
  - Hay que **ofrecer al menos una alternativa equivalente sin biometría**. En el prototipo es la videollamada con un agente.
  - Hay que hacer una **evaluación de impacto** antes de implementar el sistema y **actualizarla cada 12 meses**, además de un análisis de riesgos y medidas de seguridad reforzadas.
  - Se deben guardar **plantillas biométricas**, no fotos crudas, salvo necesidad técnica estricta.
  - **Prohíbe usar la biometría de niños y adolescentes para identificarlos.** En fisioterapia pediátrica se verifica al padre, madre o representante, nunca al menor.

Esta norma es de hace menos de un mes. Revísenla con un abogado antes de lanzar.

## 3. Qué copiamos de Uber e inDrive

| Función | Quién la usa | Cómo queda en FisioCerca |
|---|---|---|
| Insignia de usuario verificado (documento + selfie) | Uber (insignia de pasajero verificado) | Insignia de paciente verificado. El fisio ve solo nombre, inicial del apellido, foto y calificación. |
| Selfie antes de conectarse | Uber (Real-Time ID Check), inDrive | El fisio toma una selfie al ponerse disponible cada día, para que nadie más use su cuenta. |
| Elegir con quién ir | inDrive | El paciente elige al fisio por su perfil y el fisio ve al paciente antes de aceptar. |
| PIN para iniciar | Uber | PIN de 4 dígitos. Sin PIN no empieza la sesión ni el cobro. |
| Compartir viaje, botón SOS y contactos de confianza | Uber, inDrive | Seguimiento en vivo, botón de emergencia (ECU 911) y contacto de confianza. |
| Detección de anomalías | Uber | Si la sesión pasa de 90 min, o el celular del fisio se aleja más de 300 m, la app pregunta «¿Todo bien?» a los dos. |
| Número enmascarado | Uber, Rappi | Chat y llamadas dentro de la app. |
| Pin exacto de la entrega | Rappi, Uber | El paciente ajusta el pin a su puerta. El fisio solo puede marcar «Llegué» a menos de 150 m. |

## 4. Flujo en el prototipo

**Paciente:**
1. Autorización (dos permisos separados) o la alternativa sin biometría.
2. Celular y código SMS de 6 dígitos.
3. Cédula (con dígito verificador) y código dactilar (letra, 4 números, letra, 4 números).
4. Foto del frente y del reverso, con marco guía.
5. Selfie con prueba de vida.
6. Verificación: lectura de la cédula, Registro Civil, comparación facial, prueba de vida y revisión del celular.
7. Resultado: **aprobada**, **revisión manual** (comparación facial menor al 85%, la revisa una persona en menos de 2 h) o **rechazada** (máximo 3 intentos y luego bloqueo de 24 h).

**Especialista:** los mismos pasos, más el registro SENESCYT, el registro MSP, los antecedentes penales (renovados cada 6 meses), especialidades y precio. Al final cae al panel de Admin, que muestra la selfie y la cédula lado a lado.

**Durante la cita:**
- Paciente sin verificar: no puede reservar.
- Fisio sin selfie del día: no puede conectarse.
- En la puerta: el paciente confirma «¿es la persona del perfil?» antes de ver su PIN. Si responde «No es», se cancela la cita, se suspende al fisio y llega una alerta a Admin.

La cámara funciona de verdad al abrir `prototipo/index.html` en un navegador (por ejemplo con GitHub Pages). La lectura del documento, la prueba de vida y la comparación facial están **simuladas**: en producción las hace el SDK del proveedor.

## 5. Rentabilidad

La pestaña Admin › Negocio calcula la ganancia mensual. Con 50 fisios, 8 sesiones por semana, $30 por sesión, 15% de comisión, $0.99 de tarifa de servicio, 300 pacientes nuevos al mes, $1,500 de marketing y $1,200 de soporte:

- Ingresos ≈ $9,600 al mes. Costos ≈ $5,850. **Ganancia ≈ $3,760 al mes.**
- El punto de equilibrio está en unos **24 fisios activos**.
- Verificar a un paciente ($1.20) se paga con el 4% de su primera sesión.

Lo que más mueve el resultado es **sesiones por fisio a la semana**. Por eso importan más la retención (paquetes, comisión baja en pacientes recurrentes) y que los fisios no se lleven a los pacientes por fuera, que subir la comisión.

## Fuentes

- [Registro Civil: verificación por web service demográfico o demográfico + biométrico](https://www.gob.ec/dgrcic/tramites/verificacion-mediante-consulta-datos-web-service-demografico-demografico-mas-biometrico)
- [Registro Civil: Sistema Nacional de Identificación Ciudadana para empresas](https://www.gob.ec/dgrcic/tramites/verificacion-sistema-nacional-identificacion-ciudadana-consulta-demografico-demografico-mas-biometrico-0)
- [Registro Civil: preguntas frecuentes (cédula + código dactilar)](https://www.registrocivil.gob.ec/accordion-item/preguntas-frecuentes-registro-civil-en-linea/)
- [Banco Central: firma electrónica remota con validación biométrica](https://www.bce.fin.ec/servicios-y-tramites/administracion-de-certificados-de-firma-electronica-y-servicios-relacionado/emision-y-renovacion-de-certificados-digitales-de-firma-electronica/)
- [Primicias: Ecuador regula el uso de datos biométricos](https://www.primicias.ec/sociedad/imagen-huella-rostro-voz-datos-biometricos-personales-norma-ecuador-132986/)
- [Proyecto de norma de datos biométricos (SPDP)](https://spdp.gob.ec/wp-content/uploads/2026/03/Proyecto-Resolucion-N%C2%B0-SPDP-SPD-2026-00XX-R-Norma-General-para-el-Tratamiento-de-Datos-Biometricos-1.pdf)
- [Daniel Law: Ecuador regulates the processing of biometric data](https://www.daniel.com.br/en/client-alert/ecuador-regulates-the-processing-of-biometric-data/)
- [Uber: Real-Time ID Check](https://www.uber.com/us/en/blog/real-time-id-check/) · [Verificación de pasajeros](https://www.biometricupdate.com/202404/uber-gets-a-blue-check-system-for-rider-identity-document-verification) · [Ayuda: verificar tu identidad](https://help.uber.com/en/riders/article/verify-your-identity-faq?nodeId=9441c28e-e29f-46f9-b953-f938cf442ed9)
- [inDrive: seguridad para pasajeros](https://indrive.com/en-co/safety) · [para conductores](https://indrive.com/en-co/safety/drivers)
- [Didit: API de verificación de cédula en Ecuador](https://didit.me/es/blog/ecuador-cedula-database-validation-de/) · [ApiConsult](https://apiconsult.zampisoft.com/) · [Truora](https://www.truora.com/en/products/digital-identity-verification-facial-document-ocr-software) · [Gruppo Avanti / Scanovate](https://www.gruppoavanti.com/servicios/firma-electronica-y-biometrica-de-documentos/)
