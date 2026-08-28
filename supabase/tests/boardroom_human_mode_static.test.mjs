import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const boardroom = readFileSync(
  new URL('../../supabase/functions/boardroom/index.ts', import.meta.url),
  'utf8',
);
const admin = readFileSync(
  new URL('../../admin/App.tsx', import.meta.url),
  'utf8',
);
const providers = readFileSync(
  new URL('../../supabase/functions/_shared/providers.ts', import.meta.url),
  'utf8',
);

for (const heading of [
  "WHAT'S GOING ON",
  'WHY IT MATTERS',
  'WHAT THE TEAM THINKS',
  'MY RECOMMENDATION',
  'WHAT I NEED FROM DANIEL',
]) {
  assert.match(boardroom, new RegExp(heading.replace(/[']/gu, "['’]"), 'u'));
}

assert.match(boardroom, /Human Mode is the default: complex inside, simple outside/u);
assert.match(boardroom, /Never say Gnome is "risk-free"/u);
assert.match(boardroom, /Translate jargon immediately, or put it under TECHNICAL DETAILS/u);
assert.match(boardroom, /INFO = "Just so you know"/u);
assert.match(boardroom, /WATCH = "Keep an eye on this"/u);
assert.match(boardroom, /IMPORTANT = "This needs attention"/u);
assert.match(boardroom, /URGENT = "This should be handled soon"/u);
assert.match(boardroom, /CRITICAL = "Daniel needs to act now"/u);
assert.match(boardroom, /Marty: explain sample size and uncertainty in normal language/u);
assert.match(boardroom, /Gee: explain Gnome revenue separately from seller-recorded sales/u);
assert.match(boardroom, /Senior: explain what is wrong/u);
assert.match(boardroom, /Junior: translate engineering into product impact/u);
assert.match(boardroom, /Debb: explain compliance in seller-friendly business language/u);
assert.match(boardroom, /Never include secrets or unnecessary PII/u);
assert.match(boardroom, /const allowPaid = false/u);
assert.doesNotMatch(boardroom, /allowPaid = true/u);

assert.match(admin, /splitTechnicalDetails/u);
assert.match(admin, /useState<'simple' \| 'technical'>\('simple'\)/u);
assert.match(admin, /SHOW TECHNICAL DETAILS/u);
assert.match(admin, /Simple by default/u);
assert.match(admin, /BoardroomMessageText/u);
assert.match(admin, /scrollToEnd/u);

assert.match(providers, /geminiThinkingConfig/u);
assert.match(providers, /thinkingLevel: 'LOW'/u);
assert.match(providers, /thinkingBudget: 0/u);
assert.match(providers, /gemini-3\.5-flash-lite/u);
assert.match(providers, /finishReason === 'MAX_TOKENS'/u);
assert.match(providers, /maxTokens: Math\.min\(1800, o\.maxTokens \* 3\)/u);
assert.match(providers, /maxOutputTokens: o\.maxTokens/u);

console.log('boardroom human mode static checks: PASS');
