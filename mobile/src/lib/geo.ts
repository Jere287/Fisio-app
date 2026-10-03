// Cálculos geográficos simples para la interfaz. La validación real (geocerca de 150 m, zona del fisio) la hace el backend.
export interface LatLng { lat: number; lng: number }

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// Tiempo estimado en Quito: ~22 km/h promedio en ciudad, más 1.3× porque las calles no van en línea recta.
export function etaMinutes(m: number): number {
  return Math.max(1, Math.round(((m * 1.3) / 1000 / 22) * 60));
}

export const midpoint = (a: LatLng, b: LatLng): LatLng => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });

// Enlaces de navegación: abren la app de mapas del teléfono con la ruta hasta la dirección.
export const googleMapsUrl = (p: LatLng) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
export const wazeUrl = (p: LatLng) => `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`;
