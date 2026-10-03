import { useState } from 'react';
import { TextInput, View, type TextStyle } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { call, client } from '@/api/client';
import { keys, usePhysioMe } from '@/api/queries';
import type { PhysioMe } from '@/api/types';
import { AccountScreen } from '@/features/AccountScreen';
import { money } from '@/lib/format';
import { specialtyLabel } from '@/lib/labels';
import { useNow } from '@/lib/useNow';
import { radius, useColors } from '@/theme/tokens';
import { Badge, Button, Card, Chip, Notice, Row, Stack, Text } from '@/ui';

const DOC: Record<PhysioMe['documents'][number]['kind'], string> = { senescyt: 'Título SENESCYT', msp: 'Registro MSP', criminal_record: 'Certificado de antecedentes', certificate: 'Certificado' };
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAY_MS = 86400000;

export default function Profile() {
  const me = usePhysioMe();
  return (
    <AccountScreen family={false}>
      {me.data ? (
        <Stack gap={14}>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="h2">Perfil profesional</Text>
              {me.data.rating !== null ? <Badge tone="brand" label={`★ ${me.data.rating.toFixed(1)} (${me.data.ratingCount})`} /> : <Badge tone="warn" label="Sin reseñas" />}
            </Row>
            <Text variant="small">{me.data.specialties.map(specialtyLabel).join(' · ')}</Text>
            <Text variant="small" muted>Domicilio {money(me.data.price_cents)}{me.data.offers_video ? ` · Video ${money(me.data.video_price_cents)}` : ''} · Radio {me.data.radius_km} km</Text>
          </Card>
          <Documents docs={me.data.documents} />
          <Schedule initial={me.data.availability} />
        </Stack>
      ) : null}
    </AccountScreen>
  );
}

// Documentos con su vencimiento: 30 días antes avisamos; al vencer, el fisio se desconecta solo.
function Documents({ docs }: { docs: PhysioMe['documents'] }) {
  const now = useNow(3600000);
  return (
    <Stack>
      <Text variant="h2">Documentos</Text>
      {docs.map(d => {
        const left = d.expires_at ? Math.floor((new Date(`${d.expires_at}T00:00:00-05:00`).getTime() - now) / DAY_MS) : null;
        const [label, tone] = d.status !== 'approved' ? [d.status === 'rejected' ? 'Rechazado' : 'En revisión', d.status === 'rejected' ? 'danger' : 'warn'] as const
          : left !== null && left < 0 ? ['Vencido', 'danger'] as const : left !== null && left <= 30 ? [`Vence en ${left} días`, 'warn'] as const : ['Vigente', 'ok'] as const;
        return (
          <Card key={d.id}>
            <Row style={{ justifyContent: 'space-between' }}><Text variant="label">{DOC[d.kind]}</Text><Badge label={label} tone={tone} /></Row>
            <Text variant="tiny" muted>{d.title}{d.expires_at ? ` · hasta ${d.expires_at}` : ''}</Text>
          </Card>
        );
      })}
    </Stack>
  );
}

// Horario semanal: un tramo por día (el backend acepta varios; la app ofrece el caso común).
type Slot = { weekday: number; start_min: number; end_min: number };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

const input: TextStyle = { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16, textAlign: 'center' };

function Schedule({ initial }: { initial: Slot[] }) {
  const c = useColors();
  const qc = useQueryClient();
  const [days, setDays] = useState(() => WEEKDAYS.map((_, w) => {
    const s = initial.find(x => x.weekday === w);
    return { on: !!s, start: hhmm(s?.start_min ?? 480), end: hhmm(s?.end_min ?? 1020) };
  }));
  const invalid = days.some(d => d.on && !(toMin(d.start) < toMin(d.end) && toMin(d.end) <= 1440));
  const save = useMutation({
    mutationFn: () => call(() => client.PUT('/v1/physios/me/availability', { body: days.flatMap((d, weekday) => (d.on ? [{ weekday, startMin: toMin(d.start), endMin: toMin(d.end) }] : [])) })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.physioMe }),
  });
  const set = (w: number, patch: Partial<(typeof days)[number]>) => setDays(ds => ds.map((d, i) => (i === w ? { ...d, ...patch } : d)));
  return (
    <Stack>
      <Text variant="h2">Horario de atención</Text>
      {days.map((d, w) => (
        <View key={w} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50 }}>
          <View style={{ width: 64 }}><Chip label={WEEKDAYS[w]!} selected={d.on} onPress={() => set(w, { on: !d.on })} /></View>
          {d.on ? (
            <>
              <TextInput accessibilityLabel={`${WEEKDAYS[w]} desde`} value={d.start} onChangeText={t => set(w, { start: t })} maxLength={5} style={[input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />
              <Text muted>a</Text>
              <TextInput accessibilityLabel={`${WEEKDAYS[w]} hasta`} value={d.end} onChangeText={t => set(w, { end: t })} maxLength={5} style={[input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />
            </>
          ) : <Text variant="small" muted>No atiendo</Text>}
        </View>
      ))}
      {invalid ? <Text variant="tiny" color="danger">Revisa las horas: usa el formato 08:00 y que el fin sea posterior al inicio.</Text> : null}
      {save.isSuccess ? <Notice tone="ok">Horario guardado.</Notice> : null}
      {save.error ? <Notice tone="danger">{(save.error as Error).message}</Notice> : null}
      <Button title="Guardar horario" disabled={invalid} loading={save.isPending} onPress={() => save.mutate()} />
    </Stack>
  );
}
