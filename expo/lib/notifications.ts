// Expo push notification registration (P1). Tokens are stored on the user's
// profile-scoped device_tokens table; delivery is handled by the `notify`
// Supabase Edge Function (see supabase/functions/notify). Safe to call on web
// and in Expo Go — it no-ops when push isn't available.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(userId: string): Promise<void> {
  try {
    if (!isSupabaseConfigured || Platform.OS === 'web' || !Device.isDevice) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const token = (
      await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      )
    ).data;

    // onConflict:'token' rebinds this device to whoever is signed in now, so a
    // second account on the same phone takes ownership of the token.
    const { error } = await supabase
      .from('device_tokens')
      .upsert(
        { user_id: userId, token, platform: Platform.OS },
        { onConflict: 'token' },
      );
    if (error) console.warn('[push] could not save device token:', error.message);
  } catch {
    // Push is best-effort; never block the app on it.
  }
}

/**
 * Explicit-consent gate for Drop alerts (§5): request OS permission only when
 * the buyer just asked to enable alerts. 'granted' also (best-effort) registers
 * this device's token; 'denied' means the caller must keep the preference OFF
 * and explain gently — never nag.
 */
export async function ensurePushPermission(userId: string): Promise<'granted' | 'denied'> {
  try {
    if (Platform.OS === 'web') return 'denied';
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return 'denied';
    void registerForPushNotifications(userId);
    return 'granted';
  } catch {
    return 'denied';
  }
}

/**
 * Unbind this device before signing out.
 *
 * Rebinding happens on the next sign-in, but without this the row keeps
 * pointing at the departing user, so pushes meant for them (new request,
 * approval, chat message — including message previews) keep landing on a phone
 * they no longer control. Must run while the session is still valid: the
 * device_tokens delete policy is scoped to auth.uid().
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    if (!isSupabaseConfigured || Platform.OS === 'web' || !Device.isDevice) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (
      await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    ).data;

    await supabase.from('device_tokens').delete().eq('token', token);
  } catch {
    // Never block sign-out on push cleanup.
  }
}

/**
 * Ask the `notify` Edge Function to push to the counterparty. Best-effort: the
 * loop still works (and persists) even if push isn't deployed yet.
 */
export async function notifyCounterparty(
  event: 'claim' | 'approved',
  claimId: string,
): Promise<void> {
  try {
    if (!isSupabaseConfigured) return;
    await supabase.functions.invoke('notify', { body: { event, claimId } });
  } catch {
    // ignore — notifications are not required for the core loop
  }
}

/**
 * A new offer was created. The Edge Function matches it (same category, within
 * radius, last 30 days) against active Wanted posts and pushes to those owners.
 * Best-effort: matching/logging happens server-side with the service role.
 */
export async function notifyOfferCreated(listingId: string): Promise<void> {
  try {
    if (!isSupabaseConfigured) return;
    await supabase.functions.invoke('notify', { body: { event: 'offer_created', listingId } });
  } catch {
    // ignore — matching pushes are not required for the core loop
  }
}

/**
 * A pickup-chat message was sent. The Edge Function pushes the OTHER party
 * (derived from the claim, not the client) with the body preview.
 */
export async function notifyMessage(claimId: string, preview: string): Promise<void> {
  try {
    if (!isSupabaseConfigured) return;
    await supabase.functions.invoke('notify', { body: { event: 'message', claimId, preview } });
  } catch {
    // ignore — chat works without push
  }
}
