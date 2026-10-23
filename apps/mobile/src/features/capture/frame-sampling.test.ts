import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FramePruner, lumaSignature, motionScore, planSampling, RingBuffer } from './frame-sampling.ts';

describe('planSampling', () => {
  it('samples at the preferred rate when within budget', () => {
    assert.deepEqual(planSampling(60_000, 240, 1), { intervalMs: 1000, maxFrames: 240 });
    assert.equal(planSampling(60_000, 240, 2).intervalMs, 500);
  });

  it('stretches the interval for long recordings', () => {
    assert.equal(planSampling(600_000, 240, 1).intervalMs, 2500);
  });

  it('clamps the frame rate to 2 FPS', () => {
    assert.equal(planSampling(10_000, 240, 30).intervalMs, 500);
  });
});

describe('lumaSignature / motionScore', () => {
  const solid = (value: number, format = 'RGBA') => {
    const bytes = format.length;
    return lumaSignature(new Uint8Array(4 * 2 * bytes).fill(value), 4, 2, format);
  };

  it('computes one luminance value per pixel', () => {
    const signature = solid(200);
    assert.equal(signature.length, 8);
    assert.ok(signature.every((value) => value === 200));
  });

  it('respects channel order', () => {
    const red = new Uint8Array([255, 0, 0, 255]);
    assert.equal(lumaSignature(red, 1, 1, 'RGBA')[0], 76);
    assert.equal(lumaSignature(red, 1, 1, 'BGRA')[0], 29);
  });

  it('scores identical frames as still and different frames as motion', () => {
    assert.equal(motionScore(solid(100), solid(100)), 0);
    assert.ok(motionScore(solid(0), solid(255)) > 0.99);
    assert.equal(motionScore(null, solid(10)), 1);
  });
});

describe('FramePruner', () => {
  it('drops static frames but keeps periodic keyframes', () => {
    const pruner = new FramePruner({ motionThreshold: 0.05, keyframeIntervalMs: 3000 });
    const still = new Uint8Array(16).fill(50);
    const decisions = [0, 1000, 2000, 3000, 4000].map((t) => pruner.shouldKeep(t, still).keep);
    assert.deepEqual(decisions, [true, false, false, true, false]);
    assert.equal(pruner.pruned, 3);
  });

  it('keeps frames with motion', () => {
    const pruner = new FramePruner({ motionThreshold: 0.05, keyframeIntervalMs: 60_000 });
    pruner.shouldKeep(0, new Uint8Array(16).fill(0));
    assert.equal(pruner.shouldKeep(1000, new Uint8Array(16).fill(200)).keep, true);
  });
});

describe('RingBuffer', () => {
  it('evicts the oldest item when full', () => {
    const buffer = new RingBuffer<number>(3);
    assert.equal(buffer.push(1), undefined);
    buffer.push(2);
    buffer.push(3);
    assert.equal(buffer.push(4), 1);
    assert.deepEqual(buffer.drain(), [2, 3, 4]);
    assert.equal(buffer.length, 0);
  });

  it('drains in batches', () => {
    const buffer = new RingBuffer<number>(10);
    for (let i = 0; i < 7; i++) buffer.push(i);
    assert.deepEqual(buffer.drain(5), [0, 1, 2, 3, 4]);
    assert.deepEqual(buffer.drain(5), [5, 6]);
  });
});
