import { useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { call, client } from '@/api/client';
import { keys, useMe, useNotifications, usePatients } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
import { money } from '@/lib/format';
import { PrivacySection } from './PrivacySection';
import { Badge, Button, Card, Chip, ErrorState, Field, Loading, Notice, Row, Screen, Stack, Text } from '@/ui';

const KYC_LABEL: Record<string, [string, 'ok' | 'warn' | 'danger']> = {
  approved: ['Identidad verificada', 'ok'], review: ['En revisión', 'warn'], pending: ['Pendiente', 'warn'], pending_agent: ['Videollamada agendada', 'warn'], rejected: ['No verificada', 'danger'], none: ['Sin verificar', 'warn'],
};

// La usan las dos partes; el fisio no administra familiares, así que puede ocultar esa sección y anteponer su propio bloque.
export function AccountScreen({ family = true, children }: { family?: boolean; children?: ReactNode }) {
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const me = useMe();
  const patients = usePatients();
  const notifications = useNotifications();
  const [adding, setAdding] = useState(false);
  const [fam, setFam] = useState({ fullName: '', relationship: '', birthYear: '', canConsent: true });

  const addFamily = useMutation({
    mutationFn: () => call(() => client.POST('/v1/patients', { body: { fullName: fam.fullName, relationship: fam.relationship, birthYear: fam.birthYear ? Number(fam.birthYear) : undefined, canConsent: fam.canConsent } })),
    onSuccess: async () => { setAdding(false); setFam({ fullName: '', relationship: '', birthYear: '', canConsent: true }); await qc.invalidateQueries({ queryKey: keys.patients }); },
  });
  const logoutAll = useMutation({
    mutationFn: () => call(() => client.POST('/v1/auth/logout-all')),
    onSettled: () => signOut(),
  });

  if (me.isPending) return <Screen><Loading /></Screen>;
  if (me.isError) return <Screen><ErrorState error={me.error} onRetry={() => me.refetch()} /></Screen>;
  const u = me.data.user, [kycLabel, kycTone] = KYC_LABEL[u.kyc_status] ?? ['', 'warn'];

  return (
    <Screen testID="account-screen">
      <Text variant="title">{u.full_name || 'Mi cuenta'}</Text>
      <Row><Badge label={kycLabel} tone={kycTone} />{u.credit_cents > 0 ? <Badge tone="brand" label={`Crédito ${money(u.credit_cents)}`} /> : null}</Row>
      <Text muted>{u.phone}</Text>

      {children}

      {family ? <Stack>
        <Row style={{ justifyContent: 'space-between' }}><Text variant="h2">Mi familia</Text><Button small kind="ghost" title={adding ? 'Cancelar' : 'Agregar'} onPress={() => setAdding(a => !a)} /></Row>
        {patients.data?.map(p => (
          <Card key={p.id}><Text variant="label">{p.full_name || 'Yo'}</Text><Text variant="small" muted>{p.relationship === 'self' ? 'Titular de la cuenta' : `${p.relationship}${p.birth_year ? ` · nació en ${p.birth_year}` : ''}`}</Text></Card>
        ))}
        {adding ? (
          <Card tone="brand">
            <Field label="Nombre completo" value={fam.fullName} onChangeText={v => setFam(f => ({ ...f, fullName: v }))} />
            <Field label="Parentesco" placeholder="Abuela, Mamá, Hijo…" value={fam.relationship} onChangeText={v => setFam(f => ({ ...f, relationship: v }))} />
            <Field label="Año de nacimiento" keyboardType="number-pad" value={fam.birthYear} onChangeText={v => setFam(f => ({ ...f, birthYear: v.replace(/\D/g, '').slice(0, 4) }))} />
            <Row><Chip label="Puede firmar por sí misma/o" selected={fam.canConsent} onPress={() => setFam(f => ({ ...f, canConsent: !f.canConsent }))} /></Row>
            <Text variant="tiny" muted>A los menores de edad nunca les pedimos datos biométricos. Si no puede firmar, firmarás tú como su representante.</Text>
            <Button title="Guardar" loading={addFamily.isPending} disabled={fam.fullName.trim().length < 3 || fam.relationship.trim().length < 2} onPress={() => addFamily.mutate()} />
            {addFamily.error ? <Notice tone="danger">{(addFamily.error as Error).message}</Notice> : null}
          </Card>
        ) : null}
      </Stack> : null}

      <Stack>
        <Text variant="h2">Notificaciones</Text>
        {notifications.data?.slice(0, 8).map(n => <Card key={n.id}><Text variant="small">{n.body}</Text></Card>)}
        {notifications.data?.length === 0 ? <Text muted variant="small">No tienes notificaciones.</Text> : null}
      </Stack>

      <PrivacySection />

      <Stack>
        <Button kind="ghost" testID="help" title="Ayuda y garantías" onPress={() => router.push('/help')} />
        <Button kind="line" testID="logout" title="Cerrar sesión" onPress={() => { signOut().catch(() => {}); }} />
        <Button kind="line" title="Cerrar sesión en todos mis dispositivos" loading={logoutAll.isPending} onPress={() => logoutAll.mutate()} />
        <Text variant="tiny" muted>Tus datos de salud se protegen según la Ley Orgánica de Protección de Datos Personales.</Text>
      </Stack>
    </Screen>
  );
}
