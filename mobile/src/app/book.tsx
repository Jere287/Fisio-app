import { useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { call, client, newIdempotencyKey } from '@/api/client';
import { keys, useMe, usePatients, usePhysio } from '@/api/queries';
import type { CreateBooking } from '@/api/types';
import { dateTime, money } from '@/lib/format';
import { EMPTY_TRIAGE, PAIN, triageOutcome, type Triage } from '@/lib/labels';
import { TriageCard } from '@/features/TriageCard';
import { addressFrom, currentCoords, QUITO_DEFAULT, type Coords } from '@/lib/useLocation';
import { PlaceMap } from '@/ui/map';
import { Button, Card, Chip, ErrorState, Field, Loading, Notice, Row, Screen, Stack, Text } from '@/ui';

const SERVICE_FEE = 99;

export default function Book() {
  const { physioId, scheduledAt, mode } = useLocalSearchParams<{ physioId: string; scheduledAt: string; mode: 'home' | 'video' }>();
  const qc = useQueryClient();
  const physio = usePhysio(physioId);
  const patients = usePatients();
  const me = useMe();
  const idemKey = useRef(newIdempotencyKey()); // la misma clave en cada reintento: nunca se reserva dos veces

  const [patientId, setPatientId] = useState<string | undefined>();
  const [companion, setCompanion] = useState<'booker' | 'other' | 'none'>('booker');
  const [triage, setTriage] = useState<Triage>(EMPTY_TRIAGE);
  const [pain, setPain] = useState({ zones: [] as string[], since: undefined as string | undefined, types: [] as string[], worse: [] as string[], history: '' });
  const [painScore, setPainScore] = useState<number | undefined>();
  const [comments, setComments] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);

  const selectedId = patientId ?? patients.data?.[0]?.id;
  const patient = patients.data?.find(p => p.id === selectedId);
  const isThird = patient && patient.relationship !== 'self';
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const price = mode === 'video' ? physio.data?.video_price_cents ?? 0 : physio.data?.price_cents ?? 0;
  const credit = Math.min(me.data?.user.credit_cents ?? 0, price + SERVICE_FEE);
  const total = price + SERVICE_FEE - credit;

  const ready = useMemo(() => triageOutcome(triage) === 'clear' && (pain.zones.length > 0 || comments.trim().length > 4) && (mode === 'video' || (address.trim().length >= 5 && coords)), [triage, pain.zones, comments, mode, address, coords]);

  const create = useMutation({
    mutationFn: () => {
      const body: CreateBooking = {
        physioId, patientId: selectedId!, mode, scheduledAt, redFlags: triage.flags, medicalClearance: triage.clearance, painScore, comments: comments || undefined,
        pain: { zones: pain.zones, since: pain.since, types: pain.types, worse: pain.worse, history: pain.history || undefined },
        ...(isThird ? { companion } : {}),
        ...(mode === 'home' ? { address, lat: coords!.lat, lng: coords!.lng } : {}),
      };
      return call(() => client.POST('/v1/bookings', { body, headers: { 'idempotency-key': idemKey.current } }));
    },
    onSuccess: async b => {
      await qc.invalidateQueries({ queryKey: keys.bookings('patient') });
      router.replace(`/booking/${b.id}`);
    },
  });

  const [gpsCenter, setGpsCenter] = useState<Coords>(QUITO_DEFAULT);
  const locate = async () => {
    setLocating(true);
    const c = (await currentCoords()) ?? QUITO_DEFAULT;
    setCoords(c);
    setGpsCenter(c);
    setLocating(false);
    if (!address.trim()) {
      const a = await addressFrom(c);
      if (a) setAddress(a);
    }
  };

  if (physio.isPending || patients.isPending) return <Screen><Loading /></Screen>;
  if (physio.isError) return <Screen><ErrorState error={physio.error} /></Screen>;

  return (
    <Screen testID="book-screen">
      <Text variant="h2">{physio.data.full_name}</Text>
      <Text muted>{dateTime(scheduledAt)} · {mode === 'video' ? 'Videollamada de 30 min' : 'A domicilio, 60 min'}</Text>

      {patients.data && patients.data.length > 1 ? (
        <Stack>
          <Text variant="label">¿Para quién es la sesión?</Text>
          <Row>{patients.data.map(p => <Chip key={p.id} testID={`for-${p.relationship}`} label={p.relationship === 'self' ? 'Para mí' : `${p.full_name.split(' ')[0]} · ${p.relationship}`} selected={p.id === selectedId} onPress={() => setPatientId(p.id)} />)}</Row>
          {isThird ? (
            <Card tone="brand">
              <Text variant="label">¿Quién estará en casa durante la sesión?</Text>
              <Row>
                <Chip label="Yo estaré presente" selected={companion === 'booker'} onPress={() => setCompanion('booker')} />
                <Chip label="Otro familiar o cuidador" selected={companion === 'other'} onPress={() => setCompanion('other')} />
                <Chip label="Nadie más" selected={companion === 'none'} onPress={() => setCompanion('none')} />
              </Row>
              <Text variant="tiny" muted>Tú recibes las notificaciones y el PIN. Para personas de 75 años o más, menores o quien no puede firmar, un adulto responsable debe estar presente.</Text>
            </Card>
          ) : null}
        </Stack>
      ) : null}

      <Card>
        <Text variant="h2">Cuéntanos del dolor</Text>
        <Text variant="label">¿Dónde duele?</Text>
        <Row>{PAIN.zones.map(z => <Chip key={z} testID={`zone-${z}`} label={z} selected={pain.zones.includes(z)} onPress={() => setPain(p => ({ ...p, zones: toggle(p.zones, z) }))} />)}</Row>
        <Text variant="label">¿Desde cuándo?</Text>
        <Row>{PAIN.since.map(s => <Chip key={s} label={s} selected={pain.since === s} onPress={() => setPain(p => ({ ...p, since: p.since === s ? undefined : s }))} />)}</Row>
        <Text variant="label">¿Cómo es el dolor?</Text>
        <Row>{PAIN.types.map(t => <Chip key={t} label={t} selected={pain.types.includes(t)} onPress={() => setPain(p => ({ ...p, types: toggle(p.types, t) }))} />)}</Row>
        <Text variant="label">¿Qué lo empeora?</Text>
        <Row>{PAIN.worse.map(w => <Chip key={w} label={w} selected={pain.worse.includes(w)} onPress={() => setPain(p => ({ ...p, worse: toggle(p.worse, w) }))} />)}</Row>
        <Text variant="label">¿Qué tan fuerte es ahora? (0 a 10)</Text>
        <Row gap={4}>{Array.from({ length: 11 }, (_, v) => <Chip key={v} label={String(v)} selected={painScore === v} onPress={() => setPainScore(v)} />)}</Row>
        <Field label="Comentarios para el fisio" testID="comments" multiline value={comments} onChangeText={setComments} placeholder="Cómo empezó, a qué hora duele más, qué has probado…" />
        <Field label="Cirugías, enfermedades o medicamentos (opcional)" value={pain.history} onChangeText={v => setPain(p => ({ ...p, history: v }))} />
      </Card>

      <TriageCard value={triage} onChange={setTriage} />

      {mode === 'home' ? (
        <Card>
          <Field label="Dirección de la visita" testID="address" value={address} onChangeText={setAddress} placeholder="Calle, número, edificio, piso" hint="Solo el especialista que acepte verá la dirección exacta." />
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label">{coords ? 'Punto de tu puerta' : '¿Dónde es la visita?'}</Text>
            <Button small kind="ghost" testID="use-location" title={coords ? 'Volver a mi ubicación' : 'Usar mi ubicación'} loading={locating} onPress={() => { locate().catch(() => {}); }} />
          </Row>
          <PlaceMap testID="book-map" center={gpsCenter} spanKm={0.8} pin={coords} onPinChange={setCoords} height={230} />
          <Text variant="tiny" muted>{coords ? 'Toca el mapa o arrastra el punto hasta tu entrada. El fisio solo podrá marcar «Llegué» a menos de 150 m de aquí.' : 'Toca el mapa donde está tu entrada o usa tu ubicación.'}</Text>
        </Card>
      ) : null}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}><Text>Sesión</Text><Text>{money(price)}</Text></Row>
        <Row style={{ justifyContent: 'space-between' }}><Text>Tarifa de servicio</Text><Text>{money(SERVICE_FEE)}</Text></Row>
        {credit ? <Row style={{ justifyContent: 'space-between' }}><Text color="ok">Crédito FisioCerca</Text><Text color="ok">−{money(credit)}</Text></Row> : null}
        <Row style={{ justifyContent: 'space-between' }}><Text variant="label">Total</Text><Text variant="label">{money(total)}</Text></Row>
        <Text variant="tiny" muted>Solo retenemos el valor; se cobra al terminar la sesión. Cancelación gratis hasta 12 horas antes. Si tu fisio no llega, te devolvemos el 100%.</Text>
        <Button small kind="line" title="Ver garantías" onPress={() => router.push('/help')} />
      </Card>

      <Button testID="confirm-booking" title={`Solicitar a ${physio.data.full_name?.split(' ')[0] ?? 'el especialista'}`} disabled={!ready} loading={create.isPending} onPress={() => create.mutate()} />
      {create.error ? <Notice tone="danger" testID="booking-error">{(create.error as Error).message}</Notice> : null}
    </Screen>
  );
}
