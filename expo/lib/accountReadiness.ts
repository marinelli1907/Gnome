import { supabase } from './supabase';

export type AccountReadiness = {
  user_id: string;
  email_verified: boolean;
  phone_verified: boolean;
  age_confirmed: boolean;
  terms_accepted: boolean;
  privacy_accepted: boolean;
  marketplace_rules_accepted: boolean;
  account_ready: boolean;
  missing: string[];
};

export type AccountPolicyVersions = {
  terms_version: string;
  privacy_version: string;
  marketplace_rules_version: string;
  age_policy_version: string;
  marketplace_notice: string;
};

const firstRow = <T>(data: T | T[] | null): T | null =>
  Array.isArray(data) ? data[0] ?? null : data;

export async function loadAccountReadiness(): Promise<AccountReadiness | null> {
  const { data, error } = await supabase.rpc('my_account_readiness');
  if (error) throw error;
  return firstRow<AccountReadiness>(data as AccountReadiness | AccountReadiness[] | null);
}

export async function loadAccountPolicyVersions(): Promise<AccountPolicyVersions | null> {
  const { data, error } = await supabase.rpc('current_account_policy_versions');
  if (error) throw error;
  return firstRow<AccountPolicyVersions>(data as AccountPolicyVersions | AccountPolicyVersions[] | null);
}

export async function resendEmailVerification(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  });
  if (error) throw error;
  const { error: proofError } = await supabase.rpc('record_my_verified_email_otp');
  if (proofError) throw proofError;
}

export async function requestPhoneVerification(phone: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ phone: phone.trim() });
  if (error) throw error;
}

export async function verifyPhoneCode(phone: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    phone: phone.trim(),
    token: token.trim(),
    type: 'phone_change',
  });
  if (error) throw error;
  const { error: syncError } = await supabase.rpc('sync_verified_auth_phone_to_private_contact');
  if (syncError) throw syncError;
}

export type AccountPolicyConsent = {
  age18: boolean;
  terms: boolean;
  privacy: boolean;
  marketplaceRules: boolean;
};

export async function acceptCurrentAccountPolicies(consent: AccountPolicyConsent): Promise<void> {
  const { error } = await supabase.rpc('accept_current_account_policies', {
    p_confirm_18: consent.age18,
    p_accept_terms: consent.terms,
    p_accept_privacy: consent.privacy,
    p_accept_marketplace_rules: consent.marketplaceRules,
  });
  if (error) throw error;
}

export function readinessLabel(key: string): string {
  switch (key) {
    case 'verified_email': return 'Verified email';
    case 'verified_phone': return 'Verified mobile phone';
    case 'age_18': return '18+ confirmation';
    case 'terms': return 'Current Terms';
    case 'privacy': return 'Current Privacy Policy';
    case 'marketplace_rules': return 'Marketplace Rules';
    default: return key.replace(/_/g, ' ');
  }
}
