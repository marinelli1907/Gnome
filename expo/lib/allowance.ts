// Presentation for the seller allowance card — the EXPO TWIN of web/lib/allowance.ts.
//
// Kept as a copy rather than a shared package: web/ and expo/ are separate npm roots with no
// common workspace, and inventing one for ~200 lines of formatting would be a monorepo refactor
// this change has no business making. The price of the copy is drift, so drift is made loud
// instead of possible: expo/lib/allowance.test.mjs transpiles BOTH files and asserts identical
// output for the same server rows across every plan state. Change one file and the parity suite
// fails until the other matches.
//
//
// PURE FORMATTING. Every number here arrives from my_listing_allowance(); nothing in this file
// adds, subtracts or infers one. That is deliberate: "remaining" is a server value, not
// allowed-minus-used computed here, because the server already accounts for paid overage and
// unlimited plans in ways naive arithmetic gets wrong — 20 included, 23 actual would render as
// "-3 remaining" the moment a client tried to derive it.
//
// The only decisions made here are which SENTENCE to show. Comparing two server numbers to pick
// wording is presentation; recomputing them would not be.

/** One row of my_listing_allowance(). NULL means unlimited, never 0 / -1 / 999999. */
export type AllowanceRow = {
  display_name: string;              // "Free" | "Pro" | "Farm" (0126) — never the enum
  period_start: string;
  period_end: string;
  period_source: 'subscription' | 'calendar_month';
  publishes_allowed: number | null;  // null = unlimited
  renewals_allowed: number | null;   // null = unlimited
  publishes_used: number;            // included entitlement consumed
  renewals_used: number;
  publishes_actual: number;          // everything that happened: included + paid + unlimited
  renewals_actual: number;
  paid_publishes_period: number;
  paid_renewals_period: number;
  publishes_remaining: number | null; // null = unlimited
  renewals_remaining: number | null;
  listing_lifetime_days: number;
};

export type MeterLine = { value: string; note?: string };
export type Meter = {
  heading: string;
  lines: MeterLine[];
  /** true when included entitlement is spent — drives the paid/upgrade hint, never a checkout. */
  exhausted: boolean;
  unlimited: boolean;
};
export type PurchaseCopyOptions = { canBuyExtras?: boolean };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const canMentionExtras = (opts?: PurchaseCopyOptions) => opts?.canBuyExtras !== false;

/**
 * Next upgrade in the customer-facing ladder, or null at the top. Keyed on display_name because
 * that is what the server hands us; the internal enum never reaches this layer.
 */
export const NEXT_PLAN: Record<string, { name: string; price: string } | null> = {
  Free: { name: 'Pro', price: '$9.99/month' },
  Pro: { name: 'Farm', price: '$29.99/month' },
  Farm: null,
  // Retired rungs (0126): 'Max' no longer exists as a display name, and Legacy
  // Farm (the old $99 sponsor row) is a comp tier with nothing above it.
  'Legacy Farm': null,
};

