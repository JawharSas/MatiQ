/**
 * Claude-backed analysis provider.
 *
 * - Structured outputs (`output_config.format`) constrain the response to the
 *   discipline's event schema; the SDK parses and validates it.
 * - Server-side `fallbacks: "default"` lets a policy-declined request be
 *   retried on Anthropic's recommended fallback model inside the same call.
 * - The API key is either the platform key (secret) or the user's decrypted
 *   BYOK key; it only ever lives in memory for the duration of the request.
 */

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { Discipline } from '../rules-engine/index.ts';
import { type BatchContext, batchIntro, coachingSystemPrompt, systemPrompt } from './prompts.ts';
import { BATCH_SCHEMAS, type BatchOutput } from './schemas.ts';

export interface Frame {
  t: number;
  /** Base64-encoded JPEG. */
  data: string;
}

export class AnalysisError extends Error {
  override name = 'AnalysisError';
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface AnalysisProvider {
  readonly model: string;
  analyzeBatch(context: BatchContext, frames: Frame[]): Promise<BatchOutput>;
  coachingSummary(discipline: Discipline, digest: unknown, observations: string[]): Promise<string>;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function createAnthropicProvider(options: {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
}): AnalysisProvider {
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 120_000 });

  async function call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new AnalysisError('ai_key_rejected', 'The AI provider rejected the API key');
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new AnalysisError('ai_rate_limited', 'The AI provider is rate limiting requests', true);
      }
      if (error instanceof Anthropic.BadRequestError) {
        throw new AnalysisError('ai_bad_request', `The AI provider rejected the request: ${error.message}`);
      }
      if (error instanceof Anthropic.APIError) {
        throw new AnalysisError('ai_unavailable', `AI provider error ${error.status ?? ''}`.trim(), true);
      }
      throw error;
    }
  }

  return {
    model: options.model,

    async analyzeBatch(context, frames) {
      if (frames.length === 0) return { events: [], observations: [] };
      const first = frames[0]!.t;
      const last = frames[frames.length - 1]!.t;

      const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: batchIntro(context, first, last) }];
      for (const frame of frames) {
        content.push({ type: 'text', text: `Frame at t=${frame.t} ms:` });
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame.data } });
      }

      const response = await call(() =>
        client.beta.messages.parse({
          model: options.model,
          max_tokens: 16000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: [{ type: 'text', text: systemPrompt(context.discipline), cache_control: { type: 'ephemeral' } }],
          output_config: { effort: options.effort, format: betaZodOutputFormat(BATCH_SCHEMAS[context.discipline]) },
          messages: [{ role: 'user', content }],
        })
      );

      if (response.stop_reason === 'refusal') {
        throw new AnalysisError('ai_refused', 'The AI provider declined to analyse this footage');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AnalysisError('ai_truncated', 'The AI response was truncated');
      }
      const parsed = response.parsed_output;
      if (!parsed) throw new AnalysisError('ai_invalid_output', 'The AI response did not match the event schema');

      return {
        events: parsed.events as Record<string, unknown>[],
        observations: parsed.observations.slice(0, 5),
      };
    },

    async coachingSummary(discipline, digest, observations) {
      const response = await call(() =>
        client.beta.messages.create({
          model: options.model,
          max_tokens: 4000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: coachingSystemPrompt(discipline),
          output_config: { effort: 'low' },
          messages: [
            {
              role: 'user',
              content: `Match digest (JSON):\n${JSON.stringify(digest)}\n\nSegment observations:\n${observations
                .map((note) => `- ${note}`)
                .join('\n')}`,
            },
          ],
        })
      );
      if (response.stop_reason === 'refusal') return '';
      return response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim()
        .slice(0, 4000);
    },
  };
}

/** Cheap credential check used before storing a BYOK key (no tokens billed). */
export async function verifyAnthropicKey(apiKey: string): Promise<boolean> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
  try {
    await client.models.list({ limit: 1 });
    return true;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return false;
    throw new AnalysisError('ai_unavailable', 'Could not verify the key right now', true);
  }
}
