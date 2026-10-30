/**
 * Analysis through any OpenAI-compatible chat completions API: OpenAI, Google
 * Gemini, xAI, OpenRouter, Groq, Mistral, Together and custom endpoints.
 *
 * - Frames go in as base64 data URLs (images never leave as links).
 * - Structured output is asked for in the strongest form the endpoint
 *   accepts: a strict JSON Schema, then JSON mode, then a plain instruction.
 *   The reply is validated with the same zod schemas as Claude's; events the
 *   rules engine can't use are dropped, but the content check is required.
 * - Requests never follow redirects; custom hosts must resolve publicly.
 */

import { z } from 'zod';
import type { Discipline } from '../rules-engine/index.ts';
import { assertPublicHost } from './endpoint.ts';
import { type BatchContext, batchIntro, coachingSystemPrompt, IMAGE_SAFETY_PROMPT, systemPrompt } from './prompts.ts';
import type { ModelChoice, ProviderId, ProviderInfo } from './providers.ts';
import { BATCH_SCHEMAS, type BatchOutput, type Safety, SAFETY_SCHEMA } from './schemas.ts';
import { AnalysisError, type AnalysisProvider, type Frame } from './types.ts';

/** A 64x64 JPEG for the connection test when a key is saved. */
const TEST_IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDv6KK42GGSeURRLudugziubEYh0Wkle51YbDKspNytY7KiuX/sm+/54f8Aj6/40f2Tff8APD/x9f8AGsfrdX/n2/6+Rt9Tpf8AP1fh/mdRRXL/ANk33/PD/wAfX/Gj+yb7/nh/4+v+NH1ur/z7f9fIPqdL/n6vw/zOoorj7i3ltpAk6bWIyBkHj8K6my/48bf/AK5L/KtaGJdWTi42sZYjCqlFSUr3J65fRv8AkKQ/8C/9BNdRXL6N/wAhSH/gX/oJrLF/xafr/ka4P+FV9P0Z1FFFFd554UUUUAc94g/4/k/65D+Zrasv+PG3/wCuS/yrF8Qf8fyf9ch/M1tWX/Hjb/8AXJf5VwUP94mehiP92pk9cvo3/IUh/wCBf+gmuorl9G/5CkP/AAL/ANBNGL/i0/X/ACDB/wAKr6fozqKKKK7zzwooooA57xB/x/J/1yH8zW1Zf8eNv/1yX+VYviD/AI/k/wCuQ/ma2rL/AI8bf/rkv8q4KH+8TPQxH+7UyeuPtp3tp1mjCllzgN06YrsKg+x2v/PtD/37Fa4mhKq4uLtYywuIjSUlJXuYv9u3X/POH8j/AI0f27df884fyP8AjW19jtf+faH/AL9ij7Ha/wDPtD/37FZewxH85r9Yw3/Psxf7duv+ecP5H/Gj+3br/nnD+R/xra+x2v8Az7Q/9+xR9jtf+faH/v2KPYYj+cPrGG/59nMXl3JeSiSUKCF2/KP8+tdPZf8AHjb/APXJf5UfY7X/AJ9of+/YqZQFUKoAAGAB2rTD4eVOTlJ3uZ4nEwqwUYq1j//Z';

const REQUEST_TIMEOUT_MS = 120_000;
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

class ApiError extends Error {
  override name = 'ApiError';
  readonly status: number;
  constructor(status: number, detail: string) {
    super(detail.slice(0, 300));
    this.status = status;
  }
  get aboutImages(): boolean {
    return /image|vision|multimodal|modalit/i.test(this.message);
  }
}

interface Transport {
  fetchFn?: typeof fetch;
  retryDelayMs?: number;
}

async function request(baseUrl: string, path: string, apiKey: string, init: RequestInit, transport: Transport, attempts = 3): Promise<unknown> {
  const fetchFn = transport.fetchFn ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, (transport.retryDelayMs ?? 1000) * 2 ** (attempt - 1)));
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
      });
    } catch (error) {
      lastError = error; // network error, timeout or a redirect
      continue;
    }
    if (response.ok) return await response.json();
    const detail = await response.text().catch(() => '');
    lastError = new ApiError(response.status, detail);
    if (!RETRYABLE.has(response.status)) break;
  }
  throw lastError;
}

