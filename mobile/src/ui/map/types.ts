import type { LatLng } from '@/lib/geo';

export type PointKind = 'home' | 'physio' | 'me';
export interface MapPoint { id: string; coords: LatLng; kind: PointKind; label?: string; onPress?: () => void }

export interface PlaceMapProps {
  /** Centro inicial. El mapa se mueve si cambia. */
  center: LatLng;
  /** Ancho aproximado visible, en kilómetros. */
  spanKm?: number;
  points?: MapPoint[];
  /** Punto editable (la puerta del paciente): se mueve tocando el mapa o arrastrándolo. */
  pin?: LatLng | null;
  onPinChange?: (c: LatLng) => void;
  /** Círculo, por ejemplo la geocerca de 150 m. */
  circle?: { center: LatLng; meters: number };
  height?: number;
  testID?: string;
}
