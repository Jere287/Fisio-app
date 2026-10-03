import { useCallback, useState } from 'react';
import { Modal, View } from 'react-native';
import { radius, space, useColors } from '@/theme/tokens';
import { Button, Text } from './index';

type Options = { title: string; message: string; confirm: string; cancel?: string; danger?: boolean };

// Confirmación para acciones que no se pueden deshacer (cancelar, reportar, alertar).
// Funciona igual en iPhone, Android y web (Alert.alert no muestra botones en web).
export function useConfirm() {
  const c = useColors();
  const [req, setReq] = useState<(Options & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback((o: Options) => new Promise<boolean>(resolve => setReq({ ...o, resolve })), []);
  const close = (ok: boolean) => { req?.resolve(ok); setReq(null); };

  const dialog = (
    <Modal transparent visible={!!req} animationType="fade" onRequestClose={() => close(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,20,35,0.45)', justifyContent: 'center', padding: space.lg }}>
        <View accessibilityViewIsModal testID="confirm-dialog" style={{ backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, gap: space.md, width: '100%', maxWidth: 420, alignSelf: 'center' }}>
          <Text variant="h2">{req?.title}</Text>
          <Text variant="small" muted>{req?.message}</Text>
          <Button testID="confirm-yes" kind={req?.danger ? 'danger' : 'primary'} title={req?.confirm ?? 'Confirmar'} onPress={() => close(true)} />
          <Button testID="confirm-no" kind="line" title={req?.cancel ?? 'Volver'} onPress={() => close(false)} />
        </View>
      </View>
    </Modal>
  );
  return [dialog, ask] as const;
}
