/**
 * The AI providers MatIQ can analyse with, for people's own keys and for the
 * platform key. Claude runs on the Anthropic SDK; every other provider is
 * reached through its OpenAI-compatible chat completions API (see
 * openai-compatible.ts). "custom" is any other OpenAI-compatible endpoint the
 * person points at: only public https hosts are accepted.
 */

import { createAnthropicProvider, listAnthropicModels } from './anthropic.ts';
import { assertPublicHost, normalizeBaseUrl } from './endpoint.ts';
import { createOpenAICompatibleProvider, listCompatibleModels, testCompatibleModel } from './openai-compatible.ts';
import { AnalysisError, type AnalysisProvider } from './types.ts';
import { ConfigError, env } from '../env.ts';

export const PROVIDER_IDS = ['anthropic', 'openai', 'google', 'xai', 'openrouter', 'groq', 'mistral', 'together', 'custom'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Any printable key without spaces, for providers without a fixed format. */
const ANY_KEY = /^[\x21-\x7e]{8,500}$/;

export interface ProviderInfo {
  label: string;
  /** Fixed endpoint; absent for Anthropic (SDK) and custom (the person's own). */
  baseUrl?: string;
  keyPattern: RegExp;
  /** Most images one request may carry; larger batches are split. */
  maxImages: number;
  /** OpenAI's newer models only accept max_completion_tokens. */
  tokenField: 'max_tokens' | 'max_completion_tokens';
  /** Preferred models, best first, matched against the models the key can use. */
  preferred: RegExp[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,250}$/,
    maxImages: 100,
    tokenField: 'max_tokens',
    preferred: [/^claude-opus-\d/, /^claude-sonnet-\d/],
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyPattern: /^sk-(?!ant-|or-)[A-Za-z0-9_-]{20,300}$/,
    maxImages: 20,
    tokenField: 'max_completion_tokens',
    preferred: [/^gpt-\d+(\.\d+)?$/, /^gpt-\d+(\.\d+)?-mini$/, /^gpt-4\.1$/, /^gpt-4o$/],
  },
  google: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyPattern: /^AIza[0-9A-Za-z_-]{30,60}$/,
    maxImages: 20,
    tokenField: 'max_tokens',
    preferred: [/^gemini-[\d.]+-pro$/, /^gemini-[\d.]+-flash$/],
  },
  xai: {
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    keyPattern: /^xai-[A-Za-z0-9_-]{20,300}$/,
    maxImages: 10,
    tokenField: 'max_tokens',
    preferred: [/^grok-\d+(\.\d+)?$/, /^grok-\d+(\.\d+)?-fast/, /vision/],
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPattern: /^sk-or-[A-Za-z0-9_-]{20,300}$/,
    maxImages: 10,
    tokenField: 'max_tokens',
    preferred: [/^anthropic\/claude-opus/, /^anthropic\/claude-sonnet/, /^openai\/gpt-\d+(\.\d+)?$/, /^google\/gemini-[\d.]+-pro$/],
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPattern: /^gsk_[A-Za-z0-9]{20,300}$/,
    maxImages: 5,
    tokenField: 'max_tokens',
    preferred: [/llama-4-maverick/, /llama-4-scout/, /vision/],
  },
  mistral: {
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyPattern: /^[A-Za-z0-9]{24,64}$/,
    maxImages: 8,
    tokenField: 'max_tokens',
    preferred: [/^mistral-medium-latest$/, /^pixtral-large-latest$/, /^mistral-small-latest$/],
  },
  together: {
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    keyPattern: ANY_KEY,
    maxImages: 8,
    tokenField: 'max_tokens',
    preferred: [/Llama-4-Maverick/i, /Llama-4-Scout/i, /Qwen.*VL/i],
  },
  custom: {
    label: 'Other (OpenAI-compatible)',
    keyPattern: ANY_KEY,
    maxImages: 8,
    tokenField: 'max_tokens',
    preferred: [],
  },
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

export { assertPublicHost, normalizeBaseUrl } from './endpoint.ts';

// Choosing a model ------------------------------------------------------------------------

export interface ModelChoice {
  id: string;
  /** true: reads images; false: does not; null: unknown. */
  vision: boolean | null;
}

/** Newest first within a pattern: "gemini-3.1-pro" before "gemini-2.5-pro". */
function newestFirst(a: string, b: string): number {
  return b.localeCompare(a, 'en', { numeric: true });
}

