import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { unregisterPushToken } from '@/lib/notifications';

// Dismiss the auth browser tab if it's left dangling (web/dev safety).
void WebBrowser.maybeCompleteAuthSession();

// Android can deliver the same OAuth callback through both Linking and
// openAuthSessionAsync. Share the in-flight exchange so the PKCE verifier is
// consumed exactly once and both callers observe the same result.
const authCodeExchanges = new Map<string, Promise<void>>();

function exchangeAuthCodeOnce(code: string): Promise<void> {
  const existing = authCodeExchanges.get(code);
  if (existing) return existing;

  const exchange = supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
    if (error) throw error;
  });
  authCodeExchanges.set(code, exchange);

  const forget = () => setTimeout(() => authCodeExchanges.delete(code), 60_000);
  void exchange.then(forget, forget);
  return exchange;
}

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
  /** Email a password-reset link that deep-links back into the app. */
  requestPasswordReset: (email: string) => Promise<void>;
  /** Set a new password for the recovery session opened by that link. */
  setNewPassword: (password: string) => Promise<void>;
  /** True once a password-recovery deep link has put us in a recovery session. */
  recoveryMode: boolean;
  clearRecoveryMode: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const clearRecoveryMode = useCallback(() => setRecoveryMode(false), []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => {}) // never strand the app on a loading splash
      .finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      // A reset link deep-links in as a recovery session; the UI must collect a
      // new password rather than dropping the user into the app signed in.
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      // Queries fetched before the session hydrated ran as anon and came back
      // empty (RLS), with nothing to retrigger them — refetch on any auth change.
      if (event === 'SIGNED_OUT') queryClient.clear();
      else void queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  // Native deep-link handler for auth callbacks (gnome://auth-callback?code=…).
  // detectSessionInUrl is off on native, so nothing else consumes these: the
  // password-reset email link (PKCE) lands here on cold and warm starts and is
  // exchanged for a recovery session (which fires PASSWORD_RECOVERY above).
  // The Google flow exchanges its own code first; re-exchanging a used code
  // just errors, which we swallow.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const handleUrl = async (url: string | null) => {
      if (!url || !url.includes('auth-callback')) return;
      const code = Linking.parse(url).queryParams?.code;
      if (typeof code !== 'string' || !code) return;
      try {
        await exchangeAuthCodeOnce(code);
      } catch {
        // Used/expired code — the sign-in screen's normal flows still work.
      }
    };
    void Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => void handleUrl(url));
    return () => sub.remove();
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

  /**
   * Send a reset link. redirectTo deep-links back into the app (gnome://
   * auth-callback), which Supabase turns into a PASSWORD_RECOVERY session.
   * We deliberately do NOT surface whether the address exists — callers show
   * the same "check your email" copy either way, to avoid account enumeration.
   */
  const requestPasswordReset = useCallback(async (email: string) => {
    const redirectTo = Linking.createURL('auth-callback');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }, []);

  const setNewPassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
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
    const { error: proofError } = await supabase.rpc('record_my_verified_email_otp');
    if (proofError) throw proofError;
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
    await exchangeAuthCodeOnce(code);
    const { error: proofError } = await supabase.rpc('record_my_verified_email_provider');
    if (proofError) throw proofError;
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
    const { error: proofError } = await supabase.rpc('record_my_verified_email_provider');
    if (proofError) throw proofError;

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
    // Unbind this device FIRST — the delete policy is scoped to auth.uid(), so
    // it only works while the session is still valid. Otherwise the departing
    // user's pushes (including chat previews) keep arriving on this phone.
    await unregisterPushToken();
    // scope 'local' signs out THIS device only. The default ('global') revokes
    // every refresh token for the account, which would silently sign the user
    // out of their other devices and the website.
    await supabase.auth.signOut({ scope: 'local' });
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
      requestPasswordReset,
      setNewPassword,
      recoveryMode,
      clearRecoveryMode,
      signInWithGoogle,
      signInWithApple,
      signOut,
    }),
    [session, loading, signUp, signIn, requestEmailCode, verifyEmailCode, requestPasswordReset, setNewPassword, recoveryMode, clearRecoveryMode, signInWithGoogle, signInWithApple, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
