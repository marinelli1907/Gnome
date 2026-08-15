// Seller Verification center: every credential the seller has submitted, its
// review status, what categories it unlocks, expiry warnings, and the actions
// the current state allows. Sellers see only their own rows (RLS) and can
// never touch the review state — resubmission goes back to PENDING for review.
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { Button, EmptyState, ErrorState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import {
  getCredentialDocumentUrl,
  useMyCredentials,
  useMyListings,
  useReactivateListings,
  type SellerCredential,
} from '@/lib/db';
import { useTaxonomy } from '@/lib/taxonomy';
import { isUnderReview } from '@/lib/screening';

const STATUS_LABEL: Record<SellerCredential['status'], string> = {
  NOT_SUBMITTED: 'Not submitted',
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  DENIED: 'Not approved',
  EXPIRED: 'Expired',
  RENEWAL_REQUIRED: 'Resubmission needed',
  REVOKED: 'Revoked',
};

const STATUS_COLOR: Record<SellerCredential['status'], string> = {
  NOT_SUBMITTED: Colors.textTertiary,
  PENDING: '#2563EB',
  APPROVED: Colors.primary,
  DENIED: '#DC2626',
  EXPIRED: '#B45309',
  RENEWAL_REQUIRED: '#B45309',
  REVOKED: '#DC2626',
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T23:59:59');
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** Escalating expiry warning per the launch spec: 30 / 14 / 7 days. */
function expiryWarning(cred: SellerCredential): { text: string; urgent: boolean } | null {
  if (cred.status !== 'APPROVED') return null;
  const days = daysUntil(cred.expiration_date);
  if (days == null || days > 30) return null;
  if (days <= 0) return { text: 'Expired', urgent: true };
  if (days <= 7) return { text: `Expires in ${days} day${days === 1 ? '' : 's'} — renew now to avoid paused listings`, urgent: true };
  if (days <= 14) return { text: `Expires in ${days} days — renew soon`, urgent: true };
  return { text: `Expires in ${days} days`, urgent: false };
}

export default function ComplianceCenterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const creds = useMyCredentials(userId ?? undefined);
  const taxonomy = useTaxonomy();
  const myListings = useMyListings(userId ?? undefined);
  const reactivate = useReactivateListings(userId ?? undefined);
  const [docBusy, setDocBusy] = useState<string | null>(null);

  if (!userId) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, justifyContent: 'center' }]}>
        <EmptyState emoji="🔑" title="Sign in" subtitle="Seller verification is tied to your account.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  // Held-for-review listings are `paused` too, but nothing about them is the
  // seller's to fix — counting them as "paused" would send someone renewing a
  // credential they already hold. Two states, two cards.
  const parked = (myListings.data ?? []).filter((l) => l.status === 'paused');
  const underReview = parked.filter(isUnderReview);
  const pausedCount = parked.length - underReview.length;

  const scopeNames = (cred: SellerCredential): string => {
    const index = taxonomy.data;
    if (!index || !cred.scope?.length) return '—';
    return cred.scope
      .map((s) => index.byId.get(s.taxonomy_node_id)?.name ?? 'Unknown category')
      .join(', ');
  };

  const viewDocument = async (cred: SellerCredential) => {
    if (!cred.document_path) {
      Alert.alert('No document', 'This submission has no document attached.');
      return;
    }
    setDocBusy(cred.id);
    try {
      const url = await getCredentialDocumentUrl(cred.document_path);
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert('Couldn’t open document', 'Check your connection and try again.');
    } finally {
      setDocBusy(null);
    }
  };

  const runReactivate = async () => {
    try {
      const n = await reactivate.mutateAsync();
      Alert.alert(
        n > 0 ? 'Listings resumed' : 'Nothing to resume yet',
        n > 0
          ? `${n} paused listing${n === 1 ? ' is' : 's are'} live again.`
          : 'Paused listings resume once your plan and verification are both in order.',
      );
    } catch {
      Alert.alert('Couldn’t reactivate', 'Check your connection and try again.');
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={creds.isRefetching}
          onRefresh={() => creds.refetch()}
          tintColor={Colors.primary}
        />
      }
    >
      <Text style={styles.intro}>
        Some categories (like meat, live bait, or pet food) require seller
        verification before listings can go live. Documents you upload are
        private — only you and Gnome’s review team can see them.
      </Text>

      {underReview.length > 0 ? (
        <View style={styles.reviewCard}>
          <Text style={styles.reviewTitle}>
            {underReview.length} listing{underReview.length === 1 ? '' : 's'} under review
          </Text>
          {/* The server's words, one line per distinct reason — the internal
              keyword match behind them never leaves the database. */}
          {Array.from(
            new Set(
              underReview
                .map((l) => l.screening_reason?.trim())
                .filter((r): r is string => !!r),
            ),
          ).map((reason) => (
            <Text key={reason} style={styles.reviewBody}>{reason}</Text>
          ))}
          <Text style={styles.reviewBody}>
            Someone at Gnome reads each one by hand and you’ll be notified either
            way. Adding the documentation for that category below usually settles
            it faster.
          </Text>
        </View>
      ) : null}

      {pausedCount > 0 ? (
        <View style={styles.pausedCard}>
          <Text style={styles.pausedTitle}>
            {pausedCount} listing{pausedCount === 1 ? '' : 's'} paused
          </Text>
          <Text style={styles.pausedBody}>
            Listings pause when a credential expires or a seller plan lapses —
            nothing is deleted. Once renewed, resume them here.
          </Text>
          <Button
            label="Reactivate eligible listings"
            variant="secondary"
            loading={reactivate.isPending}
            onPress={() => void runReactivate()}
            style={{ marginTop: 8 }}
          />
        </View>
      ) : null}

      {creds.isError ? (
        <ErrorState message="Couldn’t load your verifications." onRetry={() => creds.refetch()} />
      ) : null}

      {(creds.data ?? []).map((cred) => {
        const warning = expiryWarning(cred);
        const canResubmit =
          cred.status === 'DENIED' ||
          cred.status === 'RENEWAL_REQUIRED' ||
          cred.status === 'REVOKED';
        const canRenew = cred.status === 'EXPIRED' || (cred.status === 'APPROVED' && warning != null);
        return (
          <View key={cred.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {cred.credential_type}
              </Text>
              <View style={[styles.status, { backgroundColor: STATUS_COLOR[cred.status] + '1A' }]}>
                <Text style={[styles.statusText, { color: STATUS_COLOR[cred.status] }]}>
                  {STATUS_LABEL[cred.status]}
                </Text>
              </View>
            </View>

            <Text style={styles.metaLine}>Covers: {scopeNames(cred)}</Text>
            {cred.issuing_agency ? <Text style={styles.metaLine}>Issued by {cred.issuing_agency}</Text> : null}
            {cred.credential_number ? <Text style={styles.metaLine}>Nº {cred.credential_number}</Text> : null}
            {cred.expiration_date ? (
              <Text style={styles.metaLine}>Expires {cred.expiration_date}</Text>
            ) : null}
            <Text style={styles.metaLine}>State: {cred.state}</Text>

            {warning ? (
              <View style={[styles.warn, warning.urgent && styles.warnUrgent]}>
                <Text style={[styles.warnText, warning.urgent && styles.warnTextUrgent]}>
                  ⚠️ {warning.text}
                </Text>
              </View>
            ) : null}

            {cred.denial_reason && (cred.status === 'DENIED' || cred.status === 'RENEWAL_REQUIRED' || cred.status === 'REVOKED') ? (
              <View style={styles.denial}>
                <Text style={styles.denialLabel}>Reason from review</Text>
                <Text style={styles.denialText}>{cred.denial_reason}</Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              {cred.document_path ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="View your uploaded document"
                  onPress={() => void viewDocument(cred)}
                  style={styles.actionBtn}
                  disabled={docBusy === cred.id}
                >
                  <Text style={styles.actionText}>
                    {docBusy === cred.id ? 'Opening…' : 'View document'}
                  </Text>
                </Pressable>
              ) : null}
              {canResubmit ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/compliance/upload?resubmit=${cred.id}`)}
                  style={[styles.actionBtn, styles.actionPrimary]}
                >
                  <Text style={[styles.actionText, styles.actionTextPrimary]}>Resubmit</Text>
                </Pressable>
              ) : null}
              {canRenew ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/compliance/upload?renewOf=${cred.id}`)}
                  style={[styles.actionBtn, styles.actionPrimary]}
                >
                  <Text style={[styles.actionText, styles.actionTextPrimary]}>Renew</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}

      {creds.data && creds.data.length === 0 ? (
        <EmptyState
          emoji="📋"
          title="No verifications yet"
          subtitle="You only need this if you sell regulated products. Ordinary garden goods never require it."
        />
      ) : null}

      <Button
        label="Add a verification"
        onPress={() => router.push('/compliance/upload')}
        style={{ marginTop: 16 }}
      />
      <Text style={styles.disclaimer}>
        Gnome reviews documentation for marketplace access. Gnome is not a
        government licensing agency and approval is not legal advice.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  intro: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 19, marginBottom: 14 },
  pausedCard: {
    backgroundColor: '#B4530911',
    borderColor: '#B4530955',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  reviewCard: {
    backgroundColor: Colors.info + '11',
    borderColor: Colors.info + '55',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    gap: 4,
  },
  reviewTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  reviewBody: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 18 },
  pausedTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  pausedBody: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 4, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  cardTitle: { flex: 1, fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  status: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: fonts.bold },
  metaLine: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  warn: { backgroundColor: '#B4530914', borderRadius: 10, padding: 10, marginTop: 8 },
  warnUrgent: { backgroundColor: '#DC262614' },
  warnText: { fontSize: 13, fontFamily: fonts.semibold, color: '#B45309' },
  warnTextUrgent: { color: '#DC2626' },
  denial: { backgroundColor: '#DC26260D', borderRadius: 10, padding: 10, marginTop: 8 },
  denialLabel: { fontSize: 12, fontFamily: fonts.bold, color: '#DC2626' },
  denialText: { fontSize: 13, fontFamily: fonts.regular, color: Colors.text, marginTop: 2, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actionBtn: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0D' },
  actionText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  actionTextPrimary: { color: Colors.primary },
  disclaimer: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 14, lineHeight: 16, textAlign: 'center' },
});
