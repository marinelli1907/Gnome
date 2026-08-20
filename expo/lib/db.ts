import { useEffect } from 'react';
import type { AllowanceRow, WantedRow } from '@/lib/allowance';
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
import {
  boundingBox,
  browseRadiusMiles,
  distanceMiles,
  type BrowseRadius,
  type Coords,
} from './location';
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
  PublicMarket,
  PublicProfile,
  ReportTargetType,
  RequestOption,
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
  isFollowing: (marketId?: string, uid?: string) => ['isFollowing', marketId, uid] as const,
  followedMarkets: (uid?: string) => ['followedMarkets', uid] as const,
  followedListings: (uid?: string) => ['followedListings', uid] as const,
  followedDrops: (uid?: string) => ['followedDrops', uid] as const,
  myFollowerCount: (uid?: string) => ['myFollowerCount', uid] as const,
};

// Explicit column list — NEVER select('*') or lat/lng (SELECT on exact coords is
// revoked from anon/authenticated for privacy; the app reads approx_* only).
// The screening columns ride along on every listing read because a REVIEW
// verdict is invisible otherwise: the row saves, the status silently becomes
// 'paused', and only screening_status tells the seller's UI why.
//
// EXACTLY TWO of the five screening columns may appear here, because 0102 grants
// exactly those two. `listings` uses per-COLUMN grants, and PostgREST asks for
// every column in this list — so ONE ungranted column here returns 42501 for the
// WHOLE query and takes Browse down. That is not hypothetical: it is what 0085
// did with request_options and what 0092 had to repair.
// screening_term (the matched keyword), screening_category and screened_at are
// revoked on purpose. Do not add them.
const LISTING_FIELDS =
  'id,owner_id,market_id,kind,listing_type,fulfilled_by_listing_id,title,description,' +
  'category,taxonomy_node_id,quantity,photos,price_cents,currency,trade_for,unit,inventory_count,' +
  'fulfillment_type,approx_lat,approx_lng,is_featured,featured_until,is_demo,status,created_at,expires_at,' +
  'request_options,allow_custom_request,screening_status,screening_reason,is_bundle';
// The ONLY profile shape other users ever receive. Reads go through the
// `public_profiles` view (0087), which enumerates its columns server-side, so a
// column added to `profiles` cannot leak here. Administrative flags (can_*,
// suspended) are deliberately absent — nothing in the UI used them for other
// users, and they are entitlement/moderation state, not profile content.
// The owner reads their own full row via the my_profile() RPC.
const PUBLIC_PROFILE_FIELDS =
  'id,name,avatar_url,city,county,state,user_type,business_account,business_category,created_at';

// The only Market shape another user ever receives. 0093 revoked lat, lng, zip,
// contact_email, contact_phone and pickup_instructions from every client role —
// a seller's coordinates and personal phone are not public data. The owner reads
// their own full row through the my_market() RPC.
const PUBLIC_MARKET_FIELDS =
  'id,owner_id,name,slug,market_type,plan,avatar_url,banner_url,tagline,theme,' +
  'description,city,county,state,approximate_location,verified,status,created_at';

const LISTING_SELECT = `${LISTING_FIELDS}, owner:public_profiles(${PUBLIC_PROFILE_FIELDS}), market:markets(name), claims(count)`;

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

/**
 * 0121: buyer feeds must never surface an unavailable basket. The canonical
 * public view is the availability authority; these feed queries read the base
 * table, so any basket rows are re-checked against the view in ONE extra query
 * (skipped entirely when the page has no baskets). Fail-open on transport
 * trouble — the feed keeps working, and the server still refuses to sell an
 * unavailable basket at claim/order time regardless of what rendered.
 */
async function dropUnavailableBundles<T extends { id: string; is_bundle?: boolean | null }>(
  rows: T[],
): Promise<T[]> {
  const bundleIds = rows.filter((r) => r.is_bundle).map((r) => r.id);
  if (!bundleIds.length) return rows;
  try {
    const { data, error } = await supabase
      .from('public_listings')
      .select('id')
      .in('id', bundleIds);
    if (error) return rows;
    const ok = new Set((data ?? []).map((r: { id: string }) => r.id));
    return rows.filter((r) => !r.is_bundle || ok.has(r.id));
  } catch {
    return rows;
  }
}

// ---------------------------------------------------------------------------
// Browse listings (anonymous-friendly)
// ---------------------------------------------------------------------------
export interface BrowseFilters {
  coords: Coords | null;
  /** Miles (1–500) or 'anywhere' (no geographic filter). */
  radius: BrowseRadius;
  category: string | null;
  listingType: 'all' | ListingType;
  /** Node ids of the selected taxonomy subtree (from subtreeIds()); null = no
   *  taxonomy filter. Server-side .in() so a deep drilldown isn't starved by
   *  the 200-row browse cap. */
  taxonomyIds?: string[] | null;
}

