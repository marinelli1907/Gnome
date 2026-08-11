// Delivery settings — seller-side mirror of the web editor. Free tier: on/off,
// radius (≤15 mi), one flat fee. Paid: distance surcharge + same-day/next-day
// cutoffs + a weekly schedule. The backend trigger enforces the plan gate; the
// UI just doesn't offer what would bounce, and says why.
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket } from '@/lib/db';
import { useDeliverySettings, useSaveDeliverySettings } from '@/lib/delivery';

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const centsToDollars = (c: number | null | undefined) =>
  c == null ? '' : (c / 100).toFixed(2).replace(/\.00$/, '');
const dollarsToCents = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return s.trim() === '' || Number.isNaN(n) ? null : Math.round(n * 100);
};

export default function DeliverySettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;
  const paid = (market.data?.plan ?? 'free') !== 'free';
  const settings = useDeliverySettings(marketId);
  const save = useSaveDeliverySettings(marketId);

  const [enabled, setEnabled] = useState(false);
  const [radius, setRadius] = useState('');
  const [flatFee, setFlatFee] = useState('');
  const [surAfter, setSurAfter] = useState('');
  const [surFee, setSurFee] = useState('');
  const [sameDay, setSameDay] = useState(false);
  const [sameDayCutoff, setSameDayCutoff] = useState('11:00');
  const [nextDay, setNextDay] = useState(false);
  const [nextDayCutoff, setNextDayCutoff] = useState('18:00');
  const [scheduled, setScheduled] = useState(false);
  const [orderByDow, setOrderByDow] = useState<number | null>(null);
  const [deliveryDows, setDeliveryDows] = useState<number[]>([]);
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settings.data === undefined || loaded) return;
    const d = settings.data;
    if (d) {
      setEnabled(d.enabled);
      setRadius(d.radius_miles != null ? String(d.radius_miles) : '');
      setFlatFee(centsToDollars(d.flat_fee_cents));
      setSurAfter(d.surcharge_after_miles != null ? String(d.surcharge_after_miles) : '');
      setSurFee(centsToDollars(d.surcharge_fee_cents));
      setSameDay(d.same_day);
      setSameDayCutoff(d.same_day_cutoff?.slice(0, 5) ?? '11:00');
      setNextDay(d.next_day);
      setNextDayCutoff(d.next_day_cutoff?.slice(0, 5) ?? '18:00');
      setScheduled(d.scheduled);
      setOrderByDow(d.order_by_dow);
      setDeliveryDows(d.delivery_dows ?? []);
      setNotes(d.notes ?? '');
    }
    setLoaded(true);
  }, [settings.data, loaded]);

  if (!userId || (market.data === null && !market.isLoading)) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🚚" title="No Market yet" subtitle="Post something first — your Market appears with your first listing." />
      </View>
    );
  }

  const onSave = () => {
    const r = radius.trim() === '' ? null : Number(radius);
    if (enabled && (r == null || Number.isNaN(r) || r <= 0)) {
      Alert.alert('Missing radius', 'Enter how many miles you deliver.');
      return;
    }
    if (paid && scheduled && (orderByDow == null || deliveryDows.length === 0)) {
      Alert.alert('Schedule incomplete', 'Pick an order-by day and at least one delivery day.');
      return;
    }
    save.mutate(
      {
        enabled,
        radius_miles: r,
        flat_fee_cents: dollarsToCents(flatFee) ?? 0,
        surcharge_after_miles: paid && surAfter.trim() !== '' ? Number(surAfter) : null,
        surcharge_fee_cents: paid && surAfter.trim() !== '' ? dollarsToCents(surFee) ?? 0 : null,
        same_day: paid && sameDay,
        same_day_cutoff: paid && sameDay ? sameDayCutoff : null,
        next_day: paid && nextDay,
        next_day_cutoff: paid && nextDay ? nextDayCutoff : null,
        scheduled: paid && scheduled,
        order_by_dow: paid && scheduled ? orderByDow : null,
        delivery_dows: paid && scheduled ? deliveryDows : [],
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => Alert.alert('Saved', 'Buyers now see your delivery offer.'),
        onError: (e: any) => {
          const m = /DELIVERY_PLAN_LIMIT:[^:]*:(.*)/.exec(e?.message ?? '');
          Alert.alert('Not saved', m ? m[1] : e?.message ?? 'Try again.');
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.heading}>Delivery</Text>
        <Text style={styles.sub}>
          Tell buyers if you deliver, how far, and what it costs. Fees are paid to
          you directly, like everything else on Gnome.
        </Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>We deliver</Text>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: Colors.primary }} />
        </View>

        {enabled && (
          <>
            <Field
              label={paid ? 'Delivery radius (miles)' : 'Delivery radius (miles — up to 15 on the free plan)'}
              value={radius}
              onChangeText={setRadius}
              keyboardType="decimal-pad"
              placeholder={paid ? '25' : '10'}
            />
            <Field
              label="Delivery fee ($, flat — 0 = free delivery)"
              value={flatFee}
              onChangeText={setFlatFee}
              keyboardType="decimal-pad"
              placeholder="3.00"
            />

            {paid ? (
              <>
                <Text style={styles.section}>Distance surcharge (optional)</Text>
                <View style={styles.pair}>
                  <View style={{ flex: 1 }}>
                    <Field label="Extra fee after (miles)" value={surAfter} onChangeText={setSurAfter}
                      keyboardType="decimal-pad" placeholder="10" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Extra fee ($)" value={surFee} onChangeText={setSurFee}
                      keyboardType="decimal-pad" placeholder="2.00" editable={surAfter.trim() !== ''} />
                  </View>
                </View>

                <Text style={styles.section}>When do you deliver?</Text>

                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Same-day</Text>
                  <Switch value={sameDay} onValueChange={setSameDay} trackColor={{ true: Colors.primary }} />
                </View>
                {sameDay && (
                  <Field label="Same-day: order by (24h HH:MM)" value={sameDayCutoff}
                    onChangeText={setSameDayCutoff} placeholder="11:00" autoCapitalize="none" />
                )}

                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Next-day</Text>
                  <Switch value={nextDay} onValueChange={setNextDay} trackColor={{ true: Colors.primary }} />
                </View>
                {nextDay && (
                  <Field label="Next-day: order by (24h HH:MM)" value={nextDayCutoff}
                    onChangeText={setNextDayCutoff} placeholder="18:00" autoCapitalize="none" />
                )}

                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Weekly schedule</Text>
                  <Switch value={scheduled} onValueChange={setScheduled} trackColor={{ true: Colors.primary }} />
                </View>
                {scheduled && (
                  <>
                    <Text style={styles.fieldLabel}>Order by</Text>
                    <View style={styles.chips}>
                      {DOWS.map((d, i) => (
                        <Pressable key={d} onPress={() => setOrderByDow(i)}
                          style={[styles.chip, orderByDow === i && styles.chipActive]}>
                          <Text style={[styles.chipText, orderByDow === i && styles.chipTextActive]}>{d}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.fieldLabel}>We deliver on</Text>
                    <View style={styles.chips}>
                      {DOWS.map((d, i) => {
                        const on = deliveryDows.includes(i);
                        return (
                          <Pressable key={d}
                            onPress={() => setDeliveryDows(on ? deliveryDows.filter((x) => x !== i) : [...deliveryDows, i].sort())}
                            style={[styles.chip, on && styles.chipActive]}>
                            <Text style={[styles.chipText, on && styles.chipTextActive]}>{d}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.hint}>Example: order by Thursday, delivered Saturday.</Text>
                  </>
                )}
              </>
            ) : (
              <View style={styles.upsell}>
                <Text style={styles.upsellTitle}>Neighbor delivery: up to 15 miles, one flat fee.</Text>
                <Text style={styles.upsellBody}>
                  Upgrade to Grower for distance surcharges, same-day & next-day
                  cutoffs, and weekly delivery days.
                </Text>
                <Button label="See plans" variant="secondary" onPress={() => router.push('/upgrade')}
                  style={{ marginTop: 10, alignSelf: 'flex-start' }} />
              </View>
            )}

            <Field
              label="Delivery notes (optional — shown to buyers)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Coolers on porches welcome; text when we're 10 min out."
              multiline
              numberOfLines={2}
            />
          </>
        )}

        <Button
          label={save.isPending ? 'Saving…' : 'Save delivery settings'}
          onPress={onSave}
          disabled={save.isPending || !marketId}
          style={{ marginTop: 18 }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20 },
  heading: { fontSize: 25, fontFamily: 'Fraunces_700Bold', color: Colors.text },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: 16, lineHeight: 20, fontFamily: fonts.regular },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  rowLabel: { fontSize: 16, color: Colors.text, fontFamily: fonts.semibold },
  section: { fontSize: 13, fontFamily: fonts.bold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8, marginBottom: 8 },
  pair: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  hint: { fontSize: 13, color: Colors.textTertiary, fontFamily: fonts.regular, marginBottom: 8 },
  upsell: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginTop: 4, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  upsellTitle: { fontSize: 14, fontFamily: fonts.bold, color: Colors.text },
  upsellBody: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 4, lineHeight: 19 },
});
