// Weekly pickup windows + date exceptions for ONE pickup location.
//
// Same interaction model as the old market-wide editor (per-day "+ Add", −/+
// time steppers, a closed-all-day switch on exceptions) — the difference is
// that every row is written with BOTH location_id and market_id, so slots are
// generated per location.
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, ErrorState, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { TimeStepper } from '@/components/pickup/TimeStepper';
import {
  formatMinuteOfDay,
  useAddHour,
  useLocationExceptions,
  useLocationHours,
  useRemoveException,
  useRemoveHour,
  useSaveException,
  WEEKDAY_NAMES,
  type LocationHours,
} from '@/lib/pickuplocations';

export function ScheduleEditor({
  locationId,
  marketId,
}: {
  locationId: string;
  marketId: string;
}) {
  const hours = useLocationHours(locationId);
  const addHour = useAddHour(locationId, marketId);
  const removeHour = useRemoveHour(locationId, marketId);
  const exceptions = useLocationExceptions(locationId);
  const saveException = useSaveException(locationId, marketId);
  const removeException = useRemoveException(locationId);

  const [editDay, setEditDay] = useState<number | null>(null);
  const [winStart, setWinStart] = useState(9 * 60);
  const [winEnd, setWinEnd] = useState(12 * 60);

  const [excDate, setExcDate] = useState('');
  const [excClosed, setExcClosed] = useState(true);
  const [excStart, setExcStart] = useState(9 * 60);
  const [excEnd, setExcEnd] = useState(12 * 60);
  const [excNote, setExcNote] = useState('');

  const submitWindow = async () => {
    if (editDay == null) return;
    if (winEnd <= winStart) {
      Alert.alert('Check the times', 'The end time must be after the start time.');
      return;
    }
    try {
      await addHour.mutateAsync({ weekday: editDay, start_minute: winStart, end_minute: winEnd });
      setEditDay(null);
    } catch (e: any) {
      Alert.alert('Couldn’t add window', e?.message ?? 'Try again.');
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

  const byDay = new Map<number, LocationHours[]>();
  for (const h of hours.data ?? []) {
    const arr = byDay.get(h.weekday) ?? [];
    arr.push(h);
    byDay.set(h.weekday, arr);
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>Weekly pickup hours</Text>
      <Text style={styles.hint}>
        Slots for this location are generated from these windows — nowhere else.
      </Text>

      {hours.isError ? (
        <ErrorState message="Couldn’t load this location’s hours." onRetry={() => hours.refetch()} />
      ) : null}
      {hours.isLoading ? <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} /> : null}

      {WEEKDAY_NAMES.map((name, day) => {
        const wins = byDay.get(day) ?? [];
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
                accessibilityLabel={
                  editing ? `Stop adding a window on ${name}` : `Add a pickup window on ${name}`
                }
                style={styles.tapBtn}
              >
                <Text style={styles.addText}>{editing ? 'Cancel' : '+ Add'}</Text>
              </Pressable>
            </View>
            {wins.length === 0 && !editing ? <Text style={styles.dayEmpty}>No pickup</Text> : null}
            {wins.map((w) => (
              <View key={w.id} style={styles.windowRow}>
                <Text style={styles.windowText}>
                  {formatMinuteOfDay(w.start_minute)} – {formatMinuteOfDay(w.end_minute)}
                </Text>
                <Pressable
                  onPress={() =>
                    removeHour.mutate(w.id, {
                      onError: (e: any) =>
                        Alert.alert('Couldn’t remove', e?.message ?? 'Try again.'),
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${name} window ${formatMinuteOfDay(w.start_minute)} to ${formatMinuteOfDay(w.end_minute)}`}
                  style={styles.tapBtn}
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
                  loading={addHour.isPending}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Days off & exceptions</Text>
      <Text style={styles.hint}>Applies to this location only.</Text>
      {(exceptions.data ?? []).map((e) => (
        <View key={e.id} style={styles.excRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.excDate}>
              {e.date} ·{' '}
              {e.closed
                ? 'Closed'
                : `${formatMinuteOfDay(e.start_minute ?? 0)} – ${formatMinuteOfDay(e.end_minute ?? 0)}`}
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
            style={styles.tapBtn}
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
          <View style={{ marginTop: 8, gap: 6, marginBottom: 8 }}>
            <TimeStepper label="Start" value={excStart} onChange={setExcStart} />
            <TimeStepper label="End" value={excEnd} onChange={setExcEnd} />
          </View>
        ) : null}
        <Field label="Note (optional)" value={excNote} onChangeText={setExcNote} placeholder="Out of town" />
        <Button
          label="Add exception"
          variant="secondary"
          onPress={() => void submitException()}
          loading={saveException.isPending}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginBottom: 4 },
  hint: {
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    marginBottom: 8,
    lineHeight: 17,
  },
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
  tapBtn: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  addText: { fontSize: 13.5, fontFamily: fonts.bold, color: Colors.primary },
  removeText: { fontSize: 13, fontFamily: fonts.bold, color: Colors.error },
  dayEmpty: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textTertiary },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  windowText: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary },
  windowEditor: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 8,
  },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
  },
  fieldLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
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
});

export default ScheduleEditor;
