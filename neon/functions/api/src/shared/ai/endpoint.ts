/**
 * Rules for custom AI endpoints (an OpenAI-compatible service someone points
 * their own key at). The function calls it from Neon's servers, so only
 * public https hosts are allowed: never an internal address.
 */

import dns from 'node:dns/promises';
import { AnalysisError } from './types.ts';

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa', '.localdomain'];

/**
 * A custom endpoint must be a public https host: no IP literals, local names,
 * credentials, other ports, query strings or fragments. Returns the URL
 * without a trailing slash, or null.
 */
export function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  if (url.port !== '' && url.port !== '443') return null;
  if (!host.includes('.') || host.length > 253 || host === 'localhost') return null;
  if (/^[\d.]+$/.test(host) || host.startsWith('[') || host.includes(':')) return null;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  if (url.pathname.length > 200) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('::ffff:');
  }
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/**
 * Refuses a custom host that resolves to a private address (a public name
 * pointed at an internal service). Where the runtime can't resolve names,
 * the https-only and no-redirect rules still apply.
 */
export type Resolver = (host: string, type: 'A' | 'AAAA') => Promise<string[]>;

const resolveDns: Resolver = (host, type) => (type === 'A' ? dns.resolve4(host) : dns.resolve6(host));

export async function assertPublicHost(baseUrl: string, resolve: Resolver = resolveDns): Promise<void> {
  const host = new URL(baseUrl).hostname;
  let addresses: string[];
  try {
    const [v4, v6] = await Promise.all([
      resolve(host, 'A').catch(() => [] as string[]),
      resolve(host, 'AAAA').catch(() => [] as string[]),
    ]);
    addresses = [...v4, ...v6];
  } catch {
    return;
  }
  if (addresses.some(isPrivateAddress)) throw new AnalysisError('base_url_rejected', 'That address is not a public AI service');
}
