// Browser-side Supabase client for the interactive parts of the site (sell,
// garden planner). Auth lives in localStorage; RLS is the security boundary —
// this client only ever holds the public anon key plus the signed-in user's JWT.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'anon',
      {
        auth: {
          storageKey: 'gnome-web-auth',
          persistSession: true,
          autoRefreshToken: true,
          // Magic-link landings (?code=… / #access_token=…) sign in automatically.
          detectSessionInUrl: true,
        },
      },
    );
  }
  return client;
}
