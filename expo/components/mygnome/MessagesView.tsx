import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { isUnread } from '@/lib/chatReads';
import type { ChatSummary } from '@/types';

export default function MessagesView({
  uid,
  chats,
  reads,
}: {
  uid: string;
  chats: ChatSummary[];
  reads: Record<string, number>;
}) {
  const router = useRouter();

  if (chats.length === 0) {
    return (
      <EmptyState
        emoji="💬"
        title="No messages yet"
        subtitle="Once a claim is approved, you and the other neighbor can chat here to sort out pickup."
      />
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {chats.map((c) => {
        const unread = isUnread(c, uid, reads);
        return (
          <Pressable key={c.claimId} style={styles.row} onPress={() => router.push(`/chat/${c.claimId}`)}>
            <Avatar name={c.otherName} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, unread && styles.bold]} numberOfLines={1}>
                {c.otherName}
              </Text>
              <Text style={styles.listing} numberOfLines={1}>{c.listingTitle}</Text>
              <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
                {c.lastBody
                  ? `${c.lastSenderId === uid ? 'You: ' : ''}${c.lastBody}`
                  : 'No messages yet — say hi about the pickup.'}
              </Text>
            </View>
            {unread && <View style={styles.dot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  name: { fontSize: 15, color: Colors.text, fontFamily: fonts.semibold },
  bold: {  fontFamily: fonts.bold },
  listing: { fontSize: 12, color: Colors.textSecondary, marginTop: 1, fontFamily: fonts.regular },
  preview: { fontSize: 13, color: Colors.textTertiary, marginTop: 2, fontFamily: fonts.regular },
  previewUnread: { color: Colors.text, fontFamily: fonts.semibold },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
});
