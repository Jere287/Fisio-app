import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { radius, useColors } from '@/theme/tokens';
import type { PlaceMapProps, PointKind } from './types';

const deg = (km: number) => km / 111;

// Mapa nativo: Apple Maps en iPhone y Google Maps en Android (en Expo Go funciona sin configurar nada;
// para la app publicada en Android hace falta la llave de Google Maps, ver README).
export function PlaceMap({ center, spanKm = 1.2, points = [], pin, onPinChange, circle, height = 220, testID }: PlaceMapProps) {
  const c = useColors();
  const ref = useRef<MapView>(null);
  const color: Record<PointKind, string> = { home: c.brand, physio: '#2F8F6B', me: '#5B6B80' };

  useEffect(() => {
    ref.current?.animateToRegion({ latitude: center.lat, longitude: center.lng, latitudeDelta: deg(spanKm), longitudeDelta: deg(spanKm) }, 300);
  }, [center.lat, center.lng, spanKm]);

  return (
    <View testID={testID} style={{ height, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: c.line }}>
      <MapView
        ref={ref}
        style={{ flex: 1 }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: deg(spanKm), longitudeDelta: deg(spanKm) }}
        onPress={onPinChange ? e => onPinChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude }) : undefined}
        toolbarEnabled={false}
        showsPointsOfInterests={false}
      >
        {circle ? <Circle center={{ latitude: circle.center.lat, longitude: circle.center.lng }} radius={circle.meters} strokeColor={c.brand} strokeWidth={1.5} fillColor="rgba(64,115,159,0.12)" /> : null}
        {points.map(p => (
          <Marker key={p.id} coordinate={{ latitude: p.coords.lat, longitude: p.coords.lng }} title={p.label} pinColor={color[p.kind]} onCalloutPress={p.onPress} />
        ))}
        {pin ? (
          <Marker draggable coordinate={{ latitude: pin.lat, longitude: pin.lng }} title="Tu puerta" pinColor={c.brand}
            onDragEnd={e => onPinChange?.({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })} />
        ) : null}
      </MapView>
    </View>
  );
}
