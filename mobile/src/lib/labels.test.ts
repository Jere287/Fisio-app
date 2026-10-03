import assert from 'node:assert/strict';
import { test } from 'node:test';
import { triageOutcome } from './labels';

test('el triaje exige responder antes de reservar', () => {
  assert.equal(triageOutcome({ answer: null, flags: [], clearance: false }), 'unanswered');
  assert.equal(triageOutcome({ answer: 'yes', flags: [], clearance: false }), 'unanswered');
  assert.equal(triageOutcome({ answer: 'no', flags: [], clearance: false }), 'clear');
});

test('una señal de emergencia nunca se puede reservar, aunque haya autorización', () => {
  assert.equal(triageOutcome({ answer: 'yes', flags: ['sudden_weakness'], clearance: true }), 'emergency');
  assert.equal(triageOutcome({ answer: 'yes', flags: ['fever', 'chest_pain_or_breathless'], clearance: true }), 'emergency');
});

test('las señales de «médico primero» se reservan con autorización médica', () => {
  assert.equal(triageOutcome({ answer: 'yes', flags: ['major_trauma'], clearance: false }), 'needs_clearance');
  assert.equal(triageOutcome({ answer: 'yes', flags: ['major_trauma', 'fever'], clearance: true }), 'clear');
});
