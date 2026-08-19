'use client';

import { useCallback } from 'react';
import { logWeb } from '@/lib/analytics';

const IOS = process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/';
// Gnome is not on Google Play yet, so there is deliberately NO Android store
// fallback: an empty value means an Android device that cannot open the deep
// link simply stays on this page. Set NEXT_PUBLIC_ANDROID_APP_URL to the real
// Play listing URL only once the app is actually published there — never to a
// generic store URL, which implies an availability that does not exist.
const ANDROID = process.env.NEXT_PUBLIC_ANDROID_APP_URL || '';

// Opens the native app via gnome://<kind>[/<id>]; falls back to the store if the
// app isn't installed. Web never transacts — it hands off to the app. Some
// destinations are a screen rather than a record (the Credential Center, where
// a seller uploads the permit that clears a held listing), so `id` is optional.
export default function AppLink({
  kind,
  id,
  label,
  variant = 'primary',
  plain = false,
}: {
  kind: 'listing' | 'market' | 'compliance';
  id?: string;
  label: string;
  variant?: 'primary' | 'secondary';
  /** Render as an inline text link instead of a button (for notice copy). */
  plain?: boolean;
}) {
  const onClick = useCallback(() => {
    logWeb('web_open_app_clicked', { kind, id });
    const deep = id ? `gnome://${kind}/${id}` : `gnome://${kind}`;
    const store = /android/i.test(navigator.userAgent) ? ANDROID : IOS;
    // Only arm the store fallback when there is a store to send them to.
    if (store) {
      const fallback = setTimeout(() => {
        window.location.href = store;
      }, 1200);
      const cancel = () => clearTimeout(fallback);
      document.addEventListener('visibilitychange', cancel, { once: true });
      window.addEventListener('pagehide', cancel, { once: true });
    }
    window.location.href = deep;
  }, [kind, id]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={plain ? 'linkbtn' : `btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}
    >
      {label}
    </button>
  );
}
