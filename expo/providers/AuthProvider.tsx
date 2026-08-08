import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// Dismiss the auth browser tab if it's left dangling (web/dev safety).
void WebBrowser.maybeCompleteAuthSession();

interface AuthContextValue {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  configured: boolean;
  /** Resolves with whether email confirmation is still pending (no session yet). */
  signUp: (email: string, password: string, name: string) => Promise<{ needsConfirm: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Email a 6-digit sign-in code (creates the account if new — same as web). */
  requestEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (email: string, code: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) throw error;
    // With email confirmation off, signUp returns a live session — the user is in.
    return { needsConfirm: !data.session };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const requestEmailCode = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true }, // same door as the website
    });
    if (error) throw error;
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    // Native OAuth: ask Supabase for the provider URL (don't let it auto-open a
    // browser), drive the system auth session ourselves, then exchange the
    // returned PKCE `code` for a session. The `on_auth_user_created` DB trigger
    // creates the profile + default market, same as email signup.
    const redirectTo = Linking.createURL('auth-callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data?.url) throw new Error('Could not start Google sign-in.');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      // User dismissed/cancelled — not an error worth surfacing.
      return;
    }
    const code = Linking.parse(result.url).queryParams?.code;
    if (typeof code !== 'string') throw new Error('Google sign-in did not return a code.');
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
  }, []);

  const signInWithApple = useCallback(async () => {
    // Native Sign in with Apple → Supabase via signInWithIdToken. Apple wants a
    // SHA-256 nonce in the request and Supabase verifies against the raw one.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) throw new Error('Apple sign-in did not return a token.');
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;

    // Apple shares the name only on the FIRST authorization; the profile trigger
    // has no metadata to use, so persist it now (best-effort).
    const given = credential.fullName?.givenName;
    if (given && data.user) {
      const full = [given, credential.fullName?.familyName].filter(Boolean).join(' ');
      try {
        await supabase.from('profiles').update({ name: full }).eq('id', data.user.id);
      } catch {
        // non-fatal — user can rename their garden/profile later
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      userId: session?.user?.id ?? null,
      loading,
      configured: isSupabaseConfigured,
      signUp,
      signIn,
      requestEmailCode,
      verifyEmailCode,
      signInWithGoogle,
      signInWithApple,
      signOut,
    }),
    [session, loading, signUp, signIn, requestEmailCode, verifyEmailCode, signInWithGoogle, signInWithApple, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