function toAnalysisError(error: unknown): AnalysisError {
  if (error instanceof AnalysisError) return error;
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return new AnalysisError('ai_key_rejected', 'The AI provider rejected the API key');
    if (error.status === 404) return new AnalysisError('ai_model_not_found', 'The AI provider does not have this model');
    if (error.status === 429) return new AnalysisError('ai_rate_limited', 'The AI provider is rate limiting requests', true);
    if (error.status === 400 || error.status === 413 || error.status === 422) {
      return error.aboutImages
        ? new AnalysisError('ai_model_no_vision', 'This model cannot read images')
        : new AnalysisError('ai_bad_request', 'The AI provider rejected the request');
    }
    return new AnalysisError('ai_unavailable', `AI provider error ${error.status}`, true);
  }
  return new AnalysisError('ai_unavailable', 'The AI provider could not be reached', true);
}

// JSON Schema for other providers ---------------------------------------------------------

const schemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();
const UNSUPPORTED_KEYWORDS = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key)).map(([key, value]) => [key, strip(value)]),
  );
}

/** The schema in the subset most providers accept (zod already closes every object). */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  let cached = schemaCache.get(schema);
  if (!cached) {
    cached = strip(z.toJSONSchema(schema)) as Record<string, unknown>;
    schemaCache.set(schema, cached);
  }
  return cached;
}

/** The JSON object in a reply, also when it is wrapped in a code fence or prose. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AnalysisError('ai_invalid_output', 'The AI response contained no JSON');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AnalysisError('ai_invalid_output', 'The AI response was not valid JSON');
  }
}

/**
 * Validates a batch reply. A reply that only misses null fields or carries
 * stray ones keeps its valid events; the content check must be present.
 */
export function parseBatch(discipline: Discipline, raw: unknown): BatchOutput {
  const schema = BATCH_SCHEMAS[discipline] as unknown as z.ZodObject<{ events: z.ZodArray<z.ZodObject<z.ZodRawShape>> }>;
  const strict = schema.safeParse(raw);
  if (strict.success) {
    const data = strict.data as unknown as { events: Record<string, unknown>[]; observations: string[]; safety: Safety };
    return { events: data.events, observations: data.observations.slice(0, 5), safety: data.safety };
  }
  const object = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const safety = SAFETY_SCHEMA.safeParse(object.safety);
  if (!safety.success) throw new AnalysisError('ai_invalid_output', 'The AI response did not include the content check');
  const eventSchema = schema.shape.events.element;
  const keys = Object.keys(eventSchema.shape);
  const events = (Array.isArray(object.events) ? object.events : []).flatMap((event) => {
    const source = (event && typeof event === 'object' ? event : {}) as Record<string, unknown>;
    const parsed = eventSchema.safeParse(Object.fromEntries(keys.map((key) => [key, source[key] ?? null])));
    return parsed.success ? [parsed.data as Record<string, unknown>] : [];
  });
  const observations = (Array.isArray(object.observations) ? object.observations : [])
    .filter((note): note is string => typeof note === 'string')
    .map((note) => note.slice(0, 300))
    .slice(0, 5);
  return { events, observations, safety: safety.data };
}

/** Combines the replies for one batch split across several requests. */
function mergeOutputs(outputs: BatchOutput[]): BatchOutput {
  const findings = outputs.map((output) => output.safety).filter((safety): safety is Safety => Boolean(safety));
  const flagged = findings.filter((safety) => safety.sexualContent).sort((a, b) => b.confidence - a.confidence)[0];
  return {
    events: outputs.flatMap((output) => output.events),
    observations: outputs.flatMap((output) => output.observations).slice(0, 5),
    safety: flagged ?? findings[0],
  };
}

// The provider -----------------------------------------------------------------------------

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface Reply {
  text: string;
  refused: boolean;
  truncated: boolean;
}

function readReply(body: unknown): Reply {
  const choice = (body as { choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: string }[] })?.choices?.[0];
  if (!choice?.message) throw new AnalysisError('ai_invalid_output', 'The AI provider returned no answer');
  const content = choice.message.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
    ? content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
    : '';
  return {
    text,
    refused: Boolean(choice.message.refusal) || choice.finish_reason === 'content_filter',
    truncated: choice.finish_reason === 'length',
  };
}

