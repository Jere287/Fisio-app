import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { call, client } from '@/api/client';
import { keys, usePatients, useRecord } from '@/api/queries';
import { dateLong } from '@/lib/format';
import { useColors } from '@/theme/tokens';
import { Badge, Button, Card, Chip, Empty, ErrorState, Loading, Notice, Row, Screen, Stack, Text } from '@/ui';

export default function Treatment() {
  const c = useColors();
  const qc = useQueryClient();
  const patients = usePatients();
  const [selected, setSelected] = useState<string | undefined>();
  const patientId = selected ?? patients.data?.[0]?.id;
  const record = useRecord(patientId);
  const [done, setDone] = useState<string[]>([]);
  const [painSent, setPainSent] = useState<number | null>(null);

  const logExercise = useMutation({
    mutationFn: (code: string) => call(() => client.POST('/v1/patients/{id}/exercise-logs', { params: { path: { id: patientId! } }, body: { exerciseCode: code } })),
    onSuccess: (_d, code) => { setDone(d => [...d, code]); qc.invalidateQueries({ queryKey: keys.record(patientId!) }).catch(() => {}); },
  });
  const logPain = useMutation({
    mutationFn: (value: number) => call(() => client.POST('/v1/patients/{id}/pain-logs', { params: { path: { id: patientId! } }, body: { value } })),
    onSuccess: (_r, value) => setPainSent(value),
  });

  return (
    <Screen testID="treatment-screen">
      <Text variant="title">Mi tratamiento</Text>
      {patients.data && patients.data.length > 1 ? (
        <Row>{patients.data.map(p => <Chip key={p.id} label={p.relationship === 'self' ? 'Yo' : `${p.full_name.split(' ')[0]} · ${p.relationship}`} selected={p.id === patientId} onPress={() => setSelected(p.id)} />)}</Row>
      ) : null}
      {record.isPending ? <Loading /> : record.isError ? <ErrorState error={record.error} onRetry={() => record.refetch()} /> : record.data.notes.length === 0 && record.data.exercises.length === 0 ? (
        <Empty title="Todavía no hay sesiones" subtitle="Después de tu primera sesión verás aquí tu evolución y tus ejercicios para casa." />
      ) : (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="h2">Tu dolor</Text>
              <Badge tone={record.data.adherence.percent >= 60 ? 'ok' : 'warn'} label={`Ejercicios: ${record.data.adherence.daysCompleteLast7} de 7 días`} />
            </Row>
            <Row gap={6} style={{ alignItems: 'flex-end', minHeight: 90, flexWrap: 'nowrap' }}>
              {record.data.notes.map(n => (
                <Stack key={n.id} gap={4} style={{ alignItems: 'center', flex: 1 }}>
                  <Text variant="tiny">{n.painAfter ?? '–'}</Text>
                  <View style={{ width: 18, height: 6 + (n.painAfter ?? 0) * 7, backgroundColor: c.brand, borderRadius: 4 }} />
                  <Text variant="tiny" muted>{dateLong(n.date).split(' ').slice(1, 2).join('')}</Text>
                </Stack>
              ))}
            </Row>
            <Text variant="tiny" muted>Dolor al final de cada sesión, de 0 a 10.</Text>
          </Card>

          <Stack>
            <Text variant="h2">Ejercicios de hoy</Text>
            {record.data.exercises.map(e => {
              const isDone = done.includes(e.code);
              return (
                <Card key={e.code}>
                  <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <Stack gap={2} style={{ flex: 1 }}><Text variant="label">{e.name}</Text><Text variant="small" muted>{e.dose}</Text></Stack>
                    {isDone ? <Badge label="Hecho" /> : <Button small kind="ghost" testID={`done-${e.code}`} title="Hecho" loading={logExercise.isPending && logExercise.variables === e.code} onPress={() => logExercise.mutate(e.code)} />}
                  </Row>
                  <Text variant="small">{e.instructions}</Text>
                </Card>
              );
            })}
            {record.data.exercises.length > 0 ? (
              <Card>
                <Text variant="label">¿Cuánto dolor sentiste al hacerlos?</Text>
                <Row gap={4}>{Array.from({ length: 11 }, (_, v) => <Chip key={v} testID={`pain-${v}`} label={String(v)} selected={painSent === v} onPress={() => logPain.mutate(v)} />)}</Row>
                {painSent !== null ? <Notice tone={painSent >= 7 ? 'warn' : 'ok'}>{painSent >= 7 ? 'Registramos dolor alto y le avisamos a tu fisio.' : '¡Bien hecho! Quedó registrado.'}</Notice> : null}
              </Card>
            ) : null}
          </Stack>

          <Stack>
            <Text variant="h2">Notas de tus sesiones</Text>
            {[...record.data.notes].reverse().map(n => (
              <Card key={n.id}>
                <Text variant="label">{dateLong(n.date)} · {n.physio}</Text>
                <Text variant="small"><Text variant="small" muted>Evaluación: </Text>{n.assessment}</Text>
                <Text variant="small"><Text variant="small" muted>Plan: </Text>{n.plan}</Text>
              </Card>
            ))}
          </Stack>
        </>
      )}
    </Screen>
  );
}
