# Gnome Founding Member Program

**Status: BUILT, SHIPPED OFF, NOT LAUNCHED.** The database layer is
`supabase/migrations/0091_founding_members.sql`, which is **not applied to
production**. Even once applied, `founding_program_config.program_enabled`
defaults to `false` and no number can be awarded until Daniel turns it on.

**Nobody can qualify in production today**, regardless of the flag. An award
requires a Stripe payment in **live** mode, and as of 2026-08-13 no Gnome
product has a live Stripe price id (`billing_products.stripe_price_id_live` is
NULL for all eleven rows) and `billing_config.payments_live_enabled` is false.
The program becomes reachable only after Daniel configures live Stripe.

---

## 1. The doctrine, in one paragraph

Founding Member is **exclusively for paid Gnome marketplace subscribers**.
Signing up early does not qualify anyone. Being on a waitlist does not qualify
anyone. Expressing interest in Seed Drop — or even paying for Seed Drop — does
not qualify anyone. A complimentary plan grant does not qualify anyone. The
only way in is a real, live-mode, paid marketplace subscription while slots
remain.

## 2. Exact qualification rules

A person becomes a Founding Member when **all** of these are true at the moment
Gnome's Stripe webhook processes their subscription event:

1. The program is enabled.
2. The payment is a **live-mode** Stripe event. Test-mode payments are refused
   outright — they are not recorded and do not consume a number. (`stripe_livemode`
   is also a table CHECK, so a test-mode founder cannot exist even by accident.)
3. The Stripe subscription status is **`active`**. `incomplete`, `past_due`,
   `unpaid`, `paused`, `canceled` and **`trialing`** do not qualify. A trial has
   not paid, and this program is paid-only.
4. **Money was actually captured** — a positive amount on the event. A failed
   first payment therefore never consumes a number.
5. The product is one of the **qualifying marketplace subscriptions**:
   `GNOME_GROWER_MONTHLY` or `GNOME_FARM_MONTHLY`. The list is server-side
   config, changeable only by the owner and audited.
6. If a live Stripe price id is configured for that product, the event carries
   **exactly** that price id.
7. The user exists, has no Founding Member row already, and the subscription has
   not already seated a founder.
8. Fewer than **500** numbers have been allocated.

Anything else is a refusal with a reason code, not an error, and **a refusal
never consumes a number**.

### Capacity: 500, and it does not grow

500 is a schema invariant, not a setting. The config column accepts values from
1 to 500, so the cap can be *tightened* deliberately but cannot be raised —
growing the program past 500 requires a migration, which is a reviewed act.

**Numbers are never recycled automatically.** A founder who lapses, is revoked,
or deletes their account does not return their number to the pool: "remaining
slots" is computed from the highest number ever allocated, not from a headcount
of active founders. Two people who can both truthfully screenshot
"Founding Member #0042" is a worse outcome than a retired number.

## 3. "Continuously active" — the exact definition

A Founding Member is **ACTIVE** when they hold a qualifying marketplace
subscription in Stripe status `active` with **no failed payment older than the
grace period**.

| Event | What happens to the number | What happens to the status |
|---|---|---|
| Payment fails | kept | stays **ACTIVE**; a grace clock starts |
| Grace period expires (**30 days**, config) | kept | **LAPSED** |
| Payment recovers inside grace | kept | stays **ACTIVE**; clock cleared |
| Payment recovers after lapsing | kept — the *same* number | back to **ACTIVE** |
| Member cancels | kept | **LAPSED** when the paid period ends |
| Member resubscribes later | kept — the *same* number | back to **ACTIVE** |
| Upgrade Grower ⇄ Farm | kept | stays **ACTIVE** |
| Moves to a non-qualifying plan (e.g. free, or Seed Drop only) | kept | **LAPSED** |
| Refund or chargeback on the qualifying payment | kept, and **retired** | **REVOKED** |
| Fraud / abuse, owner decision | kept, and **retired** | **REVOKED** |

- **Grace period:** 30 days from the first failed payment, then the member
  lapses. Configurable 1–90 days by the owner, audited.
- **LAPSED** means: the number is still theirs and still reserved, but the badge
  stops displaying and any Founding Market launch boost switches off
  immediately. Resuming a qualifying subscription restores everything.
- **REVOKED** means: the membership is over. The badge never displays again and
  the number is retired rather than reissued. Revocation requires either a
  refund/chargeback signal from Stripe or a written owner decision.
