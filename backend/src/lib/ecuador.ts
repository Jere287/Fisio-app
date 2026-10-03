// Validación de cédula ecuatoriana: provincia 01–24 o 30, tercer dígito < 6 y dígito verificador módulo 10.
export function cedulaError(c: string): string | null {
  if (!/^\d{10}$/.test(c)) return 'La cédula debe tener 10 dígitos.';
  const prov = Number(c.slice(0, 2));
  if (!((prov >= 1 && prov <= 24) || prov === 30)) return 'Los dos primeros dígitos no corresponden a una provincia.';
  if (Number(c[2]) >= 6) return 'El tercer dígito no corresponde a una persona natural.';
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let p = Number(c[i]) * (i % 2 ? 1 : 2);
    if (p > 9) p -= 9;
    sum += p;
  }
  return (10 - (sum % 10)) % 10 === Number(c[9]) ? null : 'El dígito verificador no coincide.';
}

// Código dactilar del reverso de la cédula: letra, 4 números, letra, 4 números.
export const dactilarOk = (d: string) => /^[A-Z]\d{4}[A-Z]\d{4}$/.test(d);

// Celular ecuatoriano a formato E.164 (+5939XXXXXXXX).
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (/^09\d{8}$/.test(digits)) return `+593${digits.slice(1)}`;
  if (/^5939\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

// Señales de alarma, en dos niveles (triaje):
// - Emergencia: posible infarto, ACV o síndrome de cola de caballo. No se reserva; se indica llamar al 911.
// - Médico primero: posible infección o fractura. Se puede reservar si un médico ya lo evaluó y autorizó fisioterapia.
export const EMERGENCY_FLAGS = ['chest_pain_or_breathless', 'sudden_weakness', 'incontinence'] as const;
export const MEDICAL_FLAGS = ['fever', 'major_trauma'] as const;
export const RED_FLAGS = [...EMERGENCY_FLAGS, ...MEDICAL_FLAGS] as const;
export const isEmergencyFlag = (f: string) => (EMERGENCY_FLAGS as readonly string[]).includes(f);
