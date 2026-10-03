// Datos de ejemplo para desarrollo local: un administrador, fisios aprobados en Quito y una paciente.
// Para entrar: pide el código con el celular indicado; en desarrollo el código aparece en la consola del servidor.
import { loadConfig } from '../config.js';
import { createPool, one } from './pool.js';
import { migrate } from './migrate.js';
import { FieldCipher, hmac } from '../lib/crypto.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const cipher = new FieldCipher(config.DATA_ENCRYPTION_KEY);
await migrate(db);

async function user(phone: string, name: string, role: 'patient' | 'physio' | 'admin', cedula: string) {
  const u = await one<{ id: string }>(db, `INSERT INTO users (phone, full_name, role, kyc_status, cedula_enc, cedula_hash) VALUES ($1, $2, $3, 'approved', $4, $5)
    ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`, [phone, name, role, cipher.encrypt(cedula), hmac(config.HASH_PEPPER, `cedula:${cedula}`)]);
  await db.query(`INSERT INTO patients (owner_user_id, full_name, relationship) VALUES ($1, $2, 'self') ON CONFLICT DO NOTHING`, [u!.id, name]);
  return u!.id;
}

const PHYSIOS: [string, string, string, string[], number, number, number, 'f' | 'm'][] = [
  ['+593990000001', 'Andrea Salazar', '1710034065', ['deportiva', 'traumatologica'], 3000, -0.2050, -78.4880, 'f'],
  ['+593990000002', 'Diego Andrade', '1720935616', ['traumatologica', 'geriatrica'], 2500, -0.1740, -78.4870, 'm'],
  ['+593990000003', 'Valeria Cevallos', '1725849374', ['piso_pelvico'], 4000, -0.2010, -78.4770, 'f'],
  ['+593990000004', 'Jorge Pazmiño', '1716358492', ['neurologica', 'geriatrica'], 2500, -0.2960, -78.5420, 'm'],
];

await user('+593990000000', 'Equipo FisioCerca', 'admin', '0926687856');
for (const [phone, name, cedula, specs, price, lat, lng, gender] of PHYSIOS) {
  const id = await user(phone, name, 'physio', cedula);
  await db.query(`INSERT INTO physios (user_id, status, bio, university, years_experience, specialties, gender, offers_video, price_cents, radius_km, base_lat, base_lng, available, last_selfie_at)
    VALUES ($1, 'approved', 'Perfil de ejemplo', 'PUCE', 5, $2, $3, true, $4, 8, $5, $6, true, now()) ON CONFLICT (user_id) DO NOTHING`, [id, specs, gender, price, lat, lng]);
  for (const kind of ['senescyt', 'msp', 'criminal_record']) {
    await db.query(`INSERT INTO physio_documents (physio_id, kind, title, status) SELECT $1, $2::doc_kind, $2, 'approved' WHERE NOT EXISTS (SELECT 1 FROM physio_documents WHERE physio_id = $1 AND kind = $2::doc_kind)`, [id, kind]);
  }
  for (let d = 0; d < 6; d++) await db.query('INSERT INTO availability (physio_id, weekday, start_min, end_min) VALUES ($1, $2, 480, 1200) ON CONFLICT DO NOTHING', [id, d]);
}
const pid = await user('+593987654321', 'Daniela Paredes', 'patient', '1712345675');
await db.query(`INSERT INTO patients (owner_user_id, full_name, relationship, birth_year, can_consent) SELECT $1, 'Carmen Paredes', 'Abuela', 1942, false
  WHERE NOT EXISTS (SELECT 1 FROM patients WHERE owner_user_id = $1 AND relationship = 'Abuela')`, [pid]);

console.log('Datos de ejemplo listos. Administrador: 0990000000 · Fisio: 0990000001 · Paciente: 0987654321');
await db.end();