- **Account deletion** removes the membership row. That number is then unassigned
  — it is not reissued automatically, and only the owner can move an existing
  founder into it (see §7).

## 4. Founding **Market** activation

Being a Founding Member does not make a Market a "Founding Market". That is a
separate, later step, and it requires the founder to have actually shown up:

1. an **ACTIVE** Founding Member,
2. who **owns an active Market**,
3. which has **at least one legitimate published listing** — active, not
   expired, in an active Market, and not a seeded demo row. This is the same
   test the public `public_listings` view applies, plus the demo exclusion.

Activation happens **once**. Moving the Founding Market to a different Market is
refused, because otherwise a founder could restart the launch-visibility window
at will. Corrections go through the owner.

### Launch visibility — what it is and what it is not

On activation the Market gets a **bounded launch boost**: a `boost_until`
timestamp, **60 days** by default and constrained to 60–90 days. It expires on
its own.

The boost is an **input to ranking, never a result**. Any surface that uses it
must apply it **after** compliance filtering, **after** geographic relevance,
and **after** quality and plan rules. It may reorder results a buyer was already
entitled to see; it may never surface something those rules excluded, and it may
never appear outside the buyer's own area. There is no permanent ranking column
anywhere in this program — `boost_until` is the only lever, and it runs out.

It also switches off the moment a founder stops being ACTIVE.

> **Not yet wired.** 0091 ships the boost as data plus the
> `founding_market_boost_active(market_id)` predicate. No search or feed query
> reads it yet. Wiring it into ranking is a separate, reviewed change.

## 5. Benefits — the approved list

A Founding Member receives:

- **Permanent numbered Founding Member status** — their number is theirs, and
  it is never reissued to anyone else.
- **A displayed badge** while their membership is active.
- **Early access to new Gnome tools** as they are released.
- **Launch visibility for their Founding Market** — a bounded 60–90 day boost
  from activation, subject to §4.
- **Priority notification when Seed Drop reaches their area** — notification
  ahead of general announcement.
- **A recorded price reference** for their qualifying subscription (see §6).

## 6. Price lock — the concept only

The program **stores the price reference** a founder came in on:
`qualifying_stripe_price_id` and `qualifying_product_key`, both immutable at the
database level. That is what makes a future price-lock policy *possible* and
*provable*.

**It is not, today, a promise.** No dollar amount is published, guaranteed or
implied anywhere in this program, and no price-lock language may appear in any
public surface until approved.

> ### PENDING DANIEL'S APPROVAL — all public price-lock copy
> No price-lock wording ships until Daniel approves the exact terms. When it
> does, it must state: **which** price, for **how long**, under **what
> conditions it ends** (e.g. lapse, cancellation, or a move to a different
> plan), and whether it survives a plan change.
>
> The word **"lifetime" is not to be used** in any Founding Member copy unless
> it is accompanied by those precise terms in the same sentence. "Lifetime"
> without a definition is a promise nobody can keep and nobody can price.

## 7. Renumbering — deliberately awkward

Allocation mistakes have to be fixable, so an owner can move a founder to a
different number. It is made hard on purpose:

- owner only;
- a written reason of at least 20 characters — "fix" is refused;
- the caller must type back the founder's **current** badge string exactly
  (`RENUMBER Founding Member #0042`), so renumbering the wrong person requires
  getting their number right first;
- the target must be an **unassigned** number at or below the high-water mark,
  so a renumber can never invent capacity or desynchronise the counter;
- the vacated number is **retired**, not handed to someone else;
- the change is written to `admin_audit_log` with both the old and the new
  number.

A direct `UPDATE` of `founding_number` outside this path is blocked by a
trigger, as is any edit to the qualification evidence.

## 8. What Founding Member is **NOT** — explicit non-guarantees

These are non-guarantees. They must appear, in substance, in any public
Founding Member terms.

- **No free Seed Drops.** Founding Member status includes no seeds, no boxes,
  no discounts on Seed Drop, and no credit toward it.
- **No guarantee that Seed Drop will be available** in a founder's area, at any
  particular time, or at all. Seed Drop is subject to state-by-state compliance
  and ships nowhere until cleared. The benefit is *notification*, not access.
- **No equity, ownership, shares or membership interest** in Gnome, Boone
  Systems LLC, or any related entity.
