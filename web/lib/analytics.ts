// Web analytics stub. Anon event writes are RLS-sensitive, so M8 keeps this a
// no-op (console in dev). Wire to a real sink later without touching call sites.
export function logWeb(event: string, meta?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[web]', event, meta ?? {});
  }
}
