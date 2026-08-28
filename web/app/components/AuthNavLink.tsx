'use client';

// Session-aware header link: "Sign in" when logged out, "Account" when in.
import { useSession } from './auth';

export default function AuthNavLink() {
  const { session, ready } = useSession();
  if (!ready) return <a className="nav-account" href="/login">Sign in</a>;
  return <a className="nav-account" href="/login">{session ? 'Account' : 'Sign in'}</a>;
}
