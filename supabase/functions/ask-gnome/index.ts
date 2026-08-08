// Gnome — the site-wide gnome assistant ("Ask Gnome").
//
// One assistant, two jobs: gardening/product help AND site support, routed by
// the model from a single system prompt. Page-aware (the client sends the
// current path) and account-aware (server-side, service-role lookups scoped
// STRICTLY to the calling user's own market/plan/listings — never anyone
// else's rows).
//
// Secret:  ANTHROPIC_API_KEY (shared with draft-listing / garden-planner)
// verify_jwt stays ON: signed-in users only — the cost gate. The web client
// shows sign-in inside the chat panel for logged-out visitors.
//
// The assistant is READ-ONLY by design: it must never claim to have changed
// a listing, plan, or account. Action support is a future, separately
// authorized surface.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

function userIdFrom(req: Request): string | null {
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' && payload.sub.length > 10 ? payload.sub : null;
  } catch {
    return null;
  }
}

async function underDailyCap(userId: string, freeCap: number, paidCap: number): Promise<boolean> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: market } = await admin
    .from('markets').select('plan').eq('owner_id', userId).limit(1).maybeSingle();
  const paid = !!market?.plan && market.plan !== 'free';
  const { data, error } = await admin.rpc('ai_usage_increment', {
    p_user: userId, p_feature: 'assistant', p_cap: paid ? paidCap : freeCap,
  });
  if (error) { console.error('ai_usage_increment error:', error); return true; }
  return data !== false;
}

