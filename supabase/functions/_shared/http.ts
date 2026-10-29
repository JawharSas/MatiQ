/**
 * HTTP helpers: typed errors, JSON responses with security headers, bounded
 * body parsing and strict input validation.
 */

import { z } from 'zod';
import { env } from './env.ts';

export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message?: string, headers: Record<string, string> = {}) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/**
 * Every response is JSON for the app: never cached, never sniffed, framed or
 * rendered as a page, HTTPS only, and no browser features.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** CORS headers for an allow-listed browser origin; native apps send none. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (!origin || !env.allowedOrigins().includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}

export function errorResponse(error: HttpError, requestId: string, extraHeaders: Record<string, string> = {}): Response {
  return json({ error: { code: error.code, message: error.message, requestId } }, error.status, {
    ...error.headers,
    ...extraHeaders,
  });
}

/**
 * Reads and validates a JSON body. Rejects oversized payloads before parsing
 * and returns field-level messages without echoing the submitted values.
 */
export async function readJson<T extends z.ZodType>(req: Request, schema: T, maxBytes = 16 * 1024): Promise<z.infer<T>> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large');

  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, 'payload_too_large');

  let data: unknown;
  try {
    data = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'invalid_json');
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`);
    throw new HttpError(422, 'validation_failed', fields.join('; ').slice(0, 500));
  }
  return parsed.data;
}

/** Strips control characters and bidi overrides and normalizes Unicode. */
export function sanitizeText(value: string, maxLength: number): string {
  return value
    .normalize('NFC')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '')
    .trim()
    .slice(0, maxLength);
}

export const uuidSchema = z.string().uuid();
