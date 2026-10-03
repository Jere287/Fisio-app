import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, call, client } from '@/api/client';
import { keys, useBookings, usePhysioMe } from '@/api/queries';
import type { Booking } from '@/api/types';
import { dateTime, money } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { STATUS, painSummary } from '@/lib/labels';
import { Badge, Button, Card, Empty, ErrorState, Loading, Notice, Row, Screen, Stack, Text } from '@/ui';

const SELFIE_VALID_MS = 18 * 3600000;

// Agenda del fisio: conectarse (con la selfie del día), solicitudes nuevas, próximas visitas e historial.
export default function Agenda() {
  const me = usePhysioMe();
  const q = useBookings('physio');
  const all = q.data ?? [];
  const requests = all.filter(b => b.status === 'pending');
  const upcoming = all.filter(b => ['confirmed', 'en_route', 'arrived', 'in_progress'].includes(b.status)).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
  const past = all.filter(b => ['completed', 'cancelled', 'rejected', 'no_show'].includes(b.status)).slice(0, 10);

  return (
    <Screen testID="agenda-screen">
      <Text variant="title">Agenda</Text>
      {me.isPending ? <Loading /> : me.isError ? <ErrorState error={me.error} onRetry={() => me.refetch()} /> : <Availability available={me.data.available} lastSelfieAt={me.data.lastSelfieAt} approved={me.data.status === 'approved'} />}
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : all.length === 0 ? (
        <Empty title="Todavía no tienes citas" subtitle="Conéctate para aparecer en las búsquedas de pacientes cercanos." />
      ) : (
        <>
          <Section title={`Solicitudes (${requests.length})`} items={requests} empty="No hay solicitudes nuevas." />
          <Section title="Próximas" items={upcoming} empty="No tienes visitas confirmadas." />
          {past.length ? <Section title="Historial" items={past} /> : null}
        </>
      )}
    </Screen>
  );
}

function Section({ title, items, empty }: { title: string; items: Booking[]; empty?: string }) {
  return (
    <Stack>
      <Text variant="h2">{title}</Text>
      {items.length === 0 && empty ? <Text variant="small" muted>{empty}</Text> : null}
      {items.map(b => (
        <Card key={b.id} testID={`booking-${b.id}`} tone={b.status === 'pending' ? 'warn' : undefined} onPress={() => router.push(`/booking/${b.id}`)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label">{b.patient.name}{b.patient.age ? `, ${b.patient.age} años` : ''}</Text>
            <Badge label={STATUS[b.status].label} tone={STATUS[b.status].tone} />
          </Row>
          <Text variant="small" muted>{dateTime(b.scheduledAt)} · {b.mode === 'video' ? 'Videollamada' : 'A domicilio'} · {money(b.priceCents)}</Text>
          {painSummary(b.pain, b.painScore) ? <Text variant="tiny" muted>{painSummary(b.pain, b.painScore)}</Text> : null}
        </Card>
      ))}
    </Stack>
  );
}

function Availability({ available, lastSelfieAt, approved }: { available: boolean; lastSelfieAt: string | null; approved: boolean }) {
  const qc = useQueryClient();
  const now = useNow();
  const selfieOk = !!lastSelfieAt && now - new Date(lastSelfieAt).getTime() < SELFIE_VALID_MS;
  const refresh = () => qc.invalidateQueries({ queryKey: keys.physioMe });

  // Selfie del día con la cámara frontal. La referencia la valida el proveedor biométrico en el servidor.
  const selfie = useMutation({
    mutationFn: async () => {
      await ImagePicker.requestCameraPermissionsAsync();
      const shot = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: 0.6 }).catch(() => ImagePicker.launchImageLibraryAsync({ quality: 0.6 }));
      if (shot.canceled) throw new Error('No se tomó la selfie.');
      // TODO: subir la foto con una URL prefirmada y enviar la clave del objeto.
      return call(() => client.POST('/v1/physios/me/selfie-check', { body: { selfieRef: `upload:selfie:${shot.assets[0]?.fileName ?? Date.now()}` } }));
    },
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: (next: boolean) => call(() => client.POST('/v1/physios/me/availability-toggle', { body: { available: next } })),
    onSuccess: refresh,
  });
  const err = toggle.error ?? selfie.error;

  if (!approved) return <Notice tone="warn">Tu perfil está en revisión. Te avisaremos cuando el equipo apruebe tus títulos y antecedentes.</Notice>;
  return (
    <Card tone={available ? 'brand' : undefined} testID="availability-card">
      <Row style={{ justifyContent: 'space-between' }}>
        <Stack gap={2}>
          <Text variant="h2">{available ? 'Conectado' : 'Desconectado'}</Text>
          <Text variant="small" muted>{available ? 'Los pacientes cercanos pueden reservarte.' : 'No apareces en las búsquedas.'}</Text>
        </Stack>
        <Badge label={selfieOk ? 'Selfie del día ✓' : 'Falta selfie'} tone={selfieOk ? 'ok' : 'warn'} />
      </Row>
      {!available && !selfieOk ? <Button kind="ghost" testID="selfie" title="Tomar selfie del día" loading={selfie.isPending} onPress={() => selfie.mutate()} /> : null}
      <Button testID="toggle-available" kind={available ? 'line' : 'primary'} title={available ? 'Desconectarme' : 'Conectarme'} loading={toggle.isPending} onPress={() => toggle.mutate(!available)} />
      {err ? <Notice tone="danger">{err instanceof ApiError || err instanceof Error ? err.message : 'Algo salió mal.'}</Notice> : null}
    </Card>
  );
}
