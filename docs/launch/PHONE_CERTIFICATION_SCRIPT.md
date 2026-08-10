# Physical iPhone certification script

Reusable thumb-script for certifying a Release build on a real iPhone. The
concrete QA emails/passwords for a given run are handed over in-session, never
committed here. The Mac-side driver (Claude/CI) performs every backend action;
the phone operator performs every step below and reports what they see.

Ground rules
- The app must be the standalone **Release** build (installed via
  `xcodebuild`/`devicectl`, Metro not running). If a red dev banner or
  "Connect Supabase" screen appears, stop — the build is wrong.
- Production ends the run with **0 active Ohio compliance rules** and zero QA
  artifacts; the driver owns setup/teardown.

## 1. Fresh install
- [ ] App icon + name "Gnome" on the home screen.
- [ ] Cold launch: lands signed-out on Browse with real production listings.
- [ ] No developer/placeholder copy anywhere.
- [ ] Settings → Terms of Service / Privacy Policy open the live site.

## 2. Password auth
- [ ] Create account with the run's Seller-A email (+password from the driver).
- [ ] Sign out. Sign in with a WRONG password → clear error, no crash.
- [ ] Sign in with the right password.
- [ ] Force-quit the app → relaunch → still signed in.
- [ ] Lock the phone 30s → unlock → still signed in.

## 3. Notifications
- [ ] On first sign-in, ALLOW notifications when prompted.
- [ ] Driver confirms a real device token registered server-side.

## 4. Location
- [ ] When prompted, first DENY location. Browse still works, no distances, no
      crash, no fake distances.
- [ ] iOS Settings → Gnome → Location → While Using. Reopen: distances appear.
- [ ] Confirm the prompt copy makes sense, and there is no "Always" ask.
- [ ] (Later) revoke location again → app degrades, doesn't crash.

## 5. Taxonomy + search
- [ ] Browse → drill: Vegetables → Tomatoes → Roma; Meat → Beef → Ground Beef;
      Pet → Dog → Treats; Fishing & Bait → Nightcrawlers & Worms.
- [ ] Back/breadcrumb, selected checkmark, Clear filter all behave; sheet
      scrolls natively; chips don't wrap badly.
- [ ] Search "hamburger", "worms", "dog biscuits" — alias matches surface.
- [ ] Keyboard never hides the search field.

## 6. Real listing with a real photo
- [ ] Post → Sale → take/pick a REAL iPhone photo (HEIC) → category
      Vegetables → Tomatoes → Roma → price/unit/quantity/description → publish.
- [ ] Listing appears in Browse and on your Market with the photo rendered.
- [ ] Driver verifies server-side: stored object is JPEG with EXIF/GPS stripped.

## 7. Marketplace loop + push (phone locked!)
- [ ] Tell the driver the listing is live. LOCK the phone.
- [ ] Driver's buyer account sends a request → a push should arrive on the lock
      screen. Report exactly what appeared.
- [ ] Tap the push → app must open the request/claims screen directly.
- [ ] Approve the request. (Driver verifies the buyer-side approval push send.)
- [ ] Driver sends a chat message → message push arrives → tap → chat opens.
- [ ] Reply in chat; driver confirms persistence.

## 8. Complete Exchange → Record Payment
- [ ] My Gnome → the listing → Mark Complete → "Record the payment?" → Record:
      Cash, amount, qty → Save.
- [ ] IMMEDIATELY try to record the same exchange again (reopen sheet, save) →
      must say "Already recorded", never a duplicate ledger row.
- [ ] Profile → Sales notebook: entry exists, month summary + method breakdown
      updated.
- [ ] Quick sale (no listing) → appears. Record expense → appears. Void the
      quick sale with a reason → struck through, totals drop.

## 9. Compliance (driver creates ONE temp QA rule first)
- [ ] Post → pick the QA-regulated category (driver names it) as a FREE seller
      → plan-required card with upgrade CTA; primary button becomes Save draft.
- [ ] Driver flips your market to a paid tier → re-pick category → "verification
      needed" card → Upload credential → photo or PDF of anything → submit →
      status PENDING; publish still blocked; draft allowed.
- [ ] Driver approves as admin → banner/state flips, paused draft goes LIVE.
- [ ] Profile → Seller verification: card shows APPROVED, scope, expiry;
      View document opens YOUR doc (signed URL).
- [ ] Driver revokes → listing pauses with "Why paused?" path; reason visible.
- [ ] Driver deletes the temp rule + credential + files afterward and confirms
      0 active Ohio rules.

## 10. Profile
- [ ] Edit profile: name, avatar (real photo), city, state, ZIP → save →
      force-quit → relaunch → values persist. ZIP labeled private.

## 11. Password reset (real email)
- [ ] Sign out → Forgot password → enter the OWNER's real email (built-in
      mailer only delivers to team members, ~2/hour).
- [ ] Open the email on the phone → tap the link → app opens via deep link →
      "set new password" screen → set one → sign in with it.

## 12. Apple / Google sign-in
- [ ] Sign out → Continue with Apple → Face ID sheet → completes signed in.
      Then: cancel mid-flow (no crash), sign out/in again, cold restart.
- [ ] Continue with Google → browser → account pick → returns to app signed in.
      Same cancel/restart checks.
- [ ] Note whether Apple offered Hide My Email and what the profile shows.

## 13. Network failure
- [ ] Airplane mode ON: Browse (cached/clear error, retry visible), taxonomy
      sheet, send chat (fails clearly, text preserved), profile save, Record
      Sale — nothing may pretend success.
- [ ] Start a photo listing → airplane ON mid-submit → clear failure, form
      intact → airplane OFF → retry → publishes ONCE (driver checks for dupes).
- [ ] Wi-Fi → cellular → Wi-Fi: app recovers without restart.

## 14. VoiceOver + Dynamic Type
- [ ] Settings → Accessibility → VoiceOver ON: swipe through Browse, taxonomy
      picker (selections announced), Post, listing detail, chat, Seller
      verification, notebook. Report anything unlabeled or unreachable.
- [ ] Text Size to largest (+ Larger Accessibility Sizes): check Browse cards,
      taxonomy sheet, Post form, gate cards, notebook for clipped/overlapping
      text or lost buttons.

## 15. Token rebinding (accounts)
- [ ] Sign out of Seller A. Sign UP as the run's Seller-C email.
- [ ] Driver triggers a push meant for Seller A → it must NOT arrive.
- [ ] Driver triggers one for C (if C has activity) → arrives.

## 16. Cold start
- [ ] Force-quit, lock 1 min, unlock, relaunch: session, listings, claim,
      chat history, ledger, credential state all intact. No crash.

## Driver-side obligations (Mac)
- devicectl install/launch proof; Metro killed before cold launch.
- EXIF/GPS scan of every uploaded object.
- Push sends via production `notify` fn + Expo receipt checks.
- Idempotency probes (double record_sale).
- Temp rule + all QA accounts/files torn down; final sweep query proving
  0 rules / 0 credentials / 0 QA docs; real users and listings untouched.
