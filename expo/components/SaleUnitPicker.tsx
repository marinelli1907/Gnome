import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { OTHER_SALE_UNIT, SALE_UNIT_OPTIONS, saleUnitOption } from '@/lib/saleUnits';

export default function SaleUnitPicker({
  value,
  custom,
  onSelect,
}: {
  value: string;
  custom: boolean;
  onSelect: (value: string, custom: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedValue = custom ? OTHER_SALE_UNIT : value;
  const selectedLabel = custom ? 'Other measurement' : saleUnitOption(value)?.label ?? 'Each / item';

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Sold by</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sold by ${selectedLabel}. Tap to change.`}
        onPress={() => setOpen(true)}
        style={styles.selector}
      >
        <Text style={styles.selectorText}>{selectedLabel}</Text>
        <ChevronDown size={18} color={Colors.textSecondary} />
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>How is it sold?</Text>
              <Text style={styles.subtitle}>Choose what one price covers.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} style={styles.close}>
              <X size={20} color={Colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.options}>
            {[...SALE_UNIT_OPTIONS, { value: OTHER_SALE_UNIT, label: 'Other measurement', singular: '', plural: '' }].map((option) => {
              const selected = option.value === selectedValue;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  onPress={() => {
                    onSelect(option.value === OTHER_SALE_UNIT ? '' : option.value, option.value === OTHER_SALE_UNIT);
                    setOpen(false);
                  }}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                  {selected ? <Check size={19} color={Colors.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8, fontFamily: fonts.semibold },
  selector: {
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorText: { fontSize: 15, color: Colors.text, fontFamily: fonts.semibold },
  sheet: { flex: 1, backgroundColor: Colors.background, paddingTop: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 22, color: Colors.text, fontFamily: fonts.displayBold },
  subtitle: { marginTop: 3, fontSize: 13, color: Colors.textSecondary, fontFamily: fonts.regular },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  options: { padding: 16, paddingBottom: 36 },
  option: {
    minHeight: 50,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  optionSelected: { backgroundColor: Colors.primary + '0D' },
  optionText: { fontSize: 16, color: Colors.text, fontFamily: fonts.regular },
  optionTextSelected: { color: Colors.primary, fontFamily: fonts.bold },
});
