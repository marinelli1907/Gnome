'use client';

import AccountReadinessPanel from '../components/AccountReadinessPanel';
import { SignInCard, useSession } from '../components/auth';

export default function AccountReadyClient() {
  const { session, ready } = useSession();

  if (!ready) return <div className="authcard"><p className="sub">Checking your account…</p></div>;
  if (!session) {
    return (
      <SignInCard
        title="One quick account update"
        blurb="Sign in to verify your email and accept the current marketplace rules."
      />
    );
  }
  return <AccountReadinessPanel email={session.user.email ?? ''} />;
}
