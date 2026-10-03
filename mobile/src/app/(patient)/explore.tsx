import { useState } from 'react';
import { router } from 'expo-router';
import { useMe, useSearch } from '@/api/queries';
import { money } from '@/lib/format';
import { SPECIALTIES, specialtyLabel } from '@/lib/labels';
import { useCoords } from '@/lib/useLocation';
import { PlaceMap, type MapPoint } from '@/ui/map';
import { Avatar, Badge, Button, Card, Chip, Empty, ErrorState, Loading, Row, Screen, Stack, Text } from '@/ui';

export default function Explore() {
  const me = useMe();
  const { coords, precise, refresh } = useCoords();
  const [specialty, setSpecialty] = useState<string | undefined>();
  const [women, setWomen] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const search = useSearch({ lat: coords.lat, lng: coords.lng, specialty, women: women || undefined });
  const first = me.data?.user.full_name?.split(' ')[0];

  return (
    <Screen testID="explore-screen">
      <Stack gap={4}>
        <Text variant="title">{first ? `Hola, ${first}` : 'Hola'}</Text>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text muted variant="small">{precise ? 'Especialistas cerca de tu ubicación' : 'Mostrando especialistas cerca de La Carolina'}</Text>
          {!precise ? <Button small kind="ghost" title="Usar mi ubicación" onPress={() => { refresh().catch(() => {}); }} /> : null}
        </Row>
      </Stack>
      <Row>
        <Chip label="Solo mujeres" selected={women} onPress={() => setWomen(w => !w)} />
        <Chip label="Todas" selected={!specialty} onPress={() => setSpecialty(undefined)} />
        {SPECIALTIES.map(s => <Chip key={s.value} testID={`spec-${s.value}`} label={s.label} selected={specialty === s.value} onPress={() => setSpecialty(s.value)} />)}
      </Row>
      {search.isPending ? <Loading /> : search.isError ? <ErrorState error={search.error} onRetry={() => search.refetch()} /> : search.data.length === 0 ? (
        <Empty title="Sin especialistas con ese filtro" subtitle="Prueba con otra especialidad o quita el filtro." />
      ) : (
        <Stack gap={10}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="h2">{search.data.length} {search.data.length === 1 ? 'especialista' : 'especialistas'} cerca de ti</Text>
            <Row gap={6}>
              <Chip testID="view-list" label="Lista" selected={view === 'list'} onPress={() => setView('list')} />
              <Chip testID="view-map" label="Mapa" selected={view === 'map'} onPress={() => setView('map')} />
            </Row>
          </Row>
          {view === 'map' ? (
            <Stack>
              <PlaceMap testID="explore-map" center={coords} spanKm={6} height={360} points={[
                { id: 'me', coords, kind: 'me', label: 'Tú' },
                ...search.data.map((p): MapPoint => ({ id: p.id, coords: { lat: p.approx_lat, lng: p.approx_lng }, kind: 'physio', label: `${p.full_name?.split(' ')[0] ?? ''} · ${money(p.price_cents)}`, onPress: () => router.push(`/physio/${p.id}`) })),
              ]} />
              <Text variant="tiny" muted>Por seguridad, mostramos la zona aproximada de cada especialista, no su domicilio. Toca un punto para ver el perfil.</Text>
            </Stack>
          ) : null}
          {view === 'list' && search.data.map(p => (
            <Card key={p.id} testID={`physio-${p.id}`} onPress={() => router.push(`/physio/${p.id}`)}>
              <Row gap={12} style={{ flexWrap: 'nowrap' }}>
                <Avatar name={p.full_name} />
                <Stack gap={2} style={{ flex: 1 }}>
                  <Text variant="label">{p.full_name}</Text>
                  <Text variant="small" muted numberOfLines={1}>{p.specialties.map(specialtyLabel).join(' · ')}</Text>
                  <Text variant="small" muted>{p.rating ? `★ ${p.rating} (${p.ratingCount})` : 'Nuevo'} · {p.distanceKm} km</Text>
                </Stack>
                <Stack gap={4} style={{ alignItems: 'flex-end' }}>
                  <Text variant="label">{money(p.price_cents)}</Text>
                  {p.available ? <Badge label="Disponible" /> : <Badge tone="brand" label="Agenda" />}
                </Stack>
              </Row>
            </Card>
          ))}
        </Stack>
      )}
    </Screen>
  );
}
