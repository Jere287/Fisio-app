import { useState } from 'react';
import { Pressable } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { call, client } from '@/api/client';
import { Button, Card, Field, Notice, Screen, Stack, Text } from '@/ui';

// Preguntas frecuentes y garantías. Las reglas descritas aquí son las que aplica el backend (no son solo texto).
const FAQ: [string, [string, string][]][] = [
  ['Pagos y devoluciones', [
    ['¿Cuándo se me cobra?', 'Al reservar solo retenemos el valor en tu tarjeta. Se cobra cuando la sesión termina y el especialista cierra la cita.'],
    ['¿Qué pasa si mi fisio no llega?', 'Si no llega 20 minutos después de la hora acordada, toca «Mi fisio no llegó» en tu cita. Cancelamos sin costo, liberamos el 100 % de lo retenido y te damos $5 de crédito.'],
    ['¿Qué pasa si cancelo?', 'Es gratis hasta 12 horas antes. Con menos de 12 horas se cobra el 50 %, que va al especialista por el tiempo que te reservó. Si el especialista cancela, te devolvemos todo y te damos $5 de crédito.'],
    ['¿Cuándo veo la devolución?', 'El dinero solo estaba retenido: lo liberamos al instante, pero tu banco puede tardar de 1 a 7 días hábiles en reflejarlo.'],
    ['¿Y si la sesión no fue lo que esperaba?', 'Repórtalo desde la cita dentro de 48 horas. Revisamos el caso y, si el servicio no se dio como corresponde, te devolvemos todo o una parte.'],
  ]],
  ['Salud', [
    ['¿Por qué me preguntan por señales de alarma?', 'Hay pocos síntomas que necesitan un médico antes que fisioterapia: dolor en el pecho, debilidad repentina, pérdida del control de la orina, fiebre con el dolor o una caída fuerte reciente. Los tres primeros pueden ser una emergencia (911). Para fiebre o caída, puedes reservar si un médico ya te revisó y te indicó fisioterapia.'],
    ['Tuve un ACV hace meses y me quedó debilidad, ¿la marco?', 'No. La pregunta es por debilidad que empezó de repente. Una secuela ya diagnosticada es justamente lo que trata la fisioterapia neurológica.'],
  ]],
  ['Citas para otra persona', [
    ['¿Puedo reservar para mi abuela, mi mamá o mi hijo?', 'Sí. Agrégalos en Cuenta › Mi familia y, al reservar, elige para quién es la sesión. Tú quedas como responsable de la reserva y del pago.'],
    ['¿Mi familiar necesita celular o cuenta?', 'No. Tú recibes las notificaciones, ves al fisio en el mapa y tienes el PIN. Compártelo con quien abra la puerta.'],
    ['¿Tiene que haber alguien en casa?', 'Sí, cuando la persona tiene 75 años o más, es menor de edad o no puede firmar. Un adulto responsable debe estar presente toda la sesión.'],
  ]],
  ['Seguridad y ubicación', [
    ['¿Cómo sé que el especialista es quien dice ser?', 'Verificamos su cédula con el Registro Civil, su título en la SENESCYT y el MSP, y sus antecedentes penales. Además, se toma una selfie cada día antes de conectarse.'],
    ['¿Cómo funciona la ubicación?', 'Al reservar marcas en el mapa el punto exacto de tu puerta. El fisio solo ve tu dirección después de aceptar y navega con Google Maps o Waze. Mientras viene, lo ves en el mapa con el tiempo estimado. Solo puede marcar «Llegué» a menos de 150 m de tu puerta.'],
    ['¿Ven mi ubicación todo el tiempo?', 'No. Tu ubicación solo se usa para buscar especialistas cerca y para la dirección de la cita. La del fisio se comparte solo mientras va en camino a tu casa.'],
    ['¿Qué hago si la persona en la puerta no es la del perfil?', 'No abras. Toca «No coincide» en la cita: cancelamos, suspendemos al especialista y te llama el equipo de seguridad.'],
  ]],
  ['Historia clínica y datos', [
    ['¿Quién ve mi historia clínica?', 'Tú y los especialistas que te atienden. El personal de FisioCerca no puede verla, y cada acceso queda registrado.'],
    ['¿Puedo descargar o borrar mis datos?', 'Sí, según la Ley Orgánica de Protección de Datos Personales. Escríbenos abajo. Las facturas y la historia clínica se conservan el tiempo que exige la ley.'],
  ]],
];

export default function Help() {
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const send = useMutation({ mutationFn: () => call(() => client.POST('/v1/support/tickets', { body: { reason: 'other', description: msg.trim() } })) });
  return (
    <Screen testID="help-screen">
      <Text variant="title">Ayuda y garantías</Text>
      {FAQ.map(([section, items]) => (
        <Stack key={section}>
          <Text variant="h2">{section}</Text>
          {items.map(([q, a]) => (
            <Card key={q}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === q }} onPress={() => setOpen(o => (o === q ? null : q))}>
                <Text variant="label">{q}</Text>
              </Pressable>
              {open === q ? <Text variant="small" muted>{a}</Text> : null}
            </Card>
          ))}
        </Stack>
      ))}
      <Card>
        <Text variant="h2">Escríbenos</Text>
        {send.isSuccess ? <Notice tone="ok">Recibimos tu mensaje. Te respondemos en menos de 24 horas.</Notice> : (
          <>
            <Field label="¿En qué te ayudamos?" multiline value={msg} onChangeText={setMsg} maxLength={2000} />
            {send.error ? <Notice tone="danger">{(send.error as Error).message}</Notice> : null}
            <Button title="Enviar" disabled={msg.trim().length < 5} loading={send.isPending} onPress={() => send.mutate()} />
          </>
        )}
      </Card>
    </Screen>
  );
}
