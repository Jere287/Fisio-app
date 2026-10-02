# FisioCerca

App tipo Uber para fisioterapia a domicilio en Quito. El paciente busca especialistas verificados cerca de su ubicación, reserva, paga dentro de la app y califica la sesión. La plataforma cobra una comisión por cada sesión.

## Prototipo

`prototipo/index.html` es un prototipo navegable que funciona sin instalar nada. Ábrelo en el navegador o publícalo con GitHub Pages. Tiene tres vistas que comparten el mismo estado:

| Vista | Qué muestra |
|---|---|
| **Paciente** | Registro con validación real de cédula ecuatoriana, código SMS y selfie. Mapa de Quito con fisios cercanos y filtro por especialidad. Perfil con certificaciones y reseñas. Reserva con pago retenido, seguimiento, PIN de inicio, botón de emergencia y calificación con propina. |
| **Fisio** | Botón de disponibilidad, solicitudes con datos del paciente verificado, flujo de viaje, ingreso del PIN, notas clínicas, calificación del paciente y ganancias con la comisión desglosada. Incluye su perfil con documentos y la opción de subir certificados. |
| **Admin** | Revisión de documentos de fisios nuevos (cédula, SENESCYT, MSP, antecedentes, selfie) y alertas de emergencia. Cuando apruebas a un fisio, aparece en el mapa del paciente. |

Todos los perfiles, pagos y alertas son de ejemplo. El estado se guarda en el navegador y se borra con **Reiniciar demo**.

`prototipo/app.html` es el archivo que se edita. Después de cambiarlo, corre `prototipo/build.sh` para regenerar `index.html`.

## Documentos

- [`docs/plan-ecuador.md`](docs/plan-ecuador.md): logística, verificación, comisión, trámites legales en Ecuador y hoja de ruta técnica.
