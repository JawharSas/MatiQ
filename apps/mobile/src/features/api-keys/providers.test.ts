import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectProvider, providerOption } from './providers.ts';

describe('detectProvider', () => {
  it('recognises keys by their prefix', () => {
    assert.equal(detectProvider('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), 'anthropic');
    assert.equal(detectProvider('sk-proj-abcdefghijklmnopqrstuvwxyz'), 'openai');
    assert.equal(detectProvider('sk-or-v1-abcdefghijklmnopqrstuvwxyz'), 'openrouter');
    assert.equal(detectProvider('AIzaSyAbcdefghijklmnopqrstuvwxyz012345'), 'google');
    assert.equal(detectProvider('xai-abcdefghijklmnopqrstuvwxyz'), 'xai');
    assert.equal(detectProvider('gsk_abcdefghijklmnopqrstuvwxyz'), 'groq');
    assert.equal(detectProvider('  tgp_v1_abcdefghijklmnopqrstuvwxyz  '), 'together');
  });

  it('leaves keys without a known format to the person', () => {
    assert.equal(detectProvider('abcdefghijklmnopqrstuvwxyz012345'), null);
    assert.equal(detectProvider('sk-'), null);
  });

  it('names every provider', () => {
    assert.equal(providerOption('google').name, 'Gemini');
    assert.equal(providerOption('nonsense').id, 'custom');
  });
});
