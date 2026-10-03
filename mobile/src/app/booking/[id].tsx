import { useState } from 'react';
import { Alert, Linking } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, call, client } from '@/api/client';
import { keys, useBooking, useExercises } from '@/api/queries';
import type { Booking } from '@/api/types';
import { currentCoords } from '@/lib/useLocation';
import { useShareLocation } from '@/lib/useShareLocation';
import { useSafetyRecorder } from '@/lib/useSafetyRecorder';
import { distanceM, etaMinutes, formatDistance, googleMapsUrl, midpoint, wazeUrl, type LatLng } from '@/lib/geo';
import { PlaceMap } from '@/ui/map';
import { useConfirm } from '@/ui/Confirm';
import { useNow } from '@/lib/useNow';
import { dateTime, money, time } from '@/lib/format';
import { STATUS, ACTIVE_STATUSES, flagLabel, painSummary } from '@/lib/labels';
import { SignaturePad } from '@/ui/SignaturePad';
import { Badge, Button, Card, Chip, ErrorState, Field, Loading, Notice, Row, Screen, Stack, Text } from '@/ui';

const NO_SHOW_GRACE_MS = 20 * 60000;
const LATE_CANCEL_MS = 12 * 3600000;
const ARRIVAL_RADIUS_M = 150;
const open = (url: string) => { Linking.openURL(url).catch(() => {}); };

// Detalle de una cita. La misma pantalla sirve a las dos partes: el fisio recibe `bookedBy`, el paciente no.
export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useBooking(id);
  if (q.isPending) return <Screen><Loading /></Screen>;
  if (q.isError) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const b = q.data;
  const asPhysio = b.bookedBy !== undefined;
  return (
    <Screen testID="booking-screen">
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="title">{asPhysio ? b.patient.name ?? 'Paciente' : b.physio?.name ?? 'Tu cita'}</Text>
        <Badge testID="booking-status" label={STATUS[b.status].label} tone={STATUS[b.status].tone} />
      </Row>
      <Summary b={b} asPhysio={asPhysio} />
      {b.mode === 'home' ? <SafetyRecorder b={b} me={asPhysio ? 'physio' : 'patient'} /> : null}
      {asPhysio ? <PhysioActions b={b} /> : <PatientActions b={b} />}
      {ACTIVE_STATUSES.includes(b.status) && b.status !== 'pending' ? <Sos b={b} /> : null}
    </Screen>
  );
}

function Summary({ b, asPhysio }: { b: Booking; asPhysio: boolean }) {
  const pain = painSummary(b.pain, b.painScore);
  return (
    <Card>
      <Text variant="label">{dateTime(b.scheduledAt)} · {b.durationMin} min</Text>
      <Text variant="small" muted>{b.mode === 'video' ? 'Videollamada' : b.address}</Text>
      {b.patient.relationship && b.patient.relationship !== 'self' ? <Text variant="small">Para {b.patient.name} ({b.patient.relationship}{b.patient.age ? `, ${b.patient.age} años` : ''})</Text> : null}
      {b.companionName ? <Text variant="small">Acompañante: {b.companionName}</Text> : null}
      {pain ? <Text variant="small">Dolor: {pain}</Text> : null}
      {b.comments ? <Text variant="small" muted>«{b.comments}»</Text> : null}
      {b.redFlags.length ? (
        <Notice tone="warn" testID="booking-red-flags">{`Señales reportadas: ${b.redFlags.map(flagLabel).join('; ').toLowerCase()}.${b.medicalClearance ? ' El paciente indica que un médico ya lo evaluó y le indicó fisioterapia.' : ''}`}</Notice>
      ) : null}
      {asPhysio && b.bookedBy ? <Text variant="tiny" muted>Reservó {b.bookedBy.name}{b.bookedBy.verified ? ' · identidad verificada' : ''}</Text> : null}
      {!asPhysio ? <Text variant="small">{b.usesPackage ? 'Sesión de tu paquete' : `Total ${money(b.totalCents)}${b.creditCents ? ` (crédito ${money(b.creditCents)})` : ''}`}</Text> : null}
    </Card>
  );
}

