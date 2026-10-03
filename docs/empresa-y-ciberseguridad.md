# Registrar la empresa y proteger los datos

Guía de trabajo para Quito, octubre de 2026. **Confirmen cada paso con un abogado societario y un contador antes de firmar.** Las normas de salud y de datos cambiaron en 2025 y 2026.

## 1. Registrar la empresa, en orden

| # | Paso | Dónde | Notas |
|---|---|---|---|
| 1 | **Firma electrónica** de los dos socios | Banco Central u otra entidad certificadora | Ya se obtiene 100% en línea con validación biométrica. Sin ella no se puede constituir la SAS. |
| 2 | **Pacto de socios** | Abogado | Porcentajes, quién aporta qué, permanencia mínima (vesting a 4 años con 1 año de espera) y qué pasa si alguien se va. Firmarlo antes de constituir. |
| 3 | **Reservar el nombre y constituir la SAS** | Portal de la Superintendencia de Compañías | Todo en línea y sin notario desde la reforma de 2020. Necesitan: nombre, objeto social, domicilio, accionistas, capital, actividad CIIU y representante legal. Toma de horas a pocos días. |
| 4 | **RUC** | SRI (se configura en el mismo proceso de constitución) | Activar facturación electrónica: la plataforma factura su comisión y la tarifa de servicio **con IVA**. |
| 5 | **Cuenta bancaria** de la empresa | Cualquier banco | La piden las pasarelas de pago para liquidar. |
| 6 | **Patente municipal y LUAE** | Portal de servicios municipales de Quito (pam.quito.gob.ec) | La LUAE es digital y gratuita, pero pide el número de predio del establecimiento. Si trabajan sin oficina, consulten si basta un coworking o una oficina virtual. |
| 7 | **Marca** | SENADI | Búsqueda fonética primero. Clases 9 (software) y 44 (servicios de salud). |
| 8 | **Pasarela de pagos** | Payphone, Kushki, Datafast o DeUna | Con RUC y cuenta bancaria. Pidan **retención (pre-autorización)** y **pagos a terceros** para liquidar a los fisios. |
| 9 | **Contratos** | Abogado | Términos y condiciones (la plataforma es intermediaria), contrato de servicios con cada fisio como profesional independiente con RUC, política de cancelación y consentimiento informado. |
| 10 | **Seguro** | Aseguradora | Responsabilidad civil profesional para los fisios, y de la plataforma si es posible. |
| 11 | **Obligaciones anuales** | Supercias, SRI, Municipio | Estados financieros, declaración de impuestos, patente y renovación de la LUAE. |

### Lo de salud

- **ACESS (permiso de funcionamiento):** los profesionales con título registrado que atienden a domicilio sin tener un establecimiento de salud **no necesitan** permiso de funcionamiento. FisioCerca es una plataforma tecnológica, no un establecimiento. Confírmenlo con ACESS: si un día abren un consultorio o un centro propio, ese lugar sí necesita permiso y un director técnico.
- **Cada fisio** necesita su título registrado en SENESCYT y en el MSP/ACESS. La app ya lo verifica.
- **Historia clínica electrónica:** el MSP tiene un reglamento para su manejo (Acuerdo Ministerial 0009-2017). La nota SOAP, el consentimiento firmado y el registro de accesos del prototipo van en esa línea.
- **Videoconsultas:** existe una **Norma Técnica de Telesalud** publicada en el Registro Oficial el 28 de octubre de 2025. Si agregan fisioterapia por videollamada, revísenla antes.
- **Facturación del fisio:** los servicios de salud tienen IVA 0%. Cada fisio factura su sesión con su propio RUC y FisioCerca factura su comisión.

## 2. Protección de datos (LOPDP)

FisioCerca maneja **datos de salud y biométricos**, que son datos sensibles. Eso obliga a:

1. **Designar un Delegado de Protección de Datos (DPD).** Es obligatorio cuando se tratan datos sensibles. Puede ser externo.
2. Publicar una **política de privacidad** y llevar un **registro de actividades de tratamiento**: qué datos, para qué, cuánto tiempo y con quién se comparten.
3. **Consentimiento explícito y separado** para los datos de salud y para la biometría. Ya está en el prototipo.
4. **Evaluación de impacto** antes de lanzar, actualizada cada 12 meses (Resolución SPDP-SPD-2026-0039-R sobre biometría).
5. **Alternativa sin biometría** y **nunca usar biometría de menores**.
6. **Contratos de encargado de tratamiento** con el proveedor de verificación, la nube, la pasarela y el servicio de SMS.
7. **Derechos del titular:** acceso, rectificación, eliminación, oposición y portabilidad. En el prototipo: Cuenta › Descargar mis datos / Eliminar mi cuenta.
8. **Brechas de seguridad:** avisar a la Superintendencia de Protección de Datos y a ARCOTEL **en máximo 5 días**, y a los usuarios afectados **en 3 días** cuando haya riesgo para sus derechos.

## 3. Ciberseguridad: lo mínimo antes de lanzar

