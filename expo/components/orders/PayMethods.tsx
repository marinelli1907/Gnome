// "Pay seller" rows — the one shared rendering of a market's enabled payment
// methods (order detail + claim chat). Opening a link NEVER marks anything
// paid; the required outside-Gnome disclaimer always renders underneath.
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import {
  METHOD_LABEL,
  openPaymentLink,
  paymentLink,
  useMarketPaymentMethods,
  type MarketPaymentMethod,
} from '@/lib/marketops';

function methodDetail(m: MarketPaymentMethod): string | null {
  switch (m.method) {
    case 'venmo':
      return m.handle ? `@${m.handle.replace(/^@/, '')}` : null;
    case 'paypal':
      return m.handle ? `paypal.me/${m.handle}` : null;
    case 'cashapp':
      return m.handle ? `$${m.handle.replace(/^\$/, '')}` : null;
    case 'zelle':
      return m.handle ?? null;
    case 'cash':
      return 'Pay in person at pickup';
    case 'other':
      return m.instructions ?? null;
    default:
      return null;
  }
}

export function PayMethodRow({
  m,
  amountCents,
}: {
  m: MarketPaymentMethod;
  amountCents?: number | null;
}) {
  const linkable = paymentLink(m, amountCents) != null;
  const title = m.method === 'other' && m.label ? m.label : METHOD_LABEL[m.method];
  const detail = methodDetail(m);

  const onPress = async () => {
    const ok = await openPaymentLink(m, amountCents);
    if (!ok) {
      Alert.alert('Couldn’t open link', 'Try paying with the handle shown instead.');
    }
  };

  if (!linkable) {
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{title}</Text>
          {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
          {m.method === 'zelle' ? (
            <Text style={styles.rowHint}>Send via your banking app using this identifier.</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLabel={`Pay seller with ${title}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>Pay with {title}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      <Text style={styles.openText}>Open</Text>
    </Pressable>
  );
}

export function PaymentDisclaimer() {
  return (
    <Text style={styles.disclaimer}>
      Payment is handled outside Gnome. The seller confirms payment separately.
    </Text>
  );
}

/** Enabled payment methods for a market, with the required disclaimer. */
export default function PayMethodsList({
  marketId,
  amountCents,
}: {
  marketId?: string;
  amountCents?: number | null;
}) {
  const methods = useMarketPaymentMethods(marketId);
  const enabled = (methods.data ?? []).filter((m) => m.enabled);

  if (methods.isLoading) {
    return (
      <View style={{ paddingVertical: 12, alignItems: 'center' }}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (enabled.length === 0) {
    return (
      <Text style={styles.noneText}>
        The seller hasn’t added payment options yet — sort out payment at pickup.
      </Text>
    );
  }
  return (
    <View>
      {enabled.map((m) => (
        <PayMethodRow key={m.id} m={m} amountCents={amountCents} />
      ))}
      <PaymentDisclaimer />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 8,
  },
  rowTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  rowDetail: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  rowHint: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 2 },
  openText: { fontSize: 13, fontFamily: fonts.bold, color: Colors.primary },
  noneText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginTop: 6,
  },
  disclaimer: {
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: Colors.textTertiary,
    lineHeight: 16,
    marginTop: 8,
  },
});
