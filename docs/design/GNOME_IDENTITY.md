# Gnome visual identity — the specification

Owner-supplied direction (Daniel, 2026-08-18), transcribed here as the
authoritative source. Where the mockup and a lane proposal disagree, **this
wins**. Where this document adds something the mockup did not specify — mainly
contrast-safe variants — it says so explicitly and gives the arithmetic.

The brief: away from dark-green/cream (too close to a competitor), toward
**white canvas, black type, strong Gnome colors**. Colorful and confident, never
childish. It still has to look like a tool a real farm would run its business on.

---

## 1. Palette

Exact values as specified. The two right-hand columns are measured, not asserted
— WCAG 2.1 contrast against a white background and against black.

| Token | Hex | on white | on black | Use for |
|---|---|---|---|---|
| Gnome Red | `#E53935` | 4.23:1 | 4.97:1 | Sell / Market / core brand |
| Garden Green | `#43B649` | 2.62:1 | 8.03:1 | Garden / growing / Free |
| Trade Blue | `#1E88E5` | 3.68:1 | 5.71:1 | Trade / community / messages |
| AI Purple | `#8E44AD` | 5.87:1 | 3.58:1 | Gnome AI |
| Harvest Yellow | `#FFC107` | 1.63:1 | 12.88:1 | Rewards / discovery / celebration |
| Charcoal | `#222222` | 15.91:1 | — | Primary text |
| Slate | `#6B7280` | 4.83:1 | 4.34:1 | Secondary text |
| Light Gray | `#F1F5F9` | 1.10:1 | 19.17:1 | Surfaces, dividers, chip fills |
| Success | `#22C55E` | 2.28:1 | 9.22:1 | Success states |
| Warning | `#F59E0B` | 2.15:1 | 9.78:1 | Warning states |

### 1a. The three combinations that would ship unreadable

The mockup shows white labels on Red, and on Yellow. Measured, those do not
pass, and this is worth fixing in tokens now rather than in a hundred component
edits later:

| Combination | Measured | Verdict |
|---|---|---|
| White on Gnome Red `#E53935` | **4.23:1** | Fails AA body (needs 4.5:1). Passes only if the label is ≥18.66px bold / ≥24px regular |
| White on Harvest Yellow `#FFC107` | **1.63:1** | Fails badly. Effectively unreadable |
| White on Garden Green `#43B649` | **2.62:1** | Fails |

**Resolution — two tokens per hue, not one.** The brand color stays exactly as
specified for fills, illustration, pins and graphics. A slightly deeper
*interactive* variant carries white text:

| Role | Brand (fills, art, pins) | Interactive (white label on it) |
|---|---|---|
| Red | `#E53935` | **`#E32C27`** — 4.51:1 |
| Blue | `#1E88E5` | **`#1878CD`** — 4.56:1 |
| Green | `#43B649` | **`#328736`** — 4.51:1 |
| Purple | `#8E44AD` | `#8E44AD` — 5.87:1, already passes |

**Yellow never takes a white label.** Harvest Yellow uses **Charcoal `#222222`**
text (9.76:1). Same for Success (6.98:1) and Warning (7.41:1). This is also the
correct call visually — dark type on amber is the farm-stand convention anyway.

### 1b. Color is never the only signal

Required, not advisory. Red/green as the sole carrier of meaning fails for the
~8% of men with red-green color vision deficiency, and Gnome uses exactly that
pairing for Sell vs Free.

- Every listing-type marker pairs its color with a **distinct icon and text
  label** (Sell / Free / Trade / Wanted / Plot).
- Every status chip pairs color with its **word**: Active, Pending, Sold, Expired.
- Map pins must differ in **glyph**, not only in hue.

---

## 2. The five gnomes

One family: same silhouette, same proportions, same line weight, same palette
discipline. Only the hat color and the prop change. They must read as five
members of one household, not five stock illustrations.

| Gnome | Owns | Appears in |
|---|---|---|
| **Red** | Market & Sell — core brand | Logo, onboarding, Sell, listing-live success, brand moments |
| **Green** | Garden & Grow | Garden Planner, Free listings, plant empty states, "listing is live" |
| **Purple** | Gnome AI | Gnome AI tab and card, AI empty/help states |
| **Blue** | Trade & Community | Trade, messages, neighbor/community surfaces |
| **Yellow** | Rewards & Discovery | Milestones, seller achievements, featured, celebration |

