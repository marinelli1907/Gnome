'use client';

// The seller-facing half of content screening. A listing write has four
// outcomes and only one of them is "it's live":
//
//   CLEAR        the row saved and stayed active — the ordinary success path.
//   REVIEW       the row SAVED, but the trigger downgraded it to 'paused'. The
//                write reports success, so anything that shows a normal success
//                message here is lying to the seller. <HeldForReview> is that
//                state: the server's own explanation, verbatim, plus what
//                happens next and where documentation helps.
//   BLOCKED      the write threw. Nothing saved. Policy explanation + the rules
//                + a way to reach a person — never the raw error string.
//   RATE_LIMITED the write threw, but nothing is wrong with the listing. It gets
//                its own wording so it never reads like a content problem.
//
// The reason text always comes from the server (it is already customer copy).
// screening_term and screening_category are internal keyword matches and never
// appear on this side of the wall.
import type { ServerError } from '@/lib/gnome';
import { RULES_HREF, SUPPORT_EMAIL, TERMS_PROHIBITED_HREF } from '@/lib/gnome';
import AppLink from './AppLink';

export function HeldForReview({
  reason,
  heading = 'Saved — but under review',
}: {
  reason: string;
  heading?: string;
}) {
  return (
    <div className="notice review">
      <h3>🔎 {heading}</h3>
      {/* The server's explanation, verbatim — it is written for the seller. */}
      <p>{reason}</p>
      <p className="notice-sub">
        A person at Gnome reads it and decides — you’ll be notified either way, and
        there’s no need to post it again. It stays in your Market marked{' '}
        <strong>Under review</strong> until then. If it needs a permit, licence, or
        registration, adding that in the Credential Center is the fastest way through.
      </p>
      <div className="notice-links">
        <AppLink kind="compliance" label="Credential Center →" plain />
        <a href={RULES_HREF}>What Gnome allows</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Ask a question</a>
      </div>
    </div>
  );
}

/** Extra links that make a particular refusal actionable. */
function Links({ code }: { code: ServerError['code'] }) {
  if (code === 'PROHIBITED_ITEM' || code === 'PROHIBITED_CATEGORY') {
    return (
      <div className="notice-links">
        <a href={RULES_HREF}>What Gnome allows</a>
        <a href={TERMS_PROHIBITED_HREF}>Marketplace rules</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Think this is wrong? Contact us</a>
      </div>
    );
  }
  if (code === 'COMPLIANCE_BLOCKED') {
    return (
      <div className="notice-links">
        <AppLink kind="compliance" label="Credential Center →" plain />
        <a href={RULES_HREF}>Categories that need care</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Ask a question</a>
      </div>
    );
  }
  if (code === 'PLAN_LIMIT_REACHED' || code === 'PLOTS_REQUIRE_PLAN') {
    return (
      <div className="notice-links">
        <a href="/pricing">See plans</a>
      </div>
    );
  }
  return null;
}

export function ServerErrorNotice({ error }: { error: ServerError }) {
  const tone =
    error.code === 'RATE_LIMITED' ? 'wait'
      : error.code === 'PLAN_LIMIT_REACHED' || error.code === 'PLOTS_REQUIRE_PLAN' ? 'review'
        : 'stop';
  return (
    <div className={`notice ${tone}`} role="alert">
      <h3>{error.code === 'RATE_LIMITED' ? '⏳ ' : ''}{error.title}</h3>
      {/* Server copy, verbatim and prefix-free. */}
      <p>{error.message}</p>
      {error.code === 'RATE_LIMITED' && (
        <p className="notice-sub">
          This isn’t about what you wrote — your listing is still here, exactly as you
          typed it. Post it again once the wait is up.
        </p>
      )}
      <Links code={error.code} />
    </div>
  );
}
