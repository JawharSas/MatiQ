/**
 * api-keys: bring-your-own-key vault, for any supported AI provider.
 *
 *   POST { action: 'check', provider, apiKey, baseUrl? }
 *        -> verify the key and list the models it can use (nothing stored)
 *   POST { action?: 'save', provider, apiKey, model?, baseUrl?, label? }
 *        -> test the model with one tiny picture, encrypt (AES-256-GCM), store,
 *           and use this key for analyses from now on
 *   POST { action: 'select', provider }  -> use this stored key for analyses
 *   GET                                   -> list metadata (provider, model, last4, label, dates)
 *   DELETE ?provider=openai               -> remove the stored key
 *
 * The plaintext key is accepted over TLS only to check and save it, verified
 * with the provider, encrypted with a KEK that exists only in function
 * secrets, and is never returned, logged, or stored on the device. Custom
 * endpoints must be public https hosts (see _shared/ai/endpoint.ts).
 */

import { z } from 'zod';
import { checkKey, endpointFor, normalizeBaseUrl, PROVIDER_IDS, PROVIDERS, type ProviderConfig, type ProviderId, testModel } from '../_shared/ai/providers.ts';
import { AnalysisError } from '../_shared/ai/types.ts';
import { encryptSecret, fingerprintSecret, lastFour } from '../_shared/crypto.ts';
import { env } from '../_shared/env.ts';
import { HttpError, json, readJson, sanitizeText } from '../_shared/http.ts';
import { createHandler, enforceRateLimit, type RequestContext } from '../_shared/middleware.ts';

const provider = z.enum(PROVIDER_IDS);
const apiKey = z.string().min(8).max(500);
const baseUrl = z.string().max(300).optional();
const model = z.string().regex(/^[A-Za-z0-9._:/@+-]{1,200}$/, 'invalid model id');

const requestSchema = z.union([
  z.object({ action: z.literal('check'), provider, apiKey, baseUrl }).strict(),
  z.object({ action: z.literal('select'), provider }).strict(),
  // Without an action: what app versions before 1.6 send.
  z.object({ action: z.literal('save').optional(), provider, apiKey, model: model.optional(), baseUrl, label: z.string().max(40).optional() })
    .strict(),
]);

/** Provider errors as answers the app can explain. */
function asHttpError(error: unknown): unknown {
  if (!(error instanceof AnalysisError)) return error;
  switch (error.code) {
    case 'key_rejected':
    case 'ai_key_rejected':
      return new HttpError(422, 'key_rejected', 'The provider rejected this API key');
    case 'model_not_found':
    case 'ai_model_not_found':
      return new HttpError(422, 'model_not_found', 'The provider does not have this model');
    case 'model_no_vision':
    case 'ai_model_no_vision':
      return new HttpError(422, 'model_no_vision', 'This model cannot read images');
    case 'model_rejected':
    case 'ai_bad_request':
      return new HttpError(422, 'model_rejected', 'The provider would not run this model');
    case 'base_url_rejected':
      return new HttpError(422, 'base_url_rejected', 'Use the public https address of the AI service');
    case 'ai_rate_limited':
      return new HttpError(429, 'provider_rate_limited', 'The provider is rate limiting requests');
    default:
      return new HttpError(503, 'provider_unavailable', 'The provider could not be reached');
  }
}

function keyFor(id: ProviderId, value: string): string {
  const key = value.trim();
  if (!PROVIDERS[id].keyPattern.test(key)) {
    throw new HttpError(422, 'invalid_key_format', `That does not look like a ${PROVIDERS[id].label} API key`);
  }
  return key;
}

/** The custom endpoint's normalized address; other providers have a fixed one. */
function baseUrlFor(id: ProviderId, value: string | undefined): string | null {
  if (id !== 'custom') return null;
  const normalized = value ? normalizeBaseUrl(value) : null;
  if (!normalized) throw new HttpError(422, 'base_url_rejected', 'Use the public https address of the AI service');
  return normalized;
}

async function checkProviderKey(ctx: RequestContext, body: { provider: ProviderId; apiKey: string; baseUrl?: string }) {
  await enforceRateLimit(ctx.admin, `api-keys:write:${ctx.user.id}`, { max: 30, windowSeconds: 3600 });
  const config = { provider: body.provider, apiKey: keyFor(body.provider, body.apiKey), baseUrl: baseUrlFor(body.provider, body.baseUrl) };
  try {
    const result = await checkKey(config);
    if (!result) throw new HttpError(422, 'key_rejected', 'The provider rejected this API key');
    return json(result);
  } catch (error) {
    throw asHttpError(error);
  }
}

