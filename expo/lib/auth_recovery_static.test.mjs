import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const callback = fs.readFileSync(path.join(root, 'app/auth-callback.tsx'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
const provider = fs.readFileSync(path.join(root, 'providers/AuthProvider.tsx'), 'utf8');
const signIn = fs.readFileSync(path.join(root, 'app/sign-in.tsx'), 'utf8');

assert.match(provider, /Linking\.createURL\('auth-callback'\)/);
assert.match(provider, /exchangeCodeForSession\(code\)/);
assert.ok(
  (provider.match(/record_my_verified_email_provider/g) ?? []).length >= 2,
  'Google and Apple sign-in must persist authoritative provider email proof',
);
assert.match(provider, /const authCodeExchanges = new Map<string, Promise<void>>\(\)/);
assert.equal(
  (provider.match(/await exchangeAuthCodeOnce\(code\)/g) ?? []).length,
  2,
  'Linking and Google OAuth share one PKCE code exchange',
);
assert.match(provider, /event === 'PASSWORD_RECOVERY'/);

assert.match(layout, /name="auth-callback"/);
assert.match(callback, /if \(recoveryMode\)/);
assert.match(callback, /router\.replace\('\/sign-in'\)/);
assert.match(callback, /if \(!loading && session\) router\.replace\('\/'\)/);
assert.match(callback, /Request a new password reset link/);

assert.match(signIn, /autoComplete="email"/);
assert.match(signIn, /textContentType="emailAddress"/);
assert.match(signIn, /autoComplete=\{mode === 'up' \? 'new-password' : 'current-password'\}/);
assert.match(signIn, /textContentType=\{mode === 'up' \? 'newPassword' : 'password'\}/);
assert.match(signIn, /autoComplete="one-time-code"/);
assert.match(signIn, /textContentType="oneTimeCode"/);
assert.match(signIn, /styles\.authModeSwitch/);
assert.ok(
  signIn.indexOf('styles.authModeSwitch') < signIn.indexOf("{mode === 'up' && (\n          <Field"),
  'the sign-in/sign-up switch stays above the form fields',
);
assert.doesNotMatch(signIn, /Already have an account\? Sign in/);
assert.match(signIn, /const finishAuthentication = \(\) =>/);
assert.match(signIn, /router\.replace\('\/'\)/);
assert.ok(
  (signIn.match(/finishAuthentication\(\);/g) ?? []).length >= 4,
  'provider, code, and password authentication paths exit the sign-in screen',
);
assert.match(signIn, /onPress: finishAuthentication/);
assert.match(signIn, /if \(needsConfirm\)[\s\S]*setMode\('in'\);[\s\S]*return;/);
