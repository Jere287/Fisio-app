import { randomUUID } from 'node:crypto';

// Verificación de identidad (documento + prueba de vida + comparación facial + Registro Civil).
// En producción: Truora, Didit, Incode o un proveedor autorizado con acceso al servicio del Registro Civil.
export interface KycVerifyInput { ref: string; cedula: string; dactilar: string; frontRef: string; backRef: string; selfieRef: string }
export interface KycResult { status: 'approved' | 'review' | 'rejected'; faceScore: number; reason?: string }

export interface KycProvider {
  readonly name: string;
  createSession(userId: string): Promise<{ ref: string; uploadUrls: Record<string, string> }>;
  verify(input: KycVerifyInput): Promise<KycResult>;
  faceMatch(userId: string, selfieRef: string): Promise<{ match: boolean; score: number }>;
}

// Proveedor simulado con reglas fijas para poder probar cada resultado:
// código dactilar que empieza con Z → no coincide con el Registro Civil (rechazo);
// termina en 9999 → coincidencia facial baja (revisión manual); cualquier otro → aprobado.
export class MockKyc implements KycProvider {
  readonly name = 'mock';
  async createSession() {
    const ref = `kyc_${randomUUID()}`;
    return { ref, uploadUrls: { front: `mock://upload/${ref}/front`, back: `mock://upload/${ref}/back`, selfie: `mock://upload/${ref}/selfie` } };
  }
  async verify({ dactilar }: KycVerifyInput): Promise<KycResult> {
    if (dactilar.startsWith('Z')) return { status: 'rejected', faceScore: 95, reason: 'El código dactilar no coincide con el Registro Civil.' };
    if (dactilar.endsWith('9999')) return { status: 'review', faceScore: 78, reason: 'La coincidencia facial quedó por debajo del 85%.' };
    return { status: 'approved', faceScore: 97 };
  }
  async faceMatch(_userId: string, selfieRef: string) {
    return selfieRef.includes('otra-persona') ? { match: false, score: 41 } : { match: true, score: 96 };
  }
}

export function createKycProvider(name: string): KycProvider {
  if (name === 'mock') return new MockKyc();
  throw new Error(`Proveedor de verificación «${name}» aún no está implementado.`);
}
