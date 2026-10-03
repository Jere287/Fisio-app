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

// Señales de alarma con triaje en dos niveles (igual que el backend):
// - emergency: posible infarto, ACV o compresión de la médula. No se reserva: 911 o emergencias.
// - medical: posible infección o fractura. Se reserva solo si un médico ya lo evaluó y autorizó fisioterapia.
// Las frases son concretas y con tiempo («ahora», «de repente», «en los últimos días») para que una
// secuela antigua, como la debilidad después de un ACV ya tratado, no se confunda con una emergencia.
export const RED_FLAGS = [
  { value: 'chest_pain_or_breathless', tier: 'emergency', label: 'Dolor en el pecho o falta de aire ahora mismo' },
  { value: 'sudden_weakness', tier: 'emergency', label: 'Debilidad, adormecimiento o cara caída que empezó de repente', hint: 'Si es una secuela ya diagnosticada (por ejemplo, de un ACV), no la marques.' },
  { value: 'incontinence', tier: 'emergency', label: 'Perdiste el control de la orina o las heces desde que empezó el dolor de espalda' },
  { value: 'fever', tier: 'medical', label: 'Fiebre o escalofríos junto con el dolor' },
  { value: 'major_trauma', tier: 'medical', label: 'Caída o golpe fuerte en los últimos días, con deformidad, mucha hinchazón o sin poder apoyar' },
] as const;
export type RedFlag = (typeof RED_FLAGS)[number]['value'];
export const flagLabel = (v: string) => RED_FLAGS.find(f => f.value === v)?.label ?? v;

export type Triage = { answer: 'no' | 'yes' | null; flags: RedFlag[]; clearance: boolean };
export const EMPTY_TRIAGE: Triage = { answer: null, flags: [], clearance: false };
// Resultado del triaje: si se puede reservar y por qué no.
export function triageOutcome(t: Triage): 'unanswered' | 'clear' | 'emergency' | 'needs_clearance' {
  if (t.answer === null || (t.answer === 'yes' && t.flags.length === 0)) return 'unanswered';
  if (t.answer === 'no') return 'clear';
  if (t.flags.some(f => RED_FLAGS.find(x => x.value === f)?.tier === 'emergency')) return 'emergency';
  return t.clearance ? 'clear' : 'needs_clearance';
}

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
