import { useEffect } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from './supabase';
import { notifyCounterparty, notifyOfferCreated, notifyMessage } from './notifications';
import type { ClaimMessage, ListingKind, ListingType } from '@/types';

/** Best-effort analytics event. Never throws into the UI. */
export async function logEvent(
  eventType: string,
  opts: { userId?: string | null; listingId?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    if (!isSupabaseConfigured) return;
    await supabase.from('events').insert({
      event_type: eventType,
      user_id: opts.userId ?? null,
      listing_id: opts.listingId ?? null,
      metadata: opts.metadata ?? {},
    });
  } catch {
    /* analytics is best-effort */
  }
}
import { distanceMiles, radiusToMiles, type Coords, type RadiusOption } from './location';
import type {
  BlockedNeighbor,
  Claim,
  ChatSummary,
  ClaimStatus,
  ClaimType,
  GnomeEvent,
  Listing,
  Market,
  MarketReputation,
  PlanLimit,
  Profile,
  ProfileStats,
  ReportTargetType,
} from '@/types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const keys = {
  listings: (filters?: unknown) => ['listings', filters] as const,
  listing: (id: string) => ['listing', id] as const,
  myListings: (uid?: string) => ['myListings', uid] as const,
  myClaims: (uid?: string) => ['myClaims', uid] as const,
  incomingClaims: (uid?: string) => ['incomingClaims', uid] as const,
  profile: (id: string) => ['profile', id] as const,
  profileStats: (id: string) => ['profileStats', id] as const,
  claimThread: (id: string) => ['claimThread', id] as const,
  claimMessages: (id: string) => ['claimMessages', id] as const,
  myEvents: (uid?: string) => ['myEvents', uid] as const,
  myChats: (uid?: string) => ['myChats', uid] as const,
  myMarket: (uid?: string) => ['myMarket', uid] as const,
  market: (id: string) => ['market', id] as const,
  marketListings: (id: string) => ['marketListings', id] as const,
  planLimits: () => ['planLimits'] as const,
  featured: (filters?: unknown) => ['featured', filters] as const,
  boostCredits: (marketId?: string) => ['boostCredits', marketId] as const,
  marketReputation: (marketId?: string) => ['marketReputation', marketId] as const,
  myBlocks: (uid?: string) => ['myBlocks', uid] as const,
  myProfile: (uid?: string) => ['myProfile', uid] as const,
};

// Explicit column list — NEVER select('*') or lat/lng (SELECT on exact coords is
// revoked from anon/authenticated for privacy; the app reads approx_* only).
const LISTING_FIELDS =
  'id,owner_id,market_id,kind,listing_type,fulfilled_by_listing_id,title,description,' +
  'category,quantity,photos,price_cents,currency,trade_for,unit,inventory_count,' +
  'fulfillment_type,approx_lat,approx_lng,is_featured,featured_until,is_demo,status,created_at,expires_at';
const LISTING_SELECT = `${LISTING_FIELDS}, owner:profiles(*), market:markets(name), claims(count)`;

function shapeListing(row: any): Listing {
  const claim_count = Array.isArray(row.claims) ? row.claims[0]?.count ?? 0 : 0;
  const { claims, ...rest } = row;
  return { ...rest, claim_count } as Listing;
}

/**
 * Owner ids the current viewer has blocked. RLS returns only the viewer's own
 * block rows (anonymous → none). Best-effort: if the table doesn't exist yet
 * (0016 not applied), browsing must keep working — return an empty set.
 */
