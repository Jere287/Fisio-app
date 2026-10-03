-- Seguimiento mutuo, como en las apps de transporte: desde 30 minutos antes de una cita confirmada
-- el paciente ve al fisio y el fisio ve si el paciente está en el domicilio, hasta la llegada.
ALTER TABLE bookings
  ADD COLUMN patient_lat double precision,
  ADD COLUMN patient_lng double precision,
  ADD COLUMN patient_location_at timestamptz,
  ADD COLUMN tracking_notified_at timestamptz;

-- Recorrido de las dos partes: respaldo ante un incidente o un reclamo («no llegó», «llegó tarde»).
-- Se borra a los 30 días, salvo que la cita tenga un reporte o una alerta.
CREATE TABLE booking_locations (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('patient', 'physio')),
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  at          timestamptz NOT NULL
);
CREATE INDEX booking_locations_booking_idx ON booking_locations (booking_id, at);
CREATE INDEX booking_locations_at_idx ON booking_locations (at);
