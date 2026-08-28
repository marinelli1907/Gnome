import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const boardroom = readFileSync(
  new URL('../../supabase/functions/boardroom/index.ts', import.meta.url),
  'utf8',
);

assert.match(boardroom, /const allowPaid = false/u);
assert.match(boardroom, /one independent\s*\n\/\/ round/u);
assert.match(boardroom, /one discussion round/u);
assert.match(boardroom, /no agent-triggered loops/u);
assert.match(boardroom, /function summarizeForDiscussion/u);
assert.match(boardroom, /OTHER EXECUTIVE POSITIONS \(summary\)/u);
assert.match(boardroom, /AGREE, DISAGREE, CHALLENGE ASSUMPTION, REQUEST DATA, IDENTIFY RISK, PROPOSE ACTION/u);
assert.match(boardroom, /DATA UNAVAILABLE \/ INSUFFICIENT EVIDENCE/u);
assert.match(boardroom, /Do not summon agents, broaden permissions, or start another round/u);
assert.match(boardroom, /metadata: \{ phase: 'independent' \}/u);
assert.match(boardroom, /metadata: \{ phase: 'discussion' \}/u);
assert.match(boardroom, /PHASE 2 DISCUSSION AND CHALLENGES/u);
assert.match(boardroom, /maxTokens: 320/u);
assert.match(boardroom, /maxTokens: 650/u);
assert.match(boardroom, /discussed: discussion\.map/u);
assert.doesNotMatch(boardroom, /allowPaid = true/u);

console.log('boardroom discussion static checks: PASS');
