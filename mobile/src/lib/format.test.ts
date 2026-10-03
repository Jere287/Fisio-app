import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateLong, isoDay, money, nextDays, shortName, time } from './format';
import { cedulaError, dactilarOk, phoneOk } from './ecuador';

test('dinero en dólares', () => {
  assert.equal(money(3099), '$30.99');
  assert.equal(money(0), '$0.00');
});

test('fechas en hora de Quito', () => {
  const d = '2026-10-05T17:00:00.000Z';
  assert.equal(time(d), '12:00');
  assert.equal(dateLong(d), 'lunes 5 de octubre');
  assert.equal(isoDay(new Date('2026-10-06T03:00:00Z')), '2026-10-05'); // aún es lunes en Quito
  assert.deepEqual(nextDays(2, new Date('2026-10-05T13:00:00Z')).map(x => x.label), ['Hoy', 'Mañana']);
});

test('nombres cortos para proteger la privacidad', () => {
  assert.equal(shortName('Daniela Paredes'), 'Daniela P.');
  assert.equal(shortName('Daniela'), 'Daniela');
});

test('validaciones de Ecuador', () => {
  assert.equal(cedulaError('1710034065'), null);
  assert.match(cedulaError('1710034066')!, /verificador/);
  assert.ok(dactilarOk('V4343V4242'));
  assert.ok(!dactilarOk('V4343V424'));
  assert.ok(phoneOk('099 123 4567'));
  assert.ok(!phoneOk('022456789'));
});
