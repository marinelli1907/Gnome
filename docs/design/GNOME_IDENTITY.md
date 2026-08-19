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

## 3. Navigation — five tabs

The mockup settles the open question: **Browse · Map · Post · Gnome AI · My
Gnome**. Profile moves inside My Gnome.

Constraints that survive the change and must be verified, not assumed:
- **Account deletion stays reachable and obvious** — it is a Play requirement
  and currently lives under Profile → Settings.
- Every route that currently pushes to a profile path must be redirected;
  notification routing (`expo/lib/useNotificationRouting.ts`) included.
- Verify label fit at larger accessibility text sizes, which is what actually
  broke "My Gnome" at six tabs.

---

## 4. Pricing surface

Three tiers, as shown: **Free $0 · Pro $9.99/mo · Farm $29.99/mo**
(annual $99 / $299).

- **Free** — 3 active Sell listings, basic Market, limited AI, basic tools, and
  the **$0.99 extra Sell listing** presented in-card as the bridge to Pro.
- **Pro** — unlimited Sell listings, full Market, QR Market, expanded AI, seller
  tools, basic analytics.
- **Farm** — everything in Pro, advanced tools, advanced analytics, priority
  support.

**Note the semantic change**, because it is the substantive engineering
consequence of this design: the card says "3 **active** sell listings", while
the current system meters `monthly_publish_allowance` — publishes per calendar
month, with a 7-day expiry. Those are different products. Active-slot semantics
is the better model and matches what a seller expects, but it is a real change
to `enforce_publish_allowance` and it interacts with the expiry rules.

**Two claims on that card are commitments, not features**, and neither exists in
the product today:
- "Priority support" — implies a response-time commitment. There is currently no
  support SLA and one mailbox.
- "Advanced analytics" — verify what analytics actually ships before Farm's card
  promises a tier of it.

---

## 5. What this does not change

Layout, information architecture, and every working flow stay as they are. This
is a re-skin plus a pricing simplification, not a redesign. If a color or asset
change risks a working flow, the flow wins — and **nothing here may reopen B1**:
the Map tab renders real tiles and pins, and a mistake there does not degrade the
map, it destroys the React instance and whites out the whole app.
