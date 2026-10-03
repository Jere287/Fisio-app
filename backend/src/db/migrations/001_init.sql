-- FisioCerca: esquema inicial.
-- Dinero siempre en centavos (integer). Fechas en timestamptz (UTC).
-- Datos clínicos y sensibles cifrados en la aplicación (AES-256-GCM) antes de guardarse.

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance; -- búsqueda por distancia
CREATE EXTENSION IF NOT EXISTS btree_gist;    -- evita citas superpuestas del mismo fisio

-- ---------- Usuarios y acceso ----------
CREATE TYPE user_role AS ENUM ('patient', 'physio', 'admin');
CREATE TYPE kyc_status AS ENUM ('none', 'pending', 'approved', 'review', 'rejected', 'pending_agent');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL UNIQUE,                 -- formato E.164: +5939XXXXXXXX
  role          user_role NOT NULL DEFAULT 'patient',
  full_name     text,
  email         text,
  cedula_enc    text,                                 -- cifrada
  cedula_hash   text UNIQUE,                          -- HMAC para detectar duplicados sin descifrar
  kyc_status    kyc_status NOT NULL DEFAULT 'none',
  credit_cents  integer NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  suspended_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Consentimientos (LOPDP): uno por tipo y versión del texto aceptado.
CREATE TYPE consent_kind AS ENUM ('terms', 'health_data', 'biometric', 'registro_civil');
CREATE TABLE consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        consent_kind NOT NULL,
  version     text NOT NULL,
  ip          inet,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX consents_user_idx ON consents (user_id, kind);

-- ---------- Verificación de identidad ----------
CREATE TABLE kyc_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  provider_ref  text,
  status        kyc_status NOT NULL DEFAULT 'pending',
  face_score    integer,                               -- 0 a 100
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX kyc_sessions_user_idx ON kyc_sessions (user_id, created_at DESC);

-- ---------- Pacientes ----------
-- Cada usuario tiene un paciente «self». Los familiares (abuela, hijo) son pacientes del mismo dueño.
CREATE TABLE patients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name      text NOT NULL,
  relationship   text NOT NULL DEFAULT 'self',
  birth_year     integer CHECK (birth_year BETWEEN 1900 AND 2100),
  can_consent    boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX patients_one_self ON patients (owner_user_id) WHERE relationship = 'self';

-- ---------- Fisioterapeutas ----------
CREATE TYPE physio_status AS ENUM ('applied', 'approved', 'rejected', 'suspended');
CREATE TABLE physios (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status             physio_status NOT NULL DEFAULT 'applied',
  bio                text,
  university         text,
  years_experience   integer NOT NULL DEFAULT 0,
  specialties        text[] NOT NULL DEFAULT '{}',
  gender             text CHECK (gender IN ('f', 'm', 'x')),
  women_only         boolean NOT NULL DEFAULT false,
  offers_video       boolean NOT NULL DEFAULT false,
  price_cents        integer NOT NULL CHECK (price_cents BETWEEN 500 AND 50000),
  video_price_cents  integer NOT NULL DEFAULT 1500,
  radius_km          numeric(4,1) NOT NULL DEFAULT 8 CHECK (radius_km BETWEEN 1 AND 30),
  base_lat           double precision NOT NULL,
  base_lng           double precision NOT NULL,
  available          boolean NOT NULL DEFAULT false,
  last_selfie_at     timestamptz,
  rating_sum         integer NOT NULL DEFAULT 0,
  rating_count       integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX physios_geo_idx ON physios USING gist (ll_to_earth(base_lat, base_lng));
CREATE INDEX physios_specialties_idx ON physios USING gin (specialties);

CREATE TYPE doc_kind AS ENUM ('senescyt', 'msp', 'criminal_record', 'certificate');
CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TABLE physio_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  physio_id    uuid NOT NULL REFERENCES physios(user_id) ON DELETE CASCADE,
  kind         doc_kind NOT NULL,
  title        text NOT NULL,
  reference    text,                -- número de registro SENESCYT, folio MSP, etc.
  file_key     text,                -- ruta en el almacenamiento de objetos
  status       review_status NOT NULL DEFAULT 'pending',
  expires_at   date,
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE availability (
  physio_id  uuid NOT NULL REFERENCES physios(user_id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = lunes
  start_min  smallint NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
  end_min    smallint NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
  CHECK (end_min > start_min),
  PRIMARY KEY (physio_id, weekday, start_min)
);

-- ---------- Paquetes prepagados ----------
CREATE TABLE packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES users(id),
  physio_id       uuid NOT NULL REFERENCES physios(user_id),
  sessions_total  integer NOT NULL CHECK (sessions_total > 0),
  sessions_left   integer NOT NULL CHECK (sessions_left >= 0),
  price_cents     integer NOT NULL,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- Reservas ----------
CREATE TYPE booking_mode AS ENUM ('home', 'video');
CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'rejected', 'no_show');
CREATE TABLE bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booked_by           uuid NOT NULL REFERENCES users(id),
  patient_id          uuid NOT NULL REFERENCES patients(id),
  physio_id           uuid NOT NULL REFERENCES physios(user_id),
  mode                booking_mode NOT NULL,
  status              booking_status NOT NULL DEFAULT 'pending',
  scheduled_at        timestamptz NOT NULL,
  duration_min        integer NOT NULL,
  ends_at             timestamptz NOT NULL,
  CHECK (ends_at > scheduled_at),
  address_enc         text,                       -- cifrada; el fisio la ve solo al aceptar
  lat                 double precision,
  lng                 double precision,
  pain                jsonb NOT NULL DEFAULT '{}',  -- zonas, tipo, desde cuándo, qué lo empeora
  pain_score          smallint CHECK (pain_score BETWEEN 0 AND 10),
  comments_enc        text,
  companion           text CHECK (companion IN ('booker', 'other', 'none')),
  companion_name      text,
  price_cents         integer NOT NULL,
  fee_cents           integer NOT NULL,
  credit_cents        integer NOT NULL DEFAULT 0,
  package_id          uuid REFERENCES packages(id),
  total_cents         integer NOT NULL CHECK (total_cents >= 0),
  pin_enc             text NOT NULL,
  pin_attempts        integer NOT NULL DEFAULT 0,
  physio_lat          double precision,
  physio_lng          double precision,
  door_confirmed_at   timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Un fisio no puede tener dos citas activas que se crucen.
  EXCLUDE USING gist (physio_id WITH =, tstzrange(scheduled_at, ends_at) WITH &&)
    WHERE (status IN ('pending', 'confirmed', 'en_route', 'arrived', 'in_progress'))
);
CREATE INDEX bookings_booked_by_idx ON bookings (booked_by, scheduled_at DESC);
CREATE INDEX bookings_physio_idx ON bookings (physio_id, scheduled_at DESC);

