// Gnome — AI listing draft ("snap a photo, we write the listing").
//
// The app sends the first listing photo (base64) + the chosen listing type;
// Claude identifies the produce/goods and returns a structured draft: title,
// category, description, and (for sales) a conservative price suggestion.
// The user always reviews and can edit everything — this drafts, never posts.
//
// Deploy:  supabase functions deploy draft-listing
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// verify_jwt stays ON (default): only signed-in users can call this, which is
// also the cost gate — anonymous traffic never reaches the model.

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

// Keep in sync with expo/constants/categories.ts and web/lib/categories.ts.
const CATEGORY_IDS = [
  'vegetables', 'fruit', 'herbs', 'eggs', 'seeds', 'plants',
  'flowers', 'compost', 'honey', 'farm_fresh', 'supplies', 'decor', 'wood', 'meat', 'other',
] as const;

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Short, appealing listing title, max ~50 chars. E.g. "Fresh cherry tomatoes" or "Raw wildflower honey".',
    },
    category: { type: 'string', enum: [...CATEGORY_IDS] },
    description: {
      type: 'string',
      description: 'One or two friendly, neighborly sentences about what is shown. No emoji spam, no marketing hype.',
    },
    suggested_price_cents: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
      description: 'Conservative typical local price in US cents for the natural unit, or null if unsure.',
    },
    suggested_unit: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Natural selling unit like "dozen", "lb", "jar", "bunch", "each" — or null.',
    },
  },
  required: ['title', 'category', 'description', 'suggested_price_cents', 'suggested_unit'],
  additionalProperties: false,
} as const;

const SYSTEM = `You draft marketplace listings for Gnome, a hyperlocal neighbor-to-neighbor app for garden surplus, eggs, honey, flowers, plants, and small farm-stand goods anywhere in the United States.

Voice: a friendly neighbor, not a store. Plain, warm, concrete. Never invent details you can't see (variety names, "organic", weights). Never make food-safety claims.

Pricing: suggest a conservative, typical local price only when the item and unit are obvious (e.g. eggs by the dozen, honey by the jar); otherwise null. Prices are informal neighbor prices, not retail.

If the photo doesn't show something a neighbor would share, trade, or sell (produce, garden goods, eggs, honey, flowers, plants, firewood, carving or lumber wood, farm-raised meat, compost, preserves), still do your best with a generic but honest draft and category "other".`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return json({ error: 'AI drafting is not configured yet.' }, 503);
    }

    const userId = userIdFrom(req);
    if (!userId) {
      return json({ error: 'Sign in to use AI drafting.' }, 401);
    }
    if (!(await underDailyCap(userId, 'draft', 20))) {
      return json({ error: "You've used today's AI drafts — back tomorrow! Meanwhile, the form works great by hand." }, 429);
    }

    const { imageBase64, mediaType, listingType } = await req.json();
    if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      return json({ error: 'imageBase64 required' }, 400);
    }
    if (imageBase64.length > 8_000_000) {
      return json({ error: 'Image too large — pick a smaller photo.' }, 413);
    }
    const media = ALLOWED_MEDIA.includes(mediaType) ? mediaType : 'image/jpeg';
    const type = ['free', 'trade', 'sale', 'wanted'].includes(listingType) ? listingType : 'free';

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      output_config: {
        effort: 'low', // fast draft; the user reviews everything anyway
        format: { type: 'json_schema', schema: DRAFT_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: imageBase64 } },
            {
              type: 'text',
              text: `Draft a "${type}" listing for what this photo shows. Fill every field of the schema.`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return json({ error: "Couldn't analyze this photo. Try another one or fill the form yourself." }, 422);
    }

    const text = response.content.find((b: { type: string }) => b.type === 'text');
    if (!text || !('text' in text)) {
      return json({ error: 'No draft produced — try again.' }, 502);
    }
    const draft = JSON.parse((text as { text: string }).text);

    // Belt-and-suspenders: never return a category the app doesn't know.
    if (!CATEGORY_IDS.includes(draft.category)) draft.category = 'other';

    return json({ draft });
  } catch (e) {
    console.error('draft-listing error:', e);
    // Surface the upstream cause during beta — invaluable for debugging,
    // and nothing here is more sensitive than an HTTP status + message.
    return json({ error: 'Drafting failed — try again in a moment.', detail: String(e).slice(0, 300) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
