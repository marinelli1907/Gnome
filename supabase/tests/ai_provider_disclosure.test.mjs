// AI provider disclosure guard.
//
// The public privacy policy currently says Gnome uses Google's Gemini models.
// OpenAI/Anthropic fallback must therefore require an explicit deployment-level
// disclosure gate, not only the database flag.
//
//   node --test supabase/tests/ai_provider_disclosure.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const providersPath = path.join(here, '../functions/_shared/providers.ts');
const privacyPath = path.join(here, '../../web/app/privacy/page.tsx');

const providers = fs.readFileSync(providersPath, 'utf8');
const privacy = fs.readFileSync(privacyPath, 'utf8');

test('privacy policy still presents Gemini as the active AI provider', () => {
  assert.match(privacy, /Google(?:&rsquo;|'|’)s Gemini models/);
  assert.match(privacy, /Google is the only AI provider Gnome uses/);
});

test('paid fallback providers require an explicit privacy disclosure env gate', () => {
  assert.match(providers, /AI_PAID_FALLBACK_DISCLOSED/);
  assert.match(providers, /paidFallbackDisclosed[\s\S]*OPENAI_API_KEY/);
  assert.match(providers, /paidFallbackDisclosed[\s\S]*ANTHROPIC_API_KEY/);
});

test('source documents the two-key condition for paid fallback', () => {
  assert.match(providers, /ai_settings\.allow_paid_fallback = true/);
  assert.match(providers, /privacy policy discloses paid\s+\/\/ fallback providers/);
});
