import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import type { MarketReputation } from '@/types';

function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// Objective, derived reputation — no reviews or stars.
export default function Reputation({ rep, compact }: { rep: MarketReputation; compact?: boolean }) {
  const since = monthYear(rep.member_since);

  if (compact) {
    const bits: string[] = [];
    if (since) bits.push(`Since ${since}`);
    if (rep.verified_email) bits.push('✓ email verified');
    if (rep.listings_shared) bits.push(`${rep.listings_shared} shared`);
    if (rep.response_rate != null) bits.push(`responds ${rep.response_rate}% in 2 days`);
    if (bits.length === 0) return null;
    return <Text style={styles.compact}>{bits.join(' · ')}</Text>;
  }

  return (
    <View style={styles.block}>
      <View style={styles.stats}>
        <Stat emoji="🧺" n={rep.listings_shared} label="Shared" />
        <Stat emoji="🏷️" n={rep.listings_sold} label="Sold" />
        <Stat emoji="🔄" n={rep.trades_completed} label="Traded" />
      </View>
      {rep.response_rate != null ? (
        <Text style={styles.resp}>↩︎ Responds to {rep.response_rate}% of requests within 2 days</Text>
      ) : null}
      {rep.verified_email ? <Text style={styles.verified}>✉️ Email verified</Text> : null}
      {since ? <Text style={styles.since}>🌱 Member since {since}</Text> : null}
    </View>
  );
}

function Stat({ emoji, n, label }: { emoji: string; n: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statEmoji}>{emoji}</Text>
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: { fontSize: 12, fontFamily: fonts.medium, color: Colors.textSecondary },
  block: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 10,
  },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statEmoji: { fontSize: 18, fontFamily: fonts.regular },
  statN: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text },
  statLabel: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary },
  resp: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.primary, textAlign: 'center' },
  verified: { fontSize: 12, fontFamily: fonts.medium, color: Colors.textSecondary, textAlign: 'center' },
  since: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textTertiary, textAlign: 'center' },
});