export function useListings(filters: BrowseFilters) {
  return useQuery({
    queryKey: keys.listings(filters),
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<Listing[]> => {
      const maxMi = browseRadiusMiles(filters.radius);
      let q = supabase
        .from('listings')
        .select(LISTING_SELECT)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(200);
      if (filters.category) q = q.eq('category', filters.category);
      if (filters.taxonomyIds?.length) q = q.in('taxonomy_node_id', filters.taxonomyIds);
      if (filters.listingType !== 'all') q = q.eq('listing_type', filters.listingType);
      // SERVER-side prefilter: bounding box on the privacy-safe approx
      // coordinates. The 200-row cap then applies inside the box rather than
      // nationally, so a 250-mile search isn't silently starved by unrelated
      // far-away rows. 'anywhere' skips geography entirely (newest 200 —
      // documented cap, still paginated/limited, never unbounded).
      if (filters.coords && maxMi != null) {
        const box = boundingBox(filters.coords, maxMi);
        q = q
          .gte('approx_lat', box.minLat)
          .lte('approx_lat', box.maxLat)
          .gte('approx_lng', box.minLng)
          .lte('approx_lng', box.maxLng);
      }

      const [{ data, error }, blocked] = await Promise.all([q, fetchMyBlockedSet()]);
      if (error) throw error;

      let listings = await dropUnavailableBundles(
        (data ?? []).map(shapeListing).filter((l) => !blocked.has(l.owner_id)),
      );

      if (filters.coords) {
        // ONE distance source everywhere: buyer's current coords vs the
        // listing's approx coords. The same number drives the label and the
        // radius cut, so "6.2 mi away" and a 5-mile filter can never disagree.
        listings = listings.map((l) => ({
          ...l,
          distance_miles:
            l.approx_lat != null && l.approx_lng != null
              ? distanceMiles(filters.coords as Coords, { lat: l.approx_lat, lng: l.approx_lng })
              : null,
        }));
        if (maxMi != null) {
          listings = listings.filter((l) => l.distance_miles == null || l.distance_miles <= maxMi);
        }
        listings = listings.sort(
          (a, b) => (a.distance_miles ?? 9999) - (b.distance_miles ?? 9999),
        );
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
        .select(`*, claimer:public_profiles!claims_claimer_id_fkey(${PUBLIC_PROFILE_FIELDS}), listing:listings!inner(${LISTING_FIELDS})`)
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
        .select(`*, listing:listings(${LISTING_FIELDS}, owner:public_profiles(${PUBLIC_PROFILE_FIELDS}))`)
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
  /** Taxonomy node the seller picked. Required by the mobile UI for new
   *  listings; the column stays nullable server-side for legacy clients. */
  taxonomyNodeId?: string | null;
  /** 'paused' = save as a draft the compliance flow can auto-publish later
   *  (admin approval reactivates paused listings that pass the gate). */
  status?: 'active' | 'paused';
  // type-specific
  priceCents?: number | null;
  unit?: string | null;
  inventoryCount?: number | null;
  tradeFor?: string | null;
  fulfilledByListingId?: string | null;
  /** Wanted acceptable variants / Plot supported crops (optional). */
  requestOptions?: RequestOption[] | null;
  /** Wanted/Plot: allow the responder to request something else (default true). */
  allowCustomRequest?: boolean;
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
          taxonomy_node_id: input.taxonomyNodeId ?? null,
          ...(input.status ? { status: input.status } : {}),
          quantity: input.quantity || null,
          photos: input.photos,
          price_cents: input.priceCents ?? null,
          unit: input.unit || null,
          inventory_count: input.inventoryCount ?? null,
          trade_for: input.tradeFor || null,
          lat: input.coords?.lat ?? null,
          lng: input.coords?.lng ?? null,
          fulfilled_by_listing_id: input.fulfilledByListingId ?? null,
          ...(input.requestOptions && input.requestOptions.length
            ? { request_options: input.requestOptions } : {}),
          ...(input.allowCustomRequest != null
            ? { allow_custom_request: input.allowCustomRequest } : {}),
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
  /** Structured choice (Wanted/Plot). */
  selectedOptionLabel?: string | null;
  selectedTaxonomyNodeId?: string | null;
  isCustomOption?: boolean;
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
        selected_option_label: input.selectedOptionLabel || null,
        selected_taxonomy_node_id: input.selectedTaxonomyNodeId || null,
        is_custom_option: input.isCustomOption ?? false,
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
      // Return the id for the same reason useUpdateListing does: an update RLS
      // rejects comes back as 0 rows and NO error, so without this a seller who
      // can no longer touch the row is told their change was saved.
      const { data, error } = await supabase
        .from('listings')
        .update({ status: input.status })
        .eq('id', input.listingId)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('That listing could no longer be updated.');
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
      /** undefined = leave the node untouched (legacy listings keep their
       *  backfilled node); a value re-points it and re-runs the server gate. */
      taxonomyNodeId?: string | null;
    }): Promise<Listing> => {
      if (!uid) throw new Error('You must be signed in to edit a listing.');
      // Return the saved row for two reasons: an RLS-rejected update (0 rows, no
      // error) is caught here instead of looking like a successful save, and the
      // edit re-runs the screening trigger, which can park a live listing —
      // screening_status is the only place that shows up. Columns only, no
      // joins: the edit screen needs the verdict, not the owner card.
      const { data, error } = await supabase
        .from('listings')
        .update({
          title: input.title,
          description: input.description || null,
          quantity: input.quantity || null,
          category: input.category,
          ...(input.taxonomyNodeId !== undefined
            ? { taxonomy_node_id: input.taxonomyNodeId }
            : {}),
        })
        .eq('id', input.listingId)
        .select(LISTING_FIELDS);
      if (error) throw error;
      if (!data?.length) throw new Error('You can only edit your own listings.');
      return shapeListing(data[0]);
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
      qc.invalidateQueries({ queryKey: keys.listing(input.listingId) });
      qc.invalidateQueries({ queryKey: ['listings'] });
    },
  });
}

