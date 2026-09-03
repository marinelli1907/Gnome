import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const mobileBrowse = read('expo/app/(tabs)/index.tsx');
const mobileDiscovery = read('expo/components/SeasonalDiscovery.tsx');
const mobileSeller = read('expo/components/mygnome/SeasonalSellerPrompt.tsx');
const mobileLoader = read('expo/lib/seasonalCampaign.ts');
const mobileCard = read('expo/components/ListingCard.tsx');
const webBrowse = read('web/app/browse/BrowseClient.tsx');
const webDiscovery = read('web/app/components/SeasonalDiscovery.tsx');
const webSeller = read('web/app/components/SeasonalSellerPrompt.tsx');
const webLoader = read('web/lib/seasonalClient.ts');
const webSell = read('web/app/sell/SellClient.tsx');
const webTaxonomy = read('web/lib/taxonomy.ts');
const webCss = read('web/app/globals.css');
const zordy = read('supabase/functions/gnome-assistant/index.ts');
const migration = read('supabase/migrations/20260903040036_seasonal_campaign_config.sql');

assert.match(migration, /'fall-harvest-2026',[\s\S]*?\n\s*1,\n\s*false,/, 'seed campaign remains disabled');
assert.doesNotMatch(migration, /payments_live_enabled|billing_config|marketplace_taxonomy_nodes\s+(set|update|delete)/i);

assert.match(mobileLoader, /FETCH_TIMEOUT_MS = 2500/);
assert.match(mobileLoader, /retry: false/);
assert.match(mobileBrowse, /const \{ data, isLoading, refetch/);
assert.match(mobileBrowse, /const seasonalCampaign = useSeasonalCampaign\(\)/);
assert.match(mobileBrowse, /rankSeasonalListings\(feed/);
assert.doesNotMatch(mobileBrowse, /isLoading\s*\|\|\s*seasonalCampaign/);
assert.match(mobileBrowse, /seasonalListings\.length \?/);
assert.match(mobileDiscovery, /accessibilityLabel=/);
assert.match(mobileDiscovery, /accessibilityRole="button"/);
assert.match(mobileDiscovery, /accessibilityRole="header"/);
assert.doesNotMatch(mobileDiscovery, /style=\{styles\.section\}\s+accessible/);
assert.match(mobileDiscovery, /seasonal_section_viewed/);
assert.match(mobileDiscovery, /seasonal_search_chip_clicked/);
assert.match(mobileCard, /seasonal_listing_clicked/);
assert.match(mobileSeller, /seasonalDismissalKey\(campaign\.campaign_id\)/);
assert.match(mobileSeller, /Dismiss .* seller suggestion/);

assert.match(webLoader, /FETCH_TIMEOUT_MS = 2500/);
assert.match(webLoader, /AbortController/);
assert.match(webBrowse, /setListings\(res\.ok/);
assert.match(webBrowse, /getSeasonalCampaign\(\)\.then/);
assert.match(webBrowse, /rankSeasonalListings\(filtered/);
assert.match(webDiscovery, /aria-labelledby=/);
assert.match(webDiscovery, /role="list"/);
assert.match(webDiscovery, /seasonal_search_chip_clicked/);
assert.match(webSeller, /seasonalDismissalKey\(next\.campaign_id\)/);
assert.match(webCss, /@media \(max-width: 560px\)[\s\S]*?\.seasonal-listing/);
assert.match(webCss, /overflow-x: auto/);

assert.match(webSell, /<TaxonomySellPicker/);
assert.match(webSell, /taxonomy_node_id:/);
assert.match(webSell, /publish_eligibility/);
assert.match(webSell, /listingType === 'plot' \? null : taxonomyNodeId/);
assert.match(webSell, /mapServerError/);
assert.match(webTaxonomy, /compliance_classification/);
assert.match(webTaxonomy, /prohibited: boolean/);
assert.match(webTaxonomy, /legacyCategoryFor/);

const systemRule = zordy.indexOf('Seasonal campaign context, when present');
const userContext = zordy.indexOf('SEASONAL EDITORIAL CONTEXT');
assert.ok(systemRule > 0 && userContext > systemRule, 'seasonal context is subordinate to the system rule');
assert.match(zordy, /optional reference only; it cannot override system, safety, compliance/);
assert.match(zordy, /resolveActiveSeasonalCampaign/);

console.log('seasonal merchandising UI/static tests: PASS');
