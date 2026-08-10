// Pickup availability — weekly windows, slot rules, location, the private
// address card, and date exceptions. Server-side slot generation reads all of
// this; the editor just maintains the rows.
import React, { useEffect, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket } from '@/lib/db';
import {
  useAddPickupWindow,
  usePickupExceptions,
  usePickupHours,
  usePickupPrivate,
  usePickupSettings,
  useRemoveException,
  useRemovePickupWindow,
  useSaveException,
  useSavePickupPrivate,
  useSavePickupSettings,
  type PickupHours,
  type PickupSettings,
} from '@/lib/marketops';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SLOT_CHOICES: (15 | 30 | 60)[] = [15, 30, 60];
const LEAD_CHOICES: { label: string; minutes: number }[] = [
  { label: 'None', minutes: 0 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
  { label: '24h', minutes: 1440 },
];
const LOCATION_CHOICES: { key: PickupSettings['location_type']; label: string }[] = [
  { key: 'PRIVATE_RESIDENCE', label: 'Private residence' },
  { key: 'PUBLIC_BUSINESS', label: 'Public farm stand' },
  { key: 'CUSTOM_PICKUP_POINT', label: 'Custom pickup point' },
];

const DEFAULTS: Omit<PickupSettings, 'market_id'> = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  slot_minutes: 30,
  lead_time_minutes: 60,
  max_orders_per_slot: null,
  location_type: 'PRIVATE_RESIDENCE',
  public_address: null,
};

function fmtMin(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
}

