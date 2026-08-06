// Gnome — Stripe webhook: turns Payment-Link checkouts into plan upgrades and
// paid listing boosts. Gnome never touches card data; Stripe hosts checkout.
//
// Flow (M10-lite):
//   /pricing links out to Stripe Payment Links with ?client_reference_id=
//     <market_id>            → subscription checkout upgrades markets.plan
//     boost_<listing_id>     → one-off payment creates a 7-day promotion
//   Cancellations downgrade the market back to 'free'.
//
// Secrets (supabase secrets set ...):
//   STRIPE_SECRET_KEY      sk_live_... (reads line items / subscriptions)
//   STRIPE_WEBHOOK_SECRET  whsec_...   (from the webhook endpoint in Stripe)
//   STRIPE_PRICE_GROWER    price_...   (Grower monthly price id)
//   STRIPE_PRICE_FARM      price_...   (Farm monthly price id)
//   STRIPE_PRICE_BOOST     price_...   (one-off 7-day boost price id, optional)
//
// Deploy with verify_jwt OFF — Stripe authenticates via the signature header.
// Webhook endpoint URL: https://<ref>.supabase.co/functions/v1/stripe-webhook
// Events to send: checkout.session.completed, customer.subscription.updated,
//                 customer.subscription.deleted

import Stripe from 'npm:stripe';
import { createClient } from 'npm:@supabase/supabase-js@2';

const BOOST_DAYS = 7;

Deno.serve(async (req: Request) => {
  // Accept the dashboard-entered casing variants too (secrets can't be renamed).
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? Deno.env.get('Stripe_Secret_Key');
  const webhookSecret =
    Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? Deno.env.get('Stripe_Webhook_Secret');
  if (!secretKey || !webhookSecret) {
    return new Response('Stripe not configured', { status: 503 });
  }

  const stripe = new Stripe(secretKey);
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (e) {
    console.error('signature verification failed:', e);
    return new Response('Bad signature', { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const planForPrice = (priceId: string | null | undefined): 'grower' | 'farm' | null => {
    if (!priceId) return null;
    if (priceId === Deno.env.get('STRIPE_PRICE_GROWER')) return 'grower';
    if (priceId === Deno.env.get('STRIPE_PRICE_FARM')) return 'farm';
    return null;
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const ref = session.client_reference_id ?? '';

        if (session.mode === 'payment' && ref.startsWith('boost_')) {
          // One-off paid boost → 7-day promotion (source 'manual': the M7
          // trigger reserves 'paid' for a future in-app flow; service-role
          // 'manual' inserts are the sanctioned admin path).
          const listingId = ref.slice('boost_'.length);
          const { data: listing } = await admin
            .from('listings')
            .select('id,market_id')
            .eq('id', listingId)
            .maybeSingle();
          if (!listing?.market_id) break;
          await admin.from('listing_promotions').insert({
            listing_id: listing.id,
            market_id: listing.market_id,
            source: 'manual',
            status: 'active',
            starts_at: new Date().toISOString(),
            ends_at: new Date(Date.now() + BOOST_DAYS * 864e5).toISOString(),
            price_cents: session.amount_total ?? null,
            currency: (session.currency ?? 'usd').toUpperCase(),
          });
          console.log(`boost activated for listing ${listingId}`);
          break;
        }

        if (session.mode === 'subscription' && ref) {
          const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
          const plan = planForPrice(items.data[0]?.price?.id);
          if (!plan) { console.error('unknown price on session', session.id); break; }
          await admin.from('markets').update({ plan }).eq('id', ref);
          await admin.from('market_subscriptions').insert({
            market_id: ref,
            plan,
            provider: 'stripe',
            customer_id: String(session.customer ?? ''),
            subscription_id: String(session.subscription ?? ''),
            status: 'active',
          });
          console.log(`market ${ref} upgraded to ${plan}`);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const active = sub.status === 'active' || sub.status === 'trialing';
        const { data: row } = await admin
          .from('market_subscriptions')
          .select('market_id,plan')
          .eq('subscription_id', sub.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!row) break;
        await admin
          .from('market_subscriptions')
          .update({
            status: sub.status,
            current_period_start: new Date(sub.items.data[0]?.current_period_start * 1000).toISOString(),
            current_period_end: new Date(sub.items.data[0]?.current_period_end * 1000).toISOString(),
          })
          .eq('subscription_id', sub.id);
        await admin
          .from('markets')
          .update({ plan: active ? row.plan : 'free' })
          .eq('id', row.market_id);
        console.log(`market ${row.market_id} → ${active ? row.plan : 'free'} (${sub.status})`);
        break;
      }

      default:
        break; // acknowledge everything else
    }
  } catch (e) {
    console.error('webhook handling error:', e);
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
