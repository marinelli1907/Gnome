import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const sources = [
  path.join(root, 'expo/lib/seasonal.ts'),
  path.join(root, 'web/lib/seasonal.ts'),
  path.join(root, 'supabase/functions/_shared/seasonal.ts'),
];
const sourceText = sources.map((file) => fs.readFileSync(file, 'utf8'));
assert.equal(sourceText[1], sourceText[0], 'web seasonal logic must match mobile');
assert.equal(sourceText[2], sourceText[0], 'Edge Function seasonal logic must match mobile');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnome-seasonal-'));
const output = path.join(tmp, 'seasonal.mjs');
execFileSync(
  'npx',
  [
    '--yes',
    'esbuild@0.23.0',
    sources[0],
    '--format=esm',
    '--platform=node',
    '--target=es2022',
    `--outfile=${output}`,
  ],
  { stdio: 'pipe' },
);
const seasonal = await import(`${pathToFileURL(output).href}?${Date.now()}`);

const valid = (overrides = {}) => ({
  campaign_id: 'fall-harvest-2026',
  schema_version: 1,
  enabled: true,
  priority: 100,
  starts_on: '2026-09-01',
  ends_on: '2026-10-31',
  title: 'Fall harvest',
  subtitle: 'Fresh finds for crisp days.',
  icon_key: 'harvest',
  keywords: ['corn', 'apple'],
  taxonomy_targets: ['vegetables/squash'],
  seller_prompt: 'List what is ready at your stand.',
  zordy_context: 'Offer seasonal growing and selling context when relevant.',
  search_chips: [
    { label: 'Apples', query: 'apples' },
    { label: 'Squash', query: 'squash' },
  ],
  ...overrides,
});

const at = '2026-09-15';
assert.equal(
  seasonal.seasonalDateKey(new Date(2026, 8, 1, 0, 0, 0)),
  '2026-09-01',
  'campaign dates use the device local calendar day at midnight',
);
assert.equal(
  seasonal.resolveActiveSeasonalCampaign([valid()], '2026-09-01')?.campaign_id,
  'fall-harvest-2026',
  'campaign start date is inclusive',
);
assert.equal(
  seasonal.resolveActiveSeasonalCampaign([valid()], '2026-10-31')?.campaign_id,
  'fall-harvest-2026',
  'campaign end date is inclusive',
);
assert.equal(seasonal.resolveActiveSeasonalCampaign([], at), null, 'no campaign');
assert.equal(
  seasonal.resolveActiveSeasonalCampaign([valid({ enabled: false })], at),
  null,
  'disabled campaign',
);
assert.equal(
  seasonal.resolveActiveSeasonalCampaign([valid({ starts_on: '2026-10-01' })], at),
  null,
  'future campaign',
);
assert.equal(
  seasonal.resolveActiveSeasonalCampaign([valid({ ends_on: '2026-09-14' })], at),
  null,
  'expired campaign',
);

const lower = valid({ campaign_id: 'lower', priority: 10 });
const higher = valid({ campaign_id: 'higher', priority: 20 });
assert.equal(
  seasonal.resolveActiveSeasonalCampaign([lower, higher], at)?.campaign_id,
  'higher',
  'overlap uses priority',
);
const earlier = valid({ campaign_id: 'earlier', starts_on: '2026-08-01' });
const later = valid({ campaign_id: 'later', starts_on: '2026-09-01' });
assert.equal(
  seasonal.resolveActiveSeasonalCampaign([earlier, later], at)?.campaign_id,
  'later',
  'priority tie uses later start',
);
assert.equal(
  seasonal.resolveActiveSeasonalCampaign([
    valid({ campaign_id: 'beta' }),
    valid({ campaign_id: 'alpha' }),
  ], at)?.campaign_id,
  'alpha',
  'complete tie uses stable campaign id',
);

const malformed = [
  valid({ title: 't'.repeat(81) }),
  valid({ subtitle: 's'.repeat(161) }),
  valid({ seller_prompt: 'p'.repeat(241) }),
  valid({ zordy_context: 'z'.repeat(601) }),
  valid({ keywords: Array.from({ length: 25 }, (_, i) => `key${i}`) }),
  valid({ keywords: ['k'.repeat(41)] }),
  valid({ taxonomy_targets: Array.from({ length: 25 }, (_, i) => `root/item-${i}`) }),
  valid({ taxonomy_targets: ['x'.repeat(161)] }),
  valid({ search_chips: Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, query: `q${i}` })) }),
  valid({ search_chips: [{ label: 'l'.repeat(33), query: 'valid' }] }),
  valid({ search_chips: [{ label: 'Valid', query: 'q'.repeat(65) }] }),
  valid({ schema_version: 2 }),
  valid({ icon_key: 'remote-svg' }),
  valid({ starts_on: '2026-02-30' }),
  valid({ starts_on: '2025-01-01', ends_on: '2026-09-01' }),
  valid({ keywords: ['corn', 'CORN'] }),
  valid({ taxonomy_targets: ['vegetables/squash', 'vegetables/squash'] }),
  valid({ search_chips: [{ label: 'Corn', query: 'corn', href: '/unsafe' }] }),
  valid({ title: '<b>Fall harvest</b>' }),
  valid({ zordy_context: 'Visit https://example.com for instructions.' }),
  valid({ keywords: ['javascript:alert'] }),
  valid({ search_chips: [{ label: 'Corn', query: 'www.example.com' }] }),
  { ...valid(), extra_remote_field: 'not-in-schema' },
];
for (const row of malformed) {
  assert.equal(seasonal.parseSeasonalCampaign(row), null, `malformed row rejected: ${JSON.stringify(row).slice(0, 90)}`);
}
assert.equal(seasonal.resolveActiveSeasonalCampaign(null, at), null, 'empty server null response');
assert.equal(seasonal.resolveActiveSeasonalCampaign({}, at), null, 'empty server object response');

