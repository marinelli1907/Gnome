import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assistant = fs.readFileSync(path.join(root, 'functions/gnome-assistant/index.ts'), 'utf8');
const providers = fs.readFileSync(path.join(root, 'functions/_shared/providers.ts'), 'utf8');

assert.match(assistant, /const chatImage = body\.image/);
assert.match(assistant, /MAX_CHAT_IMAGE_B64/);
assert.match(assistant, /ALLOWED_CHAT_IMAGE_MEDIA/);
assert.match(assistant, /const chain = chainFor\(hasChatImage\)/);
assert.match(assistant, /\{ imageB64, mediaType: imageMedia \}/);
assert.match(assistant, /SKIP_ACTION_LAYER_FOR_IMAGE/);
assert.match(assistant, /images: hasChatImage \? 1 : 0/);

assert.match(providers, /inline_data/);
assert.match(providers, /mime_type: p\.mediaType \|\| 'image\/jpeg'/);
assert.match(providers, /data: p\.imageB64/);

const suspiciousLogs = assistant
  .split('\n')
  .filter((line) => /console\.(log|error|warn)/.test(line) && /(imageB64|image_base64|base64|Authorization|GEMINI_API_KEY)/.test(line));
assert.deepEqual(suspiciousLogs, []);
