/**
 * Request pipeline shared by every route of the function:
 *
 *   CORS preflight -> method allow-list -> Clerk token -> bans (account and
 *   network) -> per-user rate limit -> age check -> handler -> uniform
 *   error mapping
 *
 * Unknown errors become a generic 500 with a request id; internal messages
 * and stack traces are logged (redacted) but never returned to the client.
 */

import { type Admin, admin as serviceAdmin } from './admin.ts';
import { type AppUser, authenticateRequest } from './auth.ts';
import { ConfigError } from './env.ts';
import { corsHeaders, errorResponse, HttpError } from './http.ts';
import { createLogger, type Logger } from './log.ts';
import { accessDenied, requestIps } from './moderation.ts';

export interface RequestContext {
  req: Request;
  url: URL;
  user: AppUser;
  admin: Admin;
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
  /**
   * Serve users who have not answered the age check yet. Only the account
   * function, which records the answer and handles export and deletion.
   */
  allowBeforeAgeCheck?: boolean;
}

export type Handler = (ctx: RequestContext) => Promise<Response>;

/** Atomically counts a hit and throws 429 once the window is exhausted. */
export async function enforceRateLimit(admin: Admin, key: string, limit: RateLimit): Promise<void> {
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

/** Users act only after answering the age check (mirrors `private.age_checked()`). */
export async function requireAgeCheck(admin: Admin, userId: string): Promise<void> {
  const { data, error } = await admin.rpc('svc_age_checked', { p_user_id: userId });
  if (error) throw new Error(`age check lookup failed: ${error.message}`);
  if (data !== true) throw new HttpError(403, 'age_check_required', 'Enter your birth month and year first');
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
      const admin = serviceAdmin;
      const ips = requestIps(req);
      if (await accessDenied(admin, user.id, ips)) {
        throw new HttpError(403, 'banned', 'This account or network is banned from MatIQ');
      }
      // The addresses an account uses, for network bans (Supabase's sign-in log kept these).
      if (ips[0]) {
        const { error } = await admin.rpc('svc_record_address', { p_user: user.id, p_ip: ips[0] });
        if (error) log.warn('recording the address failed', { error: error.message });
      }
      if (options.rateLimit) await enforceRateLimit(admin, `${options.name}:${user.id}`, options.rateLimit);
      if (!options.allowBeforeAgeCheck) await requireAgeCheck(admin, user.id);

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
