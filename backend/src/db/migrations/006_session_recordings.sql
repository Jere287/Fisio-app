-- Grabación de audio de seguridad (como la de Uber): cualquiera de las dos partes la activa durante la visita
-- y la otra recibe el aviso. El audio se guarda cifrado; nadie lo escucha salvo el equipo de seguridad,
-- y solo si la cita tiene un reporte o una alerta. Se borra a los 30 días.
ALTER TABLE bookings
  ADD COLUMN recording_patient_at timestamptz,
  ADD COLUMN recording_physio_at timestamptz;

CREATE TABLE session_recordings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  recorded_by   uuid NOT NULL REFERENCES users(id),
  role          text NOT NULL CHECK (role IN ('patient', 'physio')),
  seq           integer NOT NULL CHECK (seq >= 0),
  started_at    timestamptz NOT NULL,
  duration_ms   integer NOT NULL CHECK (duration_ms >= 0),
  bytes         integer NOT NULL,
  content_type  text NOT NULL,
  storage_key   text NOT NULL UNIQUE,
  sha256        text NOT NULL,           -- huella del audio original: prueba de que no se alteró
  created_at    timestamptz NOT NULL,
  deleted_at    timestamptz,
  UNIQUE (booking_id, recorded_by, seq)
);
CREATE INDEX session_recordings_created_idx ON session_recordings (created_at) WHERE deleted_at IS NULL;