async function fetchMyBlockedSet(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from('user_blocks').select('blocked_id');
    if (error) return new Set();
    return new Set((data ?? []).map((b: { blocked_id: string }) => b.blocked_id));
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Browse listings (anonymous-friendly)
// ---------------------------------------------------------------------------
export interface BrowseFilters {
  coords: Coords | null;
  radius: RadiusOption;
  category: string | null;
  listingType: 'all' | ListingType;
}

export function useListings(filters: BrowseFilters) {
  return useQuery({
    queryKey: keys.listings(filters),
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<Listing[]> => {
      let q = supabase
        .from('listings')
        .select(LISTING_SELECT)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(200);
      if (filters.category) q = q.eq('category', filters.category);
      if (filters.listingType !== 'all') q = q.eq('listing_type', filters.listingType);

      const [{ data, error }, blocked] = await Promise.all([q, fetchMyBlockedSet()]);
      if (error) throw error;

      let listings = (data ?? []).map(shapeListing).filter((l) => !blocked.has(l.owner_id));

      if (filters.coords) {
        const max = radiusToMiles(filters.radius);
        listings = listings
          .map((l) => ({
            ...l,
            distance_miles:
              l.approx_lat != null && l.approx_lng != null
                ? distanceMiles(filters.coords as Coords, { lat: l.approx_lat, lng: l.approx_lng })
                : null,
          }))
          .filter((l) => l.distance_miles == null || l.distance_miles <= max)
          .sort((a, b) => (a.distance_miles ?? 9999) - (b.distance_miles ?? 9999));
      }
      return listings;
    },
  });
}

export function useListing(id: string) {
  return useQuery({
    queryKey: keys.listing(id),
    enabled: isSupabaseConfigured && !!id,
    queryFn: async (): Promise<Listing | null> => {
      const { data, error } = await supabase
        .from('listings')
        .select(LISTING_SELECT)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? shapeListing(data) : null;
    },
  });
}

// ---------------------------------------------------------------------------
// My listings + incoming claims (owner side)
// ---------------------------------------------------------------------------
export function useMyListings(uid?: string) {
  return useQuery({
    queryKey: keys.myListings(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<Listing[]> => {
      const { data, error } = await supabase
        .from('listings')
        .select(LISTING_SELECT)
        .eq('owner_id', uid as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(shapeListing);
    },
  });
}

/** Claims other people have made on my listings (pending approval, etc.). */
export function useIncomingClaims(uid?: string) {
  return useQuery({
    queryKey: keys.incomingClaims(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<Claim[]> => {
      const { data, error } = await supabase
        .from('claims')
        // claims has two FKs to profiles (claimer_id + dormant assigned_fulfiller_id),
        // so disambiguate the claimer embed by FK constraint name. The listing embed
        // must name its columns too: `listings(*)` expands to every column including
        // lat/lng, whose SELECT is revoked → 42501 kills the whole query.
        .select(`*, claimer:profiles!claims_claimer_id_fkey(*), listing:listings!inner(${LISTING_FIELDS})`)
        .eq('listing.owner_id', uid as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Claim[];
    },
  });
}

/** Claims I have made on other people's listings. */
export function useMyClaims(uid?: string) {
  return useQuery({
    queryKey: keys.myClaims(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<Claim[]> => {
      const { data, error } = await supabase
        .from('claims')
        .select(`*, listing:listings(${LISTING_FIELDS}, owner:profiles(*))`)
        .eq('claimer_id', uid as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Claim[];
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export interface NewListing {
  listingType: ListingType;
  title: string;
  description: string;
  category: string;
  quantity: string;
  photos: string[];
  coords: Coords | null;
  // type-specific
  priceCents?: number | null;
  unit?: string | null;
  inventoryCount?: number | null;
  tradeFor?: string | null;
  fulfilledByListingId?: string | null;
}

export function useCreateListing(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewListing): Promise<Listing> => {
      if (!uid) throw new Error('You must be signed in to post.');
      // Attach the listing to the user's Market (created on signup / backfill).
      const { data: market } = await supabase
        .from('markets')
        .select('id')
        .eq('owner_id', uid)
        .limit(1)
        .maybeSingle();
      // listing_type is source of truth; send a derived `kind` mirror too so it's
      // correct even before the 0006 sync trigger is applied.
      const derivedKind: ListingKind = input.listingType === 'wanted' ? 'wanted' : 'offer';
      const { data, error } = await supabase
        .from('listings')
        .insert({
          owner_id: uid,
          market_id: market?.id ?? null,
          listing_type: input.listingType,
          kind: derivedKind,
          title: input.title,
          description: input.description || null,
          category: input.category,
          quantity: input.quantity || null,
          photos: input.photos,
          price_cents: input.priceCents ?? null,
          unit: input.unit || null,
          inventory_count: input.inventoryCount ?? null,
          trade_for: input.tradeFor || null,
          lat: input.coords?.lat ?? null,
          lng: input.coords?.lng ?? null,
          fulfilled_by_listing_id: input.fulfilledByListingId ?? null,
        })
        .select(LISTING_SELECT)
        .single();
      if (error) throw error;
      return shapeListing(data);
    },
    onSuccess: (listing) => {
      void logEvent(`listing_created_${listing.listing_type}`, {
        userId: uid,
        listingId: listing.id,
        metadata: { listing_type: listing.listing_type, title: listing.title },
      });
      if (listing.kind === 'offer') {
        // New offer -> server-side category+radius matching pushes to wanted owners.
        void notifyOfferCreated(listing.id);
        if (listing.fulfilled_by_listing_id) {
          void logEvent('offer_matched_to_want', {
            userId: uid,
            listingId: listing.id,
            metadata: { wanted_id: listing.fulfilled_by_listing_id, title: listing.title },
          });
        }
      }
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
      qc.invalidateQueries({ queryKey: keys.myEvents(uid) });
    },
  });
}

export interface NewClaim {
  listingId: string;
  title?: string;
  claimType?: ClaimType;
  buyerNote?: string | null;
  tradeOfferText?: string | null;
  agreedPriceCents?: number | null;
  paymentStatus?: 'none' | 'external';
}

export function useClaimListing(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewClaim): Promise<Claim> => {
      if (!uid) throw new Error('You must be signed in to make a request.');
      const row = {
        listing_id: input.listingId,
        claimer_id: uid,
        claim_type: input.claimType ?? 'claim',
        buyer_note: input.buyerNote || null,
        trade_offer_text: input.tradeOfferText || null,
        agreed_price_cents: input.agreedPriceCents ?? null,
        payment_status: input.paymentStatus ?? 'none',
      };
      const { data, error } = await supabase.from('claims').insert(row).select('*').single();
      if (!error) return data as Claim;

      // claims is UNIQUE (listing_id, claimer_id), so a neighbour whose earlier
      // request was declined or cancelled has no row to insert. Re-open that
      // row instead of failing with a raw constraint error.
      if (error.code === '23505') {
        const { data: revived, error: reviveError } = await supabase
          .from('claims')
          .update({ ...row, status: 'pending' })
          .eq('listing_id', input.listingId)
          .eq('claimer_id', uid)
          .in('status', ['declined', 'cancelled', 'expired'])
          .select('*')
          .maybeSingle();
        if (reviveError) throw reviveError;
        if (revived) return revived as Claim;
        throw new Error('You already have a request on this listing.');
      }
      throw error;
    },
    onSuccess: (claim, input) => {
      void notifyCounterparty('claim', claim.id);
      void logEvent('listing_claim_started', {
        userId: uid,
        listingId: input.listingId,
        metadata: { title: input.title, claim_type: input.claimType ?? 'claim' },
      });
      qc.invalidateQueries({ queryKey: keys.listing(input.listingId) });
      qc.invalidateQueries({ queryKey: keys.myClaims(uid) });
      qc.invalidateQueries({ queryKey: keys.myEvents(uid) });
    },
  });
}

export function useUpdateClaim(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      claimId: string;
      status: 'approved' | 'declined' | 'cancelled';
      title?: string;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from('claims')
        .update({ status: input.status })
        .eq('id', input.claimId)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('That request could no longer be updated.');
    },
    onSuccess: (_d, input) => {
      if (input.status === 'approved') void notifyCounterparty('approved', input.claimId);
      if (input.status === 'approved' || input.status === 'declined') {
        void logEvent(input.status === 'approved' ? 'listing_claim_approved' : 'claim_declined', {
          userId: uid,
          metadata: { claim_id: input.claimId, title: input.title },
        });
      }
      qc.invalidateQueries({ queryKey: keys.incomingClaims(uid) });
      qc.invalidateQueries({ queryKey: keys.myClaims(uid) });
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
      qc.invalidateQueries({ queryKey: keys.myEvents(uid) });
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: ['listing'] });
    },
  });
}