async function storeKey(ctx: RequestContext, body: { provider: ProviderId; apiKey: string; model?: string; baseUrl?: string; label?: string }) {
  // Stricter limit for writes: saving calls the provider.
  await enforceRateLimit(ctx.admin, `api-keys:write:${ctx.user.id}`, { max: 30, windowSeconds: 3600 });
  const config: ProviderConfig = {
    provider: body.provider,
    apiKey: keyFor(body.provider, body.apiKey),
    model: body.model ?? (body.provider === 'anthropic' ? env.analysisModel() : ''),
    baseUrl: baseUrlFor(body.provider, body.baseUrl),
  };
  if (!config.model) throw new HttpError(422, 'validation_failed', 'Choose a model');

  try {
    if (body.provider === 'anthropic') {
      const result = await checkKey(config);
      if (!result) throw new HttpError(422, 'key_rejected', 'The provider rejected this API key');
      if (body.model && !result.models.some((choice) => choice.id === body.model)) {
        throw new HttpError(422, 'model_not_found', 'The provider does not have this model');
      }
    } else {
      endpointFor(config);
      await testModel(config);
    }
  } catch (error) {
    throw asHttpError(error);
  }

  const encrypted = await encryptSecret(config.apiKey, ctx.user.id, body.provider);
  const label = body.label ? sanitizeText(body.label, 40) || null : null;
  const { error } = await ctx.admin.rpc('svc_upsert_api_key', {
    p_user_id: ctx.user.id,
    p_provider: body.provider,
    p_ciphertext: encrypted.ciphertext,
    p_iv: encrypted.iv,
    p_key_version: encrypted.keyVersion,
    p_last4: lastFour(config.apiKey),
    p_fingerprint: await fingerprintSecret(config.apiKey),
    p_label: label,
    p_model: config.model,
    p_base_url: config.baseUrl ?? null,
  });
  if (error) throw new Error(`storing key failed: ${error.message}`);

  ctx.log.info('api key stored', { provider: body.provider, model: config.model, keyVersion: encrypted.keyVersion });
  return json({ provider: body.provider, model: config.model, last4: lastFour(config.apiKey), label }, 201);
}

async function selectKey(ctx: RequestContext, id: ProviderId): Promise<Response> {
  const { data, error } = await ctx.admin.rpc('svc_select_api_key', { p_user_id: ctx.user.id, p_provider: id });
  if (error) throw new Error(`selecting key failed: ${error.message}`);
  if (data !== true) throw new HttpError(404, 'not_found');
  return json({ provider: id, active: true });
}

async function listKeys(ctx: RequestContext): Promise<Response> {
  const { data, error } = await ctx.admin.rpc('svc_list_api_keys', { p_user_id: ctx.user.id });
  if (error) throw new Error(`listing keys failed: ${error.message}`);
  return json({ keys: data ?? [] });
}

async function deleteKey(ctx: RequestContext): Promise<Response> {
  const id = provider.safeParse(ctx.url.searchParams.get('provider'));
  if (!id.success) throw new HttpError(422, 'validation_failed', 'provider is required');

  const { data, error } = await ctx.admin.rpc('svc_delete_api_key', { p_user_id: ctx.user.id, p_provider: id.data });
  if (error) throw new Error(`deleting key failed: ${error.message}`);
  if (data !== true) throw new HttpError(404, 'not_found');

  ctx.log.info('api key deleted', { provider: id.data });
  return json({ deleted: true });
}

Deno.serve(
  createHandler({ name: 'api-keys', methods: ['GET', 'POST', 'DELETE'], rateLimit: { max: 60, windowSeconds: 60 } }, async (ctx) => {
    switch (ctx.req.method) {
      case 'POST': {
        const body = await readJson(ctx.req, requestSchema, 4096);
        if (body.action === 'check') return checkProviderKey(ctx, body);
        if (body.action === 'select') return selectKey(ctx, body.provider);
        return storeKey(ctx, body);
      }
      case 'DELETE':
        return deleteKey(ctx);
      default:
        return listKeys(ctx);
    }
  }),
);
