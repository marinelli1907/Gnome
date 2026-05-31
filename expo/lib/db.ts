import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from './supabase';
import { notifyCounterparty } from './notifications';
import { distanceMiles, radiusToMiles, type Coords, type RadiusOption } from './location';
import type { Claim, Listing, Profile, ProfileStats } from '@/types';

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
};

const LISTING_SELECT = '*, owner:profiles(*), claims(count)';

function shapeListing(row: any): Listing {
  const claim_count = Array.isArray(row.claims) ? row.claims[0]?.count ?? 0 : 0;
  const { claims, ...rest } = row;
  return { ...rest, claim_count } as Listing;
}

// ---------------------------------------------------------------------------
// Browse listings (anonymous-friendly)
// ---------------------------------------------------------------------------
export interface BrowseFilters {
  coords: Coords | null;
  radius: RadiusOption;
  category: string | null;
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

      const { data, error } = await q;
      if (error) throw error;

      let listings = (data ?? []).map(shapeListing);

      if (filters.coords) {
        const max = radiusToMiles(filters.radius);
        listings = listings
          .map((l) => ({
            ...l,
            distance_miles:
              l.lat != null && l.lng != null
                ? distanceMiles(filters.coords as Coords, { lat: l.lat, lng: l.lng })
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
        .select('*, claimer:profiles(*), listing:listings!inner(*)')
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
        .select('*, listing:listings(*, owner:profiles(*))')
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
  title: string;
  description: string;
  category: string;
  quantity: string;
  photos: string[];
  coords: Coords | null;
}

export function useCreateListing(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewListing): Promise<Listing> => {
      if (!uid) throw new Error('You must be signed in to post.');
      const { data, error } = await supabase
        .from('listings')
        .insert({
          owner_id: uid,
          title: input.title,
          description: input.description || null,
          category: input.category,
          quantity: input.quantity || null,
          photos: input.photos,
          lat: input.coords?.lat ?? null,
          lng: input.coords?.lng ?? null,
        })
        .select(LISTING_SELECT)
        .single();
      if (error) throw error;
      return shapeListing(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
    },
  });
}

export function useClaimListing(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listingId: string): Promise<Claim> => {
      if (!uid) throw new Error('You must be signed in to claim.');
      const { data, error } = await supabase
        .from('claims')
        .insert({ listing_id: listingId, claimer_id: uid })
        .select('*')
        .single();
      if (error) throw error;
      return data as Claim;
    },
    onSuccess: (claim, listingId) => {
      void notifyCounterparty('claim', claim.id);
      qc.invalidateQueries({ queryKey: keys.listing(listingId) });
      qc.invalidateQueries({ queryKey: keys.myClaims(uid) });
    },
  });
}

export function useUpdateClaim(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      claimId: string;
      status: 'approved' | 'declined' | 'cancelled';
    }): Promise<void> => {
      const { error } = await supabase
        .from('claims')
        .update({ status: input.status })
        .eq('id', input.claimId);
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      if (input.status === 'approved') void notifyCounterparty('approved', input.claimId);
      qc.invalidateQueries({ queryKey: keys.incomingClaims(uid) });
      qc.invalidateQueries({ queryKey: keys.myClaims(uid) });
      qc.invalidateQueries({ queryKey: keys.myListings(uid) });
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
    }): Promise<void> => {
      const { error } = await supabase
        .from('listings')
        .update({ status: input.status })
        .eq('id', input.listingId);
      if (error) throw error;
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
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
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

export function useUpdateProfile(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name?: string; zip_code?: string }): Promise<void> => {
      if (!uid) throw new Error('Not signed in.');
      const { error } = await supabase.from('profiles').update(input).eq('id', uid);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
