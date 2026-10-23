/**
 * api-keys: bring-your-own-key vault.
 *
 *   POST   { provider, apiKey, label? }  -> verify, encrypt (AES-256-GCM), store
 *   GET                                   -> list metadata (provider, last4, label, dates)
 *   DELETE ?provider=anthropic            -> remove the stored key
 *
 * The plaintext key is accepted exactly once over TLS, verified with the
 * provider, encrypted with a KEK that exists only in function secrets, and is
 * never returned, logged, or stored on the device.
 */

import { z } from 'zod';
import { verifyAnthropicKey } from '../_shared/ai/anthropic.ts';
import { encryptSecret, fingerprintSecret, lastFour } from '../_shared/crypto.ts';
import { HttpError, json, readJson, sanitizeText } from '../_shared/http.ts';
import { createHandler, enforceRateLimit, type RequestContext } from '../_shared/middleware.ts';

const PROVIDERS = ['anthropic'] as const;

const KEY_FORMATS: Record<(typeof PROVIDERS)[number], RegExp> = {
  anthropic: /^sk-ant-[A-Za-z0-9_-]{20,250}$/,
};

const storeSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    apiKey: z.string().min(20).max(300),
    label: z.string().max(40).optional(),
  })
  .strict();

async function storeKey(ctx: RequestContext): Promise<Response> {
  // Stricter limit for writes: key verification calls the provider.
  await enforceRateLimit(ctx.admin, `api-keys:write:${ctx.user.id}`, { max: 10, windowSeconds: 3600 });

  const body = await readJson(ctx.req, storeSchema, 2048);
  const apiKey = body.apiKey.trim();
  if (!KEY_FORMATS[body.provider].test(apiKey)) {
    throw new HttpError(422, 'invalid_key_format', 'That does not look like a valid API key');
  }
  if (!(await verifyAnthropicKey(apiKey))) {
    throw new HttpError(422, 'key_rejected', 'The provider rejected this API key');
  }

  const encrypted = await encryptSecret(apiKey, ctx.user.id, body.provider);
  const label = body.label ? sanitizeText(body.label, 40) || null : null;
  const { error } = await ctx.admin.rpc('svc_upsert_api_key', {
    p_user_id: ctx.user.id,
    p_provider: body.provider,
    p_ciphertext: encrypted.ciphertext,
    p_iv: encrypted.iv,
    p_key_version: encrypted.keyVersion,
    p_last4: lastFour(apiKey),
    p_fingerprint: await fingerprintSecret(apiKey),
    p_label: label,
  });
  if (error) throw new Error(`storing key failed: ${error.message}`);

  ctx.log.info('api key stored', { provider: body.provider, keyVersion: encrypted.keyVersion });
  return json({ provider: body.provider, last4: lastFour(apiKey), label }, 201);
}

async function listKeys(ctx: RequestContext): Promise<Response> {
  const { data, error } = await ctx.admin.rpc('svc_list_api_keys', { p_user_id: ctx.user.id });
  if (error) throw new Error(`listing keys failed: ${error.message}`);
  return json({ keys: data ?? [] });
}

async function deleteKey(ctx: RequestContext): Promise<Response> {
  const provider = z.enum(PROVIDERS).safeParse(ctx.url.searchParams.get('provider'));
  if (!provider.success) throw new HttpError(422, 'validation_failed', 'provider is required');

  const { data, error } = await ctx.admin.rpc('svc_delete_api_key', { p_user_id: ctx.user.id, p_provider: provider.data });
  if (error) throw new Error(`deleting key failed: ${error.message}`);
  if (data !== true) throw new HttpError(404, 'not_found');

  ctx.log.info('api key deleted', { provider: provider.data });
  return json({ deleted: true });
}

Deno.serve(
  createHandler({ name: 'api-keys', methods: ['GET', 'POST', 'DELETE'], rateLimit: { max: 60, windowSeconds: 60 } }, (ctx) => {
    switch (ctx.req.method) {
      case 'POST':
        return storeKey(ctx);
      case 'DELETE':
        return deleteKey(ctx);
      default:
        return listKeys(ctx);
    }
  }),
);
