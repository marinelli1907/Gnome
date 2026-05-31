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

    await supabase
      .from('device_tokens')
      .upsert(
        { user_id: userId, token, platform: Platform.OS },
        { onConflict: 'token' },
      );
  } catch {
    // Push is best-effort; never block the app on it.
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
