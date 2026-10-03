import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';

// Pasarela de pagos. Flujo: autorizar (retener) al reservar, capturar al terminar, anular si se cancela,
// devolver si hay un reclamo. Las tarjetas las guarda la pasarela (tokenizadas), nunca nosotros.
export interface PaymentProvider {
  readonly name: string;
  authorize(amountCents: number, reference: string): Promise<{ ref: string }>;
  capture(ref: string, amountCents: number): Promise<void>;
  void(ref: string): Promise<void>;
  refund(ref: string, amountCents: number): Promise<void>;
  charge(amountCents: number, reference: string): Promise<{ ref: string }>;
}

type MockTx = { amount: number; captured: number; refunded: number; status: 'authorized' | 'captured' | 'voided' };

// Pasarela simulada para desarrollo y pruebas. Rechaza montos terminados en 13 centavos para probar errores.
export class MockPayments implements PaymentProvider {
  readonly name = 'mock';
  txs = new Map<string, MockTx>();
  private decline(amount: number) {
    if (amount % 100 === 13) throw new AppError(402, 'payment_declined', 'La tarjeta fue rechazada. Prueba con otro medio de pago.');
  }
  async authorize(amountCents: number) {
    this.decline(amountCents);
    const ref = `mock_${randomUUID()}`;
    this.txs.set(ref, { amount: amountCents, captured: 0, refunded: 0, status: 'authorized' });
    return { ref };
  }
  async capture(ref: string, amountCents: number) {
    const t = this.txs.get(ref);
    if (!t || t.status !== 'authorized') throw new Error(`No se puede capturar ${ref}`);
    if (amountCents > t.amount) throw new Error('Captura mayor a lo autorizado');
    t.captured = amountCents; t.status = 'captured';
  }
  async void(ref: string) {
    const t = this.txs.get(ref);
    if (!t || t.status !== 'authorized') throw new Error(`No se puede anular ${ref}`);
    t.status = 'voided';
  }
  async refund(ref: string, amountCents: number) {
    const t = this.txs.get(ref);
    if (!t || t.status !== 'captured' || t.refunded + amountCents > t.captured) throw new Error(`Devolución inválida en ${ref}`);
    t.refunded += amountCents;
  }
  async charge(amountCents: number) {
    const { ref } = await this.authorize(amountCents);
    await this.capture(ref, amountCents);
    return { ref };
  }
}

export function createPaymentProvider(name: string): PaymentProvider {
  if (name === 'mock') return new MockPayments();
  // El adaptador de Payphone/Kushki se implementa con sus credenciales de comercio (ver docs/backend.md).
  throw new Error(`Proveedor de pagos «${name}» aún no está implementado.`);
}