const campaign = seasonal.parseSeasonalCampaign(valid());
assert.ok(campaign);
const taxonomy = [
  { id: 'squash', path: 'vegetables/squash/winter', name: 'Winter squash', search_synonyms: ['pumpkin'] },
  { id: 'maize', path: 'vegetables/corn', name: 'Maize', search_synonyms: ['sweet corn'] },
];
const listings = [
  { id: 'corner', title: 'Corner shelf', description: 'A unicorn decoration', created_at: '2026-09-04' },
  { id: 'corn', title: 'Sweet corn', description: null, created_at: '2026-09-03' },
  { id: 'taxonomy', title: 'Mystery fall crop', taxonomy_node_id: 'squash', created_at: '2026-09-02' },
  { id: 'alias', title: 'Fresh ears', taxonomy_node_id: 'maize', created_at: '2026-09-01' },
  { id: 'corn', title: 'Duplicate sweet corn', created_at: '2026-09-05' },
];
const originalOrder = listings.map((listing) => listing.id);
const ranked = seasonal.rankSeasonalListings(listings, campaign, taxonomy, 6);
assert.deepEqual(listings.map((listing) => listing.id), originalOrder, 'normal input ordering is untouched');
assert.ok(!ranked.some(({ listing }) => listing.id === 'corner'), 'whole words reject corn in corner/unicorn');
assert.ok(ranked.some(({ listing }) => listing.id === 'corn'), 'whole-word title match');
assert.ok(ranked.some(({ listing }) => listing.id === 'taxonomy'), 'taxonomy descendant match');
assert.ok(ranked.some(({ listing }) => listing.id === 'alias'), 'taxonomy alias match');
assert.equal(ranked.filter(({ listing }) => listing.id === 'corn').length, 1, 'duplicate listing ids collapse');
assert.deepEqual(
  seasonal.rankSeasonalListings([{ id: 'none', title: 'Fresh bread' }], campaign, taxonomy),
  [],
  'zero seasonal matches',
);

const now = new Date(2026, 8, 15, 12, 0, 0);
const nowMs = now.getTime();
const activeCache = JSON.stringify({ version: 1, fetched_at: nowMs - 1000, campaign });
const expiredCampaign = seasonal.parseSeasonalCampaign(valid({ ends_on: '2026-09-14' }));
assert.ok(expiredCampaign);

const outage = await seasonal.loadSeasonalCampaign({
  fetchRows: async () => { throw new Error('offline'); },
  readCache: async () => null,
  now,
  nowMs,
});
assert.deepEqual(outage, { campaign: null, source: 'none' }, 'network outage without cache');

const cached = await seasonal.loadSeasonalCampaign({
  fetchRows: async () => { throw new Error('offline'); },
  readCache: async () => activeCache,
  now,
  nowMs,
});
assert.equal(cached.source, 'cache', 'fresh active cache used during outage');
assert.equal(cached.campaign?.campaign_id, campaign.campaign_id);

const cachedExpired = await seasonal.loadSeasonalCampaign({
  fetchRows: async () => { throw new Error('offline'); },
  readCache: async () => JSON.stringify({ version: 1, fetched_at: nowMs - 1000, campaign: expiredCampaign }),
  now,
  nowMs,
});
assert.deepEqual(cachedExpired, { campaign: null, source: 'none' }, 'expired cached campaign rejected');

const stale = await seasonal.loadSeasonalCampaign({
  fetchRows: async () => { throw new Error('offline'); },
  readCache: async () => JSON.stringify({
    version: 1,
    fetched_at: nowMs - seasonal.SEASONAL_CACHE_MAX_AGE_MS - 1,
    campaign,
  }),
  now,
  nowMs,
});
assert.deepEqual(stale, { campaign: null, source: 'none' }, 'stale cache rejected');

let cacheWrite = '';
const emptyWins = await seasonal.loadSeasonalCampaign({
  fetchRows: async () => [],
  readCache: async () => activeCache,
  writeCache: async (value) => { cacheWrite = value; },
  now,
  nowMs,
});
assert.deepEqual(emptyWins, { campaign: null, source: 'network' }, 'empty network response overrides cache');
assert.equal(JSON.parse(cacheWrite).campaign, null, 'empty network response caches null');

const malformedWins = await seasonal.loadSeasonalCampaign({
  fetchRows: async () => [valid({ icon_key: 'invalid' })],
  readCache: async () => activeCache,
  now,
  nowMs,
});
assert.deepEqual(malformedWins, { campaign: null, source: 'network' }, 'malformed remote row is never partially trusted');

assert.notEqual(
  seasonal.seasonalDismissalKey('fall-harvest-2026'),
  seasonal.seasonalDismissalKey('winter-2026'),
  'campaign changes do not inherit an old dismissal',
);
assert.equal(seasonal.isSeasonalPromptDismissed('1'), true, 'stored dismissal is honored');
assert.equal(seasonal.isSeasonalPromptDismissed(null), false, 'missing dismissal shows the prompt');
assert.equal(seasonal.SEASONAL_LIMITS.searchChips, 4, 'at most four search chips');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('seasonal campaign logic tests: PASS');
