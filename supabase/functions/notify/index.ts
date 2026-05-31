// Gnome push-notification Edge Function.
//
// Invoked by the app after a claim or an approval. Derives the recipient from
// the claim (owner for a new claim, claimer for an approval), looks up their
// Expo push tokens with the service role, and sends a notification via the
// Expo push API. Tokens are never exposed to clients.
//
// Deploy: `supabase functions deploy notify`
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface NotifyPayload {
  event: 'claim' | 'approved';
  claimId: string;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req: Request) => {
  try {
    const { event, claimId } = (await req.json()) as NotifyPayload;
    if (!event || !claimId) {
      return json({ error: 'event and claimId required' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: claim, error } = await admin
      .from('claims')
      .select('id, claimer_id, listing:listings(title, owner_id)')
      .eq('id', claimId)
      .single();
    if (error || !claim) return json({ error: 'claim not found' }, 404);

    const listing = (claim as any).listing;
    const title = listing?.title ?? 'your listing';

    let recipientId: string;
    let message: { title: string; body: string };
    if (event === 'claim') {
      recipientId = listing.owner_id;
      message = { title: 'New claim 🍅', body: `Someone wants "${title}". Approve or decline in Gnome.` };
    } else {
      recipientId = (claim as any).claimer_id;
      message = { title: 'Claim approved ✅', body: `You're approved for "${title}". Arrange pickup with your neighbor.` };
    }

    const { data: tokens } = await admin
      .from('device_tokens')
      .select('token')
      .eq('user_id', recipientId);

    if (!tokens?.length) return json({ sent: 0 });

    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      sound: 'default',
      title: message.title,
      body: message.body,
      data: { claimId, event },
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    return json({ sent: messages.length, expo: await res.json() });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
