// /q/<code> — the durable Market QR destination.
//
// This is the URL printed on farm-stand signs and packaging, so its one job is to keep resolving
// forever: it looks the code up at SCAN TIME and redirects to wherever the market currently
// lives. Renames, plan changes and future /market route changes all happen behind it.
//
// Resolution is public by design (the QR is on a sign), runs with the anon key only, and the RPC
// enforces the same visibility rule as the public market pages — a suspended market resolves to
// nothing here exactly as its page 404s there. The RPC also logs the scan: code, market,
// timestamp, nothing else.
import { createClient } from '@supabase/supabase-js';
import { notFound, redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  // Reject junk before touching the database: codes are exactly 16 hex chars.
  if (!/^[0-9a-fA-F]{16}$/.test(code)) notFound();

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { auth: { persistSession: false } },
  );
  const { data } = await anon.rpc('resolve_market_qr', { p_code: code });
  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.slug) notFound();
  redirect(`/market/${row.slug}`);
}
