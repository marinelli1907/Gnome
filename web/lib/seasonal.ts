export const SEASONAL_SCHEMA_VERSION = 1 as const;
export const SEASONAL_CACHE_VERSION = 1 as const;
export const SEASONAL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const SEASONAL_LIMITS = Object.freeze({
  campaignId: 64,
  title: 80,
  subtitle: 160,
  sellerPrompt: 240,
  zordyContext: 600,
  keywords: 24,
  keyword: 40,
  taxonomyTargets: 24,
  taxonomyTarget: 160,
  searchChips: 4,
  searchChipLabel: 32,
  searchChipQuery: 64,
  dateSpanDays: 370,
  priorityMin: -1000,
  priorityMax: 1000,
} as const);

export const SEASONAL_ICON_KEYS = [
  'leaf',
  'sprout',
  'sun',
  'snowflake',
  'gift',
  'harvest',
] as const;

export type SeasonalIconKey = (typeof SEASONAL_ICON_KEYS)[number];

export interface SeasonalSearchChip {
  label: string;
  query: string;
}

export interface SeasonalCampaign {
  campaign_id: string;
  schema_version: typeof SEASONAL_SCHEMA_VERSION;
  enabled: boolean;
  priority: number;
  starts_on: string;
  ends_on: string;
  title: string;
  subtitle: string;
  icon_key: SeasonalIconKey;
  keywords: string[];
  taxonomy_targets: string[];
  seller_prompt: string;
  zordy_context: string;
  search_chips: SeasonalSearchChip[];
}

export interface SeasonalListingLike {
  id: string;
  title: string;
  description?: string | null;
  taxonomy_node_id?: string | null;
  created_at?: string | null;
}

export interface SeasonalTaxonomyNodeLike {
  id: string;
  path: string;
  name: string;
  search_synonyms?: string[] | null;
}

export interface RankedSeasonalListing<T extends SeasonalListingLike> {
  listing: T;
  score: number;
}

export interface SeasonalCampaignLoadResult {
  campaign: SeasonalCampaign | null;
  source: 'network' | 'cache' | 'none';
}

export interface SeasonalCampaignLoader {
  fetchRows: () => Promise<unknown>;
  readCache?: () => Promise<string | null>;
  writeCache?: (value: string) => Promise<void>;
  now?: Date;
  nowMs?: number;
}

const CAMPAIGN_KEYS = [
  'campaign_id',
  'enabled',
  'ends_on',
  'icon_key',
  'keywords',
  'priority',
  'schema_version',
  'search_chips',
  'seller_prompt',
  'starts_on',
  'subtitle',
  'taxonomy_targets',
  'title',
  'zordy_context',
] as const;
const SEARCH_CHIP_KEYS = ['label', 'query'] as const;
const CACHE_KEYS = ['campaign', 'fetched_at', 'version'] as const;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CAMPAIGN_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAXONOMY_PATH_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const UNSAFE_REMOTE_TEXT_RE = /[<>]|(?:https?|mailto|javascript|data):|www\./i;
const ICON_KEY_SET = new Set<string>(SEASONAL_ICON_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isBoundedText(value: unknown, maximum: number, minimum = 1): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.trim() === value &&
    !CONTROL_CHAR_RE.test(value) &&
    !UNSAFE_REMOTE_TEXT_RE.test(value)
  );
}

function parseDateKey(value: unknown): number | null {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(timestamp / 86_400_000);
}

export function isSeasonalDateKey(value: unknown): value is string {
  return parseDateKey(value) !== null;
}

export function seasonalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseStringArray(
  value: unknown,
  countMaximum: number,
  itemMaximum: number,
  itemPattern?: RegExp,
): string[] | null {
  if (!Array.isArray(value) || value.length > countMaximum) return null;
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isBoundedText(item, itemMaximum) || (itemPattern && !itemPattern.test(item))) return null;
    const dedupeKey = item.toLocaleLowerCase('en-US');
    if (seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);
    parsed.push(item);
  }
  return parsed;
}

function parseSearchChips(value: unknown): SeasonalSearchChip[] | null {
  if (!Array.isArray(value) || value.length > SEASONAL_LIMITS.searchChips) return null;
  const parsed: SeasonalSearchChip[] = [];
  const queries = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, SEARCH_CHIP_KEYS)) return null;
    if (
      !isBoundedText(item.label, SEASONAL_LIMITS.searchChipLabel) ||
      !isBoundedText(item.query, SEASONAL_LIMITS.searchChipQuery)
    ) {
      return null;
    }
    const dedupeKey = item.query.toLocaleLowerCase('en-US');
    if (queries.has(dedupeKey)) return null;
    queries.add(dedupeKey);
    parsed.push({ label: item.label, query: item.query });
  }
  return parsed;
}

