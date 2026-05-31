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

export type ClaimStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export type ListingKind = 'offer' | 'wanted';

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

export interface Listing {
  id: string;
  owner_id: string;
  kind: ListingKind;
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
  distance_miles?: number | null;
  claim_count?: number;
}

export interface Claim {
  id: string;
  listing_id: string;
  claimer_id: string;
  status: ClaimStatus;
  fulfillment_method?: string; // future (V2 delivery): pickup | delivery | meetup
  assigned_fulfiller_id?: string | null; // future (V2 delivery), dormant in V1
  created_at: string;
  // Joined:
  listing?: Listing | null;
  claimer?: Profile | null;
}

export interface ProfileStats {
  memberSince: string;
  postsShared: number;
  claimsCompleted: number;
}
