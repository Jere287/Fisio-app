import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '@/lib/geo';
import { radius, useColors } from '@/theme/tokens';
import type { PlaceMapProps, PointKind } from './types';

// Versión web con Leaflet. Por defecto usa los mapas de OpenStreetMap; para producción conviene un proveedor
// con contrato (Mapbox, MapTiler o Google) configurado en EXPO_PUBLIC_MAP_TILES.
const TILES = process.env.EXPO_PUBLIC_MAP_TILES ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const zoomFor = (spanKm: number) => Math.min(18, Math.max(10, Math.round(Math.log2((40075 * 1.5) / spanKm))));

function dot(color: string, size: number, label?: string) {
  const ring = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)`;
  const tag = label ? `<div style="position:absolute;left:50%;top:${size + 2}px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#14243A;font:600 11px system-ui;padding:2px 6px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.25)">${label.replace(/[<>&"]/g, '')}</div>` : '';
  return L.divIcon({ className: '', html: `<div style="position:relative"><div style="${ring}"></div>${tag}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export function PlaceMap({ center, spanKm = 1.2, points = [], pin, onPinChange, circle, height = 220, testID }: PlaceMapProps) {
  const c = useColors();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const onPin = useRef(onPinChange);
  useEffect(() => { onPin.current = onPinChange; }, [onPinChange]);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { attributionControl: true }).setView([center.lat, center.lng], zoomFor(spanKm));
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    L.tileLayer(TILES, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    m.on('click', e => onPin.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // El mapa se crea una sola vez; los cambios de centro y puntos se aplican en los efectos de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { map.current?.setView([center.lat, center.lng], zoomFor(spanKm)); }, [center.lat, center.lng, spanKm]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const color: Record<PointKind, string> = { home: c.brand, physio: '#2F8F6B', me: '#5B6B80' };
    if (circle) L.circle([circle.center.lat, circle.center.lng], { radius: circle.meters, color: c.brand, weight: 1.5, fillOpacity: 0.12 }).addTo(g);
    for (const p of points) {
      const mk = L.marker([p.coords.lat, p.coords.lng], { icon: dot(color[p.kind], p.kind === 'me' ? 16 : 20, p.label), keyboard: !!p.onPress, title: p.label });
      if (p.onPress) mk.on('click', () => p.onPress?.());
      mk.addTo(g);
    }
    if (pin) {
      const mk = L.marker([pin.lat, pin.lng], { icon: dot(c.brand, 24, 'Tu puerta'), draggable: true, title: 'Tu puerta' });
      mk.on('dragend', () => { const ll = mk.getLatLng(); onPin.current?.({ lat: ll.lat, lng: ll.lng } satisfies LatLng); });
      mk.addTo(g);
    }
  }, [points, pin, circle, c.brand]);

  return <div ref={el} data-testid={testID} style={{ height, borderRadius: radius.md, overflow: 'hidden', border: `1px solid ${c.line}`, zIndex: 0 }} />;
}
