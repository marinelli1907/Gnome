// Add or edit ONE pickup location — its identity, its address, its privacy
// setting, its slot rules, and its own weekly schedule.
//
// `id === 'new'` creates. Because SELECT on address_line/lat/lng is revoked
// (0054), the insert returns nothing: useSaveLocation re-reads through
// my_pickup_locations() to learn the new id, and we only advance to the
// schedule editor if we actually got one back.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, EmptyState, ErrorState, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket } from '@/lib/db';
import { ScheduleEditor } from '@/components/pickup/ScheduleEditor';
import { UpgradeCard } from '@/components/pickup/UpgradeCard';
import {
  deviceTimezone,
  isPublicLocationType,
  LEAD_TIME_CHOICES,
  LOCATION_TYPE_LABELS,
  LOCATION_TYPES,
  parsePickupLimitError,
  planLabel,
  SLOT_MINUTE_CHOICES,
  TIMEZONE_CHOICES,
  useLocationSlots,
  usePickupLocations,
  useSaveLocation,
  type PickupLocationType,
} from '@/lib/pickuplocations';

export default function PickupLocationEditorScreen() {
  const { id, section } = useLocalSearchParams<{ id: string; section?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;

  const isNew = id === 'new';
  const locations = usePickupLocations(marketId);
  const existing = useMemo(
    () => (isNew ? null : (locations.data ?? []).find((l) => l.id === id) ?? null),
    [isNew, locations.data, id],
  );
  const save = useSaveLocation(marketId);
  const slots = useLocationSlots(isNew ? undefined : id, 10);

  // Form state
  const [nickname, setNickname] = useState('');
  const [type, setType] = useState<PickupLocationType>('PRIVATE_RESIDENCE');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [postal, setPostal] = useState('');
  const [instructions, setInstructions] = useState('');
  const [publicVisible, setPublicVisible] = useState(false);
  const [timezone, setTimezone] = useState(deviceTimezone());
  const [slotMinutes, setSlotMinutes] = useState<15 | 30 | 60>(30);
  const [leadMinutes, setLeadMinutes] = useState(120);
  const [maxPerSlot, setMaxPerSlot] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [limitError, setLimitError] = useState<{ allowance: number } | null>(null);

  // "Schedule" from the manager list deep-links straight to the hours editor.
  const scroller = useRef<ScrollView | null>(null);
  const scheduleY = useRef(0);
  const jumped = useRef(false);

  useEffect(() => {
    if (existing && !seeded) {
      setNickname(existing.nickname);
      setType(existing.location_type);
      setAddress(existing.address_line ?? '');
      setCity(existing.city ?? '');
      setStateCode(existing.state ?? '');
      setPostal(existing.postal_code ?? '');
      setInstructions(existing.instructions ?? '');
      setPublicVisible(existing.public_address_visible);
      setTimezone(existing.timezone);
      setSlotMinutes(existing.slot_minutes);
      setLeadMinutes(existing.lead_time_minutes);
      setMaxPerSlot(
        existing.max_orders_per_slot != null ? String(existing.max_orders_per_slot) : '',
      );
      setSeeded(true);
    }
  }, [existing, seeded]);

  useEffect(() => {
    if (section !== 'schedule' || jumped.current || !existing) return;
    jumped.current = true;
    const t = setTimeout(
      () => scroller.current?.scrollTo({ y: Math.max(0, scheduleY.current - 12), animated: true }),
      350,
    );
    return () => clearTimeout(t);
  }, [section, existing]);

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔑" title="Sign in" subtitle="Pickup locations belong to your Market.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (market.isLoading || (!isNew && locations.isLoading)) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (!marketId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🏡"
          title="No Market yet"
          subtitle="Post a listing to create your Market first."
        />
      </View>
    );
  }
  if (!isNew && locations.isError) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState message="Couldn’t load this location." onRetry={() => locations.refetch()} />
      </View>
    );
  }
  if (!isNew && !locations.isLoading && !existing) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🧭"
          title="Location not found"
          subtitle="It may have been removed from this Market."
        >
          <Button
            label="Back to locations"
            onPress={() => router.replace('/market/pickup-locations')}
            style={{ marginTop: 12 }}
          />
        </EmptyState>
      </View>
    );
  }

  const publicType = isPublicLocationType(type);
  const plan = planLabel(market.data?.plan);
  const restricted = existing?.plan_restricted ?? false;

  const onSave = async () => {
    if (!nickname.trim()) {
      Alert.alert('Name this location', 'Give it a short name you’ll recognise, like “Front porch”.');
      return;
    }
    let maxOrders: number | null = null;
    const trimmedMax = maxPerSlot.trim();
    if (trimmedMax !== '') {
      const n = parseInt(trimmedMax, 10);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert(
          'Check the number',
          'Max per slot must be a positive number, or blank for unlimited.',
        );
        return;
      }
      maxOrders = n;
    }

    setLimitError(null);
    try {
      const savedId = await save.mutateAsync({
        id: isNew ? null : id,
        nickname: nickname.trim(),
        location_type: type,
        address_line: address.trim() || null,
        city: city.trim() || null,
        state: stateCode.trim() || null,
        postal_code: postal.trim() || null,
        instructions: instructions.trim() || null,
        // Only a PUBLIC_* location can ever opt in.
        public_address_visible: publicType ? publicVisible : false,
        timezone,
        slot_minutes: slotMinutes,
        lead_time_minutes: leadMinutes,
        max_orders_per_slot: maxOrders,
      });

      if (!isNew) {
        Alert.alert('Saved', 'This pickup location is up to date.');
        return;
      }
      if (savedId) {
        // Straight into the schedule — a location with no windows books nothing.
        router.replace({
          pathname: '/market/pickup-location/[id]',
          params: { id: savedId, section: 'schedule' },
        });
      } else {
        Alert.alert(
          'Location added',
          'Open it from the list to set the hours when buyers can come by.',
          [{ text: 'OK', onPress: () => router.replace('/market/pickup-locations') }],
        );
      }
    } catch (e: any) {
      const limit = parsePickupLimitError(e);
      if (limit) {
        setLimitError({ allowance: limit.allowance });
        return;
      }
      Alert.alert('Couldn’t save', e?.message ?? 'Check your connection and try again.');
    }
  };

  const slotCount = slots.data?.length ?? 0;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scroller}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 48 }}
        keyboardShouldPersistTaps="handled"
      >
        {existing?.is_default ? (
          <View style={{ marginBottom: 10 }}>
            <Badge label="Default location" />
          </View>
        ) : null}

        {restricted ? (
          <View style={{ marginBottom: 14 }}>
            <UpgradeCard
              title="Not included on your current plan — upgrade to use this location again"
              body="Its address, hours and order history are all still here. Nothing was deleted."
            />
          </View>
        ) : null}

        {limitError ? (
          <View style={{ marginBottom: 14 }}>
            <UpgradeCard
              title={`You’ve reached the ${limitError.allowance}-location limit on ${plan}.`}
              body="Upgrade to add more pickup locations"
            />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>The basics</Text>
        <View style={styles.card}>
          <Field
            label="Name (only you see this)"
            value={nickname}
            onChangeText={setNickname}
            placeholder="Front porch"
          />

          <Text style={styles.fieldLabel}>Type of place</Text>
          <View style={styles.chipRow}>
            {LOCATION_TYPES.map((t) => {
              const active = type === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => {
                    setType(t);
                    if (!isPublicLocationType(t)) setPublicVisible(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={LOCATION_TYPE_LABELS[t]}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {LOCATION_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Where it is</Text>
        <View style={styles.card}>
          <Text style={styles.privacyNote}>
            {publicType && publicVisible
              ? 'This address is shown to everyone browsing your Market.'
              : 'Only buyers with a confirmed pickup ever see this address.'}
          </Text>
          <Field
            label="Street address"
            value={address}
            onChangeText={setAddress}
            placeholder="123 Maple Ave — side gate"
          />
          <Field label="City" value={city} onChangeText={setCity} placeholder="Lyndhurst" />
          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}>
              <Field
                label="State"
                value={stateCode}
                onChangeText={setStateCode}
                placeholder="OH"
                autoCapitalize="characters"
                maxLength={2}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="ZIP"
                value={postal}
                onChangeText={setPostal}
                placeholder="44124"
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
          </View>
          <Field
            label="Pickup instructions"
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Cooler on the porch, knock twice…"
            multiline
            numberOfLines={2}
            style={styles.multiline}
          />

          {publicType ? (
            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.switchLabel}>Show this address publicly</Text>
                <Text style={styles.switchHelp}>
                  Fine for a farm stand or a shop. Only public places can be shown.
                </Text>
              </View>
              <Switch
                value={publicVisible}
                onValueChange={setPublicVisible}
                trackColor={{ true: Colors.primary, false: Colors.border }}
                thumbColor={Colors.surfaceElevated}
                accessibilityRole="switch"
                accessibilityLabel="Show this address publicly"
              />
            </View>
          ) : (
            <Text style={styles.helpText}>
              A private residence is never shown publicly — buyers only get the
              exact address once you confirm their pickup.
            </Text>
          )}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Slot rules</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Time zone</Text>
          <View style={styles.chipRow}>
            {TIMEZONE_CHOICES.map((tz) => {
              const active = timezone === tz.value;
              return (
                <Pressable
                  key={tz.value}
                  onPress={() => setTimezone(tz.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${tz.label} time`}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{tz.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Slot length</Text>
          <View style={styles.chipRow}>
            {SLOT_MINUTE_CHOICES.map((mins) => {
              const active = slotMinutes === mins;
              return (
                <Pressable
                  key={mins}
                  onPress={() => setSlotMinutes(mins)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${mins} minute slots`}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{mins} min</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Lead time before a slot</Text>
          <View style={styles.chipRow}>
            {LEAD_TIME_CHOICES.map((c) => {
              const active = leadMinutes === c.minutes;
              return (
                <Pressable
                  key={c.minutes}
                  onPress={() => setLeadMinutes(c.minutes)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Lead time ${c.label}`}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ marginTop: 14 }}>
            <Field
              label="Max orders per slot (blank = unlimited)"
              value={maxPerSlot}
              onChangeText={setMaxPerSlot}
              placeholder="Unlimited"
              keyboardType="number-pad"
            />
          </View>
        </View>

        <Button
          label={isNew ? 'Add pickup location' : 'Save location'}
          onPress={() => void onSave()}
          loading={save.isPending}
          style={{ marginTop: 18 }}
        />

        {/* Schedule lives on the saved row — it needs a location_id. */}
        <View
          style={{ marginTop: 26 }}
          onLayout={(e) => {
            scheduleY.current = e.nativeEvent.layout.y;
          }}
        >
          {isNew ? (
            <View style={styles.pendingCard}>
              <Text style={styles.pendingTitle}>Hours come next</Text>
              <Text style={styles.pendingBody}>
                Add this location first, then set the weekly windows when buyers
                can come by. Until it has hours, it generates no pickup slots.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.slotSummary}>
                <Text style={styles.slotSummaryText}>
                  {restricted
                    ? 'Restricted by your plan — this location generates no slots right now.'
                    : !existing?.active
                      ? 'Turned off — this location generates no slots right now.'
                      : slots.isLoading
                        ? 'Checking upcoming slots…'
                        : slots.isError
                          ? 'Couldn’t check upcoming slots.'
                          : `${slotCount} bookable slot${slotCount === 1 ? '' : 's'} in the next 10 days`}
                </Text>
              </View>
              <ScheduleEditor locationId={id} marketId={marketId} />
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginBottom: 6 },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
  },
  fieldLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  inlineRow: { flexDirection: 'row', gap: 12 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  privacyNote: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.primary, marginBottom: 10, lineHeight: 17 },
  helpText: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 17 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  switchLabel: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.text },
  switchHelp: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  pendingCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 14,
    padding: 14,
  },
  pendingTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  pendingBody: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  slotSummary: {
    backgroundColor: Colors.primary + '0D',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  slotSummaryText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.primary, lineHeight: 18 },
});
