// Envío de SMS. En producción se conecta a un proveedor local (Claro/Movistar vía agregador) o Twilio.
export interface SmsProvider {
  send(phone: string, text: string): Promise<void>;
}

// Proveedor de desarrollo: escribe el mensaje en el log y lo guarda en memoria para las pruebas.
export class ConsoleSms implements SmsProvider {
  outbox: { phone: string; text: string }[] = [];
  constructor(private log: (msg: string) => void = () => {}) {}
  async send(phone: string, text: string) {
    this.outbox.push({ phone, text });
    this.log(`[SMS a ${phone.slice(0, 7)}•••] ${text}`);
  }
  lastCodeFor(phone: string): string | undefined {
    const m = [...this.outbox].reverse().find(x => x.phone === phone);
    return m?.text.match(/\b(\d{6})\b/)?.[1];
  }
}
