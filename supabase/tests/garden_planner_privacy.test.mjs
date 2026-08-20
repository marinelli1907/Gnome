// Garden Planner privacy — exact-address and coordinate inputs must not reach
// the AI provider through the location field or forwarded chat turns.
//
//   node --test supabase/tests/garden_planner_privacy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FN = path.join(here, '../functions/garden-planner/index.ts');
const APP = path.join(here, '../../expo/app/garden.tsx');
const src = fs.readFileSync(FN, 'utf8');
const appSrc = fs.readFileSync(APP, 'utf8');

function loadHelpers() {
  const start = src.indexOf('const MAX_TURNS');
  const end = src.indexOf('const SYSTEM_BASE');
  assert.notEqual(start, -1, 'privacy helper block missing');
  assert.notEqual(end, -1, 'helper block end marker missing');
  const helperSrc = src.slice(start, end)
    .replace(/\(s: string\)/g, '(s)')
    .replace(/export function coarsenGardenLocation\(input: unknown\): string \| null \{/,
      'function coarsenGardenLocation(input) {')
    .replace(/export function redactGardenPlannerText\(input: string\): string \{/,
      'function redactGardenPlannerText(input) {');
  const mod = `${helperSrc}\nexport { coarsenGardenLocation, redactGardenPlannerText };`;
  return import(`data:text/javascript;base64,${Buffer.from(mod).toString('base64')}`);
}

const { coarsenGardenLocation, redactGardenPlannerText } = await loadHelpers();

test('city and state pass through unchanged', () => {
  assert.equal(coarsenGardenLocation('Cleveland Heights, OH'), 'Cleveland Heights, OH');
});

test('ZIP is removed from otherwise coarse location text', () => {
  assert.equal(coarsenGardenLocation('Cleveland Heights, OH 44118'), 'Cleveland Heights, OH');
});

test('comma-separated street address is coarsened to city and state', () => {
  assert.equal(
    coarsenGardenLocation('123 Main Street Apt 2, Cleveland Heights, OH 44118'),
    'Cleveland Heights, OH',
  );
  assert.equal(
    coarsenGardenLocation('123 Main, Cleveland Heights, OH'),
    'Cleveland Heights, OH',
  );
  assert.equal(
    coarsenGardenLocation('123 W 5th, Cleveland Heights, OH'),
    'Cleveland Heights, OH',
  );
});

test('uncoarsenable street address is rejected', () => {
  assert.equal(coarsenGardenLocation('123 Main St Cleveland Heights OH 44118'), null);
  assert.equal(coarsenGardenLocation('123 W 5th Cleveland Heights OH 44118'), null);
});

test('exact coordinates are rejected as a planner location', () => {
  assert.equal(coarsenGardenLocation('41.51234, -81.61234'), null);
});

test('blank or non-string location is rejected', () => {
  assert.equal(coarsenGardenLocation('   '), null);
  assert.equal(coarsenGardenLocation(null), null);
});

test('forwarded chat turns redact street addresses and coordinates', () => {
  const out = redactGardenPlannerText(
    'The bed behind 123 Main Street gets afternoon sun at 41.51234, -81.61234. GPS is lat 41.51234 lon -81.61234. My other bed is 123 W 5th, Cleveland Heights.',
  );
  assert.ok(!out.includes('123 Main'), out);
  assert.ok(!out.includes('123 W 5th'), out);
  assert.ok(!out.includes('41.51234'), out);
  assert.match(out, /\[address redacted\]/);
  assert.match(out, /\[location redacted\]/);
});

test('source assembles prompts from the coarsened location and redacted turns', () => {
  assert.match(src, /const loc = coarsenGardenLocation\(location\)/);
  assert.match(src, /Gardener's location: \$\{loc\}/);
  assert.match(src, /content: redactGardenPlannerText\(m\.content\)\.slice/);
});

test('mobile analytics event does not log the planner question text', () => {
  assert.ok(!/garden_planner_used[^]*metadata:\s*\{\s*q\s*\}/.test(appSrc),
    'garden_planner_used must not store the free-text question in events.metadata');
  assert.match(appSrc, /metadata:\s*\{\s*chars:\s*q\.length,\s*has_photo:\s*!!photo\s*\}/);
});
