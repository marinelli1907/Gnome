import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const files = [
  'supabase/functions/ask-gnome/index.ts',
  'supabase/functions/draft-listing/index.ts',
  'supabase/functions/garden-planner/index.ts',
];

for (const file of files) {
  const src = readFileSync(join(root, file), 'utf8');
  assert.ok(
    !/JSON\.parse\s*\(\s*atob|token\.split\s*\(\s*['"]\.['"]\s*\)/.test(src),
    `${file} must not trust locally decoded JWT payloads for identity`,
  );
  assert.match(
    src,
    /auth\.getUser\s*\(/,
    `${file} should verify the caller with Supabase Auth before service-role reads`,
  );
  assert.match(
    src,
    /const token = req\.headers\.get\(['"]authorization['"]\)\?\.replace\(\/\^Bearer\\s\+\/i, ['"]['"]\) \?\? ['"]['"]/,
    `${file} should accept identity only from a Bearer token`,
  );
  assert.match(
    src,
    /auth\.getUser\s*\(token\)/,
    `${file} must send the actual token to Supabase Auth for verification`,
  );
  assert.match(
    src,
    /if \(error \|\| !data\.user\?\.id\) return null;\s*return data\.user\.id;/,
    `${file} must reject invalid tokens and derive identity from the verified user`,
  );

  const handler = src.slice(src.indexOf('Deno.serve'));
  const verifyAt = handler.indexOf('await verifiedUserIdFrom(req)');
  const rejectAt = handler.indexOf('if (!userId)');
  const serviceReadAt = handler.indexOf('SUPABASE_SERVICE_ROLE_KEY');
  assert.ok(verifyAt >= 0 && rejectAt > verifyAt, `${file} must reject before handler work`);
  assert.ok(
    serviceReadAt < 0 || serviceReadAt > rejectAt,
    `${file} must not construct a service-role client before invalid-token rejection`,
  );
  assert.match(
    handler.slice(rejectAt, rejectAt + 180),
    /401/,
    `${file} should return HTTP 401 for missing, malformed, invalid, or forged tokens`,
  );
}

console.log('legacy AI auth static checks passed');