- **No revenue sharing, profit sharing, or royalties.**
- **No cash referral payments, commissions, bounties or finder's fees.**
- **No unlimited free services**, no free plan upgrades, and no exemption from
  any plan limit or fee.
- **No regulatory approval, certification, licence or endorsement** of any kind.
  Founding Member status says nothing about food safety, seed law, cottage-food
  rules, or a seller's compliance with them, and it grants no exemption from
  Gnome's compliance rules or from the law.
- **No guaranteed placement, ranking, sales, traffic or income.** The launch
  boost is time-limited, applies after compliance and relevance rules, and
  guarantees no outcome.
- **No guaranteed price**, until and unless §6 is approved with precise terms.
- **No permanent entitlement to the badge.** The *number* is permanent; the
  *display* follows an active paid membership.

## 9. Display format

- Member badge: **`Founding Member #0042`** — always four digits, always with
  the `#`. Built by `founding_number_display()`; never format it anywhere else.
- Market label: **`Founding Market`** — no number, no year, no variants.
- Public counter (optional marketing surface): `founding_program_status()`
  returns `{enabled, capacity, awarded, remaining, accepting}`, and returns
  `{"enabled": false}` and nothing else while the program is off.

Only **ACTIVE** members appear in the public `founding_badges` view. Lapsed
members are hidden until they resume; revoked members never reappear.

## 10. Launch copy (approved wording)

> **Become a Gnome Founding Member** — Join one of Gnome's first 500 paid
> marketplace memberships and earn permanent numbered Founding Member status,
> early access to new tools, launch visibility for your Market and priority
> notification when Seed Drop reaches your area.

Rules for using it:

- Do not add a price, a discount, or any "lifetime" claim to this copy.
- Do not imply Seed Drop availability, timing, or inclusion.
- Any surface showing this copy must link to the non-guarantees in §8.

## 11. What the database actually does

| Object | Purpose |
|---|---|
| `founding_program_config` | singleton: flag, capacity, high-water counter, qualifying products, grace days, boost days |
| `founding_members` | the roster; one row per founder, RLS: self + `subscriptions.view` admins |
| `founding_badges` | the only public projection — enumerated columns, ACTIVE only, empty while the flag is off |
| `founding_award_member(...)` | **service role only.** The only way a number is issued |
| `founding_mark_payment_failed/recovered`, `founding_lapse_member`, `founding_sweep_lapses`, `founding_revoke_for_refund`, `founding_relink_subscription` | service-role lifecycle, all audited |
| `founding_activate_my_market(market_id)` | member self-service; cannot create a membership, only attach a Market |
| `founding_market_boost_active(market_id)` | the boost predicate — an input to ranking, never a bypass |
| `admin_founding_set_program/revoke/renumber` | owner-only, audited |

There is **no client-callable "claim my founding status"** anywhere. The only
entrance is a Stripe event the webhook verified.

Every award, payment failure, recovery, lapse, revocation, relink, market
activation, renumber and program-flag change writes a row to `admin_audit_log`.

### Allocation is atomic

Numbers are allocated by a single-row counter updated with
`UPDATE ... SET last_founding_number = last_founding_number + 1 WHERE
last_founding_number < founding_capacity RETURNING ...`. Concurrent webhook
transactions serialise on that row lock, so two events can never take the same
number and a rollback returns the number rather than burning it. A sequence
would skip numbers on rollback; `select max+1` would lose awards outright — the
test suite demonstrates both failure modes are avoided.

## 12. Before this can launch

1. Apply `0091_founding_members.sql` (declare it in
   `supabase/migrations/UNAPPLIED.txt` until then).
2. Configure live Stripe prices for `GNOME_GROWER_MONTHLY` and
   `GNOME_FARM_MONTHLY`, and enable live payments.
3. Call `founding_award_member` from the Stripe webhook on the paid-subscription
   paths (not yet wired — the RPC exists, nothing calls it).
4. Get §6 price-lock terms and §8 non-guarantees reviewed, then published as
   public terms.
5. Decide how, or whether, `founding_market_boost_active()` feeds ranking.
6. Only then: `admin_founding_set_program('{"program_enabled": true}')`.

### Tests

`supabase/tests/run_founding_member_tests.sh` builds a throwaway local database,
applies 0091, runs a real multi-session concurrency phase and the 92-case suite
in `supabase/tests/founding_member_suite.sql`, proves the migration is
idempotent, and proves the paired rollback refuses to destroy a loaded roster
unless forced.