/** Strict, all-or-nothing parser for a row received from remote configuration. */
export function parseSeasonalCampaign(value: unknown): SeasonalCampaign | null {
  if (!isRecord(value) || !hasExactKeys(value, CAMPAIGN_KEYS)) return null;
  if (
    !isBoundedText(value.campaign_id, SEASONAL_LIMITS.campaignId) ||
    !CAMPAIGN_ID_RE.test(value.campaign_id) ||
    value.schema_version !== SEASONAL_SCHEMA_VERSION ||
    typeof value.enabled !== 'boolean' ||
    !Number.isInteger(value.priority) ||
    (value.priority as number) < SEASONAL_LIMITS.priorityMin ||
    (value.priority as number) > SEASONAL_LIMITS.priorityMax ||
    !isBoundedText(value.title, SEASONAL_LIMITS.title) ||
    !isBoundedText(value.subtitle, SEASONAL_LIMITS.subtitle) ||
    !isBoundedText(value.seller_prompt, SEASONAL_LIMITS.sellerPrompt) ||
    !isBoundedText(value.zordy_context, SEASONAL_LIMITS.zordyContext) ||
    typeof value.icon_key !== 'string' ||
    !ICON_KEY_SET.has(value.icon_key)
  ) {
    return null;
  }

  const startsOn = parseDateKey(value.starts_on);
  const endsOn = parseDateKey(value.ends_on);
  if (
    startsOn === null ||
    endsOn === null ||
    startsOn > endsOn ||
    endsOn - startsOn > SEASONAL_LIMITS.dateSpanDays
  ) {
    return null;
  }

  const keywords = parseStringArray(
    value.keywords,
    SEASONAL_LIMITS.keywords,
    SEASONAL_LIMITS.keyword,
  );
  const taxonomyTargets = parseStringArray(
    value.taxonomy_targets,
    SEASONAL_LIMITS.taxonomyTargets,
    SEASONAL_LIMITS.taxonomyTarget,
    TAXONOMY_PATH_RE,
  );
  const searchChips = parseSearchChips(value.search_chips);
  if (
    keywords === null ||
    taxonomyTargets === null ||
    searchChips === null ||
    keywords.length + taxonomyTargets.length === 0
  ) {
    return null;
  }

  return {
    campaign_id: value.campaign_id,
    schema_version: SEASONAL_SCHEMA_VERSION,
    enabled: value.enabled,
    priority: value.priority as number,
    starts_on: value.starts_on as string,
    ends_on: value.ends_on as string,
    title: value.title,
    subtitle: value.subtitle,
    icon_key: value.icon_key as SeasonalIconKey,
    keywords,
    taxonomy_targets: taxonomyTargets,
    seller_prompt: value.seller_prompt,
    zordy_context: value.zordy_context,
    search_chips: searchChips,
  };
}

export function isCampaignActive(campaign: SeasonalCampaign, dateKey: string): boolean {
  return (
    campaign.enabled &&
    isSeasonalDateKey(dateKey) &&
    campaign.starts_on <= dateKey &&
    campaign.ends_on >= dateKey
  );
}

/** Higher priority wins; ties use later start date, then stable campaign id. */
export function resolveActiveSeasonalCampaign(
  rows: unknown,
  dateKey = seasonalDateKey(),
): SeasonalCampaign | null {
  if (!Array.isArray(rows) || !isSeasonalDateKey(dateKey)) return null;
  const active = rows
    .map(parseSeasonalCampaign)
    .filter((campaign): campaign is SeasonalCampaign => !!campaign && isCampaignActive(campaign, dateKey));
  active.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.starts_on.localeCompare(a.starts_on) ||
      a.campaign_id.localeCompare(b.campaign_id),
  );
  return active[0] ?? null;
}

