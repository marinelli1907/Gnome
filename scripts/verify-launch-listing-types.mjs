#!/usr/bin/env node
// Regression guard for the launch listing-type posture (identity v5).
//
// Gnome does not launch with Wanted listings. That is a HIDE, not a delete: the
// enum value, the rows, the labels and every render path still exist so
// historical Wanted listings keep working for their owner and for admin tools.
// The failure modes this guards against are therefore SYMMETRIC —
//   leaking:   Wanted reappears in something customer-facing
//   breaking:  someone "cleans up" by narrowing the canonical enum list, which
//              would make isListingType('wanted') false and stop historical
//              rows from validating or rendering
// so this asserts both directions.
//
// No test framework on purpose: the app has none, and adding one days before a
// store submission is not a change worth making. Run with `node`.
//
//   node scripts/verify-launch-listing-types.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
};

// ---------------------------------------------------------------- app: types
const appTypes = read('expo/lib/listingType.ts');
const appLaunch = appTypes.match(/LAUNCH_LISTING_TYPES[^=]*=\s*\[([^\]]*)\]/s)?.[1] ?? '';
const appOrder = appTypes.match(/LISTING_TYPE_ORDER[^=]*=\s*\[([^\]]*)\]/s)?.[1] ?? '';

console.log('\napp — listing types');
check("launch set excludes 'wanted'", !/'wanted'/.test(appLaunch), `got: ${appLaunch.trim()}`);
for (const t of ['sale', 'free', 'trade']) {
  check(`launch set includes '${t}'`, appLaunch.includes(`'${t}'`));
}
check(
  "canonical enum list still includes 'wanted' (historical rows must validate)",
  /'wanted'/.test(appOrder),
  'narrowing LISTING_TYPE_ORDER breaks isListingType() for stored Wanted rows',
);
check('TYPE_CHOICES derives from the launch set', /TYPE_CHOICES[\s\S]{0,200}?LAUNCH_LISTING_TYPES/.test(appTypes));
check('TYPE_FILTERS derives from the launch set', /TYPE_FILTERS[\s\S]{0,240}?LAUNCH_LISTING_TYPES/.test(appTypes));
check("TYPE_LABEL still defines 'wanted' (historical rows must render)", /wanted:\s*'Wanted'/.test(appTypes));

// -------------------------------------------------------------- app: queries
const db = read('expo/lib/db.ts');
console.log('\napp — discovery queries');
const filtered = [...db.matchAll(/\.in\('listing_type',\s*LAUNCH_LISTING_TYPES/g)].length;
check('discovery queries filter to launch types (Browse/Map/search + Markets)', filtered >= 2, `found ${filtered}, expected >= 2`);
check(
  'the Browse filter is unconditional, not gated on a chosen filter',
  /\.eq\('status',\s*'active'\)[\s\S]{0,400}?\.in\('listing_type',\s*LAUNCH_LISTING_TYPES/.test(db),
  'a crafted or stale listingType must not be able to surface Wanted',
);
// Anchor on the function DEFINITION, not any mention — prose about
// useMyListings elsewhere in the file is not the query body.
const myListingsBody = db.match(/export function useMyListings[\s\S]*?\n}\n/)?.[0] ?? '';
check(
  "the owner's own listings query exists and is NOT filtered",
  myListingsBody.length > 0 && !myListingsBody.includes('LAUNCH_LISTING_TYPES'),
  'an owner must still see their historical Wanted posts',
);

// ------------------------------------------------------------- app: entry pts
console.log('\napp — creation entry points');
check(
  'deep-linked ?type= is clamped to the launch set',
  /clampToLaunch/.test(read('expo/app/(tabs)/post.tsx')),
  '?type=wanted would otherwise open a flow the chooser no longer offers',
);
check("import review does not offer 'wanted'", !/key:\s*'wanted'/.test(read('expo/app/import.tsx')));
check(
  'Upgrade does not advertise a Wanted-response allowance',
  /const tierWanted = \(_l\?: PlanLimit\) => null/.test(read('expo/app/upgrade.tsx')),
);

// -------------------------------------------------------------------- web
const fmt = read('web/lib/format.ts');
const webLaunch = fmt.match(/LAUNCH_LISTING_TYPES\s*=\s*\[([^\]]*)\]/s)?.[1] ?? '';
const webAll = fmt.match(/LISTING_TYPES\s*=\s*\[([^\]]*)\]/s)?.[1] ?? '';
console.log('\nweb');
check("launch set excludes 'wanted'", !/'wanted'/.test(webLaunch), `got: ${webLaunch.trim()}`);
check("canonical list still includes 'wanted'", /'wanted'/.test(webAll));
check('create flow offers launch types only', /LAUNCH_LISTING_TYPES\.map/.test(read('web/app/sell/SellClient.tsx')));
check('public Market type counts exclude Wanted', /LAUNCH_LISTING_TYPES\.filter/.test(read('web/app/market/[slug]/page.tsx')));
check('homepage copy does not advertise Wanted', !/wanted posts/i.test(read('web/app/page.tsx')));

// --------------------------------------------------------------- palette v5
console.log('\npalette — semantic roles');
const colors = read('expo/constants/colors.ts');
check('Sell is green',  /sell:\s*'#328736'/.test(colors));
check('Free is blue',   /free:\s*'#1878CD'/.test(colors));
check('Trade is red',   /trade:\s*'#E32C27'/.test(colors));
check('primary is no longer red', !/primary:\s*'#E32C27'/.test(colors), 'red must not be the global brand colour');
const layout = read('expo/app/(tabs)/_layout.tsx');
check('Ask AI is the only tab overriding the active tint', ([...layout.matchAll(/tabBarActiveTintColor/g)].length === 2));
check('and it overrides to purple', /tabBarActiveTintColor:\s*Colors\.aiPurple/.test(layout));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
