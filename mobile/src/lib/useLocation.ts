import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface Coords { lat: number; lng: number }
// Si la persona no da permiso, se usa La Carolina (centro-norte de Quito) para mostrar especialistas igual.
export const QUITO_DEFAULT: Coords = { lat: -0.183, lng: -78.483 };

export async function currentCoords(): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    return null;
  }
}

export function useCoords() {
  const [coords, setCoords] = useState<Coords>(QUITO_DEFAULT);
  const [precise, setPrecise] = useState(false);
  const refresh = useCallback(async () => {
    const c = await currentCoords();
    if (c) { setCoords(c); setPrecise(true); }
  }, []);
  // Primera lectura al montar; si la pantalla se cierra antes de tener respuesta, se descarta.
  useEffect(() => {
    let alive = true;
    currentCoords().then(c => { if (alive && c) { setCoords(c); setPrecise(true); } }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return { coords, precise, refresh };
}

// Dirección aproximada a partir del GPS, para no obligar a escribirla. En web no existe este servicio: devuelve null.
export async function addressFrom(c: Coords): Promise<string | null> {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lng });
    if (!a) return null;
    return [a.street && a.streetNumber ? `${a.street} ${a.streetNumber}` : a.street ?? a.name, a.district ?? a.subregion].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}