**Where they appear** — deliberately, not everywhere: onboarding, empty states,
success states, Gnome AI, seller milestones, occasional feature cards, selected
marketing surfaces.

**Where they must not:** listing rows, seller tools, forms, compliance and
screening warnings, checkout, settings, and anything a seller uses repeatedly to
run their business. A farm-stand operator checking inventory at 6am should not
wade through mascots. Illustration is a welcome, not a wallpaper.

**Originality constraint:** these must not resemble known commercial gnome
characters (notably the Travelocity roaming gnome, or Disney/Sprout garden
gnome characters). Original Gnome branding only.

---

## 3. Navigation — SIX tabs, shorter labels (owner decision D3, 2026-08-19)

The mockup showed five tabs with Profile folded into My Gnome. **D3 overrides
that: Gnome keeps six tabs and fixes the truncation with shorter labels.**

The measurement is why. Dropping Profile buys about one font-scale step — "My
Gnome" ellipsizes at 1.02× with six tabs and 1.26× with five, while Android's
own font settings go to 1.15×, 1.30× and 2.0×. Shortening the label beats it at
any tab count: the bar now reads **Browse · Map · Post · Ask AI · Market ·
Profile**, and "Market" survives to roughly 1.9×. It is also a one-file change
with no routing consequences, where the merge would have moved the
Play-required account-deletion control deeper and invalidated the deletion path
written verbatim into both stores' submission text.

Load-bearing detail: the renamed tab's ROUTE is still `activity`. Only the
`title` changed, so every `router.push('/activity')`, deep link and
notification target still resolves — verified across the app, including
`expo/lib/useNotificationRouting.ts`. Account deletion stays exactly where the
store submissions say it is: Profile → Settings → Delete my account.

---

## 4. Pricing surface

Three tiers, as shown: **Free $0 · Pro $9.99/mo · Farm $29.99/mo**
(annual $99 / $299).

- **Free** — 3 active Sell listings, basic Market, limited AI, basic tools, and
  the **$0.99 extra Sell listing** presented in-card as the bridge to Pro.
- **Pro** — unlimited Sell listings, full Market, QR Market, expanded AI, seller
  tools, basic analytics.
- **Farm** — everything in Pro, plus the strongest tooling that actually ships.

**Owner decisions that qualify this section (2026-08-19):**
- **D1** — Android v1.1 ships with **no in-app digital purchase UI**. The $0.99
  is preserved in product and backend, not deleted and not redirected to
  Stripe; native Play Billing is the v1.2 target. The Free card's "$0.99 extra"
  is therefore true on web and iOS, and on Android reads as an upgrade prompt.
- **D2** — the "3 ACTIVE Sell listings" semantics is the target but does **not**
  ship in v1.1. Current safe enforcement (publishes per month) stays for the RC
  while the active-slot engine is built and adversarially tested separately.
- **D4** — annual pricing is post-launch. Launch pricing is monthly only:
  Free / Pro $9.99 / Farm $29.99.

**Note the semantic change**, because it is the substantive engineering
consequence of this design: the card says "3 **active** sell listings", while
the current system meters `monthly_publish_allowance` — publishes per calendar
month, with a 7-day expiry. Those are different products. Active-slot semantics
is the better model and matches what a seller expects, but it is a real change
to `enforce_publish_allowance` and it interacts with the expiry rules.

**Two claims on the mockup's Farm card were commitments, not features** —
"priority support" (implies a response-time SLA that does not exist; there is
one mailbox) and "advanced analytics" (a tier of analytics that does not ship).

**Resolved by owner decision D5 (2026-08-19): neither may appear.** They never
reached shipping code — the app's Farm card and the web pricing page were both
built from `plan_limits`, so they describe only real capabilities (unlimited
Sell listings and renewals, unlimited Wanted responses, custom Market QR tools,
10 pickup locations, 10 promotions/month, AI Listing Assistant, delivery
scheduling). Any future Farm copy is held to the same rule: if the feature is
not in `plan_limits` or a shipped screen, it does not go on the card.

---

## 5. What this does not change

Layout, information architecture, and every working flow stay as they are. This
is a re-skin plus a pricing simplification, not a redesign. If a color or asset
change risks a working flow, the flow wins — and **nothing here may reopen B1**:
the Map tab renders real tiles and pins, and a mistake there does not degrade the
map, it destroys the React instance and whites out the whole app.
