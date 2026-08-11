// Gnome domain types — mirror the Supabase schema in
// supabase/migrations/0001_init.sql. Scope: surplus-produce sharing loop.

export type ListingStatus =
  | 'active'
  | 'claimed'
  | 'completed'
  | 'expired'
  | 'removed'
  // Compliance automation parks a regulated listing here when the seller's
  // credential expires or their paid plan lapses. Nothing is deleted: the
  // listing resumes automatically once the credential/plan is valid again.
  | 'paused';

export type UserType =
  | 'neighbor'
  | 'grower'
  | 'farm'
  | 'business'
  | 'market'
  | 'municipality';

export type ClaimType = 'claim' | 'trade_offer' | 'purchase_request' | 'wanted_response' | 'plot_reservation';

export type ClaimStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'cancelled'
  | 'completed'
  | 'expired';

export type ListingKind = 'offer' | 'wanted';

// M2: listing_type is the source of truth (kind is a derived/deprecated mirror).
// M11: 'plot' = a garden plot offered for reservation (priced; reserved via a
// claim of type 'plot_reservation'; payment settles in person like every sale).
export type ListingType = 'free' | 'trade' | 'sale' | 'wanted' | 'plot';

export interface Profile {
  id: string;
  name: string;
  avatar_url: string | null;
  zip_code: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  user_type: UserType;
  business_account: boolean;
  business_category: string | null;
  // Capability flags — gate future features off these, never off user_type.
  can_post: boolean;
  can_claim: boolean;
  can_sponsor: boolean;
  can_create_promotions: boolean;
  can_offer_delivery: boolean; // future (V2 delivery), dormant in V1
  created_at: string;
}

export type MarketPlan = 'free' | 'grower' | 'farm' | 'sponsor';

export interface PlanLimit {
  plan: MarketPlan;
  /** null = unlimited (0062 remodel: farm & sponsor). */
  max_active_listings: number | null;
  max_photos: number;
  analytics: boolean;
  featured: boolean;
  delivery_eligible: boolean;
  price_cents: number;
  included_boost_credits?: number;
  /** Included pickup locations (0052; remodeled 0062: free 1, grower 2, farm 5). */
  max_pickup_locations?: number;
  /** Monthly price per extra pickup location; null = add-ons not offered. */
  extra_location_fee_cents?: number | null;
}

export type PromotionSource = 'manual' | 'plan_credit' | 'paid' | 'sponsor';

export type ReportTargetType = 'listing' | 'market' | 'claim' | 'message' | 'user';

export interface MarketReputation {
  member_since: string | null;
  listings_shared: number;
  listings_sold: number;
  trades_completed: number;
  response_rate: number | null;
  /** Owner's auth email is confirmed (0015). Optional until the view is migrated. */
  verified_email?: boolean;
}

/** One row in Settings → Blocked neighbors (user_blocks + blocked profile). */
export interface BlockedNeighbor {
  blocked_id: string;
  created_at: string;
  blocked: Pick<Profile, 'id' | 'name' | 'avatar_url'> | null;
}

export interface Market {
  id: string;
  owner_id: string;
  name: string;
  slug?: string | null;
  market_type?: string;
  plan?: MarketPlan;
  avatar_url: string | null;
  banner_url?: string | null;
  tagline?: string | null;
  theme?: string | null;
  description: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  verified?: boolean;
  status: string;
  created_at: string;
}

export interface Listing {
  id: string;
  owner_id: string;
  market_id: string | null;
  kind: ListingKind;
  listing_type: ListingType;
  price_cents: number | null;
  currency: string | null;
  trade_for: string | null;
  unit: string | null;
  inventory_count: number | null;
  fulfillment_type?: string;
  // Exact lat/lng are write-only via the public API (revoked SELECT for privacy);
  // the app reads coarse approx_lat/approx_lng only.
  lat?: number | null;
  lng?: number | null;
  approx_lat?: number | null;
  approx_lng?: number | null;
  is_featured?: boolean;
  featured_until?: string | null;
  fulfilled_by_listing_id: string | null;
  title: string;
  description: string | null;
  category: string;
  /** Pointer into marketplace_taxonomy_nodes (nullable for legacy rows). */
  taxonomy_node_id?: string | null;
  quantity: string | null;
  photos: string[];
  status: ListingStatus;
  delivery_available?: boolean; // future (V2 delivery), dormant in V1
  is_demo?: boolean | null; // sample content — always labeled "Preview" in the UI
  created_at: string;
  expires_at: string;
  // Joined / derived (not columns):
  owner?: Profile | null;
  market?: { name: string } | null;
  distance_miles?: number | null;
  claim_count?: number;
}

export interface Claim {
  id: string;
  listing_id: string;
  claimer_id: string;
  status: ClaimStatus;
  claim_type?: ClaimType;
  buyer_note?: string | null;
  trade_offer_text?: string | null;
  agreed_price_cents?: number | null;
  quantity_requested?: number | null;
  payment_status?: string;
  fulfillment_method?: string; // future (V2 delivery): pickup | delivery | meetup
  assigned_fulfiller_id?: string | null; // future (V2 delivery), dormant in V1
  created_at: string;
  // Joined:
  listing?: Listing | null;
  claimer?: Profile | null;
}

export interface ClaimMessage {
  id: string;
  claim_id: string;
  sender_id: string;
  body: string;
  /** 'update' = grower growth update on a plot reservation (0026); default 'message'. */
  kind?: 'message' | 'update';
  photo_url?: string | null;
  created_at: string;
  reported_at: string | null;
}

export interface ProfileStats {
  memberSince: string;
  postsShared: number;
  claimsCompleted: number;
}

export interface GnomeEvent {
  id: string;
  event_type: string;
  listing_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

/** One row in the My Gnome → Messages list (a claim-scoped chat). */
export interface ChatSummary {
  claimId: string;
  status: ClaimStatus;
  listingTitle: string;
  otherName: string;
  lastBody: string | null;
  lastAt: string;
  lastSenderId: string | null;
}
