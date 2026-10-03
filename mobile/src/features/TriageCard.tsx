import { Linking } from 'react-native';
import { RED_FLAGS, triageOutcome, type RedFlag, type Triage } from '@/lib/labels';
import { Button, Card, Chip, Notice, Row, Stack, Text } from '@/ui';

// Señales de alarma. Primero una pregunta de sí o no, para que nadie confunda esta lista con «elige tus síntomas».
export function TriageCard({ value, onChange }: { value: Triage; onChange: (t: Triage) => void }) {
  const outcome = triageOutcome(value);
  const toggle = (f: RedFlag) => onChange({ ...value, flags: value.flags.includes(f) ? value.flags.filter(x => x !== f) : [...value.flags, f] });
  return (
    <Card tone={outcome === 'emergency' ? 'danger' : outcome === 'needs_clearance' ? 'warn' : undefined} testID="triage-card">
      <Text variant="h2">Revisión de seguridad</Text>
      <Text variant="small" muted>Es el mismo filtro que hace un fisio en la primera consulta: hay pocos síntomas que necesitan un médico antes que fisioterapia.</Text>
      <Text variant="label">¿Tienes ahora alguna señal de alarma?</Text>
      <Text variant="tiny" muted>Dolor en el pecho, debilidad repentina, pérdida del control de la orina, fiebre con el dolor o una caída fuerte reciente.</Text>
      <Row>
        <Chip testID="triage-no" label="No, ninguna" selected={value.answer === 'no'} onPress={() => onChange({ answer: 'no', flags: [], clearance: false })} />
        <Chip testID="triage-yes" label="Sí, tengo alguna" selected={value.answer === 'yes'} onPress={() => onChange({ ...value, answer: 'yes' })} />
      </Row>

      {value.answer === 'yes' ? (
        <Stack>
          <Text variant="label">Marca solo las que tienes ahora:</Text>
          {RED_FLAGS.map(f => (
            <Stack key={f.value} gap={2}>
              <Chip testID={`flag-${f.value}`} label={f.label} selected={value.flags.includes(f.value)} onPress={() => toggle(f.value)} />
              {'hint' in f ? <Text variant="tiny" muted style={{ marginLeft: 6 }}>{f.hint}</Text> : null}
            </Stack>
          ))}
        </Stack>
      ) : null}

      {outcome === 'emergency' ? (
        <Notice tone="danger" testID="triage-emergency">
          <Stack>
            <Text variant="label">Esto puede ser una emergencia.</Text>
            <Text variant="small">No esperes una cita: llama al 911 o ve a emergencias ahora. Si marcaste algo por error, quítalo.</Text>
            <Row>
              <Button small kind="danger" title="Llamar al 911" onPress={() => { Linking.openURL('tel:911').catch(() => {}); }} />
              <Button small kind="line" title="Me equivoqué" onPress={() => onChange({ answer: null, flags: [], clearance: false })} />
            </Row>
          </Stack>
        </Notice>
      ) : null}

      {outcome === 'needs_clearance' || (value.answer === 'yes' && value.flags.length > 0 && outcome === 'clear') ? (
        <Notice tone="warn" testID="triage-medical">
          <Stack>
            <Text variant="small">Con estos síntomas conviene que primero te vea un médico (para descartar una infección o una fractura). No es necesario llamar al 911 salvo que empeore.</Text>
            <Chip testID="triage-clearance" label="Un médico ya me revisó y me indicó fisioterapia" selected={value.clearance} onPress={() => onChange({ ...value, clearance: !value.clearance })} />
            {value.clearance ? <Text variant="tiny" muted>Tu fisio verá estas señales antes de la visita. Si puedes, sube la orden médica en la cita.</Text> : null}
          </Stack>
        </Notice>
      ) : null}
    </Card>
  );
}