/**
 * Read back what the screening trigger decided about a row the server just
 * wrote. `publish_listing_draft` hands back only the new listing's id, so a
 * publish that was quietly parked as `paused` is indistinguishable from one
 * that went live until the row itself is asked.
 *
 * Best-effort by design: if the read fails we return null and the caller treats
 * the publish as ordinary — we would rather under-report a review than invent
 * one. RLS already limits this to rows the seller can see.
 */
export async function fetchListingScreening(
  listingId: string,
): Promise<Pick<Listing, 'id' | 'status' | 'screening_status' | 'screening_reason'> | null> {
  const { data, error } = await supabase
    .from('listings')
    .select('id,status,screening_status,screening_reason')
    .eq('id', listingId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Pick<Listing, 'id' | 'status' | 'screening_status' | 'screening_reason'>;
}

// ---------------------------------------------------------------------------
// Profiles + trust signals
// ---------------------------------------------------------------------------
export function useProfile(id?: string) {
  return useQuery({
    queryKey: keys.profile(id ?? ''),
    enabled: isSupabaseConfigured && !!id,
    queryFn: async (): Promise<PublicProfile | null> => {
      // Explicit public columns only — never select('*') here, so a private
      // column (zip_code) can be revoked without breaking cross-user reads.
      const { data, error } = await supabase
        .from('public_profiles')
        .select(PUBLIC_PROFILE_FIELDS)
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      return data as PublicProfile | null;
    },
  });
}

export function useProfileStats(id?: string) {
  return useQuery({
    queryKey: keys.profileStats(id ?? ''),
    enabled: isSupabaseConfigured && !!id,
    queryFn: async (): Promise<ProfileStats> => {
      const [profileRes, postsRes, claimsRes] = await Promise.all([
        supabase.from('public_profiles').select('created_at').eq('id', id as string).maybeSingle(),
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
      // The owner's OWN row, including the private columns 0093 revoked from
      // every client role. Grants are role-wide, so the owner cannot be excepted
      // by privilege — a definer RPC pinned to auth.uid() is how they get it
      // back, the same shape as my_profile().
      const { data, error } = await supabase.rpc('my_market');
      if (error) throw error;
      const rows = (data ?? []) as Market[];
      return rows[0] ?? null;
    },
  });
}

/** A public Market profile by id (active markets are world-readable). */
export function useMarket(id?: string) {
  return useQuery({
    queryKey: keys.market(id ?? ''),
    enabled: isSupabaseConfigured && !!id,
    queryFn: async (): Promise<PublicMarket | null> => {
      // Explicit columns, never `*`: markets carries per-column grants after
      // 0093, and `*` asks for lat/lng/zip/contact_* too, which would fail the
      // whole query with 42501 — exactly how LISTING_FIELDS broke Browse.
      const { data, error } = await supabase
        .from('markets')
        .select(PUBLIC_MARKET_FIELDS)
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      return data as PublicMarket | null;
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
      return dropUnavailableBundles((data ?? []).map(shapeListing));
    },
  });
}

/** Plan limits (public read), keyed by plan. */
/** The seller's own allowance row (0107). No market-id parameter exists to spoof — the RPC pins
 *  to auth.uid() server-side. staleTime is short: this drives the My Market usage card, and a
 *  seller who just published should see the numbers move. */
export function useMyListingAllowance(uid?: string) {
  return useQuery({
    queryKey: ['my-listing-allowance', uid],
    enabled: isSupabaseConfigured && !!uid,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<AllowanceRow | null> => {
      const { data, error } = await supabase.rpc('my_listing_allowance');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as AllowanceRow | null;
    },
  });
}

/** Daily Wanted introduction allowance (0110). Same no-parameter shape as the listing RPC. */
export function useMyWantedAllowance(uid?: string) {
  return useQuery({
    queryKey: ['my-wanted-allowance', uid],
    enabled: isSupabaseConfigured && !!uid,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<WantedRow | null> => {
      const { data, error } = await supabase.rpc('my_wanted_allowance');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as WantedRow | null;
    },
  });
}

export type MarketQr = { code: string | null; entitled: boolean; slug: string | null; market_name: string | null };
/** Durable Market QR identity (0111). Issued server-side on first entitled access; a downgraded
 *  seller keeps their code with entitled=false so printed signs stay honest. */
export function useMyMarketQr(uid?: string) {
  return useQuery({
    queryKey: ['my-market-qr', uid],
    enabled: isSupabaseConfigured && !!uid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MarketQr | null> => {
      const { data, error } = await supabase.rpc('my_market_qr');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as MarketQr | null;
    },
  });
}

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
        .select(`id, ends_at, listing:listings(${LISTING_FIELDS}, owner:public_profiles(${PUBLIC_PROFILE_FIELDS}), market:markets(name), claims(count))`)
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
      listings = await dropUnavailableBundles(listings);

      if (filters.listingType !== 'all') {
        listings = listings.filter((l) => l.listing_type === filters.listingType);
      }
      if (filters.coords) {
        const max = browseRadiusMiles(filters.radius);
        listings = listings
          .map((l) => ({
            ...l,
            distance_miles:
              l.approx_lat != null && l.approx_lng != null
                ? distanceMiles(filters.coords as Coords, { lat: l.approx_lat, lng: l.approx_lng })
                : null,
          }))
          .filter((l) => max == null || l.distance_miles == null || l.distance_miles <= max);
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

export type PromotionStatus = {
  included_allowance: number;
  included_remaining: number;
  included_used_this_month: number;
  purchased_balance: number;
  resets_on: string;
  price_cents: number;
  duration_days: number;
  active: { id: string; listing_id: string; ends_at: string; source: string }[];
};

// One server call answers the whole Promote screen (allowance follows the
// EFFECTIVE plan — complimentary Pro/Farm get their credits too).
export function useMarketPromotionStatus(marketId?: string) {
  return useQuery({
    queryKey: ['promotionStatus', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<PromotionStatus | null> => {
      const { data, error } = await supabase.rpc('market_promotion_status', { p_market: marketId });
      if (error) throw error;
      return (data as PromotionStatus) ?? null;
    },
  });
}

// Redeem a PURCHASED credit (server-side ledger consumption; definer RPC).
export function usePromotePurchased(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { listingId: string; marketId: string }): Promise<void> => {
      const { error } = await supabase.rpc('promote_listing_purchased', { p_listing: input.listingId });
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      void logEvent('promotion_activated', { userId: uid, listingId: input.listingId, metadata: { source: 'paid' } });
      qc.invalidateQueries({ queryKey: ['featured'] });
      qc.invalidateQueries({ queryKey: ['promotionStatus', input.marketId] });
      qc.invalidateQueries({ queryKey: keys.boostCredits(input.marketId) });
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
        .select(`*, claimer:public_profiles!claims_claimer_id_fkey(${PUBLIC_PROFILE_FIELDS}), listing:listings(${LISTING_FIELDS}, owner:public_profiles(${PUBLIC_PROFILE_FIELDS}))`)
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
          .select('id, status, created_at, listing:listings(title, owner:public_profiles(name))')
          .eq('claimer_id', uid as string)
          .in('status', ACTIVE),
        supabase
          .from('claims')
          .select('id, status, created_at, claimer:public_profiles!claims_claimer_id_fkey(name), listing:listings!inner(title, owner_id)')
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
    // Full Profile on purpose: this is the caller's OWN row, so zip_code and
    // the capability flags are theirs to see. Every OTHER profile in the app
    // comes back as PublicProfile.
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase.rpc('my_profile');
      if (error) throw error;
      const rows = (data ?? []) as Profile[];
      return rows[0] ?? null;
    },
  });
}

// ---------------------------------------------------------------------------
// Compliance: seller credentials + verification badge
// ---------------------------------------------------------------------------

export interface SellerCredential {
  id: string;
  seller_id: string;
  state: string;
  credential_type: string;
  issuing_agency: string | null;
  credential_number: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  document_path: string | null;
  status: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'RENEWAL_REQUIRED' | 'REVOKED';
  submitted_at: string;
  reviewed_at: string | null;
  denial_reason: string | null;
  seller_notes: string | null;
  renewal_of_id: string | null;
  created_at: string;
  scope?: { taxonomy_node_id: string }[];
}

/** My credentials with their category scope. RLS: own rows only. */
export function useMyCredentials(uid?: string) {
  return useQuery({
    queryKey: ['myCredentials', uid],
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<SellerCredential[]> => {
      const { data, error } = await supabase
        .from('seller_credentials')
        .select('*, scope:credential_taxonomy_scope(taxonomy_node_id)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SellerCredential[];
    },
  });
}

export interface NewCredential {
  state: string;
  credentialType: string;
  issuingAgency: string | null;
  credentialNumber: string | null;
  issueDate: string | null;      // YYYY-MM-DD
  expirationDate: string | null; // YYYY-MM-DD
  documentPath: string | null;   // storage path in compliance-docs (already uploaded)
  sellerNotes: string | null;
  scopeNodeIds: string[];        // taxonomy nodes this credential covers
  renewalOfId?: string | null;
}

/**
 * Submit a credential for review. Two writes (row + scope); both verified —
 * a scope insert that fails rolls the credential back so a "successful"
 * submission can never exist unscoped (a scopeless credential unlocks nothing).
 */
export function useSubmitCredential(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewCredential): Promise<SellerCredential> => {
      if (!uid) throw new Error('Sign in to submit verification.');
      if (!input.scopeNodeIds.length) throw new Error('Pick the category this credential covers.');
      const { data, error } = await supabase
        .from('seller_credentials')
        .insert({
          seller_id: uid,
          state: input.state,
          credential_type: input.credentialType,
          issuing_agency: input.issuingAgency,
          credential_number: input.credentialNumber,
          issue_date: input.issueDate,
          expiration_date: input.expirationDate,
          document_path: input.documentPath,
          seller_notes: input.sellerNotes,
          renewal_of_id: input.renewalOfId ?? null,
          status: 'PENDING',
        })
        .select('*')
        .single();
      if (error) throw error;
      const cred = data as SellerCredential;

      const { error: scopeError } = await supabase
        .from('credential_taxonomy_scope')
        .insert(input.scopeNodeIds.map((n) => ({ credential_id: cred.id, taxonomy_node_id: n })));
      if (scopeError) {
        // Roll back the orphan credential; if even that fails, surface the
        // scope error — PENDING-with-no-scope is inert, never privileged.
        await supabase.from('seller_credentials').delete().eq('id', cred.id);
        throw scopeError;
      }
      return cred;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myCredentials'] });
      qc.invalidateQueries({ queryKey: ['eligibility'] });
    },
  });
}

