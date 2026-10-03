-- Triaje: las señales de alarma que el paciente reportó con autorización médica quedan en la cita
-- para que el fisio las vea antes de la visita.
ALTER TABLE bookings
  ADD COLUMN red_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN medical_clearance boolean NOT NULL DEFAULT false;

-- Seguimiento en vivo: cuándo se recibió la última ubicación del fisio (para mostrar si está desactualizada).
ALTER TABLE bookings ADD COLUMN physio_location_at timestamptz;
