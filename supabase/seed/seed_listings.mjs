// Gnome — seed example listings for the Northeast Ohio beta.
//
// Solves the "empty marketplace" problem (spec §22): drops a realistic set of
// Free / Sale / Trade / Wanted listings around Richmond Heights / Mayfield /
// Mentor so the feed, map, and category pages aren't blank on day one.
//
// This writes to your LIVE database with the service-role key, so it is NOT run
// automatically — you run it yourself.
//
// Usage:
//   1. cd supabase/seed && npm install   (installs @supabase/supabase-js)
//   2. Set env (never commit the service-role key):
//        export SUPABASE_URL="https://YOUR-REF.supabase.co"
//        export SUPABASE_SERVICE_ROLE_KEY="ey..."       # Settings → API → service_role
//        export SEED_OWNER_EMAIL="you@example.com"       # an existing Gnome account
//   3. node seed_listings.mjs           # insert missing seed listings (idempotent)
//      node seed_listings.mjs --reset   # remove prior seed listings, then re-insert
//
// Idempotency: seed rows are matched by (owner_id, title). Re-running inserts
// only what's missing; --reset soft-removes the prior seed set first.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL;
const RESET = process.argv.includes('--reset');

if (!SUPABASE_URL || !SERVICE_KEY || !OWNER_EMAIL) {
  console.error(
    'Missing env. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SEED_OWNER_EMAIL.',
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// A few real-ish pickup spots around the launch area (approx neighborhood centers).
const SPOTS = {
  richmondHeights: { lat: 41.5578, lng: -81.5001 },
  mayfield: { lat: 41.5503, lng: -81.4401 },
  mentor: { lat: 41.6661, lng: -81.3396 },
  southEuclid: { lat: 41.5215, lng: -81.5187 },
  lyndhurst: { lat: 41.5203, lng: -81.4901 },
};

// listing_type is source of truth; `kind` mirrors it (wanted -> wanted, else offer).
// Schema CHECKs: sale => price_cents > 0; trade => trade_for present.
const SEED = [
  // --- Free ---------------------------------------------------------------
  { type: 'free', category: 'vegetables', title: 'Free zucchini — porch pickup', quantity: 'a big bagful', spot: 'richmondHeights',
    description: 'Garden is overflowing. Help yourself, no need to ask — bag on the porch this afternoon.' },
  { type: 'free', category: 'vegetables', title: 'Cherry tomatoes, free to a good home', quantity: '2 pints', spot: 'lyndhurst',
    description: 'Sungolds and a few romas. Picked this morning.' },
  { type: 'free', category: 'herbs', title: 'Extra basil — cut what you need', quantity: 'lots', spot: 'southEuclid',
    description: 'Genovese basil going to seed. Bring scissors.' },
  { type: 'free', category: 'flowers', title: 'Cut zinnias 💐', quantity: 'a few bunches', spot: 'mayfield',
    description: 'Fresh cut this weekend. Free jar of blooms for the first neighbor.' },
  { type: 'free', category: 'fruit', title: 'Windfall apples for sauce or cider', quantity: 'half a bushel', spot: 'mentor',
    description: 'Good for cooking, not pretty. First come first served.' },
  { type: 'free', category: 'compost', title: 'Free finished compost', quantity: 'bring buckets', spot: 'richmondHeights',
    description: 'Two-year pile, screened. Dig what you can carry.' },

  // --- Sale (payment is arranged in person; Gnome never processes money) ---
  { type: 'sale', category: 'eggs', title: 'Pasture-raised eggs', priceCents: 500, unit: 'dozen', inventoryCount: 8, spot: 'mentor',
    description: 'Happy hens, mixed brown & blue. $5/dozen, exact change appreciated.' },
  { type: 'sale', category: 'honey', title: 'Raw local honey', priceCents: 900, unit: 'jar', inventoryCount: 12, spot: 'mayfield',
    description: 'This season’s wildflower honey, 1lb jars. $9 each.' },
  { type: 'sale', category: 'farm_fresh', title: 'Sourdough loaf (weekend bake)', priceCents: 600, unit: 'loaf', inventoryCount: 6, spot: 'southEuclid',
    description: 'Naturally leavened, baked Saturday morning. Reserve yours.' },
  { type: 'sale', category: 'plants', title: 'Heirloom tomato seedlings', priceCents: 300, unit: 'each', inventoryCount: 20, spot: 'lyndhurst',
    description: 'Brandywine, Cherokee Purple, San Marzano. Sturdy 4" starts, $3 each.' },

  // --- Trade --------------------------------------------------------------
  { type: 'trade', category: 'herbs', title: 'Trade fresh basil for eggs', tradeFor: 'a dozen eggs', quantity: 'big bunch', spot: 'richmondHeights',
    description: 'Tons of basil, no chickens. Happy to swap a big bunch for a dozen eggs.' },
  { type: 'trade', category: 'vegetables', title: 'Extra hot peppers — swap for herbs', tradeFor: 'rosemary or thyme starts', quantity: 'a dozen', spot: 'mayfield',
    description: 'Jalapeños and cayenne. Would love some perennial herb starts in return.' },

  // --- Wanted -------------------------------------------------------------
  { type: 'wanted', category: 'honey', title: 'Looking for local honey near Mentor', spot: 'mentor',
    description: 'Anyone keeping bees nearby? Happy to pay or trade produce.' },
  { type: 'wanted', category: 'vegetables', title: 'Wanted: canning tomatoes (bulk)', spot: 'southEuclid',
    description: 'Putting up sauce this month — looking for a bushel or two of paste tomatoes.' },
  { type: 'wanted', category: 'seeds', title: 'Seed swap — saving fall seeds?', spot: 'lyndhurst',
    description: 'Looking to trade saved seeds. I have beans, calendula, and dill.' },
  { type: 'wanted', category: 'fruit', title: 'Wanted: extra pumpkins for the kids', spot: 'richmondHeights',
    description: 'Any spare pie or carving pumpkins this fall? Will trade eggs or honey.' },
];

async function findOwner() {
  // No get-by-email admin API; page through users and match.
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find(
      (u) => (u.email ?? '').toLowerCase() === OWNER_EMAIL.toLowerCase(),
    );
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  const owner = await findOwner();
  if (!owner) {
    console.error(`No account found for ${OWNER_EMAIL}. Sign up in the app first.`);
    process.exit(1);
  }

  const { data: market, error: marketErr } = await admin
    .from('markets')
    .select('id, name')
    .eq('owner_id', owner.id)
    .limit(1)
    .maybeSingle();
  if (marketErr) throw marketErr;
  if (!market) {
    console.error('Owner has no market yet — open the app once so the default market is created.');
    process.exit(1);
  }

  const titles = SEED.map((s) => s.title);

  if (RESET) {
    const { error } = await admin
      .from('listings')
      .update({ status: 'removed' })
      .eq('owner_id', owner.id)
      .in('title', titles);
    if (error) throw error;
    console.log('Reset: prior seed listings marked removed.');
  }

  // Skip titles that already exist for this owner (active or otherwise).
  const { data: existing, error: existErr } = await admin
    .from('listings')
    .select('title')
    .eq('owner_id', owner.id)
    .in('title', titles);
  if (existErr) throw existErr;
  const have = new Set((existing ?? []).map((r) => r.title));

  const rows = SEED.filter((s) => !have.has(s.title)).map((s) => {
    const spot = SPOTS[s.spot];
    return {
      owner_id: owner.id,
      market_id: market.id,
      listing_type: s.type,
      kind: s.type === 'wanted' ? 'wanted' : 'offer',
      title: s.title,
      description: s.description ?? null,
      category: s.category,
      quantity: s.quantity ?? null,
      photos: [],
      price_cents: s.type === 'sale' ? s.priceCents : null,
      unit: s.unit ?? null,
      inventory_count: s.inventoryCount ?? null,
      trade_for: s.type === 'trade' ? s.tradeFor : null,
      lat: spot.lat,
      lng: spot.lng,
    };
  });

  if (rows.length === 0) {
    console.log(`Nothing to insert — all ${SEED.length} seed listings already exist for ${market.name}.`);
    return;
  }

  const { data: inserted, error: insErr } = await admin
    .from('listings')
    .insert(rows)
    .select('id, title, listing_type');
  if (insErr) throw insErr;

  console.log(`Inserted ${inserted.length} listing(s) into "${market.name}":`);
  for (const l of inserted) console.log(`  • [${l.listing_type}] ${l.title}`);
}

main().catch((e) => {
  console.error('Seed failed:', e.message ?? e);
  process.exit(1);
});