/**
 * Resubmit after a denial / resubmission request / expiry. RLS requires the
 * new row state to be PENDING with review fields cleared — sending them
 * explicitly is what makes the policy's WITH CHECK pass.
 */
export function useResubmitCredential(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      credentialId: string;
      documentPath?: string | null;
      expirationDate?: string | null;
      credentialNumber?: string | null;
      sellerNotes?: string | null;
    }): Promise<void> => {
      if (!uid) throw new Error('Sign in first.');
      const patch: Record<string, unknown> = {
        status: 'PENDING',
        reviewed_by: null,
        reviewed_at: null,
        denial_reason: null,
        submitted_at: new Date().toISOString(),
      };
      if (input.documentPath !== undefined) patch.document_path = input.documentPath;
      if (input.expirationDate !== undefined) patch.expiration_date = input.expirationDate;
      if (input.credentialNumber !== undefined) patch.credential_number = input.credentialNumber;
      if (input.sellerNotes !== undefined) patch.seller_notes = input.sellerNotes;
      const { data, error } = await supabase
        .from('seller_credentials')
        .update(patch)
        .eq('id', input.credentialId)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('This credential can no longer be resubmitted.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myCredentials'] });
      qc.invalidateQueries({ queryKey: ['eligibility'] });
    },
  });
}