// Envoltura común de las acciones: refresca la cita y la lista, y muestra el error del servidor tal cual.
function useAction<T>(b: Booking, fn: (vars: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: keys.booking(b.id) }), qc.invalidateQueries({ queryKey: ['bookings'] }), qc.invalidateQueries({ queryKey: keys.me })]);
    },
  });
}
const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : null);
const path = (b: Booking) => ({ params: { path: { id: b.id } } });

// ---------------- Paciente ----------------
function PatientActions({ b }: { b: Booking }) {
  const cancel = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/cancel', { ...path(b), body: {} })));
  const noShow = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/no-show', path(b))));
  const door = useAction(b, (matches: boolean) => call(() => client.POST('/v1/bookings/{id}/door', { ...path(b), body: { matches } })));
  const now = useNow();
  const [dialog, confirm] = useConfirm();
  const late = now > new Date(b.scheduledAt).getTime() + NO_SHOW_GRACE_MS;
  const lateFee = b.status !== 'pending' && new Date(b.scheduledAt).getTime() - now < LATE_CANCEL_MS && !b.usesPackage ? Math.round(b.priceCents * 0.5) : 0;
  const err = errMsg(cancel.error ?? noShow.error ?? door.error);

  const askCancel = async () => {
    const ok = await confirm({
      title: '¿Cancelar la cita?', confirm: 'Sí, cancelar', cancel: 'No, mantenerla', danger: true,
      message: lateFee ? `Faltan menos de 12 horas: se cobrará el 50 % de la sesión (${money(lateFee)}) y se libera el resto.` : 'Es gratis: liberamos de inmediato el valor retenido en tu tarjeta.',
    });
    if (ok) cancel.mutate(undefined);
  };
  const askDoorMismatch = async () => {
    const ok = await confirm({
      title: 'No abras la puerta', confirm: 'No coincide, avisar a seguridad', cancel: 'Volver', danger: true,
      message: 'Cancelaremos la cita sin costo, suspenderemos al especialista mientras investigamos y nuestro equipo de seguridad te llamará. Si te sientes en peligro, llama al 911.',
    });
    if (ok) door.mutate(false);
  };

  return (
    <Stack gap={12}>
      {dialog}
      {err ? <Notice tone="danger">{err}</Notice> : null}
      {b.status === 'pending' ? <Notice>Esperando que el especialista acepte. Si no responde en 30 minutos, liberamos el cobro retenido.</Notice> : null}
      {['confirmed', 'en_route'].includes(b.status) && b.mode === 'home' && b.lat !== null && b.lng !== null ? <Tracking b={b} home={{ lat: b.lat, lng: b.lng }} /> : null}

      {b.status === 'arrived' && !b.doorConfirmed ? (
        <Card tone="warn">
          <Text variant="h2">¿Es la persona del perfil?</Text>
          <Text variant="small" muted>Compara su rostro con la foto de {b.physio?.name}. Si no coincide, no abras: cancelamos la cita y avisamos a seguridad.</Text>
          <Row>
            <Button flex testID="door-yes" title="Sí, es la persona" loading={door.isPending} onPress={() => door.mutate(true)} />
            <Button flex testID="door-no" kind="danger" title="No coincide" disabled={door.isPending} onPress={() => { askDoorMismatch().catch(() => {}); }} />
          </Row>
        </Card>
      ) : null}

      {['confirmed', 'en_route', 'arrived'].includes(b.status) && !b.consentSigned ? <Consent b={b} /> : null}

      {b.mode === 'home' && b.pin && ['confirmed', 'en_route', 'arrived'].includes(b.status) ? (
        <Card tone="brand">
          <Text variant="small" muted>Código para iniciar la sesión. Dáselo solo en persona, cuando ya confirmaste quién es.</Text>
          <Text testID="booking-pin" variant="title" style={{ letterSpacing: 8 }}>{b.pin}</Text>
        </Card>
      ) : null}

      {b.status === 'in_progress' ? <Notice tone="ok">Sesión en curso. Si algo no está bien, usa el botón de ayuda.</Notice> : null}
      {b.status === 'completed' ? <AfterSession b={b} target="physio" /> : null}

      {['pending', 'confirmed', 'en_route'].includes(b.status) ? (
        <Button kind="line" testID="cancel-booking" title="Cancelar cita" loading={cancel.isPending} onPress={() => { askCancel().catch(() => {}); }} />
      ) : null}
      {b.mode === 'home' && ['confirmed', 'en_route'].includes(b.status) && late ? (
        <Button kind="line" testID="report-no-show" title="Mi fisio no llegó" loading={noShow.isPending} onPress={() => noShow.mutate(undefined)} />
      ) : null}
      {['pending', 'confirmed'].includes(b.status) ? <Text variant="tiny" muted>Cancelar es gratis hasta 12 horas antes. Después se cobra el 50 %.</Text> : null}
      <Button small kind="line" title="Ayuda y garantías" onPress={() => router.push('/help')} />
    </Stack>
  );
}

