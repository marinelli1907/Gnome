// Renders the backend's publish verdict for the seller. The client NEVER
// decides eligibility — it renders `publish_eligibility` verbatim and routes
// the seller to the right next step. The BEFORE trigger on listings re-checks
// everything server-side, so this card is honest UX, not enforcement.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import type { Eligibility } from '@/lib/taxonomy';

export default function ComplianceGate({
  eligibility,
  scopeNodeId,
  denialReason,
}: {
  eligibility: Eligibility;
  /** Node to pre-scope a credential upload to. */
  scopeNodeId: string;
  /** Latest admin denial reason for this seller in this scope, if any. */
  denialReason?: string | null;
}) {
  const router = useRouter();
  const [showReqs, setShowReqs] = useState(false);
  const e = eligibility;

  // Nothing to show for ordinary goods.
  if (e.allowed && e.reason !== 'CONDITIONAL') return null;

  // We couldn't tell where the seller is: don't present the fallback verdict
  // as final — ask for their location first (Phase 16: never guess).
  if (!e.allowed && e.jurisdiction_source === 'default') {
    return (
      <View style={[styles.card, styles.cardWarn]}>
        <Text style={styles.title}>Where are you selling from?</Text>
        <Text style={styles.body}>
          Requirements for this category depend on your state. Add your city and
          state to your profile so Gnome can check the right rules.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.primaryBtn}
          onPress={() => router.push('/profile/edit')}
        >
          <Text style={styles.primaryBtnText}>Set my location</Text>
        </Pressable>
      </View>
    );
  }

  const requirements = (
    <View style={styles.reqBox}>
      {e.credential_requirement ? (
        <Text style={styles.reqLine}>Required: {e.credential_requirement}</Text>
      ) : null}
      {e.issuing_agency ? (
        <Text style={styles.reqLine}>Issued by: {e.issuing_agency}</Text>
      ) : null}
      {e.minimum_plan && e.minimum_plan !== 'free' ? (
        <Text style={styles.reqLine}>Requires a paid Gnome seller plan</Text>
      ) : null}
      {e.official_source ? (
        <Text style={styles.reqSource}>Source: {e.official_source}</Text>
      ) : null}
      <Text style={styles.reqDisclaimer}>
        Gnome is not a government licensing agency and this is not legal advice.
        Verify current requirements with the issuing agency.
      </Text>
    </View>
  );

  const viewReqsBtn = (
    <Pressable
      accessibilityRole="button"
      style={styles.linkBtn}
      onPress={() => setShowReqs((v) => !v)}
    >
      <Text style={styles.linkBtnText}>{showReqs ? 'Hide requirements' : 'View requirements'}</Text>
    </Pressable>
  );

  const uploadBtn = (label: string) => (
    <Pressable
      accessibilityRole="button"
      style={styles.primaryBtn}
      onPress={() => router.push(`/compliance/upload?scope=${scopeNodeId}`)}
    >
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );

  switch (e.reason) {
    case 'CONDITIONAL':
      return (
        <View style={[styles.card, styles.cardInfo]}>
          <Text style={styles.title}>A quick note for this category</Text>
          <Text style={styles.body}>
            {e.message ?? 'This category has labeling or point-of-sale requirements.'}
          </Text>
        </View>
      );

    case 'PLAN_REQUIRED':
      return (
        <View style={[styles.card, styles.cardWarn]}>
          <Text style={styles.title}>Paid seller plan required</Text>
          <Text style={styles.body}>
            A paid Gnome seller plan is required to sell regulated products.
            You’ll also need any verification required for this category —
            paying Gnome does not itself make a product legal to sell.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.primaryBtn}
            onPress={() => router.push('/upgrade')}
          >
            <Text style={styles.primaryBtnText}>Upgrade to sell this category</Text>
          </Pressable>
          {viewReqsBtn}
          {showReqs && requirements}
          <Text style={styles.draftHint}>You can save this listing as a draft below.</Text>
        </View>
      );

    case 'CREDENTIAL_REQUIRED':
      return (
        <View style={[styles.card, styles.cardWarn]}>
          <Text style={styles.title}>Seller verification needed</Text>
          <Text style={styles.body}>
            This product requires additional seller verification in your location.
          </Text>
          {uploadBtn('Upload credential')}
          {viewReqsBtn}
          {showReqs && requirements}
          <Text style={styles.draftHint}>You can save this listing as a draft below.</Text>
        </View>
      );

    case 'CREDENTIAL_PENDING':
      return (
        <View style={[styles.card, styles.cardInfo]}>
          <Text style={styles.title}>Verification pending</Text>
          <Text style={styles.body}>
            Gnome is reviewing your documentation for this category. Publishing
            is blocked until it’s approved — you can save a draft, and it can
            publish automatically once approved.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.linkBtn}
            onPress={() => router.push('/compliance')}
          >
            <Text style={styles.linkBtnText}>Check status</Text>
          </Pressable>
        </View>
      );

    case 'CREDENTIAL_DENIED':
      return (
        <View style={[styles.card, styles.cardBlock]}>
          <Text style={styles.title}>Verification not approved</Text>
          {denialReason ? (
            <Text style={styles.body}>Reason from review: “{denialReason}”</Text>
          ) : (
            <Text style={styles.body}>
              Your documentation for this category was not approved.
            </Text>
          )}
          {uploadBtn('Resubmit documentation')}
          {viewReqsBtn}
          {showReqs && requirements}
        </View>
      );

    case 'CREDENTIAL_EXPIRED':
      return (
        <View style={[styles.card, styles.cardWarn]}>
          <Text style={styles.title}>Credential expired</Text>
          <Text style={styles.body}>
            Your credential for this category has expired. Renew it and your
            paused listings can resume without a new review of old sales.
          </Text>
          {uploadBtn('Renew credential')}
          <Text style={styles.draftHint}>You can save this listing as a draft below.</Text>
        </View>
      );

    case 'REVIEW_REQUIRED':
      return (
        <View style={[styles.card, styles.cardInfo]}>
          <Text style={styles.title}>Temporarily unavailable</Text>
          <Text style={styles.body}>
            This category is not currently available for publishing while Gnome
            reviews applicable requirements. Your draft will be here when it opens.
          </Text>
        </View>
      );

    case 'PROHIBITED':
      return (
        <View style={[styles.card, styles.cardBlock]}>
          <Text style={styles.title}>Not allowed on Gnome</Text>
          <Text style={styles.body}>
            {e.message || 'This product is not allowed on Gnome.'}
          </Text>
        </View>
      );

    default:
      if (!e.allowed) {
        return (
          <View style={[styles.card, styles.cardWarn]}>
            <Text style={styles.title}>Can’t publish yet</Text>
            <Text style={styles.body}>{e.message ?? 'This listing can’t be published right now.'}</Text>
          </View>
        );
      }
      return null;
  }
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  cardInfo: { backgroundColor: Colors.primary + '0D', borderColor: Colors.primary + '40' },
  cardWarn: { backgroundColor: '#B4530911', borderColor: '#B4530955' },
  cardBlock: { backgroundColor: Colors.accent + '11', borderColor: Colors.accent + '55' },
  title: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  body: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 19 },
  primaryBtn: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 2,
  },
  primaryBtnText: { color: Colors.textInverse, fontFamily: fonts.bold, fontSize: 14 },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  linkBtnText: { color: Colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  reqBox: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  reqLine: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.text },
  reqSource: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary },
  reqDisclaimer: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 4, lineHeight: 16 },
  draftHint: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textTertiary },
});
