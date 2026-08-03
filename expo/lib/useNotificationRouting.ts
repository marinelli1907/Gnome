// Deep-link notification taps to the right screen.
//
// The `notify` Edge Function attaches a `data` payload to every push:
//   { event: 'claim',    claimId }        -> owner: review the new request
//   { event: 'approved', claimId }        -> claimant: open the pickup chat
//   { event: 'message',  claimId }        -> open the pickup chat
//   { event: 'wanted_matched', offerId }  -> open the matching offer listing
//
// We handle both a cold start (app launched by tapping a notification) and warm
// taps (app already running). Best-effort: routing failures never crash the app.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

type PushData = {
  event?: string;
  claimId?: string;
  offerId?: string;
};

function routeFor(data: PushData): void {
  if (!data) return;
  try {
    switch (data.event) {
      case 'approved':
      case 'message':
        if (data.claimId) router.push(`/chat/${data.claimId}`);
        break;
      case 'claim':
        // A new incoming claim — send the owner to My Gnome (Requests to review).
        router.push('/activity');
        break;
      case 'wanted_matched':
        if (data.offerId) router.push(`/listing/${data.offerId}`);
        break;
      default:
        break;
    }
  } catch {
    // ignore — navigation is best-effort
  }
}

/**
 * @param ready pass false until the root navigator is mounted (e.g. fonts
 * loaded). Cold-start routing must not run before the <Stack> exists, or the
 * initial router.push is dropped and the deep link is lost.
 */
export function useNotificationRouting(ready: boolean): void {
  const handledColdStart = useRef(false);

  useEffect(() => {
    // Remote push doesn't exist on web — the native module isn't linked there
    // and getLastNotificationResponseAsync throws (mirrors lib/notifications.ts).
    if (!ready || Platform.OS === 'web') return;

    // Cold start: launched by tapping a notification. Only once the nav is ready.
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      void Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          const data = response?.notification.request.content.data as PushData | undefined;
          if (data) routeFor(data);
        })
        .catch(() => {});
    }

    // Warm taps while the app is running.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as PushData | undefined;
      if (data) routeFor(data);
    });
    return () => sub.remove();
  }, [ready]);
}
