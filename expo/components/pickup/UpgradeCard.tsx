// The amber "your plan stops here" card. Two jobs, one look:
//   • the seller is at their plan's location limit and pressed Add
//   • a location was pushed past the allowance by a downgrade (plan_restricted)
// Nothing is ever deleted in either case, and the card always offers the way
// out rather than dead-ending.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';

const AMBER = '#B45309';

export function UpgradeCard({
  title,
  body,
  compact,
}: {
  title: string;
  body?: string;
  /** Tighter padding for use inside a location card. */
  compact?: boolean;
}) {
  const router = useRouter();
  return (
    <View
      style={[styles.card, compact && styles.compact]}
      accessibilityRole="summary"
      accessibilityLabel={body ? `${title}. ${body}` : title}
    >
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      <Button
        label="View Plans"
        variant="secondary"
        onPress={() => router.push('/upgrade')}
        style={{ marginTop: 10 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AMBER + '11',
    borderColor: AMBER + '55',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  compact: { padding: 12, marginTop: 10 },
  title: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text, lineHeight: 20 },
  body: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
});

export default UpgradeCard;
