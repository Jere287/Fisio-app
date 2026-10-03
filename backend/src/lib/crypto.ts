import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Cifrado de campos sensibles (historia clínica, dirección, cédula) con AES-256-GCM.
// Formato guardado: v1.<iv>.<tag>.<datos> en base64url. La versión permite rotar llaves.
export class FieldCipher {
  private key: Buffer;
  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('La llave de cifrado debe tener 32 bytes');
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }
  decrypt(payload: string): string {
    const [v, iv, tag, data] = payload.split('.');
    if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Formato cifrado desconocido');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  }
  encryptOpt(v: string | null | undefined) { return v ? this.encrypt(v) : null; }
  decryptOpt(v: string | null | undefined) { return v ? this.decrypt(v) : null; }
}

// HMAC con pepper: para códigos OTP, tokens y búsquedas por cédula sin guardarla en claro.
export const hmac = (pepper: string, value: string) => createHmac('sha256', pepper).update(value).digest('hex');
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join('');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
