// Read-only data access for the public site. Talks to Supabase PostgREST with
// the anon key over plain fetch (no supabase-js -> no realtime/WebSocket in the
// Node server runtime, and Next's fetch cache handles revalidation). RLS already
// limits anon reads to ACTIVE listings + public profiles, so there is no way to
// read anything private from here.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface WebListing {
  id: string;
  kind: 'offer' | 'wanted';
  title: string;
  description: string | null;
  category: string;
  quantity: string | null;
  photos: string[];
  status: string;
  city: string | null;
  state: string | null;
  created_at: string;
  expires_at: string;
  owner?: { name: string | null } | null;
}

const SELECT =
  'id,kind,title,description,category,quantity,photos,status,city,state,created_at,expires_at,owner:profiles(name)';

async function rest<T>(params: Record<string, string>, revalidate = 60): Promise<T[]> {
  if (!SUPABASE_URL || !ANON) return [];
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?${qs}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      next: { revalidate },
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  }
}

export async function getActiveListings(opts: {
  category?: string;
  limit?: number;
} = {}): Promise<WebListing[]> {
  const params: Record<string, string> = {
    select: SELECT,
    status: 'eq.active',
    kind: 'eq.offer', // public discovery shows available produce (offers)
    expires_at: `gt.${new Date().toISOString()}`,
    order: 'created_at.desc',
    limit: String(opts.limit ?? 60),
  };
  if (opts.category) params.category = `eq.${opts.category}`;
  return rest<WebListing>(params);
}

export async function getListingById(id: string): Promise<WebListing | null> {
  const rows = await rest<WebListing>({
    select: SELECT,
    id: `eq.${id}`,
    status: 'eq.active',
    limit: '1',
  });
  return rows[0] ?? null;
}