export function normalizeSeasonalText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function containsWholeSeasonalPhrase(text: string, phrase: string): boolean {
  const normalizedText = normalizeSeasonalText(text);
  const normalizedPhrase = normalizeSeasonalText(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function phraseMatchesEither(left: string, right: string): boolean {
  return containsWholeSeasonalPhrase(left, right) || containsWholeSeasonalPhrase(right, left);
}

function scoreSeasonalListing(
  listing: SeasonalListingLike,
  campaign: SeasonalCampaign,
  nodesById: Map<string, SeasonalTaxonomyNodeLike>,
): number {
  let score = 0;
  const node = listing.taxonomy_node_id ? nodesById.get(listing.taxonomy_node_id) : undefined;

  if (
    node &&
    campaign.taxonomy_targets.some(
      (target) => node.path === target || node.path.startsWith(`${target}/`),
    )
  ) {
    score += 100;
  }

  if (node) {
    const taxonomyTerms = [node.name, ...(node.search_synonyms ?? [])];
    if (
      campaign.keywords.some((keyword) =>
        taxonomyTerms.some((term) => phraseMatchesEither(term, keyword)),
      )
    ) {
      score += 60;
    }
  }

  if (campaign.keywords.some((keyword) => containsWholeSeasonalPhrase(listing.title, keyword))) {
    score += 30;
  }
  if (
    listing.description &&
    campaign.keywords.some((keyword) =>
      containsWholeSeasonalPhrase(listing.description ?? '', keyword),
    )
  ) {
    score += 15;
  }

  return score;
}

/** Rank only the Seasonal Discovery rail. The caller's normal feed is untouched. */
export function rankSeasonalListings<T extends SeasonalListingLike>(
  listings: readonly T[],
  campaign: SeasonalCampaign,
  taxonomyNodes: readonly SeasonalTaxonomyNodeLike[],
  maximum = 6,
): RankedSeasonalListing<T>[] {
  if (maximum <= 0) return [];
  const nodesById = new Map(taxonomyNodes.map((node) => [node.id, node]));
  const deduped = new Map<string, { listing: T; score: number; inputIndex: number }>();

  listings.forEach((listing, inputIndex) => {
    if (!listing?.id || deduped.has(listing.id)) return;
    const score = scoreSeasonalListing(listing, campaign, nodesById);
    if (score > 0) deduped.set(listing.id, { listing, score, inputIndex });
  });

  return [...deduped.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.listing.created_at ?? '').localeCompare(a.listing.created_at ?? '') ||
        a.inputIndex - b.inputIndex,
    )
    .slice(0, maximum)
    .map(({ listing, score }) => ({ listing, score }));
}

function parseCache(value: string | null): { fetchedAt: number; campaign: SeasonalCampaign | null } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || !hasExactKeys(parsed, CACHE_KEYS)) return null;
    if (parsed.version !== SEASONAL_CACHE_VERSION || typeof parsed.fetched_at !== 'number') return null;
    if (!Number.isFinite(parsed.fetched_at) || parsed.fetched_at < 0) return null;
    if (parsed.campaign === null) return { fetchedAt: parsed.fetched_at, campaign: null };
    const campaign = parseSeasonalCampaign(parsed.campaign);
    return campaign ? { fetchedAt: parsed.fetched_at, campaign } : null;
  } catch {
    return null;
  }
}

/** Network is authoritative when it responds; cache is outage-only fallback. */
export async function loadSeasonalCampaign({
  fetchRows,
  readCache,
  writeCache,
  now = new Date(),
  nowMs = now.getTime(),
}: SeasonalCampaignLoader): Promise<SeasonalCampaignLoadResult> {
  const dateKey = seasonalDateKey(now);
  let cached: { fetchedAt: number; campaign: SeasonalCampaign | null } | null = null;
  if (readCache) {
    try {
      cached = parseCache(await readCache());
    } catch {
      cached = null;
    }
  }

  try {
    const campaign = resolveActiveSeasonalCampaign(await fetchRows(), dateKey);
    if (writeCache) {
      try {
        await writeCache(
          JSON.stringify({
            version: SEASONAL_CACHE_VERSION,
            fetched_at: nowMs,
            campaign,
          }),
        );
      } catch {
        // Caching is an optimization and must never affect Browse.
      }
    }
    return { campaign, source: 'network' };
  } catch {
    const cacheAge = cached ? nowMs - cached.fetchedAt : Number.POSITIVE_INFINITY;
    if (
      cached &&
      cacheAge >= 0 &&
      cacheAge <= SEASONAL_CACHE_MAX_AGE_MS &&
      cached.campaign &&
      isCampaignActive(cached.campaign, dateKey)
    ) {
      return { campaign: cached.campaign, source: 'cache' };
    }
    return { campaign: null, source: 'none' };
  }
}

export function seasonalDismissalKey(campaignId: string): string {
  return `seasonal-seller-prompt-dismissed:${campaignId}`;
}

export function isSeasonalPromptDismissed(value: unknown): boolean {
  return value === '1';
}
