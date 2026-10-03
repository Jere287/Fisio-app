import { describe, expect, it } from 'vitest';
import { cedulaError, dactilarOk, normalizePhone } from '../src/lib/ecuador.js';
import { quote, split } from '../src/lib/pricing.js';
import { distanceMeters } from '../src/lib/geo.js';
import { FieldCipher } from '../src/lib/crypto.js';
import { fromLocal, localParts } from '../src/lib/time.js';

describe('Ecuador', () => {
  it('valida la cédula con el dígito verificador', () => {
    expect(cedulaError('1710034065')).toBeNull();
    expect(cedulaError('1710034066')).toMatch(/verificador/);
    expect(cedulaError('9910034065')).toMatch(/provincia/);
    expect(cedulaError('123')).toMatch(/10 dígitos/);
  });
  it('valida el código dactilar', () => {
    expect(dactilarOk('V4343V4242')).toBe(true);
    expect(dactilarOk('v4343v4242')).toBe(false);
    expect(dactilarOk('V434V4242')).toBe(false);
  });
  it('normaliza celulares a E.164', () => {
    expect(normalizePhone('099 123 4567')).toBe('+593991234567');
    expect(normalizePhone('+593991234567')).toBe('+593991234567');
    expect(normalizePhone('022456789')).toBeNull();
  });
});

describe('Dinero', () => {
  it('el reparto suma exactamente lo cobrado, con y sin crédito', () => {
    for (const [price, fee, credit] of [[3000, 99, 0], [3000, 99, 500], [2500, 99, 2599], [4000, 0, 0], [1, 99, 0], [12345, 99, 37]] as const) {
      const s = split(price, fee, credit);
      expect(s.physioPayable + s.platformRevenue + s.ivaPayable + s.promotions).toBe(price + fee - credit);
    }
  });
  it('sesión de $30: el fisio recibe $24.82', () => {
    expect(split(3000, 99, 0).physioPayable).toBe(2482);
  });
  it('el crédito nunca deja un total negativo', () => {
    expect(quote(3000, 10000, false)).toEqual({ priceCents: 3000, feeCents: 99, creditCents: 3099, totalCents: 0 });
    expect(quote(3000, 500, true).totalCents).toBe(0);
  });
});

describe('Utilidades', () => {
  it('calcula distancias en metros', () => {
    const d = distanceMeters({ lat: -0.1830, lng: -78.4830 }, { lat: -0.1830, lng: -78.4820 });
    expect(d).toBeGreaterThan(100); expect(d).toBeLessThan(120);
  });
  it('cifra y descifra; detecta manipulación', () => {
    const c = new FieldCipher(Buffer.alloc(32, 1).toString('base64'));
    const e = c.encrypt('Dolor lumbar');
    expect(e).not.toContain('Dolor');
    expect(c.decrypt(e)).toBe('Dolor lumbar');
    const parts = e.split('.'); parts[3] = Buffer.from('otro texto').toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
  });
  it('convierte hora de Quito (UTC−5)', () => {
    const d = fromLocal('2026-10-05', 12 * 60);
    expect(d.toISOString()).toBe('2026-10-05T17:00:00.000Z');
    expect(localParts(d)).toEqual({ weekday: 0, minutes: 720, date: '2026-10-05' });
  });
});
