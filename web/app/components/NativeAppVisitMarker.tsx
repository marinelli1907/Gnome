'use client';

import { useEffect } from 'react';

export const NATIVE_APP_PLATFORM_PARAM = 'app_platform';
export const NATIVE_APP_PLATFORM_SESSION_KEY = 'gnome_native_app_platform';

export default function NativeAppVisitMarker() {
  useEffect(() => {
    const platform = new URLSearchParams(window.location.search)
      .get(NATIVE_APP_PLATFORM_PARAM)?.toLowerCase();
    if (platform === 'android') {
      window.sessionStorage.setItem(NATIVE_APP_PLATFORM_SESSION_KEY, 'android');
    }
  }, []);

  return null;
}
