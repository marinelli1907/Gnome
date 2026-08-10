// Browse distance control: nonlinear slider (fine near home, broad far away),
// a numeric field that preserves EXACT typed values (37 stays 37 — the slider
// thumb just snaps to the nearest detent visually), quick shortcuts, and
// 'Anywhere' as a distinct state — never a magic number.
import React, { useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import {
  MAX_BROWSE_RADIUS,
  RADIUS_DETENTS,
  RADIUS_SHORTCUTS,
  radiusLabel,
  type BrowseRadius,
} from '@/lib/location';

function nearestDetentIndex(miles: number): number {
  let best = 0;
  let bestDiff = Infinity;
  RADIUS_DETENTS.forEach((d, i) => {
    const diff = Math.abs(d - miles);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

function DetentSlider({
  miles,
  onChange,
}: {
  miles: number;
  onChange: (m: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const idx = nearestDetentIndex(miles);
  const frac = RADIUS_DETENTS.length > 1 ? idx / (RADIUS_DETENTS.length - 1) : 0;

  const indexFromX = (x: number) => {
    const w = trackWidthRef.current;
    if (w <= 0) return 0;
    const f = Math.min(1, Math.max(0, x / w));
    return Math.round(f * (RADIUS_DETENTS.length - 1));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => onChange(RADIUS_DETENTS[indexFromX(e.nativeEvent.locationX)]),
      onPanResponderMove: (e) => onChange(RADIUS_DETENTS[indexFromX(e.nativeEvent.locationX)]),
    }),
  ).current;

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="Distance"
      accessibilityValue={{ text: `${miles} miles` }}
      accessibilityActions={[
        { name: 'increment', label: 'Increase distance' },
        { name: 'decrement', label: 'Decrease distance' },
      ]}
      onAccessibilityAction={(e) => {
        const i = nearestDetentIndex(miles);
        if (e.nativeEvent.actionName === 'increment' && i < RADIUS_DETENTS.length - 1) {
          onChange(RADIUS_DETENTS[i + 1]);
        }
        if (e.nativeEvent.actionName === 'decrement' && i > 0) {
          onChange(RADIUS_DETENTS[i - 1]);
        }
      }}
      style={styles.sliderHit}
      {...pan.panHandlers}
    >
      <View
        style={styles.track}
        onLayout={(e) => {
          setTrackWidth(e.nativeEvent.layout.width);
          trackWidthRef.current = e.nativeEvent.layout.width;
        }}
      >
        <View style={[styles.trackFill, { width: Math.max(0, frac * trackWidth) }]} />
        {RADIUS_DETENTS.map((d, i) => (
          <View
            key={d}
            style={[
              styles.tick,
              { left: (i / (RADIUS_DETENTS.length - 1)) * Math.max(0, trackWidth - 2) },
              i <= idx && styles.tickActive,
            ]}
          />
        ))}
        <View style={[styles.thumb, { left: Math.max(0, frac * trackWidth - 14) }]} />
      </View>
    </View>
  );
}

export default function DistancePicker({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: BrowseRadius;
  onApply: (r: BrowseRadius) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [anywhere, setAnywhere] = useState(value === 'anywhere');
  const [text, setText] = useState(value === 'anywhere' ? '25' : String(value));
  const [error, setError] = useState<string | null>(null);

  // Re-seed each time the sheet opens with a different applied value.
  const [seededFor, setSeededFor] = useState<BrowseRadius | null>(null);
  if (visible && seededFor !== value) {
    setSeededFor(value);
    setAnywhere(value === 'anywhere');
    setText(value === 'anywhere' ? '25' : String(value));
    setError(null);
  }

  const miles = (() => {
    const n = Number(text);
    return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_BROWSE_RADIUS) : 25;
  })();

  const validate = (): BrowseRadius | null => {
    if (anywhere) return 'anywhere';
    const n = Number(text.trim());
    if (!text.trim() || !Number.isFinite(n)) {
      setError('Enter a distance in miles.');
      return null;
    }
    if (n < 1) {
      // 0 must never silently mean Anywhere — that's an explicit choice.
      setError('Distance must be at least 1 mile. Use “Anywhere” for no limit.');
      return null;
    }
    if (n > MAX_BROWSE_RADIUS) {
      setError(`Maximum is ${MAX_BROWSE_RADIUS} miles. Use “Anywhere” for no limit.`);
      return null;
    }
    return Math.round(n);
  };

  const apply = () => {
    const r = validate();
    if (r == null) return;
    onApply(r);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Distance</Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close distance filter"
            style={styles.closeBtn}
          >
            <X size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.body}>
          {/* Quick shortcuts (shortcuts only — the slider/input remain) */}
          <View style={styles.chipWrap}>
            {RADIUS_SHORTCUTS.map((s) => {
              const active = anywhere ? s === 'anywhere' : s === miles && !anywhere;
              return (
                <Pressable
                  key={String(s)}
                  onPress={() => {
                    setError(null);
                    if (s === 'anywhere') setAnywhere(true);
                    else {
                      setAnywhere(false);
                      setText(String(s));
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  hitSlop={4}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {s === 'anywhere' ? 'Anywhere' : `${s} mi`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {!anywhere ? (
            <>
              <DetentSlider
                miles={miles}
                onChange={(m) => {
                  setError(null);
                  setText(String(m));
                }}
              />
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Within</Text>
                <TextInput
                  style={styles.input}
                  value={text}
                  onChangeText={(t) => {
                    setError(null);
                    setText(t.replace(/[^0-9]/g, ''));
                  }}
                  onBlur={() => void validate()}
                  keyboardType="number-pad"
                  maxLength={3}
                  accessibilityLabel="Within miles, numeric text field"
                  placeholder="miles"
                  placeholderTextColor={Colors.textTertiary}
                />
                <Text style={styles.inputLabel}>miles</Text>
              </View>
            </>
          ) : (
            <Text style={styles.anywhereNote}>
              No distance limit — newest listings from everywhere, sorted by
              distance when your location is available.
            </Text>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button label={anywhere ? 'Show listings from anywhere' : `Apply — within ${miles} miles`} onPress={apply} style={{ marginTop: 16 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.background },
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
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: {
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  sliderHit: { height: 44, justifyContent: 'center' },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  tick: {
    position: 'absolute',
    top: 1,
    width: 2,
    height: 4,
    borderRadius: 1,
    backgroundColor: Colors.surface,
  },
  tickActive: { backgroundColor: Colors.primary + '55' },
  thumb: {
    position: 'absolute',
    top: -11,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    borderWidth: 3,
    borderColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  inputLabel: { fontSize: 15, fontFamily: fonts.semibold, color: Colors.text },
  input: {
    minWidth: 84,
    textAlign: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: Colors.text,
    fontFamily: fonts.bold,
  },
  anywhereNote: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  error: { marginTop: 12, fontSize: 13, fontFamily: fonts.semibold, color: Colors.error },
});