/** Short-lived signed URL for the seller's OWN uploaded document. */
export async function getCredentialDocumentUrl(documentPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('compliance-docs')
    .createSignedUrl(documentPath, 300);
  if (error) throw error;
  return data.signedUrl;
}

/** Resume my paused listings that pass the gate again (renewal/resubscribe). */
export function useReactivateListings(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('compliance_reactivate_for_seller');
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
      qc.invalidateQueries({ queryKey: ['listings'] });
    },
  });
}

/** Public "Credential verified by Gnome" badge — a boolean, nothing more. */
export function useListingVerifiedBadge(listingId?: string) {
  return useQuery({
    queryKey: ['listingBadge', listingId],
    enabled: isSupabaseConfigured && !!listingId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc('listing_has_verified_credential', {
        p_listing: listingId,
      });
      if (error) throw error;
      return data === true;
    },
  });
}

// ---------------------------------------------------------------------------
// Sales notebook (mobile parity with web My Market) — existing hardened RPCs
// ---------------------------------------------------------------------------

export interface SellerTxn {
  id: string;
  market_id: string;
  listing_id: string | null;
  claim_id: string | null;
  source: 'manual' | 'request';
  quantity: number | null;
  gross_cents: number;
  discount_cents: number;
  fee_cents: number;
  net_cents: number;
  payment_method: string;
  buyer_label: string | null;
  notes: string | null;
  status: 'completed' | 'void';
  void_reason: string | null;
  sold_at: string;
}

