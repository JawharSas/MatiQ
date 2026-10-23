/**
 * Re-encrypts stored BYOK API keys under the current key-encryption key.
 *
 * Rotation procedure (see docs/SECURITY_AND_DEPLOYMENT.md):
 *   1. Generate a new KEK:   openssl rand -base64 32
 *   2. supabase secrets set MATIQ_KEK_V2=<new key> MATIQ_KEK_CURRENT=2
 *      (keep MATIQ_KEK_V1 set so existing rows still decrypt)
 *   3. Run this script with the same KEK secrets in the environment:
 *        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *        MATIQ_KEK_V1=... MATIQ_KEK_V2=... MATIQ_KEK_CURRENT=2 \
 *        deno run --allow-env --allow-net --config supabase/functions/deno.json scripts/rotate-api-key-kek.ts
 *   4. When it reports 0 remaining rows, unset MATIQ_KEK_V1.
 *
 * Plaintext keys only exist in this process's memory and are never printed.
 */

import { createClient } from '@supabase/supabase-js';
import { rotateRecord } from '../supabase/functions/_shared/crypto.ts';
import { env } from '../supabase/functions/_shared/env.ts';

const admin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), { auth: { persistSession: false } });
const currentVersion = env.kekCurrentVersion();

let rotated = 0;
while (true) {
  const { data, error } = await admin.rpc('svc_api_keys_needing_rotation', { p_current_version: currentVersion, p_limit: 100 });
  if (error) throw new Error(`listing rows failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; user_id: string; provider: string; ciphertext: string; iv: string; key_version: number }[];
  if (rows.length === 0) break;

  for (const row of rows) {
    const next = await rotateRecord({ ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.key_version }, row.user_id, row.provider);
    const { error: updateError } = await admin.rpc('svc_rotate_api_key', {
      p_key_id: row.id,
      p_ciphertext: next.ciphertext,
      p_iv: next.iv,
      p_key_version: next.keyVersion,
    });
    if (updateError) throw new Error(`updating row ${row.id} failed: ${updateError.message}`);
    rotated++;
  }
}

console.log(`Rotated ${rotated} key(s) to KEK version ${currentVersion}; 0 rows remain on older versions.`);
