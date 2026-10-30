/**
 * The service side of the backend, in the shape the handlers used with the
 * service-role supabase-js client: `rpc`, `from` and `storage.from(bucket)`.
 * It bypasses Row Level Security, so handlers check authorization first.
 */

import { from, rpc } from './db.ts';
import { adminBucket } from './storage.ts';

export const admin = { rpc, from, storage: { from: adminBucket } };

export type Admin = typeof admin;