export interface SellerExpense {
  id: string;
  market_id: string;
  category: string;
  amount_cents: number;
  vendor: string | null;
  notes: string | null;
  status: string;
  spent_at: string;
}

export function useSellerTransactions(marketId?: string) {
  return useQuery({
    queryKey: ['sellerTxns', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<SellerTxn[]> => {
      const { data, error } = await supabase
        .from('seller_transactions')
        .select('*')
        .eq('market_id', marketId as string)
        .order('sold_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as SellerTxn[];
    },
  });
}

export function useSellerExpenses(marketId?: string) {
  return useQuery({
    queryKey: ['sellerExpenses', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<SellerExpense[]> => {
      const { data, error } = await supabase
        .from('seller_expenses')
        .select('*')
        .eq('market_id', marketId as string)
        .order('spent_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as SellerExpense[];
    },
  });
}

export interface RecordSaleInput {
  marketId: string;
  listingId?: string | null;
  claimId?: string | null;
  quantity?: number | null;
  grossCents: number;
  paymentMethod: 'cash' | 'venmo' | 'zelle' | 'cashapp' | 'check' | 'external_card' | 'other';
  buyerLabel?: string | null;
  notes?: string | null;
  source?: 'manual' | 'request';
}

/**
 * Record a sale through the atomic server RPC (ownership re-check + guarded
 * inventory decrement + ledger insert). A claim-linked sale is idempotent at
 * the DB level: one completed row per claim, ever — a double-tap comes back
 * as 23505 and is reported as "already recorded", not a second ledger entry.
 */
export function useRecordSale(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordSaleInput): Promise<{ txnId: string | null; duplicate: boolean }> => {
      if (!uid) throw new Error('Sign in first.');
      const { data, error } = await supabase.rpc('record_sale', {
        p_market: input.marketId,
        p_listing: input.listingId ?? null,
        p_claim: input.claimId ?? null,
        p_quantity: input.quantity ?? null,
        p_gross_cents: input.grossCents,
        p_discount_cents: 0,
        p_fee_cents: 0,
        p_payment_method: input.paymentMethod,
        p_buyer_label: input.buyerLabel ?? null,
        p_notes: input.notes ?? null,
        p_source: input.source ?? 'manual',
      });
      if (error) {
        if (error.code === '23505') return { txnId: null, duplicate: true };
        throw error;
      }
      return { txnId: (data as string) ?? null, duplicate: false };
    },
    onSuccess: (_d, input) => {
      void logEvent('sale_recorded_mobile', {
        userId: uid,
        listingId: input.listingId ?? null,
        metadata: { method: input.paymentMethod, source: input.source ?? 'manual' },
      });
      qc.invalidateQueries({ queryKey: ['sellerTxns', input.marketId] });
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
    },
  });
}

export function useVoidSale(uid?: string, marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { txnId: string; reason: string }): Promise<void> => {
      const { error } = await supabase.rpc('void_sale', {
        p_txn: input.txnId,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sellerTxns', marketId] });
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
    },
  });
}

export function useAddExpense(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      marketId: string;
      category: string;
      amountCents: number;
      vendor?: string | null;
      notes?: string | null;
    }): Promise<void> => {
      if (!uid) throw new Error('Sign in first.');
      const { data, error } = await supabase
        .from('seller_expenses')
        .insert({
          market_id: input.marketId,
          category: input.category,
          amount_cents: input.amountCents,
          vendor: input.vendor ?? null,
          notes: input.notes ?? null,
        })
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Expense was not saved.');
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ['sellerExpenses', input.marketId] });
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

// ---------------------------------------------------------------------------
// Market following (0005 market_follows; RLS keeps every row self-scoped).
// The 0119 aggregate my_market_follower_count() is the ONLY seller-facing
// read — a count, never identities.
// ---------------------------------------------------------------------------

/**
 * A signed-out Follow tap remembers WHICH market the buyer wanted; after the
 * sign-in modal dismisses back to the market screen, the button completes the
 * follow — but only after re-resolving the market through canonical
 * visibility (status='active'), never blindly from stale intent.
 */
let pendingFollowMarketId: string | null = null;
export function setPendingFollow(marketId: string): void {
  pendingFollowMarketId = marketId;
}
export function consumePendingFollow(marketId: string): boolean {
  if (pendingFollowMarketId !== marketId) return false;
  pendingFollowMarketId = null;
  return true;
}

