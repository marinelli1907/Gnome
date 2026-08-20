// Seller-facing feedback for the content screening the server runs on every
// listing write (migration 0095). A write has four outcomes and three of them
// used to be swallowed:
//
//   CLEAR        the row is live. Nothing here runs.
//   REVIEW       the row SAVED — and the trigger silently parked it as `paused`.
//                The insert succeeds, so every plain success path tells the
//                seller their listing is public when it is not.
//   BLOCKED      the write THREW (PROHIBITED_ITEM / PROHIBITED_CATEGORY).
//                Nothing was saved and nothing about it is retryable.
//   RATE_LIMITED the write THREW because of pace, not content. It must never be
//                worded as if the listing were the problem.
//
// Every word a seller reads about a verdict comes from the server: the REVIEW
// copy is `screening_reason`, the thrown copy is the text after the prefix.
// This file picks titles, next steps and which alert to raise — it never writes
// a reason, and it never surfaces `screening_term`/`screening_category`, which
// describe how the matcher fired rather than what the seller should do.
import { Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import { parseServerError, type ServerError } from './taxonomy';
import { nativeWebUrl } from './links';
import type { Listing } from '@/types';

/** Marketplace rules — the public policy page a blocked listing points at. */
const RULES_URL = nativeWebUrl('/trust');
const APPEAL_MAILTO = 'mailto:daniel@boonesystems.com?subject=Listing%20review';

/** Wording for the held state, single-sourced so the badge and the copy agree. */
export const UNDER_REVIEW_LABEL = 'Under review';

/** True when the server saved the row but held it back from buyers. */
export function isUnderReview(
  listing: Pick<Listing, 'screening_status'> | null | undefined,
): boolean {
  return listing?.screening_status === 'REVIEW';
}

/**
 * The held-for-review conversation. The server's reason leads (it is the only
 * accurate account of why), then what happens next, then the way to help it
 * along — the Credential Center (`/compliance`, "Seller verification" in the
 * app's own words), because documentation is what usually resolves these.
 */
export function alertUnderReview(
  listing: Pick<Listing, 'screening_reason'>,
  opts?: { onClose?: () => void },
): void {
  const reason =
    listing.screening_reason?.trim() ||
    'This listing needs a quick compliance review in your area. It has been saved but is not public yet.';
  Alert.alert(
    UNDER_REVIEW_LABEL,
    `${reason}\n\nSomeone at Gnome reads it by hand and you’ll be notified either way. Nothing was lost: it sits in Market under “${UNDER_REVIEW_LABEL}” until then.`,
    [
      {
        text: 'Seller verification',
        onPress: () => {
          opts?.onClose?.();
          router.push('/compliance');
        },
      },
      { text: 'OK', style: 'cancel', onPress: opts?.onClose },
    ],
    // Android lets a tap outside dismiss this. The caller's onClose is what
    // navigates on, so it has to run on that path too or the seller is stranded.
    { onDismiss: opts?.onClose },
  );
}

/**
 * Alert for a write the server REFUSED. Returns true when it owned the error so
 * the caller keeps only the codes that need a screen-specific next step (a plan
 * limit offers an upgrade; a compliance gate offers a draft).
 */
export function alertScreeningError(err: ServerError | null): boolean {
  if (!err) return false;
  if (err.code === 'PROHIBITED_ITEM' || err.code === 'PROHIBITED_CATEGORY') {
    // Nothing was saved, so there is no "try again" — only the policy, where to
    // read it in full, and a way to say we got it wrong.
    Alert.alert(err.title, err.message, [
      { text: 'Marketplace rules', onPress: () => void Linking.openURL(RULES_URL) },
      { text: 'Contact us', onPress: () => void Linking.openURL(APPEAL_MAILTO) },
      { text: 'OK', style: 'cancel' },
    ]);
    return true;
  }
  if (err.code === 'RATE_LIMITED') {
    // Pace, not content. The server message already names the wait, so the only
    // job here is to keep it from reading like a rejection of the listing.
    Alert.alert('Too many listings at once', err.message);
    return true;
  }
  return false;
}

/** Parse-and-dispatch shortcut for callers holding a raw error message. */
export function alertListingWriteError(raw: string | null | undefined): boolean {
  return alertScreeningError(parseServerError(raw));
}

/**
 * Last-resort text for an error nobody wrote copy for. Postgres constraint
 * strings, bare enum tokens and errcodes are plumbing — a seller gets the
 * fallback instead.
 */
export function safeErrorText(raw: string | null | undefined, fallback: string): string {
  const msg = (raw ?? '').trim();
  if (!msg) return fallback;
  const internal =
    /violates|constraint|permission denied|duplicate key|null value|relation "|column "|errcode|P0001|42501/i;
  if (internal.test(msg) || /^[A-Z][A-Z0-9_]{2,}$/.test(msg)) return fallback;
  return msg;
}