export function useUpdateListingStatus(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      listingId: string;
      status: 'completed' | 'removed' | 'active';
      kind?: ListingKind;
      title?: string;
    }): Promise<void> => {
      const { error } = await supabase
        .from('listings')
        .update({ status: input.status })
        .eq('id', input.listingId);
      if (error) throw error;
      // Completing a pickup also completes its approved claim, which closes the
      // pickup chat to writes while keeping it readable as history.
      if (input.status === 'completed') {
        await supabase
          .from('claims')
          .update({ status: 'completed' })
          .eq('listing_id', input.listingId)
          .eq('status', 'approved');
      }
    },
    onSuccess: (_d, input) => {
      if (input.status === 'completed') {
        void logEvent(input.kind === 'wanted' ? 'wanted_completed' : 'listing_completed', {
          userId: uid,
          listingId: input.listingId,
          metadata: { title: input.title },
        });
      }
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
      qc.invalidateQueries({ queryKey: keys.listing(input.listingId) });
      qc.invalidateQueries({ queryKey: keys.myEvents(uid) });
      qc.invalidateQueries({ queryKey: ['listings'] });
    },
  });
}

/** Edit a listing's editable fields (owner only, enforced by RLS). */
export function useUpdateListing(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      listingId: string;
      title: string;
      description: string;
      quantity: string;
      category: string;
    }): Promise<void> => {
      if (!uid) throw new Error('You must be signed in to edit a listing.');
      // Return the id so an RLS-rejected update (0 rows, no error) is caught
      // here instead of looking like a successful save.
      const { data, error } = await supabase
        .from('listings')
        .update({
          title: input.title,
          description: input.description || null,
          quantity: input.quantity || null,
          category: input.category,
        })
        .eq('id', input.listingId)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You can only edit your own listings.');
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
      qc.invalidateQueries({ queryKey: keys.listing(input.listingId) });
      qc.invalidateQueries({ queryKey: ['listings'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Profiles + trust signals
// ---------------------------------------------------------------------------
export function useProfile(id?: string) {
  return useQuery({
    queryKey: keys.profile(id ?? ''),
    enabled: isSupabaseConfigured && !!id,
    queryFn: async (): Promise<Profile | null> => {
      // Explicit public columns only — never select('*') here, so a private
      // column (zip_code) can be revoked without breaking cross-user reads.
      const { data, error } = await supabase
        .from('profiles')
        .select('id,name,avatar_url,city,county,state,user_type,business_account,business_category,created_at')
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

export function useProfileStats(id?: string) {
  return useQuery({
    queryKey: keys.profileStats(id ?? ''),
    enabled: isSupabaseConfigured && !!id,
    queryFn: async (): Promise<ProfileStats> => {
      const [profileRes, postsRes, claimsRes] = await Promise.all([
        supabase.from('profiles').select('created_at').eq('id', id as string).maybeSingle(),
        supabase.from('listings').select('id', { count: 'exact', head: true }).eq('owner_id', id as string),
        supabase
          .from('claims')
          .select('id', { count: 'exact', head: true })
          .eq('claimer_id', id as string)
          .eq('status', 'approved'),
      ]);
      return {
        memberSince: profileRes.data?.created_at ?? new Date().toISOString(),
        postsShared: postsRes.count ?? 0,
        claimsCompleted: claimsRes.count ?? 0,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Markets (M1) — a user's lightweight local garden/storefront identity
// ---------------------------------------------------------------------------

/** The current user's own Market (one per user in M1). */
export function useMyMarket(uid?: string) {
  return useQuery({
    queryKey: keys.myMarket(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<Market | null> => {
      const { data, error } = await supabase
        .from('markets')
        .select('*')
        .eq('owner_id', uid as string)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Market | null;
    },
  });
}

/** A public Market profile by id (active markets are world-readable). */
export function useMarket(id?: string) {
  return useQuery({
    queryKey: keys.market(id ?? ''),
    enabled: isSupabaseConfigured && !!id,
    queryFn: async (): Promise<Market | null> => {
      const { data, error } = await supabase
        .from('markets')
        .select('*')
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      return data as Market | null;
    },
  });
}

/** Active listings belonging to a Market. */
export function useMarketListings(marketId?: string) {
  return useQuery({
    queryKey: keys.marketListings(marketId ?? ''),
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<Listing[]> => {
      const { data, error } = await supabase
        .from('listings')
        .select(LISTING_SELECT)
        .eq('market_id', marketId as string)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(shapeListing);
    },
  });
}

/** Plan limits (public read), keyed by plan. */
export function usePlanLimits() {
  return useQuery({
    queryKey: keys.planLimits(),
    enabled: isSupabaseConfigured,
    staleTime: 60 * 60 * 1000, // pricing/limits rarely change
    queryFn: async (): Promise<Record<string, PlanLimit>> => {
      const { data, error } = await supabase.from('plan_limits').select('*');
      if (error) throw error;
      const map: Record<string, PlanLimit> = {};
      for (const row of (data ?? []) as PlanLimit[]) map[row.plan] = row;
      return map;
    },
  });
}

/** Objective reputation for a market (from the public_markets view). */
export function useMarketReputation(id?: string) {
  return useQuery({
    queryKey: keys.marketReputation(id ?? ''),
    enabled: isSupabaseConfigured && !!id,
    queryFn: async (): Promise<MarketReputation | null> => {
      const { data, error } = await supabase
        .from('public_markets')
        .select('member_since,listings_shared,listings_sold,trades_completed,response_rate,verified_email')
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      return data as MarketReputation | null;
    },
  });
}

/** File a safety report/flag (listing/market/claim/message/user). */
export function useReport(uid?: string) {
  return useMutation({
    mutationFn: async (input: { targetType: ReportTargetType; targetId: string; reason?: string }): Promise<void> => {
      if (!uid) throw new Error('Sign in to report.');
      const { error } = await supabase.from('reports').insert({
        reporter_id: uid,
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason || null,
      });
      if (error) throw error;
    },
  });
}

// ---------------------------------------------------------------------------
// Safety: block / unblock neighbors (0016) + beta feedback (0017)
// ---------------------------------------------------------------------------

/** Neighbors I've blocked, for Settings management. Two FKs to profiles → the
 *  embed must name the constraint (see the claims PGRST201 lesson). */
export function useMyBlocks(uid?: string) {
  return useQuery({
    queryKey: keys.myBlocks(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<BlockedNeighbor[]> => {
      const { data, error } = await supabase
        .from('user_blocks')
        .select('blocked_id, created_at, blocked:profiles!user_blocks_blocked_id_fkey(id,name,avatar_url)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BlockedNeighbor[];
    },
  });
}

export function useBlockUser(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blockedId: string): Promise<void> => {
      if (!uid) throw new Error('Sign in to block.');
      if (blockedId === uid) throw new Error('You cannot block yourself.');
      // ignoreDuplicates => ON CONFLICT DO NOTHING. A merge (DO UPDATE) would hit
      // RLS: user_blocks has no UPDATE policy, so re-blocking would error.
      const { error } = await supabase
        .from('user_blocks')
        .upsert(
          { blocker_id: uid, blocked_id: blockedId },
          { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.myBlocks(uid) });
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: ['featured'] });
    },
  });
}

export function useUnblockUser(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blockedId: string): Promise<void> => {
      if (!uid) throw new Error('Sign in first.');
      const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', uid)
        .eq('blocked_id', blockedId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.myBlocks(uid) });
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: ['featured'] });
    },
  });
}

/** Beta feedback (write-only; reviewed server-side like reports). */
export function useSendFeedback(uid?: string) {
  return useMutation({
    mutationFn: async (body: string): Promise<void> => {
      if (!uid) throw new Error('Sign in to send feedback.');
      const trimmed = body.trim();
      if (!trimmed) throw new Error('Feedback is empty.');
      const { error } = await supabase
        .from('feedback')
        .insert({ user_id: uid, body: trimmed.slice(0, 2000) });
      if (error) throw error;
    },
  });
}

export function useUpdateMarket(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      marketId: string;
      name: string;
      description: string;
      avatar_url?: string | null;
    }): Promise<void> => {
      const patch: Record<string, unknown> = {
        name: input.name,
        description: input.description || null,
      };
      if (input.avatar_url !== undefined) patch.avatar_url = input.avatar_url;
      if (!uid) throw new Error('You must be signed in to edit your Market.');
      const { data, error } = await supabase
        .from('markets')
        .update(patch)
        .eq('id', input.marketId)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You can only edit your own Market.');
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: keys.myMarket(uid) });
      qc.invalidateQueries({ queryKey: keys.market(input.marketId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Promotions (M7) — Featured Near You + plan-credit boosts (no payments)
// ---------------------------------------------------------------------------

/** Active promotions' listings, filtered by radius + type; max 5 (rail hides <2). */
export function useFeaturedListings(filters: BrowseFilters) {
  return useQuery({
    queryKey: keys.featured(filters),
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<Listing[]> => {
      const { data, error } = await supabase
        .from('listing_promotions')
        .select(`id, ends_at, listing:listings(${LISTING_FIELDS}, owner:profiles(*), market:markets(name), claims(count))`)
        .eq('status', 'active')
        .gt('ends_at', new Date().toISOString())
        .order('ends_at', { ascending: true })
        .limit(30);
      if (error) throw error;

      const blocked = await fetchMyBlockedSet();
      const seen = new Set<string>();
      let listings: Listing[] = [];
      for (const row of (data ?? []) as any[]) {
        const l = row.listing;
        if (!l || l.status !== 'active') continue;
        if (new Date(l.expires_at).getTime() <= Date.now()) continue;
        if (seen.has(l.id)) continue;
        if (blocked.has(l.owner_id)) continue;
        seen.add(l.id);
        listings.push(shapeListing(l));
      }

      if (filters.listingType !== 'all') {
        listings = listings.filter((l) => l.listing_type === filters.listingType);
      }
      if (filters.coords) {
        const max = radiusToMiles(filters.radius);
        listings = listings
          .map((l) => ({
            ...l,
            distance_miles:
              l.approx_lat != null && l.approx_lng != null
                ? distanceMiles(filters.coords as Coords, { lat: l.approx_lat, lng: l.approx_lng })
                : null,
          }))
          .filter((l) => l.distance_miles == null || l.distance_miles <= max);
      }
      return listings.slice(0, 5);
    },
  });
}

/** Remaining included boost credits this month for a market (server-computed). */
export function useBoostCreditsRemaining(marketId?: string) {
  return useQuery({
    queryKey: keys.boostCredits(marketId),
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('market_boost_credits_remaining', {
        p_market_id: marketId,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
}

export function usePromoteListing(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      listingId: string;
      marketId: string;
      durationDays: number;
      source: 'plan_credit' | 'manual';
      priceCents?: number | null;
    }): Promise<void> => {
      const startsAt = new Date();
      const endsAt = new Date(Date.now() + input.durationDays * 86_400_000);
      const { error } = await supabase.from('listing_promotions').insert({
        listing_id: input.listingId,
        market_id: input.marketId,
        source: input.source,
        status: 'active',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        price_cents: input.priceCents ?? null,
        created_by: uid ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      void logEvent('promotion_created', { userId: uid, listingId: input.listingId, metadata: { source: input.source, days: input.durationDays } });
      void logEvent('promotion_activated', { userId: uid, listingId: input.listingId, metadata: { source: input.source } });
      if (input.source === 'plan_credit') {
        void logEvent('plan_credit_redeemed', { userId: uid, listingId: input.listingId });
      }
      qc.invalidateQueries({ queryKey: ['featured'] });
      qc.invalidateQueries({ queryKey: keys.boostCredits(input.marketId) });
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
      qc.invalidateQueries({ queryKey: keys.listing(input.listingId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Claim-scoped pickup chat (V1.2)
// ---------------------------------------------------------------------------

/** The claim + its parties + status, for the chat header and composer gating. */
export function useClaimThread(claimId?: string) {
  return useQuery({
    queryKey: keys.claimThread(claimId ?? ''),
    enabled: isSupabaseConfigured && !!claimId,
    queryFn: async (): Promise<Claim | null> => {
      const { data, error } = await supabase
        .from('claims')
        .select(`*, claimer:profiles!claims_claimer_id_fkey(*), listing:listings(${LISTING_FIELDS}, owner:profiles(*))`)
        .eq('id', claimId as string)
        .maybeSingle();
      if (error) throw error;
      return data as Claim | null;
    },
  });
}

export function useClaimMessages(claimId?: string) {
  return useQuery({
    queryKey: keys.claimMessages(claimId ?? ''),
    enabled: isSupabaseConfigured && !!claimId,
    // Realtime (useClaimMessagesRealtime) drives immediacy; this slow poll is a
    // safety net if the socket drops or the table isn't in the publication yet.
    refetchInterval: 15000,
    queryFn: async (): Promise<ClaimMessage[]> => {
      const { data, error } = await supabase
        .from('claim_messages')
        .select('*')
        .eq('claim_id', claimId as string)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ClaimMessage[];
    },
  });
}

/**
 * Subscribe to new messages on this claim over Supabase Realtime and refresh the
 * thread the instant one arrives. RLS on `claim_messages` scopes the stream to
 * the two parties of an approved claim, so no extra auth is needed. Requires the
 * table to be in the `supabase_realtime` publication (migration 0014).
 */
export function useClaimMessagesRealtime(claimId?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!isSupabaseConfigured || !claimId) return;
    const channel = supabase
      .channel(`claim_messages:${claimId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'claim_messages',
          filter: `claim_id=eq.${claimId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: keys.claimMessages(claimId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [claimId, qc]);
}

export function useSendMessage(claimId?: string, uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string): Promise<ClaimMessage> => {
      if (!uid || !claimId) throw new Error('Not signed in.');
      const trimmed = body.trim();
      if (!trimmed) throw new Error('Message is empty.');
      if (trimmed.length > 500) throw new Error('Messages are limited to 500 characters.');
      const { data, error } = await supabase
        .from('claim_messages')
        .insert({ claim_id: claimId, sender_id: uid, body: trimmed })
        .select('*')
        .single();
      if (error) throw error;
      return data as ClaimMessage;
    },
    onSuccess: (msg) => {
      void notifyMessage(msg.claim_id, msg.body.slice(0, 80));
      void logEvent('claim_message_sent', { userId: uid, metadata: { claim_id: msg.claim_id } });
      qc.invalidateQueries({ queryKey: keys.claimMessages(claimId ?? '') });
    },
  });
}


// ---------------------------------------------------------------------------
// My Gnome — Activity history + Messages list (V1.4)
// ---------------------------------------------------------------------------

/** Plain history of my own events (no analytics/metrics). */
export function useMyEvents(uid?: string) {
  return useQuery({
    queryKey: keys.myEvents(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<GnomeEvent[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('id, event_type, listing_id, metadata, created_at')
        .eq('user_id', uid as string)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as GnomeEvent[];
    },
  });
}

/** All my active claim chats (owner or claimant side), newest message first. */
export function useMyChats(uid?: string) {
  return useQuery({
    queryKey: keys.myChats(uid),
    enabled: isSupabaseConfigured && !!uid,
    refetchInterval: 8000,
    queryFn: async (): Promise<ChatSummary[]> => {
      const ACTIVE = ['approved', 'completed'];
      const [mineRes, inRes] = await Promise.all([
        supabase
          .from('claims')
          .select('id, status, created_at, listing:listings(title, owner:profiles(name))')
          .eq('claimer_id', uid as string)
          .in('status', ACTIVE),
        supabase
          .from('claims')
          .select('id, status, created_at, claimer:profiles!claims_claimer_id_fkey(name), listing:listings!inner(title, owner_id)')
          .eq('listing.owner_id', uid as string)
          .in('status', ACTIVE),
      ]);
      if (mineRes.error) throw mineRes.error;
      if (inRes.error) throw inRes.error;

      const summaries: Record<string, ChatSummary> = {};
      for (const c of (mineRes.data ?? []) as any[]) {
        summaries[c.id] = {
          claimId: c.id,
          status: c.status,
          listingTitle: c.listing?.title ?? 'Listing',
          otherName: c.listing?.owner?.name ?? 'the owner',
          lastBody: null,
          lastAt: c.created_at,
          lastSenderId: null,
        };
      }
      for (const c of (inRes.data ?? []) as any[]) {
        summaries[c.id] = {
          claimId: c.id,
          status: c.status,
          listingTitle: c.listing?.title ?? 'Listing',
          otherName: c.claimer?.name ?? 'a neighbor',
          lastBody: null,
          lastAt: c.created_at,
          lastSenderId: null,
        };
      }

      const ids = Object.keys(summaries);
      if (ids.length) {
        const { data: msgs } = await supabase
          .from('claim_messages')
          .select('claim_id, body, created_at, sender_id')
          .in('claim_id', ids)
          .order('created_at', { ascending: false });
        const seen = new Set<string>();
        for (const m of (msgs ?? []) as any[]) {
          if (seen.has(m.claim_id)) continue; // ordered desc -> first is newest
          seen.add(m.claim_id);
          const s = summaries[m.claim_id];
          if (s) {
            s.lastBody = m.body;
            s.lastAt = m.created_at;
            s.lastSenderId = m.sender_id;
          }
        }
      }

      return Object.values(summaries).sort(
        (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
      );
    },
  });
}

/**
 * The signed-in user's OWN profile, including fields other neighbours must not
 * see (zip_code). Goes through the my_profile() RPC, which is pinned to
 * auth.uid() server-side, so it keeps working after the private columns are
 * revoked from the authenticated role.
 */
export function useMyProfile(uid?: string) {
  return useQuery({
    queryKey: keys.myProfile(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase.rpc('my_profile');
      if (error) throw error;
      const rows = (data ?? []) as Profile[];
      return rows[0] ?? null;
    },
  });
}

export function useUpdateProfile(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name?: string;
      zip_code?: string | null;
      city?: string | null;
      state?: string | null;
      avatar_url?: string | null;
    }): Promise<void> => {
      if (!uid) throw new Error('Not signed in.');
      // Return the id so an RLS-rejected update (0 rows, no error) surfaces as
      // a failure instead of a silent no-op that looks like a save.
      const { data, error } = await supabase
        .from('profiles')
        .update(input)
        .eq('id', uid)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You can only edit your own profile.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['myProfile'] });
    },
  });
}
