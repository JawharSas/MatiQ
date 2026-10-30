// deno test --allow-env supabase/functions/
import { assertPublicHost, normalizeBaseUrl } from './endpoint.ts';
import { createOpenAICompatibleProvider, listCompatibleModels, testCompatibleModel } from './openai-compatible.ts';
import { platformConfig, PROVIDERS, suggestModel } from './providers.ts';
import type { AnalysisError } from './types.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Call {
  url: string;
  body: Record<string, unknown> | null;
}

/** A fake API: answers each request with the next queued response. */
function fakeApi(responses: (Response | (() => Response))[]) {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('no response queued'));
    return Promise.resolve(typeof next === 'function' ? next() : next);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status });
const reply = (content: string, finish = 'stop') => ok({ choices: [{ message: { content }, finish_reason: finish }] });

const clean = { sexualContent: false, confidence: 0.95 };
const frames = (count: number) => Array.from({ length: count }, (_, i) => ({ t: i * 1000, data: 'AAAA' }));
const context = { discipline: 'bjj' as const, variant: 'ibjjf', durationMs: 60_000, batchIndex: 0, batchCount: 1 };

async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return (error as AnalysisError).code ?? (error as Error).message;
  }
  return 'no error';
}

Deno.test('custom endpoints must be public https hosts', () => {
  assert(normalizeBaseUrl('https://api.example.com/v1/') === 'https://api.example.com/v1', 'normalized');
  assert(normalizeBaseUrl('https://llm.example.org') === 'https://llm.example.org', 'no path');
  for (
    const bad of [
      'http://api.example.com/v1',
      'https://10.0.0.5/v1',
      'https://[::1]/v1',
      'https://localhost/v1',
      'https://models.internal/v1',
      'https://api.example.com:8443/v1',
      'https://user:pass@api.example.com/v1',
      'https://api.example.com/v1?x=1',
      'not a url',
    ]
  ) assert(normalizeBaseUrl(bad) === null, `refused: ${bad}`);
});

Deno.test('a public name that resolves to a private address is refused', async () => {
  const resolver = (addresses: Record<string, string[]>) =>
    ((_host: string, type: string) => Promise.resolve(addresses[type] ?? [])) as unknown as typeof Deno.resolveDns;
  assert(
    (await codeOf(assertPublicHost('https://evil.example.com/v1', resolver({ A: ['169.254.169.254'] })))) === 'base_url_rejected',
    'metadata address refused',
  );
  assert((await codeOf(assertPublicHost('https://x.example.com', resolver({ AAAA: ['fd00::1'] })))) === 'base_url_rejected', 'ULA refused');
  assert((await codeOf(assertPublicHost('https://api.example.com', resolver({ A: ['93.184.216.34'] })))) === 'no error', 'public is fine');
});

Deno.test('the best model the key can use is suggested', () => {
  const openai = ['gpt-4o', 'gpt-5', 'gpt-5-mini', 'text-embedding-3-small'].map((id) => ({ id, vision: id.startsWith('gpt') }));
  assert(suggestModel('openai', openai) === 'gpt-5', `openai: ${suggestModel('openai', openai)}`);
  const google = ['gemini-2.5-flash', 'gemini-3.1-pro', 'gemini-2.5-pro'].map((id) => ({ id, vision: true }));
  assert(suggestModel('google', google) === 'gemini-3.1-pro', 'newest pro first');
  assert(suggestModel('custom', [{ id: 'my-model', vision: null }]) === 'my-model', 'custom: the first one');
  assert(suggestModel('groq', [{ id: 'llama-3.1-8b', vision: false }]) === null, 'never a text-only model');
});

Deno.test('model lists: vision from the listing or the name, rejected keys, unlisted servers', async () => {
  const openrouter = fakeApi([ok({
    data: [
      { id: 'anthropic/claude-opus-5-5', architecture: { input_modalities: ['text', 'image'] } },
      { id: 'deepseek/deepseek-chat', architecture: { input_modalities: ['text'] } },
    ],
  })]);
  const models = await listCompatibleModels('openrouter', 'https://openrouter.ai/api/v1', 'sk-or-x', openrouter);
  assert(Array.isArray(models) && models[0]!.vision === true && models[1]!.vision === false, `openrouter: ${JSON.stringify(models)}`);
  assert(openrouter.calls[0]!.url === 'https://openrouter.ai/api/v1/models', 'lists models');

  const gemini = await listCompatibleModels('google', 'https://g.example.com', 'AIza', fakeApi([ok({ data: [{ id: 'models/gemini-3.1-pro' }, { id: 'models/text-embedding-004' }] })]));
  assert(Array.isArray(gemini) && gemini[0]!.id === 'gemini-3.1-pro' && gemini[0]!.vision === true, `gemini: ${JSON.stringify(gemini)}`);
  assert(gemini[1]!.vision === false, 'embeddings are not for chat');

  assert((await listCompatibleModels('openai', 'https://a.example.com', 'sk-x', fakeApi([fail(401, 'bad key')]))) === null, 'rejected key');
  assert((await listCompatibleModels('custom', 'https://a.example.com', 'k', fakeApi([fail(404, 'no route')]))) === 'unlisted', 'no list');
});