CREATE TABLE booking_events (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id),
  type        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, id);

-- Consentimiento informado firmado: uno por pareja paciente–fisio.
CREATE TABLE clinical_consents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  physio_id           uuid NOT NULL REFERENCES physios(user_id),
  signer_name         text NOT NULL,
  signer_is_patient   boolean NOT NULL,
  signature_sha256    text NOT NULL,
  signed_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, physio_id)
);

-- ---------- Pagos ----------
CREATE TYPE payment_status AS ENUM ('authorized', 'captured', 'voided', 'refunded', 'partially_refunded');
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid REFERENCES bookings(id),
  package_id      uuid REFERENCES packages(id),
  provider        text NOT NULL,
  provider_ref    text NOT NULL,
  status          payment_status NOT NULL,
  amount_cents    integer NOT NULL,
  captured_cents  integer NOT NULL DEFAULT 0,
  refunded_cents  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_one_per_booking ON payments (booking_id) WHERE booking_id IS NOT NULL;

-- Libro contable: cada cobro se reparte en asientos que suman exactamente lo cobrado.
CREATE TYPE ledger_account AS ENUM ('physio_payable', 'platform_revenue', 'iva_payable', 'promotions', 'refund');
CREATE TABLE ledger_entries (
  id            bigserial PRIMARY KEY,
  booking_id    uuid REFERENCES bookings(id),
  physio_id     uuid REFERENCES physios(user_id),
  account       ledger_account NOT NULL,
  amount_cents  integer NOT NULL,
  payout_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_physio_idx ON ledger_entries (physio_id, account) WHERE payout_id IS NULL;

CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  physio_id     uuid NOT NULL REFERENCES physios(user_id),
  amount_cents  integer NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'paid', 'failed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Historia clínica ----------
CREATE TABLE clinical_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL UNIQUE REFERENCES bookings(id),
  patient_id    uuid NOT NULL REFERENCES patients(id),
  physio_id     uuid NOT NULL REFERENCES physios(user_id),
  subjective_enc text,
  objective_enc  text,
  assessment_enc text NOT NULL,
  plan_enc       text NOT NULL,
  pain_before   smallint CHECK (pain_before BETWEEN 0 AND 10),
  pain_after    smallint CHECK (pain_after BETWEEN 0 AND 10),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clinical_notes_patient_idx ON clinical_notes (patient_id, created_at);

CREATE TABLE exercises (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  dose          text NOT NULL,
  instructions  text NOT NULL,
  video_url     text
);

CREATE TABLE exercise_assignments (
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  exercise_code  text NOT NULL REFERENCES exercises(code),
  physio_id      uuid NOT NULL REFERENCES physios(user_id),
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, exercise_code)
);

CREATE TABLE exercise_logs (
  id             bigserial PRIMARY KEY,
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  exercise_code  text NOT NULL REFERENCES exercises(code),
  done_on        date NOT NULL,
  UNIQUE (patient_id, exercise_code, done_on)
);

CREATE TABLE pain_logs (
  id          bigserial PRIMARY KEY,
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  value       smallint NOT NULL CHECK (value BETWEEN 0 AND 10),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Quién abrió cada historia clínica (obligatorio para auditoría).
CREATE TABLE clinical_access_log (
  id          bigserial PRIMARY KEY,
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  actor_id    uuid NOT NULL REFERENCES users(id),
  action      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Reseñas ----------
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  target_id   uuid NOT NULL REFERENCES users(id),
  direction   text NOT NULL CHECK (direction IN ('patient_to_physio', 'physio_to_patient')),
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags        text[] NOT NULL DEFAULT '{}',
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, direction)
);

-- ---------- Soporte, notificaciones y seguridad ----------
CREATE TABLE support_tickets (
  id            bigserial PRIMARY KEY,
  booking_id    uuid REFERENCES bookings(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  reason        text NOT NULL CHECK (reason IN ('no_show', 'late', 'billing', 'conduct', 'other')),
  description   text,
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution    text,
  refund_cents  integer NOT NULL DEFAULT 0,
  resolved_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
ALTER SEQUENCE support_tickets_id_seq RESTART WITH 1041;

CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE sos_alerts (
  id           bigserial PRIMARY KEY,
  booking_id   uuid REFERENCES bookings(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  lat          double precision,
  lng          double precision,
  note         text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Registro general de acciones sensibles (admin, cambios de estado, accesos).
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target      text,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
