// Reglas de dinero. Todo en centavos enteros para no perder precisión.
export const COMMISSION_RATE = 0.15;     // comisión de la plataforma sobre la sesión
export const IVA_RATE = 0.15;            // IVA sobre la comisión (servicio de intermediación)
export const SERVICE_FEE_CENTS = 99;     // tarifa de servicio al paciente, IVA incluido
export const LATE_CANCEL_HOURS = 12;
export const LATE_CANCEL_RATE = 0.5;
export const NO_SHOW_CREDIT_CENTS = 500;

export interface Quote { priceCents: number; feeCents: number; creditCents: number; totalCents: number }

export function quote(priceCents: number, availableCreditCents: number, usesPackage: boolean): Quote {
  if (usesPackage) return { priceCents, feeCents: 0, creditCents: 0, totalCents: 0 };
  const gross = priceCents + SERVICE_FEE_CENTS;
  const creditCents = Math.min(availableCreditCents, gross);
  return { priceCents, feeCents: SERVICE_FEE_CENTS, creditCents, totalCents: gross - creditCents };
}

export interface Split { physioPayable: number; platformRevenue: number; ivaPayable: number; promotions: number }

// Reparto de un cobro. Invariante: la suma de los asientos es exactamente lo cobrado (precio + tarifa − crédito).
export function split(priceCents: number, feeCents: number, creditCents: number): Split {
  const commission = Math.round(priceCents * COMMISSION_RATE);
  const ivaOnCommission = Math.round(commission * IVA_RATE);
  const ivaInFee = Math.round((feeCents * IVA_RATE) / (1 + IVA_RATE));
  return {
    physioPayable: priceCents - commission - ivaOnCommission,
    platformRevenue: commission + feeCents - ivaInFee,
    ivaPayable: ivaOnCommission + ivaInFee,
    promotions: -creditCents,
  };
}