// Seguimiento mutuo: desde 30 minutos antes el paciente ve al fisio en el mapa (aunque todavía no salga)
// y comparte su propia ubicación para que el fisio sepa que hay alguien en el domicilio.
function Tracking({ b, home }: { b: Booking; home: LatLng }) {
  const now = useNow(5000);
  const share = useShareLocation(b.id, b.tracking.shareMine, 'patient');
  const name = b.physio?.name?.split(' ')[0] ?? 'Tu fisio';
  if (!b.tracking.active) {
    return <Notice testID="tracking-soon">{`Desde las ${time(b.tracking.from)} (30 minutos antes) verás a ${name} en el mapa hasta que llegue a tu puerta.`}</Notice>;
  }
  const loc = b.physioLocation;
  const there = loc && loc.lat !== null && loc.lng !== null ? { lat: loc.lat, lng: loc.lng } : null;
  const d = there ? distanceM(there, home) : null;
  const ageS = loc?.at ? Math.round((now - new Date(loc.at).getTime()) / 1000) : null;
  const status = d === null ? 'Esperando su ubicación…' : b.status === 'en_route' ? `A ${formatDistance(d)} · llega en unos ${etaMinutes(d)} min` : `Aún no sale · está a ${formatDistance(d)}`;
  return (
    <Card tone="brand" testID="en-route">
      <Text variant="h2">{b.status === 'en_route' ? `${name} va en camino` : `${name} se prepara para tu visita`}</Text>
      <Text variant="small" testID="eta">{status}</Text>
      <PlaceMap testID="tracking-map" center={there ? midpoint(there, home) : home} spanKm={Math.max(0.8, ((d ?? 600) / 1000) * 1.8)} height={240}
        points={[{ id: 'home', coords: home, kind: 'home', label: 'Tu casa' }, ...(there ? [{ id: 'physio', coords: there, kind: 'physio' as const, label: name }] : [])]} />
      {ageS !== null && ageS > 90 ? <Text variant="tiny" color="warn">Ubicación de hace {Math.round(ageS / 60)} min: puede estar sin señal.</Text> : <Text variant="tiny" muted>Se actualiza sola cada pocos segundos.</Text>}
      {b.tracking.shareMine ? <Text variant="tiny" muted testID="patient-sharing">{share.error ?? `Compartiendo tu ubicación con ${name} hasta que llegue, para que sepa que estás en casa.`}</Text> : null}
    </Card>
  );
}

