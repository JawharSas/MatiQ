import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { highlightText, withNames } from './labels.ts';

const names = { A: 'Alex', B: 'Jordan' };

describe('withNames', () => {
  it('names the fighters in engine labels', () => {
    assert.equal(withNames('Guard play (A on top)', names), 'Guard play (Alex on top)');
    assert.equal(withNames('B in control', names), 'Jordan in control');
    assert.equal(withNames('A riding', names), 'Alex riding');
  });

  it('leaves other words alone', () => {
    assert.equal(withNames('Standing exchange', names), 'Standing exchange');
    assert.equal(withNames('Arm-triangle Attempt BB', names), 'Arm-triangle Attempt BB');
  });
});

describe('highlightText', () => {
  it('drops the leading fighter letter and capitalises', () => {
    assert.equal(highlightText('A flurry: 7 strikes landed', 'A', names), 'Flurry: 7 strikes landed');
    assert.equal(highlightText('triangle choke attempt', 'B', names), 'Triangle choke attempt');
    assert.equal(highlightText('Takedown (+2)', 'A', names), 'Takedown (+2)');
  });
});
