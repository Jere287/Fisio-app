import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { call, client } from '@/api/client';
import { session } from '@/auth/session';
import { phoneOk } from '@/lib/ecuador';
import { Button, Field, Notice, Screen, Stack, Text } from '@/ui';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');

  const send = useMutation({
    mutationFn: () => call(() => client.POST('/v1/auth/otp', { body: { phone } })),
    onSuccess: () => setStep('code'),
  });
  const verify = useMutation({
    mutationFn: () => call(() => client.POST('/v1/auth/verify', { body: { phone, code } })),
    onSuccess: async tokens => { await session.save(tokens); router.replace('/'); },
  });
  const error = (step === 'phone' ? send.error : verify.error) as Error | null;

  return (
    <Screen testID="login-screen">
      <Stack gap={6} style={{ marginTop: 40 }}>
        <Text variant="title">FisioCerca</Text>
        <Text muted>Fisioterapia a domicilio en Quito, con especialistas verificados.</Text>
      </Stack>
      {step === 'phone' ? (
        <Stack gap={12}>
          <Field label="Tu celular" testID="phone-input" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="099 123 4567"
            error={phone.length >= 10 && !phoneOk(phone) ? 'Debe tener 10 dígitos y empezar con 09.' : null} hint="Te enviaremos un código por SMS." />
          <Button testID="send-code" title="Enviar código" onPress={() => send.mutate()} loading={send.isPending} disabled={!phoneOk(phone)} />
        </Stack>
      ) : (
        <Stack gap={12}>
          <Field label="Código de 6 dígitos" testID="code-input" value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad"
            autoComplete="one-time-code" textContentType="oneTimeCode" hint={`Lo enviamos al ${phone}. Vence en 5 minutos.`} />
          <Button testID="verify-code" title="Entrar" onPress={() => verify.mutate()} loading={verify.isPending} disabled={code.length !== 6} />
          <Button kind="line" title="Cambiar número" onPress={() => { setStep('phone'); setCode(''); }} />
        </Stack>
      )}
      {error ? <Notice tone="danger" testID="login-error">{error.message}</Notice> : null}
      {__DEV__ ? <Text variant="tiny" muted>En desarrollo, el código aparece en la consola del servidor.</Text> : null}
    </Screen>
  );
}
