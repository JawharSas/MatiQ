/**
 * MatIQ's server functions as one Neon Function (`api`), next to the
 * database on the same branch. The app calls `${EXPO_PUBLIC_FUNCTIONS_URL}/<route>`
 * with the user's Clerk session token; each route keeps the request and
 * response shapes the Supabase Edge Function of the same name had, so app
 * versions built for either backend read the same answers.
 */

import { Hono } from 'hono';
import account from './account/index.ts';
import analyzeMatch from './analyze-match/index.ts';
import apiKeys from './api-keys/index.ts';
import { filesRead, filesWrite } from './files/index.ts';
import { clerkSync } from './jobs/clerk-sync.ts';
import moderation from './moderation/index.ts';
import ranked from './ranked/index.ts';
import { SECURITY_HEADERS } from './shared/http.ts';

const app = new Hono();

app.all('/account', (c) => account(c.req.raw));
app.all('/analyze-match', (c) => analyzeMatch(c.req.raw));
app.all('/api-keys', (c) => apiKeys(c.req.raw));
app.all('/moderation', (c) => moderation(c.req.raw));
app.all('/ranked', (c) => ranked(c.req.raw));
app.all('/files/:action{upload|sign-upload}', (c) => filesWrite(c.req.raw));
app.all('/files/:action{sign-download|list|remove}', (c) => filesRead(c.req.raw));
app.post('/jobs/clerk-sync', (c) => clerkSync(c.req.raw));
app.get('/health', () => Response.json({ ok: true }, { headers: SECURITY_HEADERS }));
app.notFound(() => Response.json({ error: { code: 'not_found' } }, { status: 404, headers: SECURITY_HEADERS }));

export default app;
