// deno test --allow-env supabase/functions/
import { errorResponse, HttpError, json, SECURITY_HEADERS } from './http.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('every response carries the security headers', () => {
  for (const response of [json({ ok: true }), errorResponse(new HttpError(403, 'forbidden'), 'req-1')]) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert(response.headers.get(name) === value, `${name} on ${response.status}`);
    }
  }
  const csp = SECURITY_HEADERS['Content-Security-Policy'] ?? '';
  assert(csp.includes("default-src 'none'") && csp.includes("frame-ancestors 'none'"), 'locked-down CSP');
  assert((SECURITY_HEADERS['Strict-Transport-Security'] ?? '').startsWith('max-age=63072000'), 'two-year HSTS');
});

Deno.test('error responses never echo internal details', async () => {
  const body = await errorResponse(new HttpError(500, 'internal_error', 'Something went wrong'), 'req-2').json();
  assert(JSON.stringify(Object.keys(body.error)) === '["code","message","requestId"]', 'only code, message and request id');
});
