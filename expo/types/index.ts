// Gnome domain types — mirror the Supabase schema in
// supabase/migrations/0001_init.sql. Scope: surplus-produce sharing loop.

export type ListingStatus =
  | 'active'
  | 'claimed'
  | 'completed'
  | 'expired'
  | 'removed';

export type UserType =
  | 'neighbor'
  | 'grower'
  | 'farm'
  | 'business'
  | 'market'
  | 'municipality';

export type ClaimType = 'claim' | 'trade_offer' | 'purchase_request' | 'wanted_response';

export type ClaimStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'cancelled'
  | 'completed'
  | 'expired';

export type ListingKind = 'offer' | 'wanted';

// M2: listing_type is the source of truth (kind is a derived/deprecated mirror).
export type ListingType = 'free' | 'trade' | 'sale' | 'wanted';

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
  max_active_listings: number;
  max_photos: number;
  analytics: boolean;
  featured: boolean;
  delivery_eligible: boolean;
  price_cents: number;
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
  fulfilled_by_listing_id: string | null;
  title: string;
  description: string | null;
  category: string;
  quantity: string | null;
  photos: string[];
  lat: number | null;
  lng: number | null;
  status: ListingStatus;
  delivery_available?: boolean; // future (V2 delivery), dormant in V1
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
