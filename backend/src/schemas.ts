import { z } from 'zod';

// Esquemas de respuesta. Cumplen dos funciones:
// 1. Completan el contrato OpenAPI, del que la app móvil genera sus tipos.
// 2. Filtran la salida: un campo que no esté aquí nunca llega al cliente, aunque la consulta lo traiga.

// Fechas: en el código son Date; en el JSON salen como texto ISO 8601.
export const isoDate = z.codec(z.iso.datetime(), z.date(), { decode: s => new Date(s), encode: d => d.toISOString() });

export const Ok = z.looseObject({ ok: z.boolean() });

export const Tokens = z.object({ accessToken: z.string(), refreshToken: z.string() });
export const Session = Tokens.extend({ user: z.object({ id: z.uuid(), role: z.enum(['patient', 'physio', 'admin']) }), isNew: z.boolean() });

export const KycStatus = z.enum(['none', 'pending', 'approved', 'review', 'rejected', 'pending_agent']);
export const Me = z.object({
  user: z.object({
    id: z.uuid(), phone: z.string(), role: z.enum(['patient', 'physio', 'admin']), full_name: z.string().nullable(), email: z.string().nullable(),
    kyc_status: KycStatus, credit_cents: z.number(), created_at: isoDate,
  }),
  consents: z.array(z.object({ kind: z.string(), version: z.string(), granted_at: isoDate })),
  physio: z.object({ status: z.enum(['applied', 'approved', 'rejected', 'suspended']), available: z.boolean() }).nullable(),
});

export const Patient = z.object({ id: z.uuid(), full_name: z.string(), relationship: z.string(), birth_year: z.number().nullable(), can_consent: z.boolean() });

export const PhysioCard = z.object({
  id: z.uuid(), full_name: z.string().nullable(), specialties: z.array(z.string()), price_cents: z.number(), video_price_cents: z.number(),
  offers_video: z.boolean(), gender: z.string().nullable(), women_only: z.boolean(), years_experience: z.number(), available: z.boolean(),
  radius_km: z.number(), approx_lat: z.number(), approx_lng: z.number(), distanceKm: z.number(), rating: z.number().nullable(), ratingCount: z.number(),
});

export const PhysioProfile = z.object({
  id: z.uuid(), full_name: z.string().nullable(), bio: z.string().nullable(), university: z.string().nullable(), years_experience: z.number(),
  specialties: z.array(z.string()), gender: z.string().nullable(), women_only: z.boolean(), offers_video: z.boolean(),
  price_cents: z.number(), video_price_cents: z.number(), radius_km: z.number(), rating: z.number().nullable(), ratingCount: z.number(),
  certificates: z.array(z.object({ kind: z.string(), title: z.string() })),
  reviews: z.array(z.object({ stars: z.number(), tags: z.array(z.string()), comment: z.string().nullable(), created_at: isoDate, author: z.string() })),
});

// Perfil propio del fisio: incluye su estado, documentos y horario, pero no los acumulados internos de calificación.
export const PhysioMe = z.object({
  status: z.enum(['applied', 'approved', 'rejected', 'suspended']), available: z.boolean(), lastSelfieAt: isoDate.nullable(),
  bio: z.string().nullable(), university: z.string().nullable(), years_experience: z.number(), specialties: z.array(z.string()),
  gender: z.string().nullable(), women_only: z.boolean(), offers_video: z.boolean(), price_cents: z.number(), video_price_cents: z.number(),
  radius_km: z.number(), rating: z.number().nullable(), ratingCount: z.number(),
  documents: z.array(z.object({ id: z.uuid(), kind: z.enum(['senescyt', 'msp', 'criminal_record', 'certificate']), title: z.string(), reference: z.string().nullable(), status: z.string(), expires_at: z.string().nullable() })),
  availability: z.array(z.object({ weekday: z.number(), start_min: z.number(), end_min: z.number() })),
});

export const Slots = z.object({ date: z.string(), mode: z.enum(['home', 'video']), durationMin: z.number(), slots: z.array(z.string()) });

export const BookingStatus = z.enum(['pending', 'confirmed', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'rejected', 'no_show']);
// Una sola forma para las dos partes; los campos privados de cada una son opcionales (el paciente ve su PIN, el fisio no).
export const Booking = z.object({
  id: z.uuid(), mode: z.enum(['home', 'video']), status: BookingStatus, scheduledAt: isoDate, durationMin: z.number(),
  pain: z.record(z.string(), z.unknown()), painScore: z.number().nullable(), comments: z.string().nullable(),
  priceCents: z.number(), feeCents: z.number(), creditCents: z.number(), totalCents: z.number(), usesPackage: z.boolean(),
  consentSigned: z.boolean(), doorConfirmed: z.boolean(), reviewed: z.boolean(),
  redFlags: z.array(z.string()), medicalClearance: z.boolean(),
  patient: z.object({ name: z.string().optional(), relationship: z.string().optional(), age: z.number().nullable(), canConsent: z.boolean().optional() }),
  companion: z.string().nullable(), companionName: z.string().nullable(),
  address: z.string().nullable(), lat: z.number().nullable(), lng: z.number().nullable(),
  physio: z.object({ id: z.uuid(), name: z.string().nullable().optional() }).optional(),
  pin: z.string().nullable().optional(),
  physioLocation: z.object({ lat: z.number().nullable(), lng: z.number().nullable(), at: isoDate.nullable() }).nullable().optional(),
  bookedBy: z.object({ name: z.string(), verified: z.boolean() }).optional(),
});

export const Exercise = z.object({ code: z.string(), name: z.string(), dose: z.string(), instructions: z.string(), video_url: z.string().nullable() });

export const ClinicalRecord = z.object({
  patient: z.object({ id: z.uuid(), name: z.string(), relationship: z.string(), birthYear: z.number().nullable() }),
  notes: z.array(z.object({
    id: z.uuid(), date: isoDate, physio: z.string().nullable(), painBefore: z.number().nullable(), painAfter: z.number().nullable(),
    subjective: z.string().nullable(), objective: z.string().nullable(), assessment: z.string(), plan: z.string(),
  })),
  exercises: z.array(Exercise),
  painLogs: z.array(z.object({ value: z.number(), created_at: isoDate })),
  adherence: z.object({ daysCompleteLast7: z.number(), percent: z.number() }),
});

export const Notification = z.object({ id: z.number(), body: z.string(), data: z.record(z.string(), z.unknown()), read_at: isoDate.nullable(), created_at: isoDate });

export const Earnings = z.object({
  pendingCents: z.number(),
  payouts: z.array(z.object({ id: z.uuid(), amount_cents: z.number(), status: z.string(), created_at: isoDate })),
  sessions: z.array(z.object({ id: z.uuid(), scheduled_at: isoDate, price_cents: z.number(), net_cents: z.number().nullable() })),
});

export const Package = z.object({ id: z.uuid(), physio_id: z.uuid(), sessions_total: z.number(), sessions_left: z.number(), price_cents: z.number(), expires_at: isoDate });
