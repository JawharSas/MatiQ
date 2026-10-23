/**
 * Request pipeline shared by every Edge Function:
 *
 *   CORS preflight -> method allow-list -> JWT authentication ->
 *   per-user rate limit -> handler -> uniform error mapping
 *
 * Unknown errors become a generic 500 with a request id; internal messages
 * and stack traces are logged (redacted) but never returned to the client.
 */

import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ConfigError } from './env.ts';
import { corsHeaders, errorResponse, HttpError } from './http.ts';
import { createLogger, type Logger } from './log.ts';
import { adminClient, authenticateRequest } from './supabase.ts';

export interface RequestContext {
  req: Request;
  url: URL;
  user: User;
  admin: SupabaseClient;
  requestId: string;
  log: Logger;
}

export interface RateLimit {
  /** Max requests per window, per user. */
  max: number;
  windowSeconds: number;
}

export interface HandlerOptions {
  name: string;
  methods: readonly string[];
  rateLimit?: RateLimit;
}

export type Handler = (ctx: RequestContext) => Promise<Response>;

/** Atomically counts a hit and throws 429 once the window is exhausted. */
export async function enforceRateLimit(admin: SupabaseClient, key: string, limit: RateLimit): Promise<void> {
  const { data, error } = await admin.rpc('svc_check_rate_limit', {
    p_key: key,
    p_max: limit.max,
    p_window_seconds: limit.windowSeconds,
  });
  if (error) throw new Error(`rate limit check failed: ${error.message}`);
  if (data !== true) {
    throw new HttpError(429, 'rate_limited', 'Too many requests', { 'Retry-After': String(limit.windowSeconds) });
  }
}

export function createHandler(options: HandlerOptions, handler: Handler): (req: Request) => Promise<Response> {
  const baseLog = createLogger({ fn: options.name });

  return async (req: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const log = baseLog.child({ requestId });
    const cors = corsHeaders(req);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (!options.methods.includes(req.method)) {
        throw new HttpError(405, 'method_not_allowed', undefined, { Allow: options.methods.join(', ') });
      }

      const user = await authenticateRequest(req);
      const admin = adminClient();
      if (options.rateLimit) await enforceRateLimit(admin, `${options.name}:${user.id}`, options.rateLimit);

      const response = await handler({ req, url: new URL(req.url), user, admin, requestId, log: log.child({ userId: user.id }) });
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status >= 500) log.error('request failed', { code: error.code, error });
        return errorResponse(error, requestId, cors);
      }
      log.error(error instanceof ConfigError ? 'configuration error' : 'unhandled error', { error });
      return errorResponse(new HttpError(500, 'internal_error', 'Something went wrong'), requestId, cors);
    }
  };
}