// Grabación de audio de seguridad. Cualquiera de las dos partes la activa; la otra lo ve aquí y recibe un aviso.
function SafetyRecorder({ b, me }: { b: Booking; me: 'patient' | 'physio' }) {
  const live = ['arrived', 'in_progress'].includes(b.status);
  const rec = useSafetyRecorder(b.id, live);
  const [dialog, confirm] = useConfirm();
  const qc = useQueryClient();
  const otherRecording = me === 'patient' ? b.recording.physio : b.recording.patient;
  if (!live && !rec.pending && !rec.recording) return null;
  const mmss = `${String(Math.floor(rec.elapsedMs / 60000)).padStart(2, '0')}:${String(Math.floor(rec.elapsedMs / 1000) % 60).padStart(2, '0')}`;

  const askStart = async () => {
    const ok = await confirm({
      title: 'Grabar el audio de la visita', confirm: 'Empezar a grabar', cancel: 'Ahora no',
      message: `Solo se graba audio, no video. ${me === 'patient' ? 'Tu fisio' : 'El paciente'} recibirá un aviso. La grabación se guarda cifrada durante 30 días y nadie la escucha —ni tú, ni la otra persona, ni el personal de FisioCerca—, salvo el equipo de seguridad si hay un reporte o una alerta. Después se borra.`,
    });
    if (!ok) return;
    await rec.start();
    await qc.invalidateQueries({ queryKey: keys.booking(b.id) });
  };

  return (
    <Card tone={rec.recording || otherRecording ? 'danger' : undefined} testID="safety-recorder">
      {dialog}
      <Text variant="label">Grabación de seguridad</Text>
      {otherRecording ? <Text variant="small" testID="other-recording">{`● ${me === 'patient' ? 'Tu fisio' : 'El paciente'} está grabando el audio de la visita por seguridad.`}</Text> : null}
      {rec.recording ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="small" color="danger" testID="recording-on">{`● Grabando audio · ${mmss}`}</Text>
          <Button small kind="line" testID="recording-stop" title="Detener" onPress={() => { rec.stop().catch(() => {}); }} />
        </Row>
      ) : live ? (
        <Button small kind="ghost" testID="recording-start" title="Grabar audio de la visita" onPress={() => { askStart().catch(e => Alert.alert('No se pudo grabar', (e as Error).message)); }} />
      ) : null}
      {rec.pending ? <Text variant="tiny" muted testID="recording-pending">{`Subiendo ${rec.pending} ${rec.pending === 1 ? 'tramo' : 'tramos'} de audio… no cierres la app.`}</Text> : null}
      {rec.error ? <Text variant="tiny" color="danger">{rec.error}</Text> : null}
      <Text variant="tiny" muted>Solo audio, cifrado y guardado 30 días. Únicamente lo revisa el equipo de seguridad si hay un reporte.</Text>
    </Card>
  );
}

function Consent({ b }: { b: Booking }) {
  const self = b.patient.canConsent !== false && b.patient.relationship === 'self';
  const [signer, setSigner] = useState(self ? b.patient.name ?? '' : b.companionName ?? '');
  const [svg, setSvg] = useState<string | null>(null);
  const sign = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/consent', { ...path(b), body: { signerName: signer.trim(), signerIsPatient: self, signatureSvg: svg! } })));
  return (
    <Card testID="consent-card">
      <Text variant="h2">Consentimiento informado</Text>
      <Text variant="small" muted>
        Autorizo la evaluación y el tratamiento de fisioterapia. Entiendo que puedo detenerlo en cualquier momento y que mis datos clínicos se guardan cifrados y solo los ve mi especialista. Sé que, por seguridad, cualquiera de las dos partes puede grabar el audio de la visita: se guarda cifrado 30 días y solo lo revisa el equipo de seguridad si hay un reporte o una alerta.
        {self ? '' : ' Firmo como representante del paciente.'}
      </Text>
      <Field label="Nombre de quien firma" value={signer} onChangeText={setSigner} testID="signer-name" />
      <SignaturePad onChange={setSvg} />
      {sign.error ? <Notice tone="danger">{errMsg(sign.error)}</Notice> : null}
      <Button testID="sign-consent" title="Firmar" disabled={!svg || signer.trim().length < 3} loading={sign.isPending} onPress={() => sign.mutate(undefined)} />
    </Card>
  );
}

