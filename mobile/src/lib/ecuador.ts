// Mismas reglas que valida el backend (backend/src/lib/ecuador.ts). Se validan aquí para avisar mientras la persona escribe.
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
  return (10 - (sum % 10)) % 10 === Number(c[9]) ? null : 'El dígito verificador no coincide. Revisa el número.';
}

export const dactilarOk = (d: string) => /^[A-Z]\d{4}[A-Z]\d{4}$/.test(d);
export const phoneOk = (p: string) => /^09\d{8}$/.test(p.replace(/\D/g, ''));
