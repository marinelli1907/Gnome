import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const aiTab = fs.readFileSync(path.join(root, 'app/(tabs)/ai.tsx'), 'utf8');
const rawEdgeFunctionError = ['Edge Function returned', 'a non-2xx status code'].join(' ');

function blockFrom(marker, endMarker) {
  const start = aiTab.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const end = endMarker ? aiTab.indexOf(endMarker, start) : aiTab.length;
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return aiTab.slice(start, end);
}

const askBlock = blockFrom('const ask = useCallback', '// action_id -> settled');
const askAuthGuard = askBlock.indexOf('if (!userId)');
const askInvoke = askBlock.indexOf("supabase.functions.invoke('gnome-assistant'");
const askInputClear = askBlock.indexOf("setInput('')");
const askAttachmentClear = askBlock.indexOf('setAttachment(null)');

assert.ok(askAuthGuard > -1, 'ask requires a signed-in user');
assert.ok(askAuthGuard < askInvoke, 'unsigned chat is gated before gnome-assistant invoke');
assert.ok(askAuthGuard < askInputClear, 'unsigned text is preserved');
assert.ok(askAuthGuard < askAttachmentClear, 'unsigned image attachment is preserved');
assert.match(askBlock, /requireAiSignIn\(\);\s+return;/);
assert.match(askBlock, /isAiAuthFailure\(err\)/);
assert.match(askBlock, /AI_RETRY_MESSAGE/);

const addPhotosBlock = blockFrom('const addPhotos = useCallback', '// Publishes one draft');
const addPhotosAuthGuard = addPhotosBlock.indexOf('if (!userId)');
const pickImagesCall = addPhotosBlock.indexOf('pickImages({ selectionLimit: 10 })');
const draftInvoke = addPhotosBlock.indexOf("supabase.functions.invoke('gnome-assistant'");

assert.ok(addPhotosAuthGuard > -1, 'photo drafts require a signed-in user');
assert.ok(addPhotosAuthGuard < pickImagesCall, 'unsigned bulk library analysis is gated before picking photos');
assert.ok(addPhotosAuthGuard < draftInvoke, 'unsigned bulk photo analysis is gated before gnome-assistant invoke');

const chooseAttachmentBlock = blockFrom('const chooseAttachment = useCallback', 'const showAttachmentMenu');
assert.doesNotMatch(chooseAttachmentBlock, /functions\.invoke/, 'camera/library preview does not call AI directly');

assert.match(aiTab, /Sign in to use Zordy/);
assert.match(aiTab, /Create an account or sign in to ask Zordy questions, analyze photos, and manage your Market\./);
assert.match(aiTab, /router\.push\('\/sign-in'\)/);
assert.match(aiTab, /onPress=\{\(\) => ask\(input, attachment\)\}/);
assert.match(aiTab, /onSubmitEditing=\{\(\) => ask\(input, attachment\)\}/);
assert.match(aiTab, /disabled=\{busy \|\| \(!input\.trim\(\) && !attachment\)\}/);
assert.ok(!aiTab.includes(rawEdgeFunctionError), 'raw Edge Function failure copy is not user-facing app copy');