Deno.test('analysis steps down from strict schemas to JSON mode and keeps the mode', async () => {
  const event = { type: 'takedown', t: 1000, athlete: 'A', confidence: 0.9, colour: 'blue' }; // missing nulls, one stray field
  const api = fakeApi([
    fail(400, 'response_format json_schema is not supported'),
    reply('```json\n' + JSON.stringify({ events: [event], observations: ['Good base'], safety: clean }) + '\n```'),
    reply(JSON.stringify({ events: [], observations: [], safety: { sexualContent: true, confidence: 0.9 } })),
  ]);
  const provider = createOpenAICompatibleProvider({
    apiKey: 'gsk_x',
    model: 'llama-4-scout',
    baseUrl: 'https://api.groq.com/openai/v1',
    info: PROVIDERS.groq, // five images per request
    fetchFn: api.fetchFn,
    retryDelayMs: 0,
  });
  const output = await provider.analyzeBatch(context, frames(8));
  assert(api.calls.length === 3, `one failed and two split requests, got ${api.calls.length}`);
  assert((api.calls[0]!.body!.response_format as { type: string }).type === 'json_schema', 'tries strict first');
  assert((api.calls[1]!.body!.response_format as { type: string }).type === 'json_object', 'then JSON mode');
  assert((api.calls[2]!.body!.response_format as { type: string }).type === 'json_object', 'and stays there');
  const images = (call: Call) => (call.body!.messages as { content: unknown }[])[1]!.content as { type: string }[];
  assert(images(api.calls[1]!).filter((part) => part.type === 'image_url').length === 5, 'at most five pictures per request');
  assert(images(api.calls[2]!).filter((part) => part.type === 'image_url').length === 3, 'the rest in the next');
  assert(output.events.length === 1 && output.events[0]!.position === null, `the event is kept with nulls filled: ${JSON.stringify(output.events)}`);
  assert(output.safety?.sexualContent === true, 'a flagged part flags the batch');
});

Deno.test('the content check is required, failures map to clear codes', async () => {
  const make = (responses: Response[]) =>
    createOpenAICompatibleProvider({
      apiKey: 'sk-x',
      model: 'gpt-5',
      baseUrl: 'https://api.openai.com/v1',
      info: PROVIDERS.openai,
      fetchFn: fakeApi(responses).fetchFn,
      retryDelayMs: 0,
    });
  assert((await codeOf(make([reply(JSON.stringify({ events: [], observations: [] }))]).analyzeBatch(context, frames(1)))) === 'ai_invalid_output', 'no safety');
  assert((await codeOf(make([fail(401, 'bad key')]).analyzeBatch(context, frames(1)))) === 'ai_key_rejected', '401');
  assert((await codeOf(make([fail(400, 'This model does not support image input')]).analyzeBatch(context, frames(1)))) === 'ai_model_no_vision', 'no vision');
  assert((await codeOf(make([fail(429, 'slow'), fail(429, 'slow'), fail(429, 'slow')]).analyzeBatch(context, frames(1)))) === 'ai_rate_limited', '429');
  assert((await codeOf(make([reply('{', 'length')]).analyzeBatch(context, frames(1)))) === 'ai_truncated', 'truncated');
  const refused = make([ok({ choices: [{ message: { content: null, refusal: 'no' }, finish_reason: 'stop' }] })]);
  assert((await refused.checkImage('AAAA')) === null, 'a refused picture check returns null');
});

Deno.test('OpenAI gets max_completion_tokens; the save test sends one picture', async () => {
  const api = fakeApi([reply('OK')]);
  await testCompatibleModel({ apiKey: 'sk-x', model: 'gpt-5', baseUrl: 'https://api.openai.com/v1', info: PROVIDERS.openai, ...api, retryDelayMs: 0 });
  const body = api.calls[0]!.body!;
  assert(typeof body.max_completion_tokens === 'number' && !('max_tokens' in body), 'token field');
  const parts = (body.messages as { content: { type: string; image_url?: { url: string } }[] }[])[0]!.content;
  assert(parts.some((part) => part.image_url?.url.startsWith('data:image/jpeg;base64,')), 'a data URL, never a link');

  const test = (response: Response) =>
    codeOf(testCompatibleModel({ apiKey: 'k', model: 'm', baseUrl: 'https://x.example.com', info: PROVIDERS.custom, ...fakeApi([response]), retryDelayMs: 0 }));
  assert((await test(fail(400, 'image_url is not supported for this model'))) === 'model_no_vision', 'no vision');
  assert((await test(fail(404, 'model not found'))) === 'model_not_found', 'unknown model');
  assert((await test(fail(403, 'forbidden'))) === 'key_rejected', 'bad key');
});

Deno.test('platform AI settings', () => {
  const names = ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL', 'ANTHROPIC_API_KEY', 'ANALYSIS_MODEL'];
  const saved = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]));
  const set = (values: Record<string, string>) => {
    for (const name of names) Deno.env.delete(name);
    for (const [name, value] of Object.entries(values)) Deno.env.set(name, value);
  };
  try {
    set({ ANTHROPIC_API_KEY: 'sk-ant-platform' });
    const claude = platformConfig();
    assert(claude.provider === 'anthropic' && claude.model === 'claude-opus-5-5' && claude.apiKey === 'sk-ant-platform', 'Claude by default');

    set({ AI_PROVIDER: 'google', AI_API_KEY: 'AIza-platform', AI_MODEL: 'gemini-3.1-pro' });
    const gemini = platformConfig();
    assert(gemini.provider === 'google' && gemini.model === 'gemini-3.1-pro', 'any provider');

    set({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-platform' });
    let missing = '';
    try {
      platformConfig();
    } catch (error) {
      missing = (error as Error).message;
    }
    assert(missing.includes('AI_MODEL'), 'other providers need a model');

    set({ AI_PROVIDER: 'skynet', AI_API_KEY: 'x' });
    let unknown = '';
    try {
      platformConfig();
    } catch (error) {
      unknown = (error as Error).message;
    }
    assert(unknown.includes('AI_PROVIDER'), 'unknown providers are refused');
  } finally {
    for (const [name, value] of Object.entries(saved)) value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
  }
});