// The user's OWN context only — every query filtered by their user id.
async function userContext(userId: string): Promise<string> {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: market } = await admin
      .from('markets')
      .select('id,name,plan')
      .eq('owner_id', userId).limit(1).maybeSingle();
    const parts: string[] = [];
    if (market) {
      const { count } = await admin
        .from('listings')
        .select('id', { count: 'exact', head: true })
        .eq('market_id', market.id).eq('status', 'active');
      parts.push(`User's own Market: "${market.name}" on the ${market.plan} plan with ${count ?? 0} active listing(s).`);
    } else {
      parts.push('The user has no Market yet.');
    }

    // Latest Seed Drop order — the exact varieties shipped, so seed answers
    // are grounded in what the customer actually received.
    const { data: order } = await admin
      .from('seed_orders')
      .select('id,status,tracking,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    if (order) {
      const { data: items } = await admin
        .from('seed_order_items')
        .select('status,seed_products(crop,variety,days_to_germination,days_to_maturity,planting_depth_inches,spacing_inches,preferred_sun,direct_sow_allowed)')
        .eq('order_id', order.id)
        .neq('status', 'released');
      const seeds = (items ?? [])
        .map((i) => {
          const p = i.seed_products as unknown as {
            crop: string; variety: string; days_to_germination: number | null;
            days_to_maturity: number | null; planting_depth_inches: number | null;
            spacing_inches: number | null; preferred_sun: string;
          } | null;
          if (!p) return null;
          return `${p.crop} '${p.variety}' (germinates ~${p.days_to_germination ?? '?'}d, matures ~${p.days_to_maturity ?? '?'}d, depth ${p.planting_depth_inches ?? '?'}", spacing ${p.spacing_inches ?? '?'}", ${p.preferred_sun} sun)`;
        })
        .filter(Boolean)
        .join('; ');
      parts.push(
        `Latest Seed Drop order: status "${order.status}"${order.tracking ? `, tracking ${order.tracking}` : ''}, placed ${String(order.created_at).slice(0, 10)}.` +
        (seeds ? ` Seeds in this order: ${seeds}.` : ' Selection not generated yet.'),
      );
    }
    return parts.join(' ');
  } catch {
    return '';
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TURNS = 10;
const MAX_TURN_CHARS = 1500;

const SYSTEM = `You are Gnome — the friendly garden-gnome assistant living on gnomefarmersmarket.com, a neighborhood marketplace where people grow, find, share, and sell local food. Warm, practical, concise (2–6 short sentences or a tight list; this is a small chat panel). Plain text only — no markdown, no asterisks, no headers. Sparing, gentle humor; never childish.

WHAT GNOME IS (answer product questions from this, don't invent):
- Browse: find nearby listings — Free / Trade / For Sale / Wanted — with approximate locations and distance. Exact pickup spots are shared only after a seller approves a request. Current listings are labeled "Preview" demos until real neighbors post.
- Sell / My Market: every account gets a Market (their storefront). Post in under a minute; AI can draft the listing from a photo. Requests, approvals, and pickup chat happen in the Gnome app or on the site. Payment is arranged in person, neighbor to neighbor.
- Grow: (1) AI Garden Planner — zone- and date-aware planting advice, free during beta, sign-in required; (2) Seed Drop — a personalized seed box: the customer fills a garden profile (ZIP, zone, space, sun, experience, likes/exclusions) and after purchase Gnome's backend builds the box from REAL in-stock, germination-tested, in-season inventory — Starter Drop is $12 for 6 packets; selections depend on availability and timing; (3) Reserve a Plot — pay to reserve space in a nearby grower's garden, pick the crop, they grow it; growers post growth updates and chat; offering plots requires a Grower or Farm plan.
- Pricing: Neighbor free (10 active listings) · Grower $9.99/mo (100 listings, 1 monthly boost, full AI) · Farm $29.99/mo (500 listings, plots, 5 boosts). Billed via Stripe, cancel anytime. GNOME TAKES 0% OF NEIGHBOR-TO-NEIGHBOR SALES — no transaction fees, ever.
- Privacy: public locations are rounded to about a neighborhood-sized cell; home addresses are never shown. Trust & Safety page covers pickup guidance and food-safety basics (cottage-food laws vary by state; eggs/meat/dairy are regulated — point to the /trust page and their county extension office rather than giving definitive legal rulings).

HARD RULES:
- You are READ-ONLY. You cannot create, edit, pause, or delete listings, change plans, cancel subscriptions, or check orders beyond what USER CONTEXT states. Never claim you did. Instead, tell them exactly where to do it (e.g. "My Market → your listing → Mark sold", "Pricing page → Upgrade", "manage billing through the Stripe link in your receipt email").
- Never reveal or speculate about other users' data, private addresses, or anything not in this prompt or the user-context line.
- Pesticides, food-safety, legal questions: careful language, recommend the label/local authority; no definitive rulings.
- If USER CONTEXT includes a Seed Drop order, ground seed answers in those exact varieties and their numbers (depth, spacing, germination and maturity days). State order status ONLY from the context — never guess or promise shipping dates. Germination is never guaranteed.
- Off-topic requests (not gardening or Gnome): one friendly sentence redirecting to what you can help with.
- If something seems broken or you can't help, suggest the feedback option in the Gnome app or trying again shortly.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(503, { error: 'The gnome is napping — AI isn’t configured yet.' });

  const userId = userIdFrom(req);
  if (!userId) return json(401, { error: 'Sign in to chat with Gnome.' });

  if (!(await underDailyCap(userId, 20, 50))) {
    return json(429, {
      error: 'You’ve used today’s chat allowance — it resets tomorrow. (Paid plans get more.)',
    });
  }

  let body: { messages?: { role: string; content: string }[]; page?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Bad request.' });
  }

  const turns = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content.slice(0, MAX_TURN_CHARS),
    }));
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    return json(400, { error: 'Say something first. 🌱' });
  }

  const page = typeof body.page === 'string' ? body.page.slice(0, 80) : '/';
  const ctx = await userContext(userId);

  try {
    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: `${SYSTEM}\n\nCURRENT PAGE: ${page}\nUSER CONTEXT (their own account only): ${ctx}`,
      messages: turns,
    });
    const reply = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n')
      .trim();
    if (!reply) throw new Error('empty completion');
    return json(200, { reply });
  } catch (e) {
    console.error('ask-gnome error:', e);
    return json(502, {
      error: 'The gnome tripped over a root — try that again in a moment.',
    });
  }
});
