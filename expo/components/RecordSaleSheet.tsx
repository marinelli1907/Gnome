// One sheet, two entrances: the Sales Notebook's "Record sale" and the
// Complete Exchange bridge (owner marks a sale complete → offer to log the
// payment). Writes go through the atomic record_sale RPC; claim-linked
// records are idempotent server-side (unique completed row per claim), so a
// double-tap reports "already recorded" instead of double-counting.
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Button, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useRecordSale } from '@/lib/db';

export interface SalePrefill {
  listingId?: string | null;
  listingTitle?: string | null;
  claimId?: string | null;
  quantity?: number | null;
  amountCents?: number | null;
  buyerLabel?: string | null;
}

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'cashapp', label: 'Cash App' },
  { value: 'check', label: 'Check' },
  { value: 'other', label: 'Other' },
] as const;

export default function RecordSaleSheet({
  visible,
  marketId,
  uid,
  prefill,
  onClose,
  onRecorded,
}: {
  visible: boolean;
  marketId: string;
  uid: string;
  prefill?: SalePrefill | null;
  onClose: () => void;
  onRecorded?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const recordSale = useRecordSale(uid);

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [qty, setQty] = useState('1');
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('cash');
  const [buyer, setBuyer] = useState('');
  const [notes, setNotes] = useState('');

  // Seed the form each time the sheet opens with a new prefill.
  const seedKey = visible ? `${prefill?.claimId ?? ''}|${prefill?.listingId ?? ''}` : null;
  if (seedKey !== null && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setAmount(prefill?.amountCents != null ? (prefill.amountCents / 100).toFixed(2).replace(/\.00$/, '') : '');
    setQty(String(prefill?.quantity ?? 1));
    setBuyer(prefill?.buyerLabel ?? '');
    setMethod('cash');
    setNotes('');
  }

  const submit = async () => {
    const dollars = parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      Alert.alert('Enter the amount', 'How much was this sale?');
      return;
    }
    const quantity = Math.max(1, parseInt(qty, 10) || 1);
    try {
      const res = await recordSale.mutateAsync({
        marketId,
        listingId: prefill?.listingId ?? null,
        claimId: prefill?.claimId ?? null,
        quantity,
        grossCents: Math.round(dollars * 100),
        paymentMethod: method,
        buyerLabel: buyer.trim() || null,
        notes: notes.trim() || null,
        source: prefill?.claimId ? 'request' : 'manual',
      });
      if (res.duplicate) {
        Alert.alert('Already recorded', 'This exchange is already in your ledger — no duplicate was created.');
      }
      onRecorded?.();
      onClose();
    } catch (e: any) {
      const msg = e?.message ?? '';
      Alert.alert(
        'Couldn’t record the sale',
        /INSUFFICIENT_INVENTORY/i.test(msg)
          ? 'Not enough inventory on that listing — check the quantity.'
          : msg || 'Nothing was saved. Please try again.',
      );
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: Colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Record sale</Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close without recording"
            style={styles.closeBtn}
          >
            <X size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          {prefill?.listingTitle ? (
            <View style={styles.linked}>
              <Text style={styles.linkedText} numberOfLines={1}>
                For: {prefill.listingTitle}
              </Text>
              <Text style={styles.linkedSub}>
                {prefill.claimId
                  ? 'Linked to the completed exchange — inventory reconciles automatically.'
                  : 'Linked listing — inventory reconciles automatically.'}
              </Text>
            </View>
          ) : (
            <Text style={styles.quickNote}>
              Quick sale — not tied to a listing. Use this for stand walk-ups.
            </Text>
          )}

          <View style={styles.rowFields}>
            <View style={{ flex: 1.4 }}>
              <Field
                label="Amount ($)"
                value={amount}
                onChangeText={setAmount}
                placeholder="5"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Quantity"
                value={qty}
                onChangeText={setQty}
                placeholder="1"
                keyboardType="number-pad"
              />
            </View>
          </View>

          <Text style={styles.fieldLabel}>How were you paid?</Text>
          <View style={styles.methodWrap}>
            {METHODS.map((m) => {
              const active = method === m.value;
              return (
                <Pressable
                  key={m.value}
                  onPress={() => setMethod(m.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.methodChip, active && styles.methodChipActive]}
                >
                  <Text style={[styles.methodText, active && styles.methodTextActive]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Buyer (optional)"
            value={buyer}
            onChangeText={setBuyer}
            placeholder="e.g. Sam from Oak St"
          />
          <Field
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything worth remembering"
          />

          <Button label="Save to ledger" onPress={() => void submit()} loading={recordSale.isPending} />
          <Text style={styles.hint}>
            Your ledger is private to you. Recording a payment is optional — skipping it
            just leaves the exchange unrecorded.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20 },
  linked: {
    backgroundColor: Colors.primary + '0D',
    borderColor: Colors.primary + '40',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  linkedText: { fontSize: 14, fontFamily: fonts.bold, color: Colors.text },
  linkedSub: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  quickNote: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginBottom: 14 },
  rowFields: { flexDirection: 'row', gap: 12 },
  fieldLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, marginBottom: 8 },
  methodWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  methodChip: {
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  methodChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  methodText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  methodTextActive: { color: Colors.textInverse },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 12, lineHeight: 17, textAlign: 'center' },
});
