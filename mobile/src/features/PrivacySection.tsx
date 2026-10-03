import { Platform, Share } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { call, client } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useConfirm } from '@/ui/Confirm';
import { Button, Notice, Stack, Text } from '@/ui';

// Derechos de la LOPDP dentro de la app: descargar los datos y eliminar la cuenta.
// Eliminar la cuenta desde la app también es requisito de App Store y Google Play.
export function PrivacySection() {
  const { signOut } = useAuth();
  const [dialog, confirm] = useConfirm();

  const exportData = useMutation({
    mutationFn: async () => {
      const data = await call(() => client.GET('/v1/me/export'));
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'fisiocerca-mis-datos.json';
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        await Share.share({ title: 'Mis datos de FisioCerca', message: json });
      }
    },
  });
  const remove = useMutation({
    mutationFn: () => call(() => client.POST('/v1/me/delete')),
    onSuccess: () => { signOut().catch(() => {}); },
  });

  const askDelete = async () => {
    const ok = await confirm({
      title: '¿Eliminar tu cuenta?', danger: true, confirm: 'Eliminar mi cuenta', cancel: 'Volver',
      message: 'Borramos tus datos personales y cerramos tu sesión en todos tus dispositivos. No se puede deshacer. La historia clínica y las facturas se conservan el tiempo que exige la ley, sin tus datos de contacto.',
    });
    if (ok) remove.mutate();
  };

  return (
    <Stack>
      {dialog}
      <Text variant="h2">Privacidad</Text>
      <Button kind="line" testID="export-data" title="Descargar mis datos" loading={exportData.isPending} onPress={() => exportData.mutate()} />
      <Button kind="line" testID="delete-account" title="Eliminar mi cuenta" loading={remove.isPending} onPress={() => { askDelete().catch(() => {}); }} />
      {exportData.error ? <Notice tone="danger">{(exportData.error as Error).message}</Notice> : null}
      {remove.error ? <Notice tone="danger" testID="delete-error">{(remove.error as Error).message}</Notice> : null}
    </Stack>
  );
}