const MODES = ['schema', 'object', 'prompt'] as const;

export function createOpenAICompatibleProvider(options: {
  apiKey: string;
  model: string;
  baseUrl: string;
  info: ProviderInfo;
  /** Custom endpoints: check the host resolves publicly before the first request. */
  checkHost?: boolean;
} & Transport): AnalysisProvider {
  const { apiKey, model, baseUrl, info } = options;
  let hostChecked: Promise<void> | null = null;
  // Where requests start: the strongest structured-output mode this endpoint
  // has accepted so far. Each request steps down on its own, so batches
  // running at the same time can't use up each other's fallbacks.
  let startMode = 0;

  async function complete(body: Record<string, unknown>): Promise<Reply> {
    if (options.checkHost) await (hostChecked ??= assertPublicHost(baseUrl));
    try {
      return readReply(await request(baseUrl, '/chat/completions', apiKey, { method: 'POST', body: JSON.stringify(body) }, options));
    } catch (error) {
      throw error instanceof ApiError || error instanceof AnalysisError ? error : toAnalysisError(error);
    }
  }

  async function structured<T>(name: string, schema: z.ZodType, system: string, user: ContentPart[], maxTokens: number, parse: (raw: unknown) => T): Promise<T | 'refused'> {
    let modeIndex = startMode;
    for (;;) {
      const mode = MODES[modeIndex]!;
      const instruction = `Reply with only a JSON object, no markdown, that matches this JSON Schema:\n${JSON.stringify(jsonSchemaFor(schema))}`;
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'system', content: mode === 'schema' ? system : `${system}\n\n${instruction}` }, { role: 'user', content: user }],
        [info.tokenField]: maxTokens,
      };
      if (mode === 'schema') body.response_format = { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchemaFor(schema) } };
      if (mode === 'object') body.response_format = { type: 'json_object' };
      try {
        const reply = await complete(body);
        startMode = Math.max(startMode, modeIndex);
        if (reply.refused) return 'refused';
        if (reply.truncated) throw new AnalysisError('ai_truncated', 'The AI response was truncated');
        return parse(extractJson(reply.text));
      } catch (error) {
        // An endpoint without strict schemas (or JSON mode) answers 400: step down once.
        if (error instanceof ApiError && error.status === 400 && !error.aboutImages && modeIndex < MODES.length - 1) {
          modeIndex++;
          continue;
        }
        throw toAnalysisError(error);
      }
    }
  }

  const image = (data: string): ContentPart => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${data}` } });

  return {
    model,

    async analyzeBatch(context: BatchContext, frames: Frame[]): Promise<BatchOutput> {
      if (frames.length === 0) return { events: [], observations: [] };
      const outputs: BatchOutput[] = [];
      for (let start = 0; start < frames.length; start += info.maxImages) {
        const part = frames.slice(start, start + info.maxImages);
        const content: ContentPart[] = [{ type: 'text', text: batchIntro(context, part[0]!.t, part[part.length - 1]!.t) }];
        for (const frame of part) content.push({ type: 'text', text: `Frame at t=${frame.t} ms:` }, image(frame.data));
        const output = await structured('matiq_batch', BATCH_SCHEMAS[context.discipline], systemPrompt(context.discipline), content, 8000, (raw) =>
          parseBatch(context.discipline, raw)
        );
        if (output === 'refused') throw new AnalysisError('ai_refused', 'The AI provider declined to analyse this footage');
        outputs.push(output);
      }
      return mergeOutputs(outputs);
    },

    async checkImage(jpegBase64: string): Promise<Safety | null> {
      const result = await structured(
        'matiq_safety',
        SAFETY_SCHEMA,
        IMAGE_SAFETY_PROMPT,
        [{ type: 'text', text: 'Profile picture to check:' }, image(jpegBase64)],
        1000,
        (raw) => {
          const parsed = SAFETY_SCHEMA.safeParse(raw);
          if (!parsed.success) throw new AnalysisError('ai_invalid_output', 'The AI response did not match the safety schema');
          return parsed.data;
        },
      );
      return result === 'refused' ? null : result;
    },

    async coachingSummary(discipline: Discipline, digest: unknown, observations: string[]): Promise<string> {
      try {
        const reply = await complete({
          model,
          messages: [
            { role: 'system', content: coachingSystemPrompt(discipline) },
            {
              role: 'user',
              content: `Match digest (JSON):\n${JSON.stringify(digest)}\n\nSegment observations:\n${observations.map((note) => `- ${note}`).join('\n')}`,
            },
          ],
          [info.tokenField]: 1500,
        });
        return reply.refused ? '' : reply.text.trim().slice(0, 4000);
      } catch (error) {
        throw toAnalysisError(error);
      }
    },
  };
}

// Keys and models ---------------------------------------------------------------------------

const NOT_FOR_CHAT =
  /(^|[-/])(embed|embedding|whisper|tts|dall-e|davinci|babbage|moderation|transcribe|realtime|audio|imagen|veo|rerank|sora|guard)|gpt-image|-image(-|$)|search-preview|computer-use/i;

/** Whether a listed model reads images: from the listing when it says, else from the name. */
export function visionOf(provider: ProviderId, entry: Record<string, unknown>): boolean | null {
  const id = String(entry.id ?? '');
  const modalities = (entry.architecture as { input_modalities?: unknown } | undefined)?.input_modalities;
  if (Array.isArray(modalities)) return modalities.includes('image');
  const vision = (entry.capabilities as { vision?: unknown } | undefined)?.vision;
  if (typeof vision === 'boolean') return vision;
  if (NOT_FOR_CHAT.test(id)) return false;
  if (typeof entry.type === 'string' && entry.type !== 'chat') return false;
  switch (provider) {
    case 'openai':
      return /^(gpt-4o|gpt-4\.1|gpt-[5-9]|o[134])/.test(id) ? true : null;
    case 'google':
      return /^gemini/.test(id) ? true : null;
    case 'groq':
      return /llama-4|vision|scout|maverick/i.test(id);
    case 'xai':
      return /vision|grok-[4-9]/.test(id) ? true : null;
    case 'together':
      return /vision|vl\b|-vl|llama-4|gemma-3|pixtral/i.test(id) ? true : null;
    default:
      return null;
  }
}

const VISION_ORDER = (vision: boolean | null) => (vision === true ? 0 : vision === null ? 1 : 2);

/**
 * The models a key can use. null: the key was rejected. 'unlisted': the
 * endpoint has no model list (custom servers), so the model is typed in.
 */
export async function listCompatibleModels(provider: ProviderId, baseUrl: string, apiKey: string, transport: Transport = {}): Promise<
  ModelChoice[] | null | 'unlisted'
> {
  let body: unknown;
  try {
    body = await request(baseUrl, '/models', apiKey, { method: 'GET' }, transport, 2);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return 'unlisted';
    throw toAnalysisError(error);
  }
  const entries = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : [];
  const seen = new Set<string>();
  const models: ModelChoice[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String((entry as { id?: unknown }).id ?? '').replace(/^models\//, '');
    if (!/^[A-Za-z0-9._:/@+-]{1,200}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, vision: visionOf(provider, { ...(entry as Record<string, unknown>), id }) });
  }
  return models.sort((a, b) => VISION_ORDER(a.vision) - VISION_ORDER(b.vision) || a.id.localeCompare(b.id)).slice(0, 400);
}

/** One tiny picture to the chosen model: proves key, model and image support together. */
export async function testCompatibleModel(options: { apiKey: string; model: string; baseUrl: string; info: ProviderInfo } & Transport): Promise<void> {
  try {
    await request(
      options.baseUrl,
      '/chat/completions',
      options.apiKey,
      {
        method: 'POST',
        body: JSON.stringify({
          model: options.model,
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: 'Connection test from MatIQ. Reply with OK.' }, { type: 'image_url', image_url: { url: TEST_IMAGE } }],
          }],
          [options.info.tokenField]: 300,
        }),
      },
      options,
      2,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) throw new AnalysisError('key_rejected', 'The provider rejected this API key');
      if (error.status === 404) throw new AnalysisError('model_not_found', 'The provider does not have this model');
      if (error.status === 429) throw new AnalysisError('ai_rate_limited', 'The provider is rate limiting requests', true);
      if (error.status === 400 || error.status === 422) {
        throw error.aboutImages
          ? new AnalysisError('model_no_vision', 'This model cannot read images')
          : new AnalysisError('model_rejected', 'The provider would not run this model');
      }
    }
    throw toAnalysisError(error);
  }
}
