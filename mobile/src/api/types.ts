import type { paths } from './schema';

// Tipos de dominio derivados del contrato OpenAPI: si el backend cambia, TypeScript avisa aquí.
type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;
type Ok<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends { responses: infer R }
  ? Json<R extends { 200: infer X } ? X : R extends { 201: infer Y } ? Y : never> : never;

export type Me = Ok<'/v1/me', 'get'>;
export type Patient = Ok<'/v1/patients', 'get'>[number];
export type PhysioCard = Ok<'/v1/physios/search', 'get'>[number];
export type PhysioProfile = Ok<'/v1/physios/{id}', 'get'>;
export type Slots = Ok<'/v1/physios/{id}/slots', 'get'>;
export type Booking = Ok<'/v1/bookings/{id}', 'get'>;
export type BookingStatus = Booking['status'];
export type ClinicalRecord = Ok<'/v1/patients/{id}/record', 'get'>;
export type Exercise = Ok<'/v1/exercises', 'get'>[number];
export type Notification = Ok<'/v1/notifications', 'get'>[number];
export type PhysioMe = Ok<'/v1/physios/me', 'get'>;
export type Earnings = Ok<'/v1/physios/me/earnings', 'get'>;
export type Specialty = NonNullable<paths['/v1/physios/search']['get']['parameters']['query']>['specialty'];
export type CreateBooking = NonNullable<paths['/v1/bookings']['post']['requestBody']>['content']['application/json'];
