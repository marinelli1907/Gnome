import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const aiTab = fs.readFileSync(path.join(root, 'app/(tabs)/ai.tsx'), 'utf8');
const images = fs.readFileSync(path.join(root, 'lib/images.ts'), 'utf8');
const appJson = fs.readFileSync(path.join(root, 'app.json'), 'utf8');

assert.match(aiTab, /TAKE PHOTO/);
assert.match(aiTab, /CHOOSE FROM LIBRARY/);
assert.match(aiTab, /showAttachmentMenu/);
assert.match(aiTab, /attachmentPreview/);
assert.match(aiTab, /setAttachment\(null\)/);
assert.match(aiTab, /image_base64: image\.base64/);
assert.match(aiTab, /media_type: image\.mediaType/);
assert.match(aiTab, /\.\.\.\(image \? \{/);
assert.match(aiTab, /disabled=\{busy \|\| \(!input\.trim\(\) && !attachment\)\}/);
assert.match(aiTab, /serverMessages\[serverMessages\.length - 1\] = \{ role: 'user', content: clean \}/);

assert.match(images, /requestCameraPermissionsAsync/);
assert.match(images, /launchCameraAsync/);
assert.match(images, /if \(result\.canceled\) return null/);
assert.match(images, /normalizeImageAsset\(asset\)/);
assert.match(images, /exif: false/);

const config = JSON.parse(appJson);
assert.ok(config.expo.android.permissions.includes('android.permission.CAMERA'));
assert.ok(config.expo.android.blockedPermissions.includes('android.permission.READ_EXTERNAL_STORAGE'));
assert.ok(config.expo.android.blockedPermissions.includes('android.permission.WRITE_EXTERNAL_STORAGE'));