export function useIsFollowing(marketId?: string, uid?: string) {
  return useQuery({
    queryKey: keys.isFollowing(marketId, uid),
    enabled: isSupabaseConfigured && !!marketId && !!uid,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('market_follows')
        .select('id')
        .eq('market_id', marketId as string)
        .eq('follower_id', uid as string)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
}

export function useToggleFollow(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ marketId, follow }: { marketId: string; follow: boolean }) => {
      if (!uid) throw new Error('Not signed in.');
      if (follow) {
        // Canonical visibility decides followability at WRITE time — a market
        // that went non-public since the tap is simply not followable.
        const { data: mkt } = await supabase
          .from('markets').select('id').eq('id', marketId).eq('status', 'active').maybeSingle();
        if (!mkt) throw new Error('MARKET_UNAVAILABLE');
        // Idempotent: unique (market_id, follower_id) + ignoreDuplicates means
        // a doubled tap or a race can never create a second relationship.
        const { error } = await supabase
          .from('market_follows')
          .upsert({ market_id: marketId, follower_id: uid },
                  { onConflict: 'market_id,follower_id', ignoreDuplicates: true });
        if (error) throw error;
        void logEvent('market_followed', { userId: uid, metadata: { market: marketId } });
      } else {
        const { error } = await supabase
          .from('market_follows')
          .delete()
          .eq('market_id', marketId)
          .eq('follower_id', uid);
        if (error) throw error;
        void logEvent('market_unfollowed', { userId: uid, metadata: { market: marketId } });
      }
      return follow;
    },
    onSuccess: (_v, { marketId }) => {
      qc.invalidateQueries({ queryKey: keys.isFollowing(marketId, uid) });
      qc.invalidateQueries({ queryKey: ['followedMarkets'] });
      qc.invalidateQueries({ queryKey: ['followedListings'] });
      qc.invalidateQueries({ queryKey: ['followedDrops'] });
    },
  });
}

export type FollowedMarket = PublicMarket & {
  active_count: number;
  drop_alerts_enabled: boolean;
};

export function useFollowedMarkets(uid?: string) {
  return useQuery({
    queryKey: keys.followedMarkets(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<FollowedMarket[]> => {
      const { data: follows, error } = await supabase
        .from('market_follows')
        .select('market_id, drop_alerts_enabled')
        .eq('follower_id', uid as string)
        .limit(50);
      if (error) throw error;
      const ids = (follows ?? []).map((f) => f.market_id as string);
      if (!ids.length) return [];
      const alertsById = new Map(
        (follows ?? []).map((f) => [f.market_id as string, !!f.drop_alerts_enabled]),
      );
      // Canonical visibility: only active markets render — a followed market
      // that got suspended simply disappears from the surface.
      const { data: mkts, error: merr } = await supabase
        .from('markets')
        .select(PUBLIC_MARKET_FIELDS)
        .in('id', ids)
        .eq('status', 'active');
      if (merr) throw merr;
      const rows = (mkts ?? []) as unknown as PublicMarket[];
      const counts = await Promise.all(rows.map(async (m) => {
        const { count } = await supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('market_id', m.id)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString());
        return count ?? 0;
      }));
      return rows.map((m, i) => ({
        ...m,
        active_count: counts[i],
        drop_alerts_enabled: alertsById.get(m.id) ?? false,
      }));
    },
  });
}

/**
 * The Drop-alert toggle (explicit consent, §1/§4): flips ONLY the caller's own
 * follow row. The select-back detects an RLS-rejected update so the UI never
 * shows a preference the server refused.
 */
export function useSetDropAlerts(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ marketId, enabled }: { marketId: string; enabled: boolean }) => {
      if (!uid) throw new Error('Not signed in.');
      const { data, error } = await supabase
        .from('market_follows')
        .update({ drop_alerts_enabled: enabled })
        .eq('market_id', marketId)
        .eq('follower_id', uid)
        .select('market_id');
      if (error) throw error;
      if (!data?.length) throw new Error('NOT_FOLLOWING');
      void logEvent(enabled ? 'drop_alerts_enabled' : 'drop_alerts_disabled', {
        userId: uid, metadata: { market: marketId },
      });
      return enabled;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['followedMarkets'] });
    },
  });
}

export type FollowedDrop = {
  id: string; market_id: string; title: string; description: string | null;
  starts_at: string; ends_at: string; timezone: string; phase: string;
  available_items: number;
};

export function useFollowedDrops(uid?: string, marketIds?: string[]) {
  return useQuery({
    queryKey: [...keys.followedDrops(uid), marketIds] as const,
    enabled: isSupabaseConfigured && !!uid && !!marketIds && marketIds.length > 0,
    queryFn: async (): Promise<FollowedDrop[]> => {
      const { data, error } = await supabase
        .from('public_market_drops')
        .select('id,market_id,title,description,starts_at,ends_at,timezone,phase,available_items')
        .in('market_id', marketIds as string[])
        .order('starts_at', { ascending: true })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as FollowedDrop[];
    },
  });
}

