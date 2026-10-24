import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { candidatesFor, choosePlan, meetsTarget, type ProbeResult } from './capture-plan.ts';

const result = (fps: 30 | 60, liveSampling: boolean, supported: boolean, selectedFps?: number): ProbeResult => ({
  candidate: { fps, liveSampling },
  supported,
  selectedFps,
});

describe('candidatesFor', () => {
  it('tries 60 FPS before 30 FPS and live sampling before record-only in auto mode', () => {
    assert.deepEqual(candidatesFor('auto'), [
      { fps: 60, liveSampling: true },
      { fps: 60, liveSampling: false },
      { fps: 30, liveSampling: true },
      { fps: 30, liveSampling: false },
    ]);
  });

  it('honours an explicit preference', () => {
    assert.ok(candidatesFor('60').every((plan) => plan.fps === 60));
    assert.ok(candidatesFor('30').every((plan) => plan.fps === 30));
  });
});

describe('choosePlan', () => {
  it('picks 60 FPS with live sampling when the device supports three streams at 60', () => {
    assert.deepEqual(choosePlan([result(60, true, true, 60)]), { fps: 60, liveSampling: true });
  });

  it('keeps 60 FPS and samples after recording when a third stream would drop the frame rate', () => {
    assert.deepEqual(choosePlan([result(60, true, true, 30), result(60, false, true, 60)]), { fps: 60, liveSampling: false });
  });

  it('accepts NTSC rates as meeting the target', () => {
    assert.equal(meetsTarget(result(60, true, true, 59.94)), true);
    assert.equal(meetsTarget(result(30, true, true, 29.97)), true);
  });

  it('falls back to 30 FPS on devices without 60 FPS support', () => {
    const plan = choosePlan([
      result(60, true, false, undefined),
      result(60, false, true, 30),
      result(30, true, true, 30),
    ]);
    assert.deepEqual(plan, { fps: 30, liveSampling: true });
  });

  it('uses the best supported rate when no candidate hits its target exactly', () => {
    assert.deepEqual(choosePlan([result(30, true, true, 25), result(30, false, true, 28)]), { fps: 30, liveSampling: false });
  });

  it('returns null when nothing usable is supported', () => {
    assert.equal(choosePlan([result(60, true, false), result(30, false, true, 15)]), null);
  });
});