export function suggestModel(provider: ProviderId, models: readonly ModelChoice[]): string | null {
  const usable = models.filter((model) => model.vision !== false).map((model) => model.id);
  for (const pattern of PROVIDERS[provider].preferred) {
    const match = usable.filter((id) => pattern.test(id)).sort(newestFirst)[0];
    if (match) return match;
  }
  return models.find((model) => model.vision === true)?.id ?? usable[0] ?? null;
}

// Creating providers ---------------------------------------------------------------------

export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  /** Only for custom. */
  baseUrl?: string | null;
}

export function endpointFor(config: { provider: ProviderId; baseUrl?: string | null }): string {
  const fixed = PROVIDERS[config.provider].baseUrl;
  if (fixed) return fixed;
  const custom = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : null;
  if (!custom) throw new AnalysisError('base_url_rejected', 'A public https address is required for this provider');
  return custom;
}

export function createProvider(config: ProviderConfig): AnalysisProvider {
  if (config.provider === 'anthropic') {
    return createAnthropicProvider({ apiKey: config.apiKey, model: config.model, effort: env.analysisEffort() });
  }
  return createOpenAICompatibleProvider({
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: endpointFor(config),
    info: PROVIDERS[config.provider],
    checkHost: config.provider === 'custom',
  });
}

/**
 * The platform AI (used when someone analyses with the MatIQ quota). Set with
 * function secrets: AI_PROVIDER (default anthropic), AI_API_KEY (or
 * ANTHROPIC_API_KEY for Claude), AI_MODEL (required except for Claude) and
 * AI_BASE_URL for a custom endpoint. Throws ConfigError when not set up.
 */
export function platformConfig(): ProviderConfig {
  const provider = Deno.env.get('AI_PROVIDER')?.trim() || 'anthropic';
  if (!isProviderId(provider)) throw new ConfigError(`AI_PROVIDER must be one of ${PROVIDER_IDS.join(', ')}`);
  const apiKey = Deno.env.get('AI_API_KEY')?.trim() || (provider === 'anthropic' ? env.anthropicApiKey() : '');
  if (!apiKey) throw new ConfigError('Missing required secret: AI_API_KEY');
  const model = Deno.env.get('AI_MODEL')?.trim() || (provider === 'anthropic' ? env.analysisModel() : '');
  if (!model) throw new ConfigError('AI_MODEL is required for this AI provider');
  return { provider, apiKey, model, baseUrl: Deno.env.get('AI_BASE_URL')?.trim() || null };
}

export function createPlatformProvider(): AnalysisProvider {
  return createProvider(platformConfig());
}

// Checking a key ---------------------------------------------------------------------------

export interface KeyCheck {
  /** False when the endpoint has no model list (pick or type a model). */
  listed: boolean;
  models: ModelChoice[];
  suggested: string | null;
}

/** Verifies the key and lists the models it can use; null when it is rejected. */
export async function checkKey(config: Omit<ProviderConfig, 'model'>): Promise<KeyCheck | null> {
  if (config.provider === 'anthropic') {
    const ids = await listAnthropicModels(config.apiKey);
    if (!ids) return null;
    const models = ids.map((id) => ({ id, vision: true }));
    const preferred = env.analysisModel();
    return { listed: true, models, suggested: ids.includes(preferred) ? preferred : suggestModel('anthropic', models) };
  }
  const baseUrl = endpointFor(config);
  if (config.provider === 'custom') await assertPublicHost(baseUrl);
  const listing = await listCompatibleModels(config.provider, baseUrl, config.apiKey);
  if (listing === null) return null;
  if (listing === 'unlisted') return { listed: false, models: [], suggested: null };
  return { listed: true, models: listing, suggested: suggestModel(config.provider, listing) };
}

/**
 * Sends one tiny picture to the chosen model, so a key is only saved once it
 * really works for analysis (costs a fraction of a cent on the person's key).
 */
export async function testModel(config: ProviderConfig): Promise<void> {
  if (config.provider === 'anthropic') return; // models.list already proved the key; all Claude models read images
  const baseUrl = endpointFor(config);
  if (config.provider === 'custom') await assertPublicHost(baseUrl);
  await testCompatibleModel({ apiKey: config.apiKey, model: config.model, baseUrl, info: PROVIDERS[config.provider] });
}
