import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { call, client } from './client';
import type { Booking } from './types';

// Claves de caché centralizadas: así las invalidaciones después de una acción son consistentes.
export const keys = {
  me: ['me'] as const,
  patients: ['patients'] as const,
  search: (p: object) => ['search', p] as const,
  physio: (id: string) => ['physio', id] as const,
  slots: (id: string, date: string, mode: string) => ['slots', id, date, mode] as const,
  bookings: (as: 'patient' | 'physio') => ['bookings', as] as const,
  booking: (id: string) => ['booking', id] as const,
  record: (patientId: string) => ['record', patientId] as const,
  exercises: ['exercises'] as const,
  notifications: ['notifications'] as const,
  earnings: ['earnings'] as const,
  packages: ['packages'] as const,
  physioMe: ['physioMe'] as const,
};

const ACTIVE: Booking['status'][] = ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress'];

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => call(() => client.GET('/v1/me')) });

export const usePatients = () => useQuery({ queryKey: keys.patients, queryFn: () => call(() => client.GET('/v1/patients')) });

export function useSearch(q: { lat: number; lng: number; specialty?: string; women?: boolean }) {
  return useQuery({
    queryKey: keys.search(q),
    queryFn: () => call(() => client.GET('/v1/physios/search', { params: { query: q as never } })),
    placeholderData: keepPreviousData, // al cambiar un filtro, la lista no parpadea
  });
}

export const usePhysio = (id: string) => useQuery({ queryKey: keys.physio(id), queryFn: () => call(() => client.GET('/v1/physios/{id}', { params: { path: { id } } })) });

export const useSlots = (id: string, date: string, mode: 'home' | 'video') => useQuery({
  queryKey: keys.slots(id, date, mode),
  queryFn: () => call(() => client.GET('/v1/physios/{id}/slots', { params: { path: { id }, query: { date, mode } } })),
});

export const useBookings = (as: 'patient' | 'physio') => useQuery({
  queryKey: keys.bookings(as),
  queryFn: () => call(() => client.GET('/v1/bookings', { params: { query: { as } } })),
  refetchInterval: 15000,
});

// Una cita activa se refresca cada 5 s para seguir el estado (aceptada, en camino, llegó…).
export const useBooking = (id: string) => useQuery({
  queryKey: keys.booking(id),
  queryFn: () => call(() => client.GET('/v1/bookings/{id}', { params: { path: { id } } })),
  refetchInterval: q => (q.state.data && ACTIVE.includes(q.state.data.status) ? 5000 : false),
});

export const useRecord = (patientId?: string) => useQuery({
  queryKey: keys.record(patientId ?? ''),
  enabled: !!patientId,
  queryFn: () => call(() => client.GET('/v1/patients/{id}/record', { params: { path: { id: patientId! } } })),
});

export const useExercises = () => useQuery({ queryKey: keys.exercises, queryFn: () => call(() => client.GET('/v1/exercises')), staleTime: 3600000 });
export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: () => call(() => client.GET('/v1/notifications')) });
export const useEarnings = () => useQuery({ queryKey: keys.earnings, queryFn: () => call(() => client.GET('/v1/physios/me/earnings')) });
export const usePhysioMe = () => useQuery({ queryKey: keys.physioMe, queryFn: () => call(() => client.GET('/v1/physios/me')) });
