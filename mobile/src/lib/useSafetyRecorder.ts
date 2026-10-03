import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { call, client } from '@/api/client';
import { uploadBinary } from '@/api/upload';

// Grabación de audio de seguridad por tramos de 5 minutos: cada tramo se sube al terminar, así lo grabado
// queda a salvo aunque el teléfono se apague o se pierda. Si un tramo no sube, se reintenta.
const SEGMENT_MS = 5 * 60000;
const KEEP_AWAKE_TAG = 'safety-recording';
const OPTIONS = { ...RecordingPresets.LOW_QUALITY, numberOfChannels: 1, bitRate: 32000, web: { mimeType: 'audio/webm', bitsPerSecond: 32000 } };

type Segment = { seq: number; uri: string; startedAt: string; durationMs: number; tries: number };

function contentTypeOf(uri: string, blob: Blob): string {
  if (blob.type.startsWith('audio/')) return blob.type.split(';')[0]!;
  if (uri.endsWith('.3gp')) return 'audio/3gpp';
  if (uri.endsWith('.webm')) return 'audio/webm';
  return 'audio/mp4';
}

export function useSafetyRecorder(bookingId: string, live: boolean) {
  const recorder = useAudioRecorder(OPTIONS);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const segStart = useRef(0);
  const sessionStart = useRef(0);
  const queue = useRef<Segment[]>([]);
  const busy = useRef(false);
  const rotating = useRef(false);

  const drain = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const s = queue.current[0]!;
        try {
          const blob = await (await fetch(s.uri)).blob();
          await uploadBinary(`/v1/bookings/${bookingId}/recordings?seq=${s.seq}&startedAt=${encodeURIComponent(s.startedAt)}&durationMs=${s.durationMs}`, blob, contentTypeOf(s.uri, blob));
          queue.current.shift();
          setError(null);
        } catch (e) {
          s.tries += 1;
          setError(`No se pudo subir un tramo (${(e as Error).message}). Reintentando…`);
          if (s.tries >= 5) queue.current.shift();
          await new Promise(r => setTimeout(r, Math.min(30000, 2000 * 2 ** s.tries)));
        }
        setPending(queue.current.length);
      }
    } finally {
      busy.current = false;
    }
  }, [bookingId]);

  const closeSegment = useCallback(async () => {
    await recorder.stop();
    if (recorder.uri) {
      queue.current.push({ seq: seq.current++, uri: recorder.uri, startedAt: new Date(segStart.current).toISOString(), durationMs: Date.now() - segStart.current, tries: 0 });
      setPending(queue.current.length);
      drain().catch(() => {});
    }
  }, [recorder, drain]);

  const openSegment = useCallback(async () => {
    await recorder.prepareToRecordAsync();
    recorder.record();
    segStart.current = Date.now();
  }, [recorder]);

  const start = useCallback(async () => {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { setError('Permite el uso del micrófono para grabar.'); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
    await call(() => client.POST('/v1/bookings/{id}/recording/start', { params: { path: { id: bookingId } } }));
    await openSegment();
    sessionStart.current = Date.now();
    setRecording(true);
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  }, [bookingId, openSegment]);

  const stop = useCallback(async () => {
    setRecording(false);
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    await closeSegment();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    await call(() => client.POST('/v1/bookings/{id}/recording/stop', { params: { path: { id: bookingId } } })).catch(() => {});
  }, [bookingId, closeSegment]);

  // Reloj en pantalla y cambio de tramo cada 5 minutos.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      setElapsedMs(Date.now() - sessionStart.current);
      if (rotating.current || Date.now() - segStart.current < SEGMENT_MS) return;
      rotating.current = true;
      closeSegment().then(openSegment).catch(e => setError((e as Error).message)).finally(() => { rotating.current = false; });
    }, 1000);
    return () => clearInterval(t);
  }, [recording, closeSegment, openSegment]);

  // Si la visita termina o se cancela, se detiene sola y sube lo que falte.
  useEffect(() => {
    if (!live && recording) queueMicrotask(() => { stop().catch(() => {}); });
  }, [live, recording, stop]);

  return { recording, elapsedMs, pending, error, start, stop };
}
