'use client';

import { useCallback } from 'react';
import { logWeb } from '@/lib/analytics';

const IOS = process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/';
const ANDROID = process.env.NEXT_PUBLIC_ANDROID_APP_URL || 'https://play.google.com/store/apps';

// Opens the native app via gnome://<kind>/<id>; falls back to the store if the
// app isn't installed. Web never transacts — it hands off to the app.
export default function AppLink({
  kind,
  id,
  label,
  variant = 'primary',
}: {
  kind: 'listing' | 'market';
  id: string;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const onClick = useCallback(() => {
    logWeb('web_open_app_clicked', { kind, id });
    const deep = `gnome://${kind}/${id}`;
    const store = /android/i.test(navigator.userAgent) ? ANDROID : IOS;
    const fallback = setTimeout(() => {
      window.location.href = store;
    }, 1200);
    const cancel = () => clearTimeout(fallback);
    document.addEventListener('visibilitychange', cancel, { once: true });
    window.addEventListener('pagehide', cancel, { once: true });
    window.location.href = deep;
  }, [kind, id]);

  return (
    <button type="button" onClick={onClick} className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}>
      {label}
    </button>
  );
}
