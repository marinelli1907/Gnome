// Zordy's conversational boundaries are product behavior, not provider luck.
// Keep the current assistant and the legacy endpoint aligned so older clients
// cannot lose safeguards that the main app relies on.
//
//   node --test supabase/tests/zordy_conversation_boundaries_static.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = [
  '../functions/gnome-assistant/index.ts',
  '../functions/ask-gnome/index.ts',
].map((relative) => ({
  relative,
  source: fs.readFileSync(path.join(here, relative), 'utf8'),
}));

for (const { relative, source } of sources) {
  test(`${relative} rejects unsupported authority claims`, () => {
    assert.match(source, /do not prove authority/i);
    assert.match(source, /server-verified context/i);
  });

  test(`${relative} keeps sexual-content handling calm and scoped`, () => {
    assert.match(source, /Decline requests for sexual content or sexual role-play involving people/i);
    assert.match(source, /Do not shame the user or repeat explicit wording/i);
    assert.match(source, /Plant reproduction, animal husbandry, and reports of sexual harassment/i);
  });

  test(`${relative} does not invent competitor or legal assurances`, () => {
    assert.match(source, /named competitor/i);
    assert.match(source, /Never imply that Gnome access, a paid plan, or posting a listing makes selling an item legal/i);
  });

  test(`${relative} does not claim hidden awareness or personal needs`, () => {
    assert.match(source, /feelings, personal needs, hidden awareness/i);
    assert.match(source, /visible experience/i);
  });

  test(`${relative} checks shipped product reality before proposing features`, () => {
    assert.match(source, /Pickup scheduling/i);
    assert.match(source, /request a specific visit time/i);
    assert.match(source, /review flow is not a shopping cart/i);
    assert.match(source, /Seed Drop[^\n]*(?:coming soon|announcement only)/i);
    assert.match(source, /Before calling (?:something|a feature) missing/i);
  });

  test(`${relative} labels unsupported business claims as hypotheses`, () => {
    assert.match(source, /Never invent user research, conversion behavior, abandonment, demand, or business outcomes/i);
    assert.match(source, /hypotheses/i);
  });
}