/** "Resets Sep 16" — from the server's period_end, never a locally computed billing date. */
export function resetLabel(row: Pick<AllowanceRow, 'period_end'>): string {
  const d = new Date(row.period_end);
  if (Number.isNaN(d.getTime())) return '';
  return `Resets ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function periodLabel(row: Pick<AllowanceRow, 'period_source'>): string {
  return row.period_source === 'calendar_month' ? 'this month' : 'this billing period';
}

export function listingsMeter(row: AllowanceRow): Meter {
  const heading = `Listings ${periodLabel(row)}`;

  // Unlimited: the allowance is not a number, so there is nothing to count against. Actual
  // activity is still shown — "unlimited" describes the entitlement, not a reason to stop measuring.
  if (row.publishes_allowed === null) {
    return {
      heading,
      unlimited: true,
      exhausted: false,
      lines: [
        { value: `${row.publishes_actual} published` },
        { value: 'Unlimited' },
      ],
    };
  }

  const exhausted = row.publishes_remaining === 0;

  // Paid overage means actual has moved past included. Showing "23 of 20 used" would be nonsense,
  // so included and actual are stated as two separate facts.
  if (row.publishes_actual > row.publishes_used) {
    return {
      heading,
      unlimited: false,
      exhausted,
      lines: [
        { value: `${row.publishes_used} of ${row.publishes_allowed} included used` },
        { value: `${row.publishes_actual} published total` },
        { value: `${row.publishes_remaining} included remaining` },
      ],
    };
  }

  return {
    heading,
    unlimited: false,
    exhausted,
    lines: [
      { value: `${row.publishes_used} of ${row.publishes_allowed} used` },
      {
        value: `${row.publishes_remaining} remaining`,
        note: row.publishes_remaining === 1 ? undefined : undefined,
      },
    ],
  };
}

export function renewalsMeter(row: AllowanceRow, opts?: PurchaseCopyOptions): Meter {
  const heading = `Renewals ${periodLabel(row)}`;

  if (row.renewals_allowed === null) {
    return {
      heading,
      unlimited: true,
      exhausted: false,
      lines: [
        { value: `${row.renewals_actual} renewed` },
        { value: 'Unlimited' },
      ],
    };
  }

  // Free includes none. "0 of 0 used" is technically true and tells the seller nothing, so this
  // states the plan fact and, only where platform policy allows, the extra-renewal price.
  if (row.renewals_allowed === 0) {
    return {
      heading: 'Renewals',
      unlimited: false,
      exhausted: true,
      lines: [
        { value: 'No free renewals' },
        ...(row.renewals_actual > 0
          ? [{ value: `${row.renewals_actual} renewed ${periodLabel(row)}` }]
          : []),
        { value: canMentionExtras(opts) ? '$0.99 each' : 'Upgrade for renewals' },
      ],
    };
  }

  const exhausted = row.renewals_remaining === 0;

  if (row.renewals_actual > row.renewals_used) {
    return {
      heading,
      unlimited: false,
      exhausted,
      lines: [
        { value: `${row.renewals_used} of ${row.renewals_allowed} included used` },
        { value: `${row.renewals_actual} renewed total` },
        { value: `${row.renewals_remaining} included remaining` },
      ],
    };
  }

  return {
    heading,
    unlimited: false,
    exhausted,
    lines: [
      { value: `${row.renewals_used} of ${row.renewals_allowed} used` },
      {
        value: `${row.renewals_remaining} free ${plural(row.renewals_remaining ?? 0, 'renewal', 'renewals')} remaining`,
      },
    ],
  };
}

/**
 * The hint under an exhausted meter. Status and a price, never a checkout: the dashboard states
 * what an extra costs, and the real purchase goes through the publish/renew flow where the server
 * decides whether payment is genuinely owed.
 */
export function exhaustedHint(row: AllowanceRow, which: 'listings' | 'renewals', opts?: PurchaseCopyOptions): string | null {
  if (!canMentionExtras(opts)) return null;
  if (which === 'listings') {
    if (row.publishes_allowed === null || row.publishes_remaining !== 0) return null;
    return 'Additional listing: $0.99';
  }
  if (row.renewals_allowed === null) return null;
  if (row.renewals_allowed === 0) return null;   // already stated in the meter itself
  if (row.renewals_remaining !== 0) return null;
  return 'Additional renewal: $0.99';
}

export function upgradeHint(row: AllowanceRow): { name: string; price: string } | null {
  // Only worth surfacing once something is actually exhausted; otherwise it is just an advert.
  const anyExhausted =
    (row.publishes_allowed !== null && row.publishes_remaining === 0) ||
    (row.renewals_allowed !== null && row.renewals_allowed > 0 && row.renewals_remaining === 0);
  if (!anyExhausted) return null;
  return NEXT_PLAN[row.display_name] ?? null;
}

/**
 * Enum → customer-facing name, for the few legacy surfaces that only hold markets.plan and have no
 * allowance row to read display_name from.
 *
 * plan_limits.display_name on the server is the authority; this exists so those surfaces stop
 * printing the raw enum at customers, which they were doing. Note how counter-intuitive the mapping
 * was — pre-0126, 'farm' displayed as "Max" and 'sponsor' as "Farm" — which is exactly
 * why no surface should be interpolating the enum directly. Since 0126 the enum
 * and display finally agree on 'farm'; sponsor is the retired comp rung.
 */
export const PLAN_DISPLAY: Record<string, string> = {
  free: 'Free', grower: 'Pro', farm: 'Farm', sponsor: 'Legacy Farm',
};
export const planDisplay = (plan?: string | null) =>
  (plan && PLAN_DISPLAY[plan]) || 'Free';

/** One row of my_wanted_allowance(). Wanted meters daily, and used IS actual — there is no paid
 *  Wanted overage, so the two never diverge the way listing usage does. */
export type WantedRow = {
  display_name: string;
  allowed: number | null;    // null = unlimited
  used_today: number;
  remaining: number | null;  // null = unlimited, never negative
};

export function wantedMeter(row: WantedRow): Meter {
  const heading = 'Wanted responses today';
  if (row.allowed === null) {
    // Unlimited entitlement, measured activity — same rule as Farm listings.
    return {
      heading,
      unlimited: true,
      exhausted: false,
      lines: [{ value: `${row.used_today} sent` }, { value: 'Unlimited' }],
    };
  }
  return {
    heading,
    unlimited: false,
    exhausted: row.remaining === 0,
    lines: [
      { value: `${row.used_today} of ${row.allowed} used` },
      { value: `${row.remaining} remaining` },
    ],
  };
}
