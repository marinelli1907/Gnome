'use client';

import { useCallback } from 'react';

const IOS_URL = process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/';
const ANDROID_URL =
  process.env.NEXT_PUBLIC_ANDROID_APP_URL || 'https://play.google.com/store/apps';

/**
 * Tries to open the native app via the `gnome://` deep link; if nothing handles
 * it (app not installed), falls back to the right app store after a short delay.
 * Read-only web never claims/posts — this just hands off to the app.
 */
export default function OpenInApp({
  listingId,
  label = 'Open in app',
  variant = 'primary',
}: {
  listingId: string;
  label?: string;
  variant?: 'primary' | 'secondary';
}) {
  const onClick = useCallback(() => {
    const deepLink = `gnome://listing/${listingId}`;
    const isAndroid = /android/i.test(navigator.userAgent);
    const store = isAndroid ? ANDROID_URL : IOS_URL;

    const fallback = setTimeout(() => {
      window.location.href = store;
    }, 1200);

    // If the app opens, the page is backgrounded and the timer is cleared.
    const cancel = () => clearTimeout(fallback);
    document.addEventListener('visibilitychange', cancel, { once: true });
    window.addEventListener('pagehide', cancel, { once: true });

    window.location.href = deepLink;
  }, [listingId]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}
    >
      {label}
    </button>
  );
}
