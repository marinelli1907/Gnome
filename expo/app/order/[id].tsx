// Order detail — one screen, both roles. The buyer sees status, their window,
// pickup details (post-confirmation only), arrival buttons, and outside-Gnome
// payment options. The seller sees confirm / suggest-time / decline / ready /
// complete, with the record-payment sheet on completion. Every mutation
// surfaces errors via Alert and never fakes success.
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, Field } from '@/components/ui';
import { OrderStatusBadge, orderWindow } from '@/components/orders/OrderStatus';
import PayMethodsList from '@/components/orders/PayMethods';
import SlotPicker from '@/components/orders/SlotPicker';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket } from '@/lib/db';
import {
  fmtWindow,
  METHOD_LABEL,
  money,
  sendArrivalNotice,
  useLocalPickupReminder,
  useMarketPaymentMethods,
  useOrder,
  useOrderAction,
  useOrderDeliveryDetails,
  useOrderPickupDetails,
  usePickupSlots,
  type PaymentMethodKind,
  type PickupSlot,
} from '@/lib/marketops';

const CANCELLABLE = ['REQUESTED', 'TIME_PROPOSED', 'CONFIRMED', 'READY'] as const;

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const order = useOrder(id);
  const myMarket = useMyMarket(userId ?? undefined);
  const act = useOrderAction(userId ?? undefined);

  const o = order.data;
  const isBuyer = !!o && !!userId && o.buyer_id === userId;
  const isSeller = !!o && !!myMarket.data && myMarket.data.id === o.market_id;
  const marketName = o?.market?.name ?? myMarket.data?.name ?? 'the market';

  const isDelivery = o?.fulfillment_type === 'delivery';
  const pickup = useOrderPickupDetails(isBuyer && !isDelivery ? id : undefined, o?.status);
  const delivery = useOrderDeliveryDetails(
    (isBuyer || isSeller) ? id : undefined, o?.fulfillment_type,
  );
  const payMethods = useMarketPaymentMethods(isSeller || isBuyer ? o?.market_id : undefined);
  const sellerSlots = usePickupSlots(isSeller ? o?.market_id : undefined);

  // Local reminder for the buyer's confirmed order (best-effort, this device).
  useLocalPickupReminder(isBuyer && !isDelivery ? o : null, o?.market?.name ?? undefined);

  // Arrival buttons: disable each after sending this session.
  const [onWaySent, setOnWaySent] = useState(false);
  const [hereSent, setHereSent] = useState(false);

  // Seller sheets.
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeSlot, setProposeSlot] = useState<PickupSlot | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [payReceived, setPayReceived] = useState<boolean | null>(null);
  const [payMethod, setPayMethod] = useState<string>('cash');
  const [payAmount, setPayAmount] = useState('');

  if (order.isLoading || myMarket.isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (order.isError) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState message="Couldn’t load this order." onRetry={() => order.refetch()} />
      </View>
    );
  }
  if (!o || (!isBuyer && !isSeller)) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🔒"
          title="Not available"
          subtitle="This order is only visible to the buyer and the seller."
        />
      </View>
    );
  }

  const win = orderWindow(o);
  const winWord = isDelivery ? 'delivery' : 'pickup';
  const winLabel =
    win.kind === 'confirmed'
      ? `Confirmed ${winWord}`
      : win.kind === 'proposed'
        ? `Suggested ${winWord}`
        : `Requested ${winWord}`;

  const runAction = async (action: Parameters<typeof act.mutateAsync>[0]['action'], after?: () => void) => {
    try {
      await act.mutateAsync({ orderId: o.id, action, fulfillment: o.fulfillment_type });
      after?.();
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      if (/INSUFFICIENT_INVENTORY/i.test(msg)) {
        const item = msg.split(/INSUFFICIENT_INVENTORY[:\s]*/i)[1]?.trim();
        Alert.alert(
          'Not enough inventory',
          item
            ? `There isn’t enough "${item}" left to fill this order. Update the listing or decline the order.`
            : 'There isn’t enough of an item left to fill this order. Update the listing or decline the order.',
        );
      } else {
        Alert.alert('Couldn’t update the order', msg || 'Check your connection and try again.');
      }
    }
  };

  const confirmCancel = () => {
    Alert.alert('Cancel this order?', 'The seller will be notified and the time slot is released.', [
      { text: 'Keep order', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => void runAction({ kind: 'cancel' }) },
    ]);
  };

  const sendOnWay = async () => {
    setOnWaySent(true);
    try {
      await sendArrivalNotice(o.id, false);
    } catch {
      // best-effort — the notice fn never blocks the loop
    }
  };
  const sendHere = async () => {
    setHereSent(true);
    try {
      await sendArrivalNotice(o.id, true);
    } catch {
      // best-effort
    }
  };

  const submitDecline = () => {
    const reason = declineReason.trim();
    if (!reason) {
      Alert.alert('Add a reason', 'Tell the buyer why you’re declining.');
      return;
    }
    void runAction({ kind: 'decline', reason }, () => setDeclineOpen(false));
  };

  const submitPropose = () => {
    if (!proposeSlot) {
      Alert.alert('Pick a time', 'Choose the window you want to suggest.');
      return;
    }
    void runAction(
      { kind: 'propose', start: proposeSlot.slot_start, end: proposeSlot.slot_end },
      () => {
        setProposeOpen(false);
        setProposeSlot(null);
      },
    );
  };

  const openComplete = () => {
    setPayReceived(null);
    setPayMethod('cash');
    setPayAmount(((o.subtotal_cents + (o.delivery_fee_cents ?? 0)) / 100).toFixed(2));
    setCompleteOpen(true);
  };

  const submitComplete = () => {
    if (payReceived) {
      const amt = Math.round(parseFloat(payAmount) * 100);
      if (!Number.isFinite(amt) || amt <= 0) {
        Alert.alert('Enter the amount', 'How much did the buyer pay?');
        return;
      }
      void runAction(
        { kind: 'complete', recordPayment: true, method: payMethod, amountCents: amt },
        () => setCompleteOpen(false),
      );
    } else {
      void runAction({ kind: 'complete', recordPayment: false }, () => setCompleteOpen(false));
    }
  };

  const enabledMethods = (payMethods.data ?? []).filter((m) => m.enabled);
  const chipMethods: string[] = Array.from(
    new Set<string>([...enabledMethods.map((m) => m.method), 'cash']),
  );

  const showBuyerPickupCard = isBuyer && !isDelivery && (o.status === 'CONFIRMED' || o.status === 'READY');

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl refreshing={order.isRefetching} onRefresh={() => order.refetch()} tintColor={Colors.primary} />
        }
      >
        {/* Header: market + status */}
        <View style={styles.headRow}>
          <Text style={styles.marketName} numberOfLines={1}>
            {isBuyer ? marketName : isDelivery ? 'Delivery order' : 'Pickup order'}
          </Text>
          <OrderStatusBadge status={o.status} />
        </View>

        {/* Window */}
        <View style={styles.windowCard}>
          <Text style={styles.windowLabel}>{winLabel}</Text>
          <Text style={styles.windowValue}>{fmtWindow(win.start, win.end)}</Text>
          {win.kind === 'proposed' ? (
            <Text style={styles.windowSub}>
              Originally requested {fmtWindow(o.requested_start, o.requested_end)}
            </Text>
          ) : null}
        </View>

        {/* Buyer: proposal banner */}
        {isBuyer && o.status === 'TIME_PROPOSED' && o.proposed_start && o.proposed_end ? (
          <View style={styles.proposalCard}>
            <Text style={styles.proposalTitle}>
              Seller suggested {fmtWindow(o.proposed_start, o.proposed_end)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Button
                label="Accept"
                onPress={() => void runAction({ kind: 'respond', accept: true })}
                loading={act.isPending}
                style={{ flex: 1 }}
              />
              <Button
                label="Decline time"
                variant="secondary"
                onPress={() => void runAction({ kind: 'respond', accept: false })}
                disabled={act.isPending}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : null}

        {/* Items */}
        <Text style={styles.sectionTitle}>Items</Text>
        {(o.items ?? []).map((it) => (
          <View key={it.id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle} numberOfLines={1}>{it.title}</Text>
              <Text style={styles.itemSub}>
                {it.quantity} × {money(it.unit_price_cents)}
                {it.unit ? ` / ${it.unit}` : ''}
              </Text>
            </View>
            <Text style={styles.itemTotal}>{money(it.item_total_cents)}</Text>
          </View>
        ))}
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Subtotal</Text>
          <Text style={styles.subtotalValue}>{money(o.subtotal_cents)}</Text>
        </View>
        {isDelivery && o.delivery_fee_cents != null ? (
          <>
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>
                Delivery{o.delivery_distance_miles != null ? ` · ${o.delivery_distance_miles} mi` : ''}
                {o.delivery_surcharge_cents ? ` (incl. ${money(o.delivery_surcharge_cents)} distance fee)` : ''}
              </Text>
              <Text style={styles.subtotalValue}>{money(o.delivery_fee_cents)}</Text>
            </View>
            <View style={styles.subtotalRow}>
              <Text style={[styles.subtotalLabel, { fontFamily: fonts.bold, color: Colors.text }]}>Total</Text>
              <Text style={styles.subtotalValue}>{money(o.subtotal_cents + o.delivery_fee_cents)}</Text>
            </View>
          </>
        ) : null}

        {/* Delivery address: buyer always; seller once confirmed (the RPC
            withholds it before then — city + distance only). */}
        {isDelivery && delivery.data ? (
          <View style={styles.noteCard}>
            <Text style={styles.noteLabel}>Delivery address</Text>
            <Text style={styles.noteText}>
              {delivery.data.delivery_address
                ?? `${delivery.data.delivery_city ?? 'Nearby'}${delivery.data.delivery_state ? ', ' + delivery.data.delivery_state : ''} — full address after you confirm`}
            </Text>
            {delivery.data.delivery_notes ? (
              <Text style={[styles.noteText, { marginTop: 4 }]}>“{delivery.data.delivery_notes}”</Text>
            ) : null}
          </View>
        ) : null}

        {/* Buyer note / decline reason */}
        {o.buyer_note ? (
          <View style={styles.noteCard}>
            <Text style={styles.noteLabel}>Buyer note</Text>
            <Text style={styles.noteText}>{o.buyer_note}</Text>
          </View>
        ) : null}
        {o.decline_reason ? (
          <View style={[styles.noteCard, styles.declineCard]}>
            <Text style={[styles.noteLabel, { color: Colors.error }]}>
              {o.status === 'DECLINED' ? 'Declined by seller' : 'Reason'}
            </Text>
            <Text style={styles.noteText}>{o.decline_reason}</Text>
          </View>
        ) : null}

        {/* Buyer: pickup details + arrival + payment */}
        {showBuyerPickupCard ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Pickup details</Text>
            {pickup.isLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />
            ) : pickup.data ? (
              <View style={styles.pickupCard}>
                {pickup.data.address ? <Text style={styles.pickupAddress}>{pickup.data.address}</Text> : null}
                {pickup.data.instructions ? (
                  <Text style={styles.pickupInstructions}>{pickup.data.instructions}</Text>
                ) : null}
                {!pickup.data.address && !pickup.data.instructions ? (
                  <Text style={styles.pickupInstructions}>The seller hasn’t added pickup details yet.</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.mutedText}>Pickup details appear once the seller confirms.</Text>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button
                label={onWaySent ? 'On my way ✓' : "I'm on my way"}
                variant="secondary"
                onPress={() => void sendOnWay()}
                disabled={onWaySent}
                style={{ flex: 1 }}
              />
              {onWaySent ? (
                <Button
                  label={hereSent ? 'Here ✓' : "I'm here"}
                  onPress={() => void sendHere()}
                  disabled={hereSent}
                  style={{ flex: 1 }}
                />
              ) : null}
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Pay seller</Text>
            <PayMethodsList marketId={o.market_id} amountCents={o.subtotal_cents} />
          </>
        ) : null}

        {/* Buyer, delivery: pay card with the true total (items + delivery). */}
        {isBuyer && isDelivery &&
         (o.status === 'CONFIRMED' || o.status === 'READY' || o.status === 'OUT_FOR_DELIVERY') ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Pay seller</Text>
            <PayMethodsList
              marketId={o.market_id}
              amountCents={o.subtotal_cents + (o.delivery_fee_cents ?? 0)}
            />
          </>
        ) : null}

        {/* Buyer: cancel */}
        {isBuyer && (CANCELLABLE as readonly string[]).includes(o.status) ? (
          <Button
            label="Cancel order"
            variant="danger"
            onPress={confirmCancel}
            disabled={act.isPending}
            style={{ marginTop: 20 }}
          />
        ) : null}

        {/* Seller actions */}
        {isSeller ? (
          <View style={{ marginTop: 20 }}>
            {o.status === 'REQUESTED' ? (
              <View style={{ gap: 10 }}>
                <Button label="Confirm order" onPress={() => void runAction({ kind: 'confirm' })} loading={act.isPending} />
                <Button label="Suggest a different time" variant="secondary" onPress={() => setProposeOpen(true)} disabled={act.isPending} />
                <Button label="Decline" variant="danger" onPress={() => setDeclineOpen(true)} disabled={act.isPending} />
              </View>
            ) : null}
            {o.status === 'TIME_PROPOSED' ? (
              <Text style={styles.waitingText}>
                Waiting on the buyer to accept your suggested time.
              </Text>
            ) : null}
            {o.status === 'CONFIRMED' ? (
              <View style={{ gap: 10 }}>
                {isDelivery ? (
                  <Button label="Out for delivery 🚚" onPress={() => void runAction({ kind: 'out_for_delivery' })} loading={act.isPending} />
                ) : (
                  <Button label="Mark ready" onPress={() => void runAction({ kind: 'ready' })} loading={act.isPending} />
                )}
                <Button label="Complete order" variant="secondary" onPress={openComplete} disabled={act.isPending} />
              </View>
            ) : null}
            {o.status === 'READY' ? (
              isDelivery ? (
                <View style={{ gap: 10 }}>
                  <Button label="Out for delivery 🚚" onPress={() => void runAction({ kind: 'out_for_delivery' })} loading={act.isPending} />
                  <Button label="Complete order" variant="secondary" onPress={openComplete} disabled={act.isPending} />
                </View>
              ) : (
                <Button label="Complete order" onPress={openComplete} loading={act.isPending} />
              )
            ) : null}
            {o.status === 'OUT_FOR_DELIVERY' ? (
              <Button label="Complete order" onPress={openComplete} loading={act.isPending} />
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Seller: suggest a different time */}
      <Modal
        visible={proposeOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setProposeOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sectionTitle}>Suggest a time</Text>
            <Pressable
              onPress={() => setProposeOpen(false)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.sheetClose}
            >
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <Text style={styles.mutedText}>
              The buyer asked for {fmtWindow(o.requested_start, o.requested_end)}. Pick the window
              you can do instead.
            </Text>
            <View style={{ marginTop: 12 }}>
              <SlotPicker
                slots={sellerSlots.data ?? []}
                loading={sellerSlots.isLoading}
                isError={sellerSlots.isError}
                onRetry={() => sellerSlots.refetch()}
                selected={proposeSlot}
                onSelect={setProposeSlot}
              />
            </View>
            {proposeSlot ? (
              <Text style={styles.slotSummary}>
                Suggest {fmtWindow(proposeSlot.slot_start, proposeSlot.slot_end)}
              </Text>
            ) : null}
            <Button
              label="Send suggestion"
              onPress={submitPropose}
              loading={act.isPending}
              disabled={!proposeSlot}
              style={{ marginTop: 16 }}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Seller: decline with reason */}
      <Modal visible={declineOpen} transparent animationType="fade" onRequestClose={() => setDeclineOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.sectionTitle}>Decline this order?</Text>
            <Text style={styles.mutedText}>The buyer sees your reason and the slot is released.</Text>
            <Field
              label="Reason"
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="Sold out before I could confirm"
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Keep it" variant="secondary" onPress={() => setDeclineOpen(false)} style={{ flex: 1 }} />
              <Button label="Decline" variant="danger" onPress={submitDecline} loading={act.isPending} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Seller: complete + record payment */}
      <Modal visible={completeOpen} transparent animationType="fade" onRequestClose={() => setCompleteOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.sectionTitle}>Complete order</Text>
            <Text style={styles.mutedText}>Was payment received?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[true, false].map((v) => {
                const active = payReceived === v;
                return (
                  <Pressable
                    key={String(v)}
                    onPress={() => setPayReceived(v)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.chip, active && styles.chipActive, { flex: 1 }]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {v ? 'Yes, record it' : 'No / record later'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {payReceived ? (
              <>
                <View style={styles.chipWrap}>
                  {chipMethods.map((m) => {
                    const active = payMethod === m;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => setPayMethod(m)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {METHOD_LABEL[m as PaymentMethodKind] ?? m}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Field
                  label="Amount ($)"
                  value={payAmount}
                  onChangeText={setPayAmount}
                  keyboardType="decimal-pad"
                  placeholder={(o.subtotal_cents / 100).toFixed(2)}
                />
              </>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Back" variant="secondary" onPress={() => setCompleteOpen(false)} style={{ flex: 1 }} />
              <Button
                label="Complete"
                onPress={submitComplete}
                loading={act.isPending}
                disabled={payReceived == null}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  marketName: { flex: 1, fontSize: 20, fontFamily: fonts.displayBold, color: Colors.text },
  windowCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  windowLabel: { fontSize: 12, fontFamily: fonts.semibold, color: Colors.textSecondary },
  windowValue: { fontSize: 17, fontFamily: fonts.bold, color: Colors.text, marginTop: 2 },
  windowSub: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 4 },
  proposalCard: {
    backgroundColor: Colors.goldLight,
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  proposalTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text, lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginTop: 18, marginBottom: 4 },
  itemRow: {
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
  itemTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  itemSub: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  itemTotal: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 4,
  },
  subtotalLabel: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary },
  subtotalValue: { fontSize: 17, fontFamily: fonts.bold, color: Colors.text },
  noteCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  declineCard: { borderColor: Colors.error + '55', backgroundColor: Colors.error + '0D' },
  noteLabel: { fontSize: 12, fontFamily: fonts.bold, color: Colors.textSecondary },
  noteText: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.text, marginTop: 3, lineHeight: 19 },
  pickupCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  pickupAddress: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  pickupInstructions: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 4, lineHeight: 19 },
  mutedText: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 19 },
  waitingText: {
    fontSize: 13.5,
    fontFamily: fonts.semibold,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },
  slotSummary: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.primary, marginTop: 10 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetCloseText: { color: Colors.primary, fontFamily: fonts.bold, fontSize: 15 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  dialogCard: { backgroundColor: Colors.background, borderRadius: 16, padding: 18, gap: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
});
