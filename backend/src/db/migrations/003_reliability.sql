-- Idempotencia: una petición repetida con la misma clave devuelve la misma respuesta (no cobra ni reserva dos veces).
CREATE TABLE idempotency_keys (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key           text NOT NULL,
  route         text NOT NULL,
  request_hash  text NOT NULL,
  status_code   integer,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Marcas para que las tareas programadas no repitan avisos.
ALTER TABLE bookings
  ADD COLUMN reminder_24h_at timestamptz,
  ADD COLUMN reminder_1h_at timestamptz,
  ADD COLUMN long_session_alert_at timestamptz;

CREATE INDEX bookings_status_scheduled_idx ON bookings (status, scheduled_at);
