// Formatos para Ecuador. Dinero en centavos; hora de Quito (UTC−5 todo el año, sin horario de verano).
const QUITO_OFFSET_MIN = -300;
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const quito = (d: Date | string) => new Date(new Date(d).getTime() + QUITO_OFFSET_MIN * 60000);
const pad = (n: number) => String(n).padStart(2, '0');

export const time = (d: Date | string) => { const q = quito(d); return `${pad(q.getUTCHours())}:${pad(q.getUTCMinutes())}`; };
export const dateLong = (d: Date | string) => { const q = quito(d); return `${DAYS[q.getUTCDay()]} ${q.getUTCDate()} de ${MONTHS[q.getUTCMonth()]}`; };
export const dateTime = (d: Date | string) => `${dateLong(d)}, ${time(d)}`;

// YYYY-MM-DD en hora de Quito, para pedir horarios libres de un día.
export const isoDay = (d: Date) => quito(d).toISOString().slice(0, 10);

// Próximos n días para el selector de fechas.
export function nextDays(n: number, from = new Date()): { iso: string; label: string; day: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(from.getTime() + i * 86400000), q = quito(d);
    return { iso: isoDay(d), label: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : DAYS_SHORT[q.getUTCDay()]!, day: q.getUTCDate() };
  });
}

export const shortName = (full?: string | null) => {
  const [a, b] = (full ?? '').trim().split(/\s+/);
  return b ? `${a} ${b[0]}.` : a ?? '';
};
