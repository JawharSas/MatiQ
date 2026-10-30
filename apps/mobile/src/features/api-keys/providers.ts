/**
 * The AI providers people can use with their own key. The server
 * (supabase/functions/_shared/ai/providers.ts) has the endpoints and checks
 * every key; this list only names them and recognises keys as they're typed.
 */

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'xai' | 'openrouter' | 'groq' | 'mistral' | 'together' | 'custom';

export interface ProviderOption {
  id: ProviderId;
  name: string;
  /** Who makes it, or what it is. */
  detail: string;
  /** Where to create a key. */
  keyPage: string | null;
  /** Recognises a pasted key; null when its keys have no fixed format. */
  pattern: RegExp | null;
}

export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  { id: 'anthropic', name: 'Claude', detail: 'Anthropic', keyPage: 'console.anthropic.com', pattern: /^sk-ant-/ },
  { id: 'openai', name: 'ChatGPT', detail: 'OpenAI', keyPage: 'platform.openai.com/api-keys', pattern: /^sk-(?!ant-|or-)/ },
  { id: 'google', name: 'Gemini', detail: 'Google', keyPage: 'aistudio.google.com/apikey', pattern: /^AIza/ },
  { id: 'xai', name: 'Grok', detail: 'xAI', keyPage: 'console.x.ai', pattern: /^xai-/ },
  { id: 'openrouter', name: 'OpenRouter', detail: 'Hundreds of models', keyPage: 'openrouter.ai/keys', pattern: /^sk-or-/ },
  { id: 'groq', name: 'Groq', detail: 'Fast open models', keyPage: 'console.groq.com/keys', pattern: /^gsk_/ },
  { id: 'mistral', name: 'Mistral', detail: 'Mistral AI', keyPage: 'console.mistral.ai/api-keys', pattern: null },
  { id: 'together', name: 'Together', detail: 'Together AI', keyPage: 'api.together.ai/settings/api-keys', pattern: /^tgp_/ },
  { id: 'custom', name: 'Other', detail: 'Any OpenAI-compatible service', keyPage: null, pattern: null },
];

export function providerOption(id: string): ProviderOption {
  return PROVIDER_OPTIONS.find((option) => option.id === id) ?? PROVIDER_OPTIONS[PROVIDER_OPTIONS.length - 1]!;
}

/** The provider a pasted key belongs to, when its format says so. */
export function detectProvider(key: string): ProviderId | null {
  const trimmed = key.trim();
  if (trimmed.length < 8) return null;
  return PROVIDER_OPTIONS.find((option) => option.pattern?.test(trimmed))?.id ?? null;
}
