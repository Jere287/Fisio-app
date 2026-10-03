import type { BookingStatus, Specialty } from '@/api/types';

export const STATUS: Record<BookingStatus, { label: string; tone: 'ok' | 'warn' | 'danger' | 'brand' }> = {
  pending: { label: 'Por confirmar', tone: 'warn' },
  confirmed: { label: 'Confirmada', tone: 'brand' },
  en_route: { label: 'En camino', tone: 'brand' },
  arrived: { label: 'En la puerta', tone: 'warn' },
  in_progress: { label: 'En curso', tone: 'brand' },
  completed: { label: 'Completada', tone: 'ok' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
  rejected: { label: 'No aceptada', tone: 'danger' },
  no_show: { label: 'No llegó', tone: 'danger' },
};
export const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress'];

export const SPECIALTIES: { value: NonNullable<Specialty>; label: string }[] = [
  { value: 'deportiva', label: 'Deportiva' }, { value: 'traumatologica', label: 'Traumatológica' }, { value: 'neurologica', label: 'Neurológica' },
  { value: 'geriatrica', label: 'Geriátrica' }, { value: 'respiratoria', label: 'Respiratoria' }, { value: 'piso_pelvico', label: 'Piso pélvico' },
  { value: 'pediatrica', label: 'Pediátrica' },
];
export const specialtyLabel = (v: string) => SPECIALTIES.find(s => s.value === v)?.label ?? v;

// Señales de alerta: si alguna está presente, la fisioterapia no es lo indicado y se deriva a emergencias o al médico.
export const RED_FLAGS = [
  { value: 'chest_pain_or_breathless', label: 'Dolor en el pecho o falta de aire' },
  { value: 'fever', label: 'Fiebre o escalofríos junto con el dolor' },
  { value: 'sudden_weakness', label: 'Pérdida repentina de fuerza o sensibilidad en un brazo o una pierna' },
  { value: 'incontinence', label: 'Pérdida del control de la orina o las heces' },
  { value: 'major_trauma', label: 'Caída o golpe fuerte reciente con deformidad o hinchazón grande' },
] as const;

export const PAIN = {
  zones: ['Cuello', 'Hombro', 'Espalda alta', 'Espalda baja', 'Codo o muñeca', 'Mano', 'Cadera', 'Rodilla', 'Tobillo o pie', 'Otra zona'],
  since: ['Menos de 1 semana', '1 a 4 semanas', '1 a 3 meses', 'Más de 3 meses'],
  types: ['Punzante', 'Quemante', 'Sordo o constante', 'Hormigueo', 'Calambre', 'Rigidez'],
  worse: ['Caminar', 'Subir gradas', 'Estar sentado', 'Agacharse', 'Dormir', 'Levantar peso'],
};

export function painSummary(pain: Record<string, unknown>, score: number | null): string {
  const list = (k: string) => (Array.isArray(pain[k]) ? (pain[k] as string[]) : []);
  const parts = [list('zones').join(', '), list('types').join(', ').toLowerCase(), typeof pain.since === 'string' ? pain.since.toLowerCase() : '',
    list('worse').length ? `empeora al ${list('worse').map(w => w.toLowerCase()).join(', ')}` : '', score !== null ? `intensidad ${score}/10` : ''];
  return parts.filter(Boolean).join(' · ');
}