### Datos
- **Cifrado en tránsito:** TLS 1.2 o superior en todo, con certificate pinning en la app móvil.
- **Cifrado en reposo:** base de datos y respaldos con AES-256. La historia clínica y los documentos van cifrados por campo, con llaves en un gestor de llaves (KMS).
- **Mínimo dato:** guardar la plantilla biométrica, no la foto. Nunca guardar el número completo de tarjeta: la pasarela lo tokeniza, así no entran al alcance de PCI DSS.
- **Seudonimizar** los datos para estadísticas y nunca usar datos reales en desarrollo.

### Accesos
- **Doble factor** obligatorio para todo el equipo y el panel de administración.
- **Mínimo privilegio y roles:** soporte ve citas, no historias clínicas. Solo el fisio tratante y el paciente ven la historia clínica.
- **Registro de auditoría** inalterable de quién abrió cada historia clínica y cuándo.
- En la app del paciente: bloqueo con huella o Face ID para la historia clínica, cierre de sesión remoto y alertas de inicio de sesión nuevo. Ya está en el prototipo.

### Desarrollo seguro
- Seguir **OWASP MASVS** (app móvil) y **OWASP ASVS** (servidor y API).
- Revisión de código y análisis automático de dependencias en cada cambio.
- Límite de intentos en el inicio de sesión, el OTP y la verificación (el prototipo bloquea 24 horas después de 3 intentos).
- **Prueba de penetración** por un tercero antes del lanzamiento y luego una vez al año.
- Programa de reporte de vulnerabilidades, con un correo publicado para reportes.

### Operación
- **Respaldos diarios cifrados** en otra región, con prueba de restauración mensual.
- **Monitoreo y alertas** de accesos raros: muchas historias clínicas abiertas por la misma cuenta, o accesos desde otro país.
- **Plan de respuesta a incidentes** escrito: quién decide, cómo se contiene, cómo se avisa en 5 días a la SPDP y en 3 días a los usuarios, y cómo se documenta.
- **Proveedores con certificación** (ISO 27001 o SOC 2): nube, verificación de identidad y pasarela.

### Seguridad física de las personas
Ya está en el prototipo:
- Verificación tipo banco de pacientes y fisios.
- Selfie diaria del fisio.
- «Llegué» solo dentro de 150 m.
- Confirmación de rostro en la puerta y PIN.
- Botón de emergencia y contacto de confianza.
- Aviso de sesión larga.
- Número enmascarado.

Además se necesita un equipo o turno de guardia que responda las alertas las 24 horas.

## Fuentes
- [Constitución electrónica de SAS (guía de la Superintendencia de Compañías)](https://appscvsmovil.supercias.gob.ec/guiasUsuarios/images/guias/societario/cons_sas/SAS.pdf) · [Derecho Ecuador: SAS 100% en línea](https://derecho.ec/sas-ecuador-como-constituir-tu-empresa-de-forma-rapida-y-100-online/) · [Compañía SAS 2026 paso a paso](https://todotramitec.com/articulo/compania-sas-ecuador-constitucion-paso-paso-2026/)
- [LUAE en Quito (gob.ec)](https://www.gob.ec/gaddmq/tramites/licencia-metropolitana-unica-ejercicio-actividades-economicas-luae) · [Quito Informa: LUAE 2026](https://www.quitoinforma.gob.ec/2026/02/10/luae-es-el-primer-paso-para-poner-en-marcha-su-negocio/)
- [ACESS: lineamientos de permisos de funcionamiento 2026](http://www.acess.gob.ec/wp-content/uploads/2026/01/Oficializacion_Actualizacion-Lineamientos-permisos-de-funcionamiento-MSP.pdf) · [Norma técnica ACESS 2025](http://www.acess.gob.ec/wp-content/uploads/2025/12/Resolucion-Nro.-ACESS-ACESS-2025-0044-R-Norma-Tecnica-para-la-emision-de-permisos-de-funcionamiento.pdf) · [Nueva norma de permisos (Meythaler & Zambrano)](https://www.meythalerzambranoabogados.com/post/permisos-funcionamiento-salud-acess-2025)
- [Norma Técnica de Telesalud, Registro Oficial, 28 de octubre de 2025](http://www.acess.gob.ec/wp-content/uploads/2025/11/Norma-Tecnica-de-Telesalud.pdf)
- [LOPDP (texto)](https://www.consejodecomunicacion.gob.ec/wp-content/uploads/downloads/2021/07/lotaip/Ley%20Org%C3%A1nica%20de%20Protecci%C3%B3n%20de%20Datos%20Personales.pdf) · [Reglamento de la LOPDP](https://www.cosede.gob.ec/wp-content/uploads/2023/12/REGLAMENTO-GENERAL-A-LA-LEY-ORG%C3%81NICA-DE-PROTECCION-DE-DATOS-PERSONALES_compressed-1.pdf) · [Delegado de Protección de Datos (Corral Rosales)](https://corralrosales.com/delegado-de-proteccion-de-datos-caracteristicas-funciones-y-obligacion-de-su-designacion/) · [Guía LOPDP para empresas](https://cvs.ec/2025/10/26/lopdp-guia-para-empresas/)
- [Nuevas resoluciones de la SPDP: biometría, IA y brechas](https://www.meythalerzambranoabogados.com/post/nuevas-reglas-de-protecci%C3%B3n-de-datos-en-ecuador-ia-biometr%C3%ADa-denuncias-y-brechas-de-seguridad)