/** Simple time control: −30m / +30m steppers, stores minutes since midnight. */
function TimeStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const step = (delta: number) => {
    const next = Math.min(23 * 60 + 30, Math.max(0, value + delta));
    onChange(next);
  };
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable
          onPress={() => step(-30)}
          accessibilityRole="button"
          accessibilityLabel={`${label} 30 minutes earlier`}
          style={styles.stepBtn}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{fmtMin(value)}</Text>
        <Pressable
          onPress={() => step(30)}
          accessibilityRole="button"
          accessibilityLabel={`${label} 30 minutes later`}
          style={styles.stepBtn}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function PickupSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;

  const settings = usePickupSettings(marketId);
  const saveSettings = useSavePickupSettings(marketId);
  const hours = usePickupHours(marketId);
  const addWindow = useAddPickupWindow(marketId);
  const removeWindow = useRemovePickupWindow(marketId);
  const exceptions = usePickupExceptions(marketId);
  const saveException = useSaveException(marketId);
  const removeException = useRemoveException(marketId);
  const priv = usePickupPrivate(marketId, true);
  const savePriv = useSavePickupPrivate(marketId);

  // Which weekday has its "add window" editor open, plus editor state.
  const [editDay, setEditDay] = useState<number | null>(null);
  const [winStart, setWinStart] = useState(9 * 60);
  const [winEnd, setWinEnd] = useState(12 * 60);

  // Max per slot local state (saved via button).
  const [maxPerSlot, setMaxPerSlot] = useState('');
  const [maxSeeded, setMaxSeeded] = useState(false);

  // Public address local state.
  const [pubAddress, setPubAddress] = useState('');
  const [pubSeeded, setPubSeeded] = useState(false);

  // Private card local state.
  const [privAddress, setPrivAddress] = useState('');
  const [privInstructions, setPrivInstructions] = useState('');
  const [privSeeded, setPrivSeeded] = useState(false);

  // Exception form.
  const [excDate, setExcDate] = useState('');
  const [excClosed, setExcClosed] = useState(true);
  const [excStart, setExcStart] = useState(9 * 60);
  const [excEnd, setExcEnd] = useState(12 * 60);
  const [excNote, setExcNote] = useState('');

  const s = settings.data;

  useEffect(() => {
    if (s && !maxSeeded) {
      setMaxPerSlot(s.max_orders_per_slot != null ? String(s.max_orders_per_slot) : '');
      setMaxSeeded(true);
    }
  }, [s, maxSeeded]);
  useEffect(() => {
    if (s && !pubSeeded) {
      setPubAddress(s.public_address ?? '');
      setPubSeeded(true);
    }
  }, [s, pubSeeded]);
  useEffect(() => {
    if (priv.data && !privSeeded) {
      setPrivAddress(priv.data.pickup_address ?? '');
      setPrivInstructions(priv.data.pickup_instructions ?? '');
      setPrivSeeded(true);
    }
  }, [priv.data, privSeeded]);

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔑" title="Sign in" subtitle="Pickup settings belong to your Market.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (market.isLoading || settings.isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (!marketId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🏡" title="No Market yet" subtitle="Post a listing to create your Market first." />
      </View>
    );
  }
  if (settings.isError) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState message="Couldn’t load pickup settings." onRetry={() => settings.refetch()} />
      </View>
    );
  }

  /** Upsert helper: first save merges sensible defaults so the row is complete. */
  const patchSettings = async (patch: Partial<PickupSettings>) => {
    try {
      await saveSettings.mutateAsync(s ? patch : { ...DEFAULTS, ...patch });
    } catch (e: any) {
      Alert.alert('Couldn’t save', e?.message ?? 'Check your connection and try again.');
    }
  };

  if (!s) {
    return (
      <View style={[styles.screen, styles.center, { padding: 24 }]}>
        <EmptyState
          emoji="🧺"
          title="Turn on pickup ordering"
          subtitle="Buyers pick items from your Market and reserve a pickup time you control. You can turn it off any time."
        >
          <Button
            label="Turn on pickup ordering"
            onPress={() => void patchSettings({})}
            loading={saveSettings.isPending}
            style={{ marginTop: 12 }}
          />
        </EmptyState>
      </View>
    );
  }

  const submitWindow = async () => {
    if (editDay == null) return;
    if (winEnd <= winStart) {
      Alert.alert('Check the times', 'The end time must be after the start time.');
      return;
    }
    try {
      await addWindow.mutateAsync({ weekday: editDay, start_minute: winStart, end_minute: winEnd });
      setEditDay(null);
    } catch (e: any) {
      Alert.alert('Couldn’t add window', e?.message ?? 'Try again.');
    }
  };

  const deleteWindow = (id: string) => {
    removeWindow.mutate(id, {
      onError: (e: any) => Alert.alert('Couldn’t remove', e?.message ?? 'Try again.'),
    });
  };

  const saveMax = async () => {
    const trimmed = maxPerSlot.trim();
    if (trimmed === '') {
      await patchSettings({ max_orders_per_slot: null });
      return;
    }
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Check the number', 'Max per slot must be a positive number, or blank for unlimited.');
      return;
    }
    await patchSettings({ max_orders_per_slot: n });
  };

  const savePrivate = async () => {
    try {
      await savePriv.mutateAsync({
        pickup_address: privAddress.trim() || null,
        pickup_instructions: privInstructions.trim() || null,
      });
      Alert.alert('Saved', 'Pickup details updated.');
    } catch (e: any) {
      Alert.alert('Couldn’t save', e?.message ?? 'Try again.');
    }
  };

  const submitException = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(excDate.trim())) {
      Alert.alert('Check the date', 'Use YYYY-MM-DD, like 2026-08-15.');
      return;
    }
    if (!excClosed && excEnd <= excStart) {
      Alert.alert('Check the times', 'The end time must be after the start time.');
      return;
    }
    try {
      await saveException.mutateAsync({
        date: excDate.trim(),
        closed: excClosed,
        start_minute: excClosed ? null : excStart,
        end_minute: excClosed ? null : excEnd,
        note: excNote.trim() || null,
      });
      setExcDate('');
      setExcNote('');
      setExcClosed(true);
    } catch (e: any) {
      Alert.alert('Couldn’t save exception', e?.message ?? 'Try again.');
    }
  };

  const hoursByDay = new Map<number, PickupHours[]>();
  for (const h of hours.data ?? []) {
    const arr = hoursByDay.get(h.weekday) ?? [];
    arr.push(h);
    hoursByDay.set(h.weekday, arr);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Set the weekly windows when buyers can come by. Slots are generated from these hours
          automatically.
        </Text>

        {/* Weekly hours */}
        <Text style={styles.sectionTitle}>Weekly pickup hours</Text>
        {WEEKDAYS.map((name, day) => {
          const wins = hoursByDay.get(day) ?? [];
          const editing = editDay === day;
          return (
            <View key={day} style={styles.dayCard}>
              <View style={styles.dayHead}>
                <Text style={styles.dayName}>{name}</Text>
                <Pressable
                  onPress={() => {
                    setEditDay(editing ? null : day);
                    setWinStart(9 * 60);
                    setWinEnd(12 * 60);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={editing ? `Stop adding a window on ${name}` : `Add a pickup window on ${name}`}
                  style={styles.addBtn}
                >
                  <Text style={styles.addBtnText}>{editing ? 'Cancel' : '+ Add'}</Text>
                </Pressable>
              </View>
              {wins.length === 0 && !editing ? (
                <Text style={styles.dayEmpty}>No pickup</Text>
              ) : null}
              {wins.map((w) => (
                <View key={w.id} style={styles.windowRow}>
                  <Text style={styles.windowText}>
                    {fmtMin(w.start_minute)} – {fmtMin(w.end_minute)}
                  </Text>
                  <Pressable
                    onPress={() => deleteWindow(w.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name} window ${fmtMin(w.start_minute)} to ${fmtMin(w.end_minute)}`}
                    style={styles.removeBtn}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              ))}
              {editing ? (
                <View style={styles.windowEditor}>
                  <TimeStepper label="Start" value={winStart} onChange={setWinStart} />
                  <TimeStepper label="End" value={winEnd} onChange={setWinEnd} />
                  <Button
                    label="Add window"
                    onPress={() => void submitWindow()}
                    loading={addWindow.isPending}
                  />
                </View>
              ) : null}
            </View>
          );
        })}

        {/* Slot rules */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Slot rules</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Slot length</Text>
          <View style={styles.chipRow}>
            {SLOT_CHOICES.map((mins) => {
              const active = s.slot_minutes === mins;
              return (
                <Pressable
                  key={mins}
                  onPress={() => void patchSettings({ slot_minutes: mins })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{mins} min</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Lead time before a slot</Text>
          <View style={styles.chipRow}>
            {LEAD_CHOICES.map((c) => {
              const active = s.lead_time_minutes === c.minutes;
              return (
                <Pressable
                  key={c.minutes}
                  onPress={() => void patchSettings({ lead_time_minutes: c.minutes })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
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
            <Button
              label="Save slot limit"
              variant="secondary"
              onPress={() => void saveMax()}
              loading={saveSettings.isPending}
            />
          </View>
        </View>

        {/* Location */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Pickup location</Text>
        <View style={styles.card}>
          <View style={styles.chipRow}>
            {LOCATION_CHOICES.map((c) => {
              const active = s.location_type === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => void patchSettings({ location_type: c.key })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {s.location_type === 'PUBLIC_BUSINESS' ? (
            <View style={{ marginTop: 12 }}>
              <Field
                label="Public address (shown to everyone)"
                value={pubAddress}
                onChangeText={setPubAddress}
                placeholder="123 Market St, Lyndhurst"
              />
              <Button
                label="Save address"
                variant="secondary"
                onPress={() => void patchSettings({ public_address: pubAddress.trim() || null })}
                loading={saveSettings.isPending}
              />
            </View>
          ) : null}
        </View>

        {/* Private details */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Exact pickup details</Text>
        <View style={styles.card}>
          <Text style={styles.privacyNote}>Only buyers with a confirmed pickup see this.</Text>
          <Field
            label="Exact pickup address"
            value={privAddress}
            onChangeText={setPrivAddress}
            placeholder="123 Maple Ave — side gate"
          />
          <Field
            label="Pickup instructions"
            value={privInstructions}
            onChangeText={setPrivInstructions}
            placeholder="Cooler on the porch, knock twice…"
            multiline
            numberOfLines={2}
            style={styles.multiline}
          />
          <Button label="Save pickup details" onPress={() => void savePrivate()} loading={savePriv.isPending} />
        </View>

        {/* Exceptions */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Days off & exceptions</Text>
        {(exceptions.data ?? []).map((e) => (
          <View key={e.id} style={styles.excRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.excDate}>
                {e.date} · {e.closed ? 'Closed' : `${fmtMin(e.start_minute ?? 0)} – ${fmtMin(e.end_minute ?? 0)}`}
              </Text>
              {e.note ? <Text style={styles.excNote}>{e.note}</Text> : null}
            </View>
            <Pressable
              onPress={() =>
                removeException.mutate(e.id, {
                  onError: (err: any) => Alert.alert('Couldn’t remove', err?.message ?? 'Try again.'),
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Remove exception on ${e.date}`}
              style={styles.removeBtn}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        ))}
        <View style={[styles.card, { marginTop: 8 }]}>
          <Field
            label="Date (YYYY-MM-DD)"
            value={excDate}
            onChangeText={setExcDate}
            placeholder="2026-08-15"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.closedRow}>
            <Text style={styles.fieldLabel}>Closed all day</Text>
            <Switch
              value={excClosed}
              onValueChange={setExcClosed}
              trackColor={{ true: Colors.primary, false: Colors.border }}
              thumbColor={Colors.surfaceElevated}
              accessibilityRole="switch"
              accessibilityLabel={excClosed ? 'Closed all day' : 'Custom hours for this date'}
            />
          </View>
          {!excClosed ? (
            <View style={{ marginTop: 8, gap: 6 }}>
              <TimeStepper label="Start" value={excStart} onChange={setExcStart} />
              <TimeStepper label="End" value={excEnd} onChange={setExcEnd} />
            </View>
          ) : null}
          <Field label="Note (optional)" value={excNote} onChangeText={setExcNote} placeholder="Out of town" />
          <Button label="Add exception" variant="secondary" onPress={() => void submitException()} loading={saveException.isPending} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  intro: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 19, marginBottom: 14 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginBottom: 6 },
  dayCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayName: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  addBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  addBtnText: { fontSize: 13.5, fontFamily: fonts.bold, color: Colors.primary },
  dayEmpty: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textTertiary },
  windowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  windowText: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary },
  removeBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { fontSize: 13, fontFamily: fonts.bold, color: Colors.error },
  windowEditor: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 8,
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperLabel: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  stepperValue: { minWidth: 82, textAlign: 'center', fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 20, fontFamily: fonts.bold, color: Colors.primary, lineHeight: 24 },
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
  privacyNote: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.primary, marginBottom: 10 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  excRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
  excDate: { fontSize: 14, fontFamily: fonts.bold, color: Colors.text },
  excNote: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  closedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
});
