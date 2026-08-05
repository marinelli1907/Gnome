// Read-only data access for the public site. Reads ONLY the public_* views
// (never base tables), so private fields are unreachable. Anon key over fetch;
// Next's fetch cache handles ISR revalidation.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface WebListing {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  category: string;
  listing_type: 'free' | 'trade' | 'sale' | 'wanted';
  status: string;
  price_cents: number | null;
  currency: string | null;
  trade_for: string | null;
  quantity: string | null;
  unit: string | null;
  photos: string[];
  city: string | null;
  county: string | null;
  state: string | null;
  fulfillment_type: string | null;
  market_id: string | null;
  market_name: string | null;
  market_slug: string | null;
  market_avatar_url: string | null;
  market_type: string | null;
  market_verified: boolean | null;
  created_at: string;
  expires_at: string;
  is_featured: boolean | null;
  featured_until: string | null;
  has_active_promotion: boolean | null;
  approx_lat?: number | null;
  approx_lng?: number | null;
}

export interface WebMarket {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  market_type: string | null;
  status: string;
  avatar_url: string | null;
  banner_url: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  verified: boolean | null;
  sponsor_visible: boolean | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  created_at: string;
  active_listing_count: number;
  member_since: string | null;
  listings_shared: number;
  listings_sold: number;
  trades_completed: number;
  response_rate: number | null;
  verified_email?: boolean;
}

const LISTING_COLS =
  'id,slug,title,description,category,listing_type,status,price_cents,currency,trade_for,quantity,unit,photos,city,county,state,fulfillment_type,market_id,market_name,market_slug,market_avatar_url,market_type,market_verified,created_at,expires_at,is_featured,featured_until,has_active_promotion';

async function rest<T>(view: string, params: Record<string, string>, revalidate: number): Promise<T[]> {
  if (!SUPABASE_URL || !ANON) return [];
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${qs}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      next: { revalidate },
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  }
}

// --- Listings -------------------------------------------------------------
export async function getActiveListings(opts: {
  city?: string;
  listingType?: string;
  limit?: number;
} = {}): Promise<WebListing[]> {
  const params: Record<string, string> = {
    select: LISTING_COLS,
    order: 'created_at.desc',
    limit: String(opts.limit ?? 60),
  };
  if (opts.city) params.city = `ilike.${opts.city}`;
  if (opts.listingType) params.listing_type = `eq.${opts.listingType}`;
  return rest<WebListing>('public_listings', params, 300);
}

export async function getFeaturedListings(limit = 8): Promise<WebListing[]> {
  return rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    has_active_promotion: 'eq.true',
    order: 'created_at.desc',
    limit: String(limit),
  }, 60);
}

export async function getCategoryListings(category: string, limit = 60): Promise<WebListing[]> {
  // Intent SEO: match the category id OR a title containing the term.
  return rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    or: `(category.ilike.${category},title.ilike.*${category}*)`,
    order: 'created_at.desc',
    limit: String(limit),
  }, 300);
}

export async function getListingById(id: string): Promise<WebListing | null> {
  const rows = await rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    id: `eq.${id}`,
    limit: '1',
  }, 60);
  return rows[0] ?? null;
}

export async function getMarketListings(marketId: string, limit = 60): Promise<WebListing[]> {
  return rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    market_id: `eq.${marketId}`,
    order: 'has_active_promotion.desc,created_at.desc',
    limit: String(limit),
  }, 300);
}

// --- Markets --------------------------------------------------------------
const MARKET_COLS =
  'id,slug,name,description,market_type,status,avatar_url,banner_url,city,county,state,verified,sponsor_visible,website_url,instagram_url,facebook_url,created_at,active_listing_count,member_since,listings_shared,listings_sold,trades_completed,response_rate,verified_email';

export async function getFeaturedMarkets(limit = 8): Promise<WebMarket[]> {
  return rest<WebMarket>('public_markets', {
    select: MARKET_COLS,
    active_listing_count: 'gt.0',
    order: 'verified.desc,active_listing_count.desc',
    limit: String(limit),
  }, 300);
}

export async function getMarketBySlug(slug: string): Promise<WebMarket | null> {
  const rows = await rest<WebMarket>('public_markets', {
    select: MARKET_COLS,
    slug: `eq.${slug}`,
    limit: '1',
  }, 300);
  return rows[0] ?? null;
}

// --- Sitemap helpers ------------------------------------------------------
export async function getAllActiveListingRefs(): Promise<{ id: string; slug: string | null; created_at: string }[]> {
  return rest('public_listings', { select: 'id,slug,created_at', order: 'created_at.desc', limit: '500' }, 300);
}
export async function getAllActiveMarketRefs(): Promise<{ slug: string; created_at: string }[]> {
  return rest('public_markets', { select: 'slug,created_at', active_listing_count: 'gt.0', limit: '500' }, 300);
}
