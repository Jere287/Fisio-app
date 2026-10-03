import { useState } from 'react';
import { Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, call, client } from '@/api/client';
import { keys, useBooking, useExercises } from '@/api/queries';
import type { Booking } from '@/api/types';
import { currentCoords } from '@/lib/useLocation';
import { useNow } from '@/lib/useNow';
import { dateTime, money } from '@/lib/format';
import { STATUS, ACTIVE_STATUSES, painSummary } from '@/lib/labels';
import { SignaturePad } from '@/ui/SignaturePad';
import { Badge, Button, Card, Chip, ErrorState, Field, Loading, Notice, Row, Screen, Stack, Text } from '@/ui';

const NO_SHOW_GRACE_MS = 20 * 60000;

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
      {asPhysio && b.bookedBy ? <Text variant="tiny" muted>Reservó {b.bookedBy.name}{b.bookedBy.verified ? ' · identidad verificada' : ''}</Text> : null}
      {!asPhysio ? <Text variant="small">{b.usesPackage ? 'Sesión de tu paquete' : `Total ${money(b.totalCents)}${b.creditCents ? ` (crédito ${money(b.creditCents)})` : ''}`}</Text> : null}
      {asPhysio && b.mode === 'home' && b.lat !== null && b.lng !== null ? (
        <Button small kind="line" title="Abrir en el mapa" onPress={() => { Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`).catch(() => {}); }} />
      ) : null}
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
  const late = now > new Date(b.scheduledAt).getTime() + NO_SHOW_GRACE_MS;
  const err = errMsg(cancel.error ?? noShow.error ?? door.error);

  return (
    <Stack gap={12}>
      {err ? <Notice tone="danger">{err}</Notice> : null}
      {b.status === 'pending' ? <Notice>Esperando que el especialista acepte. Si no responde en 30 minutos, liberamos el cobro retenido.</Notice> : null}
      {b.status === 'en_route' ? <Notice testID="en-route">Tu fisio va en camino.</Notice> : null}

      {b.status === 'arrived' && !b.doorConfirmed ? (
        <Card tone="warn">
          <Text variant="h2">¿Es la persona del perfil?</Text>
          <Text variant="small" muted>Compara su rostro con la foto de {b.physio?.name}. Si no coincide, no abras: cancelamos la cita y avisamos a seguridad.</Text>
          <Row>
            <Button flex testID="door-yes" title="Sí, es la persona" loading={door.isPending} onPress={() => door.mutate(true)} />
            <Button flex testID="door-no" kind="danger" title="No coincide" disabled={door.isPending} onPress={() => door.mutate(false)} />
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
        <Button kind="line" testID="cancel-booking" title="Cancelar cita" loading={cancel.isPending} onPress={() => cancel.mutate(undefined)} />
      ) : null}
      {b.mode === 'home' && ['confirmed', 'en_route'].includes(b.status) && late ? (
        <Button kind="line" testID="report-no-show" title="Mi fisio no llegó" loading={noShow.isPending} onPress={() => noShow.mutate(undefined)} />
      ) : null}
      {['pending', 'confirmed'].includes(b.status) ? <Text variant="tiny" muted>Cancelar es gratis hasta 12 horas antes. Después se cobra el 50 %.</Text> : null}
    </Stack>
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
        Autorizo la evaluación y el tratamiento de fisioterapia. Entiendo que puedo detenerlo en cualquier momento y que mis datos clínicos se guardan cifrados y solo los ve mi especialista.
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

  return (
    <Stack gap={12}>
      {err ? <Notice tone="danger" testID="action-error">{err}</Notice> : null}
      {b.status === 'pending' ? (
        <Row>
          <Button flex testID="accept" title="Aceptar" loading={accept.isPending} onPress={() => accept.mutate(undefined)} />
          <Button flex kind="line" testID="reject" title="Rechazar" disabled={accept.isPending} loading={reject.isPending} onPress={() => reject.mutate(undefined)} />
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
      {['confirmed', 'en_route'].includes(b.status) ? <Button kind="line" title="Cancelar cita" loading={cancel.isPending} onPress={() => cancel.mutate(undefined)} /> : null}
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
  const sos = useMutation({
    mutationFn: async () => {
      const here = await currentCoords();
      return call(() => client.POST('/v1/bookings/{id}/sos', { ...path(b), body: { ...(here ?? {}), note: 'Botón de ayuda en la app' } }));
    },
    onSuccess: () => setSent(true),
  });
  return (
    <Card tone="danger">
      {sent ? <Text variant="small" testID="sos-sent">Avisamos a nuestro equipo de seguridad con tu ubicación. Te llamarán de inmediato.</Text>
        : <Text variant="small" muted>¿Te sientes en riesgo? Avisamos a seguridad con tu ubicación.</Text>}
      <Row>
        <Button flex kind="danger" testID="sos" title="Necesito ayuda" loading={sos.isPending} onPress={() => sos.mutate()} />
        <Button flex kind="line" title="Llamar al 911" onPress={() => { Linking.openURL('tel:911').catch(() => {}); }} />
      </Row>
      {sos.error ? <Text variant="tiny" color="danger">{errMsg(sos.error)}</Text> : null}
    </Card>
  );
}
