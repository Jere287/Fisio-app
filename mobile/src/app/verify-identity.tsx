import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { call, client } from '@/api/client';
import { keys } from '@/api/queries';
import { cedulaError, dactilarOk } from '@/lib/ecuador';
import { Badge, Button, Card, Chip, Field, Notice, Row, Screen, Stack, Text } from '@/ui';

const CONSENT_VERSION = '2026-10';
type Photo = 'front' | 'back' | 'selfie';
const PHOTO_LABEL: Record<Photo, string> = { front: 'Frente de la cédula', back: 'Reverso de la cédula', selfie: 'Selfie con buena luz' };

// Verificación como en la banca: autorización expresa, cédula y código dactilar, fotos y selfie.
export default function VerifyIdentity() {
  const qc = useQueryClient();
  const [consents, setConsents] = useState({ biometric: false, registro: false });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', cedula: '', dactilar: '' });
  const [photos, setPhotos] = useState<Partial<Record<Photo, string>>>({});
  const [result, setResult] = useState<{ status: string; reason: string | null } | null>(null);

  const start = useMutation({
    mutationFn: async () => {
      await call(() => client.POST('/v1/me/consents', { body: { kind: 'biometric', version: CONSENT_VERSION } }));
      await call(() => client.POST('/v1/me/consents', { body: { kind: 'registro_civil', version: CONSENT_VERSION } }));
      return call(() => client.POST('/v1/kyc/sessions'));
    },
    onSuccess: s => setSessionId(s.sessionId),
  });

  // TODO(almacenamiento): subir la foto con la URL firmada que entrega el proveedor y enviar su clave real.
  const pick = async (kind: Photo) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, cameraType: kind === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back };
    const perm = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
    const res = perm?.granted ? await ImagePicker.launchCameraAsync(opts).catch(() => ImagePicker.launchImageLibraryAsync(opts)) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled && res.assets[0]) setPhotos(p => ({ ...p, [kind]: `upload:${kind}:${res.assets[0]!.fileName ?? Date.now()}` }));
  };

  const submit = useMutation({
    mutationFn: () => call(() => client.POST('/v1/kyc/sessions/{id}/submit', {
      params: { path: { id: sessionId! } },
      body: { ...form, frontRef: photos.front!, backRef: photos.back!, selfieRef: photos.selfie! },
    })),
    onSuccess: async r => { setResult(r); await qc.invalidateQueries({ queryKey: keys.me }); },
  });

  const agent = useMutation({
    mutationFn: () => call(() => client.POST('/v1/kyc/agent-call', { body: { slot: new Date(Date.now() + 86400000).toISOString() } })),
    onSuccess: () => setResult({ status: 'pending_agent', reason: null }),
  });

  const cErr = form.cedula.length === 10 ? cedulaError(form.cedula) : null;
  const dErr = form.dactilar.length === 10 && !dactilarOk(form.dactilar) ? 'Formato: letra, 4 números, letra, 4 números.' : null;
  const ready = form.fullName.trim().length > 4 && form.cedula.length === 10 && !cErr && dactilarOk(form.dactilar) && photos.front && photos.back && photos.selfie;

  if (result) {
    const ok = result.status === 'approved';
    return (
      <Screen testID="kyc-result">
        <Text variant="title">{ok ? '¡Listo! Identidad verificada' : result.status === 'review' ? 'Un agente revisará tus datos' : result.status === 'pending_agent' ? 'Videollamada agendada' : 'No pudimos verificar tu identidad'}</Text>
        <Text muted>{result.reason ?? (ok ? 'Ya puedes reservar sesiones.' : result.status === 'review' ? 'Te avisamos en menos de 2 horas.' : 'Te escribiremos para coordinar.')}</Text>
        {ok || result.status === 'review' ? <Button testID="kyc-continue" title="Continuar" onPress={() => router.replace('/(patient)/explore')} /> : null}
        {result.status === 'rejected' ? <Button title="Intentar de nuevo" onPress={() => { setResult(null); setSessionId(null); setPhotos({}); }} /> : null}
      </Screen>
    );
  }

  if (!sessionId) {
    return (
      <Screen testID="kyc-consent">
        <Text variant="h2">Como abrir una cuenta en el banco: unos 2 minutos</Text>
        <Text muted>Así sabemos que cada paciente y cada especialista es quien dice ser. Nadie entra a una casa sin estar verificado.</Text>
        <Card>
          <Text variant="label">Necesitamos tu autorización (Ley de Protección de Datos)</Text>
          <Chip testID="consent-biometric" selected={consents.biometric} onPress={() => setConsents(c => ({ ...c, biometric: !c.biometric }))} label="Autorizo comparar mi rostro con mi cédula" />
          <Chip testID="consent-registro" selected={consents.registro} onPress={() => setConsents(c => ({ ...c, registro: !c.registro }))} label="Autorizo consultar el Registro Civil" />
          <Text variant="tiny" muted>Guardamos una plantilla cifrada, no tu foto. Puedes revocar estos permisos cuando quieras.</Text>
        </Card>
        <Button testID="kyc-start" title="Acepto y continúo" disabled={!consents.biometric || !consents.registro} loading={start.isPending} onPress={() => start.mutate()} />
        <Button kind="line" title="Prefiero una videollamada con un agente" loading={agent.isPending} onPress={() => agent.mutate()} />
        {start.error ? <Notice tone="danger">{(start.error as Error).message}</Notice> : null}
      </Screen>
    );
  }

  return (
    <Screen testID="kyc-form">
      <Field label="Nombre completo" testID="kyc-name" value={form.fullName} onChangeText={v => setForm(f => ({ ...f, fullName: v }))} autoComplete="name" />
      <Field label="Número de cédula" testID="kyc-cedula" value={form.cedula} keyboardType="number-pad" onChangeText={v => setForm(f => ({ ...f, cedula: v.replace(/\D/g, '').slice(0, 10) }))}
        error={cErr} hint={form.cedula.length === 10 && !cErr ? 'Número válido.' : 'Revisamos el dígito verificador mientras escribes.'} />
      <Field label="Código dactilar" testID="kyc-dactilar" value={form.dactilar} autoCapitalize="characters" onChangeText={v => setForm(f => ({ ...f, dactilar: v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) }))}
        error={dErr} hint="Está en el reverso de tu cédula, junto a la huella." />
      <Stack>
        {(Object.keys(PHOTO_LABEL) as Photo[]).map(k => (
          <Row key={k} style={{ justifyContent: 'space-between' }}>
            <Text>{PHOTO_LABEL[k]}</Text>
            {photos[k] ? <Badge label="Lista" /> : <Button small kind="ghost" testID={`photo-${k}`} title={k === 'selfie' ? 'Tomar selfie' : 'Tomar foto'} onPress={() => { pick(k).catch(() => {}); }} />}
          </Row>
        ))}
      </Stack>
      <Button testID="kyc-submit" title="Verificar mi identidad" disabled={!ready} loading={submit.isPending} onPress={() => submit.mutate()} />
      {submit.error ? <Notice tone="danger">{(submit.error as Error).message}</Notice> : null}
    </Screen>
  );
}