// ---------------- Fisio ----------------
function PhysioActions({ b }: { b: Booking }) {
  const [pin, setPin] = useState('');
  const accept = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/accept', path(b))));
  const reject = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/reject', path(b))));
  const depart = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/depart', path(b))));
  const cancel = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/cancel', { ...path(b), body: {} })));
  const arrive = useAction(b, async () => {
    const here = await currentCoords();
    if (!here) throw new Error('Activa la ubicación para marcar tu llegada.');
    return call(() => client.POST('/v1/bookings/{id}/arrive', { ...path(b), body: here }));
  });
  const start = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/start', { ...path(b), body: b.mode === 'home' ? { pin } : {} })));
  const err = errMsg(accept.error ?? reject.error ?? depart.error ?? arrive.error ?? start.error ?? cancel.error);
  const [dialog, confirm] = useConfirm();
  const share = useShareLocation(b.id, b.tracking.shareMine, 'physio');
  const pl = b.patientLocation;
  const bookerPresent = b.patient.relationship === 'self' || b.companion === 'booker';
  const home = b.mode === 'home' && b.lat !== null && b.lng !== null ? { lat: b.lat, lng: b.lng } : null;

  const askReject = async () => {
    if (await confirm({ title: '¿Rechazar la solicitud?', message: 'Liberamos el pago del paciente y le sugerimos otros especialistas cerca.', confirm: 'Rechazar', danger: true })) reject.mutate(undefined);
  };
  const askCancel = async () => {
    if (await confirm({ title: '¿Cancelar una cita confirmada?', message: 'Le devolvemos todo al paciente y le damos $5 de crédito. Las cancelaciones bajan tu índice de cumplimiento.', confirm: 'Cancelar cita', cancel: 'Mantenerla', danger: true })) cancel.mutate(undefined);
  };

  return (
    <Stack gap={12}>
      {dialog}
      {err ? <Notice tone="danger" testID="action-error">{err}</Notice> : null}
      {home && ['confirmed', 'en_route', 'arrived'].includes(b.status) ? (
        <Card testID="route-card">
          <PlaceMap testID="route-map" center={home} spanKm={0.8} height={200} circle={{ center: home, meters: ARRIVAL_RADIUS_M }} points={[{ id: 'home', coords: home, kind: 'home', label: 'Domicilio' }, ...(pl ? [{ id: 'patient', coords: { lat: pl.lat, lng: pl.lng }, kind: 'me' as const, label: b.patient.name ?? 'Paciente' }] : [])]} />
          <Row>
            <Button flex small kind="ghost" title="Ir con Google Maps" onPress={() => open(googleMapsUrl(home))} />
            <Button flex small kind="ghost" title="Ir con Waze" onPress={() => open(wazeUrl(home))} />
          </Row>
          {['confirmed', 'en_route'].includes(b.status) && b.tracking.active ? (
            <Text variant="small" testID="patient-presence">{!bookerPresent ? `Te recibe ${b.companionName ?? 'un familiar o cuidador'}: quien reservó no estará en la visita.` : pl ? (pl.atHome ? 'El paciente está en el domicilio ✓' : 'El paciente todavía no está en el domicilio') : 'Esperando la ubicación del paciente…'}</Text>
          ) : null}
          {b.tracking.shareMine && b.status !== 'arrived' ? (
            <Text variant="tiny" muted testID="sharing">{share.error ?? (share.distanceM !== null ? `Compartiendo tu ubicación con el paciente · estás a ${formatDistance(share.distanceM)}` : 'Compartiendo tu ubicación con el paciente…')}</Text>
          ) : b.status === 'confirmed' ? (
            <Text variant="tiny" muted testID="sharing-soon">{`Desde las ${time(b.tracking.from)} (30 minutos antes) el paciente verá tu ubicación y tú verás si está en casa.`}</Text>
          ) : null}
        </Card>
      ) : null}
      {b.status === 'pending' ? (
        <Row>
          <Button flex testID="accept" title="Aceptar" loading={accept.isPending} onPress={() => accept.mutate(undefined)} />
          <Button flex kind="line" testID="reject" title="Rechazar" disabled={accept.isPending} loading={reject.isPending} onPress={() => { askReject().catch(() => {}); }} />
        </Row>
      ) : null}

      {b.status === 'confirmed' && b.mode === 'home' ? <Button testID="depart" title="Salir hacia el domicilio" loading={depart.isPending} onPress={() => depart.mutate(undefined)} /> : null}
      {b.status === 'en_route' ? (
        <Stack>
          <Button testID="arrive" title="Llegué" loading={arrive.isPending} onPress={() => arrive.mutate(undefined)} />
          <Text variant="tiny" muted>Se activa a menos de 150 m de la dirección.</Text>
        </Stack>
      ) : null}

      {b.status === 'arrived' ? (
        <Card>
          {!b.doorConfirmed ? <Notice tone="warn">Espera a que el paciente confirme en su app que eres la persona del perfil.</Notice> : null}
          {!b.consentSigned ? <Notice tone="warn">Falta la firma del consentimiento informado.</Notice> : null}
          <Field label="PIN del paciente" testID="pin-input" keyboardType="number-pad" maxLength={4} value={pin} onChangeText={t => setPin(t.replace(/\D/g, ''))} />
          <Button testID="start" title="Iniciar sesión" disabled={pin.length !== 4} loading={start.isPending} onPress={() => start.mutate(undefined)} />
        </Card>
      ) : null}
      {b.status === 'confirmed' && b.mode === 'video' ? (
        <Stack>
          {!b.consentSigned ? <Notice tone="warn">El paciente aún no firma el consentimiento.</Notice> : null}
          <Button testID="start" title="Iniciar videollamada" disabled={!b.consentSigned} loading={start.isPending} onPress={() => start.mutate(undefined)} />
        </Stack>
      ) : null}

      {b.status === 'in_progress' ? <CompleteForm b={b} /> : null}
      {b.status === 'completed' ? <AfterSession b={b} target="patient" /> : null}
      {['confirmed', 'en_route'].includes(b.status) ? <Button kind="line" title="Cancelar cita" loading={cancel.isPending} onPress={() => { askCancel().catch(() => {}); }} /> : null}
    </Stack>
  );
}

