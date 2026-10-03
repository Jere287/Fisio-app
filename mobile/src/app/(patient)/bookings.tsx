import { router } from 'expo-router';
import { useBookings } from '@/api/queries';
import { dateTime, money } from '@/lib/format';
import { STATUS } from '@/lib/labels';
import { Badge, Button, Card, Empty, ErrorState, Loading, Row, Screen, Stack, Text } from '@/ui';

export default function Bookings() {
  const q = useBookings('patient');
  return (
    <Screen testID="bookings-screen">
      <Text variant="title">Mis citas</Text>
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <Empty title="Aún no tienes citas" subtitle="Busca un especialista cerca de ti." action={<Button title="Explorar" onPress={() => router.push('/(patient)/explore')} />} />
      ) : (
        <Stack gap={10}>
          {q.data.map(b => (
            <Card key={b.id} testID={`booking-${b.id}`} onPress={() => router.push(`/booking/${b.id}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label">{b.physio?.name}</Text>
                <Badge label={STATUS[b.status].label} tone={STATUS[b.status].tone} />
              </Row>
              <Text variant="small" muted>{dateTime(b.scheduledAt)} · {b.mode === 'video' ? 'Videollamada' : 'A domicilio'} · {b.usesPackage ? 'Paquete' : money(b.totalCents)}</Text>
              {b.patient.relationship !== 'self' ? <Text variant="tiny" muted>Para {b.patient.name}</Text> : null}
            </Card>
          ))}
        </Stack>
      )}
    </Screen>
  );
}
