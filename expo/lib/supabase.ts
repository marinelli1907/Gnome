import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * True when the app has real Supabase credentials wired up. We never crash the
 * bundle when they are missing — instead the UI shows a clear "connect
 * Supabase" state so the build still launches for review.
 */
export const isSupabaseConfigured =
  supabaseUrl.startsWith('http') && supabaseAnonKey.length > 20;

export const supabase = createClient(
  // Fall back to harmless placeholders so createClient never throws at import
  // time; all calls are guarded by isSupabaseConfigured.
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'public-anon-placeholder',
  {
    auth: {
      // AsyncStorage isn't available during SSR/web prerender.
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // PKCE so the native OAuth redirect returns a `?code=` we exchange for a
      // session (see AuthProvider.signInWithGoogle).
      flowType: 'pkce',
    },
  },
);
