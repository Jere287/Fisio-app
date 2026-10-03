import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { usePhysio, useSlots } from '@/api/queries';
import { money, nextDays, time } from '@/lib/format';
import { specialtyLabel } from '@/lib/labels';
import { Avatar, Badge, Button, Card, Chip, ErrorState, Loading, Notice, Row, Screen, Stack, Text } from '@/ui';

export default function PhysioProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePhysio(id);
  const days = nextDays(7);
  const [day, setDay] = useState(days[1]!.iso);
  const [mode, setMode] = useState<'home' | 'video'>('home');
  const [slot, setSlot] = useState<string | null>(null);
  const slots = useSlots(id, day, mode);

  if (p.isPending) return <Screen><Loading /></Screen>;
  if (p.isError) return <Screen><ErrorState error={p.error} onRetry={() => p.refetch()} /></Screen>;
  const d = p.data;

  return (
    <Screen testID="physio-profile">
      <Stack gap={8} style={{ alignItems: 'center' }}>
        <Avatar name={d.full_name} size={84} />
        <Text variant="title" style={{ textAlign: 'center' }}>{d.full_name}</Text>
        <Text muted variant="small">{d.university} · {d.years_experience} años de experiencia</Text>
        <Row style={{ justifyContent: 'center' }}>
          <Badge label="Cédula verificada" /><Badge label="Título SENESCYT" /><Badge label="Registro MSP" /><Badge label="Sin antecedentes" />
        </Row>
        <Text variant="small">{d.rating ? `★ ${d.rating} · ${d.ratingCount} reseñas` : 'Especialista nuevo'}</Text>
      </Stack>
      {d.bio ? <Text>{d.bio}</Text> : null}
      <Row>{d.specialties.map(s => <Badge key={s} tone="brand" label={specialtyLabel(s)} />)}{d.offers_video ? <Badge tone="brand" label="También por videollamada" /> : null}</Row>

      <Card>
        <Text variant="h2">Elige día y hora</Text>
        {d.offers_video ? (
          <Row>
            <Chip label={`A domicilio · ${money(d.price_cents)}`} selected={mode === 'home'} onPress={() => { setMode('home'); setSlot(null); }} />
            <Chip label={`Videollamada · ${money(d.video_price_cents)}`} selected={mode === 'video'} onPress={() => { setMode('video'); setSlot(null); }} />
          </Row>
        ) : null}
        <Row>{days.map(x => <Chip key={x.iso} testID={`day-${x.iso}`} label={`${x.label} ${x.day}`} selected={day === x.iso} onPress={() => { setDay(x.iso); setSlot(null); }} />)}</Row>
        {slots.isPending ? <Loading /> : slots.isError ? <ErrorState error={slots.error} /> : slots.data.slots.length === 0 ? (
          <Notice>No hay horarios libres ese día. Prueba con otro.</Notice>
        ) : (
          <Row>{slots.data.slots.map(s => <Chip key={s} testID={`slot-${time(s)}`} label={time(s)} selected={slot === s} onPress={() => setSlot(s)} />)}</Row>
        )}
        <Button testID="continue-booking" title="Continuar" disabled={!slot} onPress={() => router.push({ pathname: '/book', params: { physioId: d.id, scheduledAt: slot!, mode } })} />
      </Card>

      {d.certificates.length ? (
        <Stack><Text variant="h2">Certificaciones verificadas</Text>{d.certificates.map((c, i) => <Card key={i}><Text variant="small">{c.title}</Text></Card>)}</Stack>
      ) : null}
      {d.reviews.length ? (
        <Stack><Text variant="h2">Reseñas</Text>{d.reviews.map((r, i) => <Card key={i}><Text variant="label">{'★'.repeat(r.stars)} · {r.author}</Text>{r.comment ? <Text variant="small">{r.comment}</Text> : null}</Card>)}</Stack>
      ) : null}
    </Screen>
  );
}
