import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { call, client } from '@/api/client';

const MIN_INTERVAL_MS = 10000;

// Mientras el fisio va en camino, envía su ubicación cada ~10 s (o cada 25 m) para que el paciente lo vea en el mapa.
// Solo en primer plano: para seguirlo con la pantalla apagada hace falta permiso de ubicación en segundo plano (pendiente).
export function useShareLocation(bookingId: string, active: boolean) {
  const [state, setState] = useState<{ distanceM: number | null; error: string | null }>({ distanceM: null, error: null });

  useEffect(() => {
    if (!active) return;
    let alive = true, last = 0;
    let sub: Location.LocationSubscription | null = null;
    const send = async (lat: number, lng: number) => {
      const r = await call(() => client.POST('/v1/bookings/{id}/location', { params: { path: { id: bookingId } }, body: { lat, lng } }));
      if (alive) setState({ distanceM: r.distanceM, error: null });
    };
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (alive) setState(s => ({ ...s, error: 'Activa la ubicación para que el paciente vea que vas en camino.' }));
        return;
      }
      const s = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: MIN_INTERVAL_MS, distanceInterval: 25 }, pos => {
        const now = Date.now();
        if (now - last < MIN_INTERVAL_MS) return;
        last = now;
        send(pos.coords.latitude, pos.coords.longitude).catch(() => { if (alive) setState(st => ({ ...st, error: 'No pudimos enviar tu ubicación. Reintentando…' })); });
      });
      if (alive) sub = s; else s.remove();
    })().catch(() => { if (alive) setState(s => ({ ...s, error: 'No pudimos leer tu ubicación.' })); });
    return () => { alive = false; sub?.remove(); };
  }, [bookingId, active]);

  return state;
}
