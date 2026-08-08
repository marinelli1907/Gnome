'use client';

// Session-aware header link: "Sign in" when logged out, "Account" when in.
import { useSession } from './auth';

export default function AuthNavLink() {
  const { session, ready } = useSession();
  if (!ready) return <a href="/login">Sign in</a>;
  return <a href="/login">{session ? 'Account' : 'Sign in'}</a>;
}
