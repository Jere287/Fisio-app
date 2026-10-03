// Ecuador continental usa UTC−5 todo el año (sin horario de verano).
export const EC_OFFSET_MIN = -300;

// Día de la semana (0 = lunes) y minutos desde medianoche en hora de Quito.
export function localParts(d: Date): { weekday: number; minutes: number; date: string } {
  const local = new Date(d.getTime() + EC_OFFSET_MIN * 60000);
  return {
    weekday: (local.getUTCDay() + 6) % 7,
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    date: local.toISOString().slice(0, 10),
  };
}

// Convierte una fecha local (YYYY-MM-DD) y minutos del día a un instante UTC.
export function fromLocal(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 0, 0) + (minutes - EC_OFFSET_MIN) * 60000);
}
