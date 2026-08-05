// Gnome — AI garden planner ("what should I plant right now, here?").
//
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  (shared with draft-listing)
// verify_jwt stays ON: only signed-in users can call this (also the cost gate).

import Anthropic from 'npm:@anthropic-ai/sdk';

// --- Cost gate: real signed-in users only, capped per day. -----------------
// verify_jwt has already validated the signature; we only read the claims.
// The anon key's JWT has no `sub`, so bare anon-key calls are rejected — every
// model call is attributable to an account and counted against a daily cap.
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

async function underDailyCap(userId: string, feature: string, cap: number): Promise<boolean> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data, error } = await admin.rpc('ai_usage_increment', {
    p_user: userId, p_feature: feature, p_cap: cap,
  });
  if (error) {
    // Fail open: a broken usage table shouldn't take the feature down.
    console.error('ai_usage_increment error:', error);
    return true;
  }
  return data !== false;
}


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TURNS = 12;          // last N chat turns forwarded
const MAX_TURN_CHARS = 2000;   // per-message cap
const MAX_LOCATION_CHARS = 120;

const SYSTEM_BASE = `You are Gnome's garden planner — a warm, practical gardening expert inside Gnome, a hyperlocal farmers-market app where neighbors share, trade, buy, and sell homegrown goods.

Ground every answer in the gardener's location and the current date:
- Infer the USDA hardiness zone and typical first/last frost window from the location; say which zone you assumed in one short parenthetical.
- Recommend only what is actually sensible to start NOW (this week/month) there: direct-sow, transplant, start indoors, or "wait until <month>".
- Be concrete: varieties, spacing, sun needs, days-to-maturity, and one common beginner mistake to avoid.
- Vegetable-garden first, but flowers/herbs/fruit are fair game when asked.

Format: tight markdown. Short intro line, then sections with ### headers and - bullets. No tables. Keep the whole reply under ~350 words unless the user asks for a full-season plan.

Gnome tie-in: when it fits naturally (not every reply), remind them that surplus harvest, extra seedlings, or spare seeds can be listed on Gnome for neighbors — free, trade, or sale.

Never give pesticide-safety, food-safety, or medical advice beyond "follow the label / consult your local extension office".`;

interface Turn { role: 'user' | 'assistant'; content: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return json({ error: 'The garden planner is not configured yet.' }, 503);
    }

    const userId = userIdFrom(req);
    if (!userId) {
      return json({ error: 'Sign in to use the garden planner.' }, 401);
    }
    if (!(await underDailyCap(userId, 'planner', 30))) {
      return json({ error: "You've hit today's planner limit — your garden will still be there tomorrow! 🌱" }, 429);
    }

    const { location, messages } = await req.json();
    if (typeof location !== 'string' || location.trim().length < 2) {
      return json({ error: 'Tell us where your garden is (city + state).' }, 400);
    }
    const loc = location.trim().slice(0, MAX_LOCATION_CHARS);

    const turns: Turn[] = Array.isArray(messages)
      ? messages
          .filter(
            (m: unknown): m is Turn =>
              !!m && typeof m === 'object' &&
              ((m as Turn).role === 'user' || (m as Turn).role === 'assistant') &&
              typeof (m as Turn).content === 'string' && (m as Turn).content.trim().length > 0,
          )
          .slice(-MAX_TURNS)
          .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_TURN_CHARS) }))
      : [];
    if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
      turns.push({ role: 'user', content: 'What should I plant right now? Give me a plan.' });
    }

    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York',
    });

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1200,
      system: `${SYSTEM_BASE}\n\nGardener's location: ${loc}\nToday's date: ${today}`,
      messages: turns,
    });

    if (response.stop_reason === 'refusal') {
      return json({ error: "Couldn't answer that one — try rephrasing your gardening question." }, 422);
    }
    const text = response.content.find((b: { type: string }) => b.type === 'text');
    if (!text || !('text' in text)) {
      return json({ error: 'No plan came back — try again.' }, 502);
    }

    return json({ reply: (text as { text: string }).text });
  } catch (e) {
    console.error('garden-planner error:', e);
    // Surface the upstream cause during beta — same policy as draft-listing.
    return json({ error: 'The planner hit a snag — try again in a moment.', detail: String(e).slice(0, 300) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