function PainScale({ label, value, onChange, testID }: { label: string; value: number | null; onChange: (n: number) => void; testID: string }) {
  return (
    <Stack>
      <Text variant="label">{label}</Text>
      <Row gap={6}>{Array.from({ length: 11 }, (_, n) => <Chip key={n} testID={`${testID}-${n}`} label={String(n)} selected={value === n} onPress={() => onChange(n)} />)}</Row>
    </Stack>
  );
}

// Nota SOAP: subjetivo, objetivo, evaluación y plan. Se guarda cifrada; solo la ven el paciente y sus fisios.
function CompleteForm({ b }: { b: Booking }) {
  const ex = useExercises();
  const [n, setN] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  const [before, setBefore] = useState<number | null>(b.painScore);
  const [after, setAfter] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const complete = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/complete', {
    ...path(b),
    body: { ...n, subjective: n.subjective || undefined, objective: n.objective || undefined, painBefore: before ?? undefined, painAfter: after ?? undefined, exercises: picked },
  })));
  const set = (k: keyof typeof n) => (t: string) => setN(s => ({ ...s, [k]: t }));
  return (
    <Card testID="complete-form">
      <Text variant="h2">Nota de la sesión</Text>
      <Field label="Subjetivo" placeholder="Lo que cuenta el paciente" multiline value={n.subjective} onChangeText={set('subjective')} />
      <Field label="Objetivo" placeholder="Rangos, fuerza, pruebas" multiline value={n.objective} onChangeText={set('objective')} />
      <Field label="Evaluación" testID="assessment" multiline value={n.assessment} onChangeText={set('assessment')} />
      <Field label="Plan" testID="plan" multiline value={n.plan} onChangeText={set('plan')} />
      <PainScale label="Dolor al inicio" value={before} onChange={setBefore} testID="pain-before" />
      <PainScale label="Dolor al final" value={after} onChange={setAfter} testID="pain-after" />
      <Text variant="label">Ejercicios para casa</Text>
      <Row gap={6}>
        {(ex.data ?? []).map(e => (
          <Chip key={e.code} testID={`ex-${e.code}`} label={e.name} selected={picked.includes(e.code)}
            onPress={() => setPicked(p => (p.includes(e.code) ? p.filter(x => x !== e.code) : [...p, e.code]))} />
        ))}
      </Row>
      {complete.error ? <Notice tone="danger">{errMsg(complete.error)}</Notice> : null}
      <Button testID="complete" title="Terminar y cobrar" disabled={n.assessment.trim().length < 3 || n.plan.trim().length < 3} loading={complete.isPending} onPress={() => complete.mutate(undefined)} />
    </Card>
  );
}

// ---------------- Después de la sesión (ambos) ----------------
const TAGS = {
  physio: ['Puntual', 'Explicó bien', 'Mejoró mi dolor', 'Respetuoso', 'Higiene impecable'],
  patient: ['Puntual', 'Respetuoso', 'Siguió indicaciones', 'Espacio adecuado'],
};
const REASONS = [
  { value: 'late', label: 'Llegó tarde' }, { value: 'billing', label: 'Cobro' }, { value: 'conduct', label: 'Trato o seguridad' }, { value: 'other', label: 'Otro' },
] as const;

