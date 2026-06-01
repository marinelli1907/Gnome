import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { useMyEvents } from '@/lib/db';
import type { GnomeEvent } from '@/types';

// History only — no metrics, counts, or analytics. Community framing
// (Shared / Received / Helped), never sales/orders/revenue.
function describe(ev: GnomeEvent): { emoji: string; text: string } | null {
  const title = (ev.metadata?.title as string) || 'a listing';
  switch (ev.event_type) {
    case 'listing_created':
      return ev.metadata?.kind === 'wanted'
        ? { emoji: '🔎', text: `Posted a want: ${title}` }
        : { emoji: '🧺', text: `Shared ${title}` };
    case 'claim_made':
      return { emoji: '🙌', text: `Claimed ${title}` };
    case 'claim_approved':
      return { emoji: '✅', text: `Approved a neighbor's claim` };
    case 'claim_declined':
      return { emoji: '✋', text: `Declined a claim` };
    case 'listing_completed':
      return { emoji: '🎉', text: `Completed ${title} — shared with a neighbor` };
    case 'wanted_completed':
      return { emoji: '🌟', text: `Marked a want fulfilled: ${title}` };
    case 'wanted_matched':
      return { emoji: '🌱', text: `A nearby offer matched your want` };
    case 'offer_matched_to_want':
      return { emoji: '🤝', text: `Offered to help with a want` };
    case 'claim_message_sent':
      return null; // too noisy for history
    default:
      return { emoji: '•', text: ev.event_type.replace(/_/g, ' ') };
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ActivityFeed({ uid }: { uid: string }) {
  const events = useMyEvents(uid);
  const rows = (events.data ?? [])
    .map((e) => ({ e, d: describe(e) }))
    .filter((x): x is { e: GnomeEvent; d: { emoji: string; text: string } } => x.d !== null);

  if (rows.length === 0) {
    return (
      <EmptyState
        emoji="📜"
        title="No activity yet"
        subtitle="Your sharing history — things you share, claim, and complete — will appear here."
      />
    );
  }

  return (
    <View style={{ gap: 2 }}>
      {rows.map(({ e, d }) => (
        <View key={e.id} style={styles.row}>
          <Text style={styles.emoji}>{d.emoji}</Text>
          <Text style={styles.text}>{d.text}</Text>
          <Text style={styles.when}>{when(e.created_at)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  emoji: { fontSize: 18, width: 24, textAlign: 'center' },
  text: { flex: 1, fontSize: 14, color: Colors.text },
  when: { fontSize: 12, color: Colors.textTertiary },
});
