import { useEarnings } from '@/api/queries';
import { dateLong, dateTime, money } from '@/lib/format';
import { Badge, Card, Empty, ErrorState, Loading, Row, Screen, Stack, Text } from '@/ui';

const PAYOUT: Record<string, [string, 'ok' | 'warn' | 'danger']> = { paid: ['Pagado', 'ok'], scheduled: ['Programado', 'warn'], failed: ['Falló', 'danger'] };

// Lo que gana el fisio: saldo por cobrar (ya descontada la comisión), sesiones cobradas y transferencias.
export default function Earnings() {
  const q = useEarnings();
  if (q.isPending) return <Screen><Loading /></Screen>;
  if (q.isError) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const { pendingCents, sessions, payouts } = q.data;
  return (
    <Screen testID="earnings-screen">
      <Text variant="title">Ganancias</Text>
      <Card tone="brand">
        <Text variant="small" muted>Por cobrar en la próxima transferencia</Text>
        <Text variant="title" testID="pending-earnings">{money(pendingCents)}</Text>
        <Text variant="tiny" muted>Ya descontamos la comisión de la plataforma. Transferimos cada semana a tu cuenta bancaria.</Text>
      </Card>
      <Stack>
        <Text variant="h2">Sesiones</Text>
        {sessions.length === 0 ? <Empty title="Aún no tienes sesiones cobradas" /> : sessions.map(s => (
          <Row key={s.id} style={{ justifyContent: 'space-between' }}>
            <Text variant="small">{dateTime(s.scheduled_at)}</Text>
            <Text variant="label">{money(s.net_cents ?? 0)} <Text variant="tiny" muted>de {money(s.price_cents)}</Text></Text>
          </Row>
        ))}
      </Stack>
      {payouts.length ? (
        <Stack>
          <Text variant="h2">Transferencias</Text>
          {payouts.map(p => (
            <Card key={p.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label">{money(p.amount_cents)}</Text>
                <Badge label={PAYOUT[p.status]?.[0] ?? p.status} tone={PAYOUT[p.status]?.[1] ?? 'warn'} />
              </Row>
              <Text variant="tiny" muted>{dateLong(p.created_at)}</Text>
            </Card>
          ))}
        </Stack>
      ) : null}
    </Screen>
  );
}
