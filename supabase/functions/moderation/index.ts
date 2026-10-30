/**
 * moderation: checks content before other people can see it.
 *
 *   POST { action: 'avatar' }
 *     The app uploaded `avatars/{user}/pending.jpg`. The platform AI (any
 *     provider, see _shared/ai/providers.ts) checks it and it is published under a new name as the profile's
 *     avatar_path -> 200 { status: 'ok', path }.
 *     Sexual content: the picture goes to quarantine and the account is
 *     banned -> 403 banned. Declined or not a JPEG -> 422 image_rejected.
 *     No platform key configured -> 503 moderation_unavailable.
 */

import { z } from 'zod';
import { createPlatformProvider } from '../_shared/ai/providers.ts';
import { ConfigError } from '../_shared/env.ts';
import { json, readJson } from '../_shared/http.ts';
import { createHandler } from '../_shared/middleware.ts';
import { checkAvatar } from './avatar.ts';

const requestSchema = z.object({ action: z.literal('avatar') }).strict();

function platformProvider() {
  try {
    return createPlatformProvider();
  } catch (error) {
    if (error instanceof ConfigError) return null;
    throw error;
  }
}

Deno.serve(
  createHandler({ name: 'moderation', methods: ['POST'], rateLimit: { max: 20, windowSeconds: 3600 } }, async (ctx) => {
    await readJson(ctx.req, requestSchema);
    const path = await checkAvatar(ctx.admin, ctx.user.id, platformProvider(), ctx.log);
    return json({ status: 'ok', path });
  }),
);
