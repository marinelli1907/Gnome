// Web analytics — fire-and-forget writes to the existing `events` table
// (0001 RLS: anonymous inserts allowed with user_id null; users can only read
// their own rows, aggregation is service-role only). No cookies, no third
// parties, no PII: event name + coarse metadata only. Call sites never await.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function logWeb(event: string, meta?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[web]', event, meta ?? {});
  }
  if (!SUPABASE_URL || !ANON) return;
  try {
    void fetch(`${SUPABASE_URL}/rest/v1/events`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ event_type: `web_${event}`, metadata: meta ?? {} }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* analytics must never break the page */ }
}
