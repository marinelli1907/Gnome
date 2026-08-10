// Sales Notebook — mobile parity with the web My Market notebook, on the same
// hardened backend (record_sale / void_sale RPCs, owner-only RLS). Monthly
// summary, quick sale, listing-linked sale, ledger with void, and expenses.
// CSV export intentionally stays web-only.
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Field } from '@/components/ui';
import RecordSaleSheet, { type SalePrefill } from '@/components/RecordSaleSheet';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import {
  useAddExpense,
  useMyListings,
  useMyMarket,
  useSellerExpenses,
  useSellerTransactions,
  useVoidSale,
  type SellerTxn,
} from '@/lib/db';

const EXPENSE_CATS = ['seeds', 'soil', 'fertilizer', 'packaging', 'market_fees', 'supplies', 'mileage', 'other'];
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function NotebookScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;
  const txns = useSellerTransactions(marketId);
  const expenses = useSellerExpenses(marketId);
  const myListings = useMyListings(userId ?? undefined);
  const voidSale = useVoidSale(userId ?? undefined, marketId);
  const addExpense = useAddExpense(userId ?? undefined);

  const [saleOpen, setSaleOpen] = useState(false);
  const [salePrefill, setSalePrefill] = useState<SalePrefill | null>(null);
  const [pickListingOpen, setPickListingOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expCat, setExpCat] = useState('seeds');
  const [expAmount, setExpAmount] = useState('');
  const [expVendor, setExpVendor] = useState('');
  const [voidTarget, setVoidTarget] = useState<SellerTxn | null>(null);
  const [voidReason, setVoidReason] = useState('entered by mistake');

  const summary = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const done = (txns.data ?? []).filter((t) => t.status === 'completed');
    const monthTx = done.filter((t) => new Date(t.sold_at).getTime() >= monthStart);
    const gross = monthTx.reduce((s, t) => s + t.net_cents, 0);
    const items = monthTx.reduce((s, t) => s + (Number(t.quantity) || 1), 0);
    const byMethod: Record<string, number> = {};
    for (const t of monthTx) byMethod[t.payment_method] = (byMethod[t.payment_method] ?? 0) + t.net_cents;
    const monthExp = (expenses.data ?? [])
      .filter((e) => e.status === 'recorded' && new Date(e.spent_at).getTime() >= monthStart)
      .reduce((s, e) => s + e.amount_cents, 0);
    return { gross, count: monthTx.length, items, byMethod, monthExp };
  }, [txns.data, expenses.data]);

  if (!userId) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <EmptyState emoji="📒" title="Sign in" subtitle="Your sales notebook is tied to your Market.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (market.data === null) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <EmptyState emoji="🏡" title="No Market yet" subtitle="Post your first listing and your Market — and this notebook — will be ready." />
      </View>
    );
  }

  const saleListings = (myListings.data ?? []).filter(
    (l) => l.listing_type === 'sale' && ['active', 'claimed', 'completed', 'paused'].includes(l.status),
  );

  const doVoid = async () => {
    if (!voidTarget) return;
    const reason = voidReason.trim();
    if (!reason) {
      Alert.alert('Add a reason', 'A voided sale keeps a note about why.');
      return;
    }
    try {
      await voidSale.mutateAsync({ txnId: voidTarget.id, reason });
      setVoidTarget(null);
    } catch (e: any) {
      Alert.alert('Couldn’t void', e?.message ?? 'Try again.');
    }
  };

  const saveExpense = async () => {
    const amt = Math.round(parseFloat(expAmount) * 100);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Enter the amount', 'How much was the expense?');
      return;
    }
    try {
      await addExpense.mutateAsync({
        marketId: marketId as string,
        category: expCat,
        amountCents: amt,
        vendor: expVendor.trim() || null,
      });
      setExpenseOpen(false);
      setExpAmount('');
      setExpVendor('');
    } catch (e: any) {
      Alert.alert('Couldn’t save expense', e?.message ?? 'Try again.');
    }
  };

  const ledger = txns.data ?? [];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={txns.isRefetching}
            onRefresh={() => {
              void txns.refetch();
              void expenses.refetch();
            }}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Monthly summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryMonth}>
            {new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </Text>
          <Text style={styles.summaryGross}>{money(summary.gross)}</Text>
          <Text style={styles.summarySub}>
            {summary.count} sale{summary.count === 1 ? '' : 's'} · {summary.items} item{summary.items === 1 ? '' : 's'}
            {summary.monthExp > 0 ? ` · expenses ${money(summary.monthExp)}` : ''}
          </Text>
          {Object.keys(summary.byMethod).length > 0 ? (
            <View style={styles.methodRow}>
              {Object.entries(summary.byMethod).map(([m, cents]) => (
                <View key={m} style={styles.methodPill}>
                  <Text style={styles.methodPillText}>
                    {m.replace('_', ' ')} {money(cents)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <Button
            label="Record sale"
            onPress={() => {
              setSalePrefill(null);
              setSaleOpen(true);
            }}
            style={{ flex: 1 }}
          />
          <Button
            label="From listing"
            variant="secondary"
            onPress={() => setPickListingOpen(true)}
            style={{ flex: 1 }}
          />
        </View>
        <Button
          label="Record expense"
          variant="ghost"
          onPress={() => setExpenseOpen((v) => !v)}
          style={{ marginTop: 8 }}
        />

        {expenseOpen ? (
          <View style={styles.expenseCard}>
            <Text style={styles.sectionTitle}>Record an expense</Text>
            <View style={styles.catWrap}>
              {EXPENSE_CATS.map((c) => {
                const active = expCat === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setExpCat(c)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.catChip, active && styles.catChipActive]}
                  >
                    <Text style={[styles.catText, active && styles.catTextActive]}>
                      {c.replace('_', ' ')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field label="Amount ($)" value={expAmount} onChangeText={setExpAmount} placeholder="12.50" keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1.4 }}>
                <Field label="Vendor (optional)" value={expVendor} onChangeText={setExpVendor} placeholder="Rural King" />
              </View>
            </View>
            <Button label="Save expense" onPress={() => void saveExpense()} loading={addExpense.isPending} />
          </View>
        ) : null}

        {/* Ledger */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Ledger</Text>
        {ledger.length === 0 ? (
          <Text style={styles.emptyLedger}>
            No sales recorded yet — tap “Record sale” after your next exchange.
          </Text>
        ) : (
          ledger.map((t) => (
            <View key={t.id} style={styles.txnRow}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.txnAmount, t.status === 'void' && styles.txnVoid]}
                  numberOfLines={1}
                >
                  {money(t.net_cents)} · {t.payment_method.replace('_', ' ')}
                  {t.buyer_label ? ` · ${t.buyer_label}` : ''}
                </Text>
                <Text style={styles.txnSub}>
                  {new Date(t.sold_at).toLocaleDateString()}
                  {t.source === 'request' ? ' · from exchange' : ''}
                  {t.status === 'void' ? ` · VOID (${t.void_reason ?? 'no reason'})` : ''}
                </Text>
              </View>
              {t.status === 'completed' ? (
                <Pressable
                  onPress={() => {
                    setVoidReason('entered by mistake');
                    setVoidTarget(t);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Void this recorded sale"
                  style={styles.voidBtn}
                >
                  <Text style={styles.voidText}>Void</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
        <Text style={styles.ledgerNote}>
          Recorded sales are for your own tracking and may not represent complete
          tax records. CSV export is available on the web notebook.
        </Text>

        {/* Expenses list */}
        {(expenses.data ?? []).length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Expenses</Text>
            {(expenses.data ?? []).map((e) => (
              <View key={e.id} style={styles.txnRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txnAmount}>
                    {money(e.amount_cents)} · {e.category.replace('_', ' ')}
                    {e.vendor ? ` · ${e.vendor}` : ''}
                  </Text>
                  <Text style={styles.txnSub}>{new Date(e.spent_at).toLocaleDateString()}</Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      {/* Record-sale sheet (quick or listing-linked) */}
      {marketId ? (
        <RecordSaleSheet
          visible={saleOpen}
          marketId={marketId}
          uid={userId}
          prefill={salePrefill}
          onClose={() => setSaleOpen(false)}
        />
      ) : null}

      {/* Simple listing chooser for listing-linked sales */}
      <Modal
        visible={pickListingOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickListingOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={styles.pickHeader}>
            <Text style={styles.sectionTitle}>Which listing?</Text>
            <Pressable
              onPress={() => setPickListingOpen(false)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: Colors.primary, fontFamily: fonts.bold, fontSize: 15 }}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            {saleListings.length === 0 ? (
              <Text style={styles.emptyLedger}>No sale listings yet.</Text>
            ) : (
              saleListings.map((l) => (
                <Pressable
                  key={l.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setPickListingOpen(false);
                    setSalePrefill({
                      listingId: l.id,
                      listingTitle: l.title,
                      amountCents: l.price_cents,
                    });
                    setSaleOpen(true);
                  }}
                  style={styles.pickRow}
                >
                  <Text style={styles.pickTitle} numberOfLines={1}>{l.title}</Text>
                  <Text style={styles.pickSub}>
                    {l.price_cents != null ? money(l.price_cents) : ''}
                    {l.unit ? ` / ${l.unit}` : ''}
                    {l.inventory_count != null ? ` · ${l.inventory_count} left` : ''}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Void-with-reason */}
      <Modal visible={!!voidTarget} transparent animationType="fade" onRequestClose={() => setVoidTarget(null)}>
        <View style={styles.voidBackdrop}>
          <View style={styles.voidCard}>
            <Text style={styles.sectionTitle}>Void this sale?</Text>
            <Text style={styles.voidBody}>
              It stays in your history as voided, and any inventory it used is restored.
            </Text>
            <TextInput
              style={styles.voidInput}
              value={voidReason}
              onChangeText={setVoidReason}
              placeholder="Reason"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="Reason for voiding"
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Keep it" variant="secondary" onPress={() => setVoidTarget(null)} style={{ flex: 1 }} />
              <Button label="Void" variant="danger" onPress={() => void doVoid()} loading={voidSale.isPending} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  summaryCard: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 16,
    padding: 16,
  },
  summaryMonth: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  summaryGross: { fontSize: 32, fontFamily: 'Fraunces_700Bold', color: Colors.text, marginTop: 2 },
  summarySub: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  methodPill: { backgroundColor: Colors.backgroundSecondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  methodPillText: { fontSize: 12, fontFamily: fonts.semibold, color: Colors.textSecondary },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  expenseCard: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    gap: 10,
  },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: {
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  catTextActive: { color: Colors.textInverse },
  emptyLedger: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 8, lineHeight: 19 },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  txnAmount: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  txnVoid: { textDecorationLine: 'line-through', color: Colors.textTertiary },
  txnSub: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  voidBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  voidText: { color: Colors.error, fontFamily: fonts.bold, fontSize: 13 },
  ledgerNote: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 10, lineHeight: 16 },
  pickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickRow: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  pickTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  pickSub: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  voidBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  voidCard: { backgroundColor: Colors.background, borderRadius: 16, padding: 18, gap: 10 },
  voidBody: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 19 },
  voidInput: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    fontFamily: fonts.regular,
  },
});
