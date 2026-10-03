// Prueba de punta a punta del flujo principal con dos personas a la vez (paciente y fisio).
// Requiere: backend en marcha con datos de ejemplo y SMS_PROVIDER=console (el código se lee de su log),
// y la app exportada para web servida en APP_URL. Ver mobile/README.md.
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.APP_URL ?? 'http://localhost:8099';
const API_LOG = process.env.API_LOG ?? 'api.log';
const OUT = process.env.SHOTS_DIR ?? 'e2e/capturas';
fs.mkdirSync(OUT, { recursive: true });
const HOME = { latitude: -0.2046, longitude: -78.4876 }; // a ~50 m de Andrea Salazar
const T = s => `[data-testid="${s}"]`;
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

function codeFor(phone) {
  const lines = fs.readFileSync(API_LOG, 'utf8').split('\n').filter(l => l.includes(`SMS a ${phone.slice(0, 7)}`));
  return /es (\d{6})/.exec(lines.at(-1))[1];
}
async function login(p, local, intl) {
  await p.goto(URL);
  await p.locator(T('phone-input')).fill(local);
  await p.locator(T('send-code')).click();
  await p.locator(T('code-input')).waitFor();
  await p.waitForTimeout(300);
  await p.locator(T('code-input')).fill(codeFor(intl));
  await p.locator(T('verify-code')).click();
}

(async () => {
  const browser = await chromium.launch();
  const mk = async () => (await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: HOME, permissions: ['geolocation'], locale: 'es-EC' })).newPage();
  const pat = await mk(), fis = await mk();
  for (const p of [pat, fis]) p.on('pageerror', e => console.log('PAGEERROR', e.message));

  // Paciente: entra, busca y reserva
  await login(pat, '0987654321', '+593987654321');
  await pat.locator(T('explore-screen')).waitFor();
  await pat.waitForTimeout(1500);
  await shot(pat, '01-explore');
  await pat.locator('[data-testid^="physio-"]', { hasText: 'Andrea' }).first().click();
  await pat.locator(T('day-2026-10-05')).click();
  await pat.locator('[data-testid^="slot-"]').first().waitFor();
  await pat.locator('[data-testid^="slot-"]').first().click();
  await shot(pat, '02-perfil');
  await pat.locator(T('continue-booking')).click();
  await pat.locator(T('zone-Rodilla')).click();
  await pat.locator(T('comments')).fill('Me duele al subir gradas desde hace dos semanas');
  await pat.locator(T('address')).fill('Av. Amazonas N34-120 y Atahualpa, edificio Torre Azul, piso 3');
  await pat.locator(T('use-location')).click();
  await pat.waitForTimeout(800);
  await shot(pat, '03-reserva');
  await pat.locator(T('confirm-booking')).click();
  await pat.locator(T('booking-screen')).waitFor();
  console.log('Paciente: cita creada →', await pat.locator(T('booking-status')).innerText());
  await shot(pat, '04-cita-pendiente');

  // Fisio: agenda, acepta, sale y llega
  await login(fis, '0990000001', '+593990000001');
  await fis.locator(T('agenda-screen')).waitFor();
  await fis.waitForTimeout(1000);
  await shot(fis, '05-agenda');
  await fis.locator('[data-testid^="booking-"]', { hasText: 'Por confirmar' }).first().click();
  await fis.locator(T('accept')).click();
  await fis.locator(T('depart')).click();
  await fis.locator(T('arrive')).click();
  await fis.locator(T('pin-input')).waitFor();
  console.log('Fisio: estado →', await fis.locator(T('booking-status')).innerText());

  // Paciente: confirma el rostro en la puerta y firma el consentimiento
  await pat.locator(T('door-yes')).waitFor({ timeout: 15000 });
  await shot(pat, '06-puerta');
  await pat.locator(T('door-yes')).click();
  // El consentimiento se firma una vez por paciente y especialista; en una segunda cita ya no se pide.
  await pat.waitForTimeout(1000);
  if (await pat.locator(T('consent-card')).count()) {
    const pad = await pat.locator(T('signature-pad')).boundingBox();
    await pat.mouse.move(pad.x + 30, pad.y + 70); await pat.mouse.down();
    for (let i = 1; i <= 12; i++) await pat.mouse.move(pad.x + 30 + i * 22, pad.y + 70 + Math.sin(i) * 25);
    await pat.mouse.up();
    await shot(pat, '07-consentimiento');
    await pat.locator(T('sign-consent')).click();
    await pat.locator(T('consent-card')).waitFor({ state: 'detached' });
    console.log('Paciente: firmó el consentimiento');
  }
  const pin = (await pat.locator(T('booking-pin')).innerText()).trim();
  console.log('Paciente: PIN', pin);
  await shot(pat, '08-pin');

  // Fisio: PIN incorrecto, luego el correcto; nota SOAP y cierre
  await fis.locator(T('pin-input')).fill(pin === '0000' ? '1111' : '0000');
  await fis.locator(T('start')).click();
  await fis.locator(T('action-error')).waitFor();
  console.log('Fisio: PIN incorrecto →', await fis.locator(T('action-error')).innerText());
  await fis.locator(T('pin-input')).fill(pin);
  await fis.locator(T('start')).click();
  await fis.locator(T('complete-form')).waitFor({ timeout: 15000 });
  await fis.locator(T('assessment')).fill('Síndrome patelofemoral derecho, leve.');
  await fis.locator(T('plan')).fill('Fortalecimiento de cuádriceps 2 semanas; reevaluar.');
  await fis.locator(T('pain-before-6')).click();
  await fis.locator(T('pain-after-3')).click();
  await fis.locator('[data-testid^="ex-"]').first().click();
  await shot(fis, '09-nota');
  await fis.locator(T('complete')).click();
  await fis.locator(T('review-card')).waitFor();
  console.log('Fisio: sesión →', await fis.locator(T('booking-status')).innerText());

  // Paciente: califica; fisio: ve sus ganancias
  await pat.locator(T('review-card')).waitFor({ timeout: 15000 });
  await pat.locator(T('star-5')).click();
  await pat.locator(T('send-review')).click();
  await pat.locator(T('review-done')).waitFor();
  await pat.reload(); await pat.locator(T('review-done')).waitFor();
  console.log('Paciente: calificó (persistente tras recargar)');
  await shot(pat, '10-calificada');
  await fis.goto(`${URL}/earnings`);
  await fis.locator(T('pending-earnings')).waitFor();
  console.log('Fisio: por cobrar', await fis.locator(T('pending-earnings')).innerText());
  await shot(fis, '11-ganancias');
  await fis.goto(`${URL}/profile`); await fis.waitForTimeout(1500); await shot(fis, '12-perfil-fisio');
  await browser.close();
})().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