function AfterSession({ b, target }: { b: Booking; target: 'physio' | 'patient' }) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]['value'] | null>(null);
  const [desc, setDesc] = useState('');
  const [ticket, setTicket] = useState(false);
  const review = useAction(b, () => call(() => client.POST('/v1/bookings/{id}/reviews', { ...path(b), body: { stars, tags, comment: comment || undefined } })));
  const support = useMutation({ mutationFn: () => call(() => client.POST('/v1/support/tickets', { body: { bookingId: b.id, reason: reason!, description: desc || undefined } })) });
  const alreadyReviewed = review.error instanceof ApiError && review.error.status === 409;

  return (
    <Stack gap={12}>
      {done || alreadyReviewed || b.reviewed ? <Notice tone="ok" testID="review-done">¡Gracias por tu calificación!</Notice> : (
        <Card testID="review-card">
          <Text variant="h2">{target === 'physio' ? '¿Cómo te fue con tu fisio?' : '¿Cómo fue la visita?'}</Text>
          <Row gap={6}>{[1, 2, 3, 4, 5].map(s => <Chip key={s} testID={`star-${s}`} label={'★'.repeat(s)} selected={stars === s} onPress={() => setStars(s)} />)}</Row>
          <Row gap={6}>{TAGS[target].map(t => <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => setTags(x => (x.includes(t) ? x.filter(y => y !== t) : [...x, t]))} />)}</Row>
          <Field label="Comentario (opcional)" multiline value={comment} onChangeText={setComment} maxLength={1000} />
          {review.error && !alreadyReviewed ? <Notice tone="danger">{errMsg(review.error)}</Notice> : null}
          <Button testID="send-review" title="Enviar calificación" disabled={!stars} loading={review.isPending} onPress={() => review.mutate(undefined, { onSuccess: () => setDone(true) })} />
        </Card>
      )}
      {target === 'physio' ? (
        support.isSuccess ? <Notice tone="ok">Recibimos tu reporte. Te respondemos en menos de 24 horas.</Notice> : ticket ? (
          <Card>
            <Text variant="h2">Reportar un problema</Text>
            <Row gap={6}>{REASONS.map(r => <Chip key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />)}</Row>
            <Field label="Cuéntanos qué pasó" multiline value={desc} onChangeText={setDesc} maxLength={2000} />
            {support.error ? <Notice tone="danger">{errMsg(support.error)}</Notice> : null}
            <Button title="Enviar reporte" disabled={!reason} loading={support.isPending} onPress={() => support.mutate()} />
          </Card>
        ) : <Button kind="line" title="Reportar un problema o pedir devolución" onPress={() => setTicket(true)} />
      ) : null}
    </Stack>
  );
}

// Botón de ayuda: comparte la ubicación con el equipo de seguridad y ofrece llamar al 911 (ECU 911).
function Sos({ b }: { b: Booking }) {
  const [sent, setSent] = useState(false);
  const [dialog, confirm] = useConfirm();
  const sos = useMutation({
    mutationFn: async () => {
      const here = await currentCoords();
      return call(() => client.POST('/v1/bookings/{id}/sos', { ...path(b), body: { ...(here ?? {}), note: 'Botón de ayuda en la app' } }));
    },
    onSuccess: () => setSent(true),
  });
  return (
    <Card tone="danger">
      {dialog}
      {sent ? <Text variant="small" testID="sos-sent">Avisamos a nuestro equipo de seguridad con tu ubicación. Te llamarán de inmediato.</Text>
        : <Text variant="small" muted>¿Te sientes en riesgo? Avisamos a seguridad con tu ubicación.</Text>}
      <Row>
        <Button flex kind="danger" testID="sos" title="Necesito ayuda" loading={sos.isPending} onPress={() => {
          confirm({ title: '¿Activar la alerta?', message: 'Enviamos tu ubicación y los datos de la cita al equipo de seguridad de FisioCerca, que te llamará de inmediato. Si estás en peligro, llama también al 911.', confirm: 'Activar alerta', danger: true })
            .then(ok => { if (ok) sos.mutate(); }).catch(() => {});
        }} />
        <Button flex kind="line" title="Llamar al 911" onPress={() => open('tel:911')} />
      </Row>
      {sos.error ? <Text variant="tiny" color="danger">{errMsg(sos.error)}</Text> : null}
    </Card>
  );
}
