import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceM, etaMinutes, formatDistance } from './geo';

test('distancia entre dos puntos de Quito', () => {
  // La Carolina → El Ejido: unos 3,6 km en línea recta
  const d = distanceM({ lat: -0.1807, lng: -78.4847 }, { lat: -0.2120, lng: -78.4995 });
  assert.ok(d > 3500 && d < 4000, String(d));
  assert.equal(Math.round(distanceM({ lat: -0.2, lng: -78.5 }, { lat: -0.2, lng: -78.5 })), 0);
});

test('formato de distancia y tiempo estimado', () => {
  assert.equal(formatDistance(143), '140 m');
  assert.equal(formatDistance(2480), '2.5 km');
  assert.equal(etaMinutes(50), 1);
  assert.equal(etaMinutes(5000), 18);
});