export function useFollowedListings(uid?: string, marketIds?: string[]) {
  return useQuery({
    queryKey: [...keys.followedListings(uid), marketIds] as const,
    enabled: isSupabaseConfigured && !!uid && !!marketIds && marketIds.length > 0,
    queryFn: async (): Promise<Listing[]> => {
      const { data, error } = await supabase
        .from('listings')
        .select(LISTING_SELECT)
        .in('market_id', marketIds as string[])
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return dropUnavailableBundles((data ?? []).map(shapeListing));
    },
  });
}

/** The seller's own follower count — the 0119 aggregate; an integer, nothing else. */
export function useMyFollowerCount(uid?: string) {
  return useQuery({
    queryKey: keys.myFollowerCount(uid),
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('my_market_follower_count');
      if (error) throw error;
      return typeof data === 'number' ? data : 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Gift Baskets / Bundles (0121). Composition is read-only for clients; all
// creation goes through the canonical create_market_bundle RPC.
// ---------------------------------------------------------------------------

export type BundleComponent = {
  id: string; title: string; price_cents: number | null; unit: string | null;
  status: string;
};

/** What's inside a basket, plus whether the basket is currently available. */
export function useBundleComponents(listingId?: string, isBundle?: boolean) {
  return useQuery({
    queryKey: ['bundleComponents', listingId] as const,
    enabled: isSupabaseConfigured && !!listingId && !!isBundle,
    queryFn: async (): Promise<{ components: BundleComponent[]; available: boolean }> => {
      const { data: comps, error } = await supabase
        .from('listing_components')
        .select('component_listing_id, position')
        .eq('listing_id', listingId as string)
        .order('position', { ascending: true });
      if (error) throw error;
      const ids = (comps ?? []).map((c) => c.component_listing_id as string);
      let components: BundleComponent[] = [];
      if (ids.length) {
        const { data: rows } = await supabase
          .from('listings')
          .select('id,title,price_cents,unit,status')
          .in('id', ids);
        const order = new Map(ids.map((id, i) => [id, i]));
        components = ((rows ?? []) as BundleComponent[])
          .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
      }
      const { data: avail } = await supabase
        .rpc('bundle_components_available', { p_listing: listingId as string });
      return { components, available: avail === true };
    },
  });
}

/** The seller's own baskets, with composition titles and live availability. */
export function useMyBundles(marketId?: string) {
  return useQuery({
    queryKey: ['myBundles', marketId] as const,
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async () => {
      const { data: bs, error } = await supabase
        .from('listings')
        .select('id,title,price_cents,status,inventory_count,expires_at')
        .eq('market_id', marketId as string)
        .eq('is_bundle', true)
        .in('status', ['active', 'claimed', 'completed'])
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      const out = [] as {
        id: string; title: string; price_cents: number | null; status: string;
        inventory_count: number | null; expires_at: string;
        components: string[]; available: boolean;
      }[];
      for (const b of bs ?? []) {
        const { data: comps } = await supabase
          .from('listing_components')
          .select('component_listing_id')
          .eq('listing_id', b.id);
        const ids = (comps ?? []).map((c) => c.component_listing_id as string);
        let titles: string[] = [];
        if (ids.length) {
          const { data: cls } = await supabase.from('listings').select('id,title').in('id', ids);
          titles = ((cls ?? []) as { title: string }[]).map((c) => c.title);
        }
        const { data: avail } = await supabase
          .rpc('bundle_components_available', { p_listing: b.id });
        out.push({ ...b, components: titles, available: avail === true && b.status === 'active' });
      }
      return out;
    },
  });
}

/** Create a basket through the canonical RPC. Surfaces server errors verbatim. */
export function useCreateBundle(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string; priceCents: number; componentIds: string[];
      description?: string | null; inventory?: number | null;
    }) => {
      if (!uid) throw new Error('Not signed in.');
      const { data, error } = await supabase.rpc('create_market_bundle', {
        p_title: input.title,
        p_price_cents: input.priceCents,
        p_component_ids: input.componentIds,
        p_description: input.description ?? null,
        p_unit: null,
        p_inventory: input.inventory ?? null,
        p_request: null,
      });
      if (error) throw new Error(String(error.message ?? 'CREATE_FAILED'));
      void logEvent('bundle_created_ui', { userId: uid });
      return data as { ok: boolean; id: string; title: string; items: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myBundles'] });
      qc.invalidateQueries({ queryKey: ['myListings'] });
      qc.invalidateQueries({ queryKey: ['marketListings'] });
    },
  });
}
