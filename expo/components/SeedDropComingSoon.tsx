// Seed Drop is announced, not sold. Nothing here may lead to a purchase,
// subscription, reservation or waitlist — there is no price and no date to
// promise yet, so the sizes and frequencies below are inert previews of what a
// drop will look like once it ships.
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';

const DROP_SIZES: { name: string; detail: string }[] = [
  { name: 'Patio', detail: '4 varieties' },
  { name: 'Garden', detail: '8 varieties' },
  { name: 'Homestead', detail: '12 varieties' },
  { name: 'Build Your Drop', detail: '4–20 varieties' },
];

const FREQUENCIES: string[] = ['Monthly', 'Every other month', 'Seasonal', 'One-time'];

export default function SeedDropComingSoon({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Seed Drop</Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close Seed Drop preview"
            style={styles.closeBtn}
          >
            <X size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.hero}>
            <Text style={styles.heroEmoji}>🌱</Text>
            <Text style={styles.heroTitle}>Seed Drop is growing 🌱</Text>
            <Text style={styles.heroText}>
              Personalized seed selections based on your location, growing space and season
              are coming soon.
            </Text>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Drop sizes</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>Preview — not yet available</Text>
              </View>
            </View>
            {DROP_SIZES.map((d) => (
              <View key={d.name} style={styles.row}>
                <Text style={styles.rowName}>{d.name}</Text>
                <Text style={styles.rowDetail}>{d.detail}</Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>How often</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>Preview — not yet available</Text>
              </View>
            </View>
            <View style={styles.freqWrap}>
              {FREQUENCIES.map((f) => (
                <View key={f} style={styles.freqChip}>
                  <Text style={styles.freqText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={styles.footnote}>
            Nothing here is for sale yet — there is no pricing, and no way to order or
            subscribe. We will announce Seed Drop in the app when it is ready.
          </Text>

          <Button label="Close" variant="secondary" onPress={onClose} style={{ marginTop: 20 }} />
        </ScrollView>
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
  hero: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  heroEmoji: { fontSize: 40, fontFamily: fonts.regular },
  heroTitle: {
    fontSize: 20,
    fontFamily: fonts.displayBold,
    color: Colors.text,
    textAlign: 'center',
  },
  heroText: {
    fontSize: 14.5,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  section: { marginTop: 24 },
  sectionHead: { gap: 6, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.gold + '26',
  },
  pillText: { fontSize: 12, fontFamily: fonts.bold, color: Colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowName: { fontSize: 15, fontFamily: fonts.semibold, color: Colors.text },
  rowDetail: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary },
  freqWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  freqChip: {
    paddingHorizontal: 14,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  freqText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  footnote: {
    marginTop: 24,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
});
