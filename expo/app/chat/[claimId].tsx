import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send, ShieldAlert } from 'lucide-react-native';
import { EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import {
  useClaimMessages,
  useClaimMessagesRealtime,
  useClaimThread,
  useReport,
  useSendMessage,
} from '@/lib/db';
import { markChatRead } from '@/lib/chatReads';
import PayMethodsList from '@/components/orders/PayMethods';
import type { ClaimMessage } from '@/types';

const RATE_LIMIT_MS = 2000; // client-side: 1 message / 2 seconds
const MAX_LEN = 500;

export default function PickupChatScreen() {
  const { claimId } = useLocalSearchParams<{ claimId: string }>();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const thread = useClaimThread(claimId);
  const messages = useClaimMessages(claimId);
  useClaimMessagesRealtime(claimId); // live updates; polling is the fallback
  const send = useSendMessage(claimId, userId ?? undefined);
  const report = useReport(userId ?? undefined);

  const [text, setText] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const lastSentAt = useRef(0);

  // Mark this chat read locally when opened and as new messages arrive.
  const msgCount = messages.data?.length ?? 0;
  useEffect(() => {
    if (claimId) void markChatRead(claimId);
  }, [claimId, msgCount]);

  const claim = thread.data;
  const status = claim?.status;
  const isParty =
    !!userId &&
    !!claim &&
    (userId === claim.claimer_id || userId === claim.listing?.owner_id);
  const canWrite = status === 'approved' && isParty;
  const otherName =
    claim?.listing?.owner_id === userId
      ? claim?.claimer?.name ?? 'your neighbor'
      : claim?.listing?.owner?.name ?? 'the owner';

  if (thread.isLoading) {
    return <View style={styles.screen} />;
  }
  if (!claim || !isParty) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🔒"
          title="Not available"
          subtitle="This pickup conversation is only visible to the two people involved."
        />
      </View>
    );
  }

  const onSend = () => {
    const body = text.trim();
    if (!body) return;
    if (body.length > MAX_LEN) {
      Alert.alert('Too long', `Messages are limited to ${MAX_LEN} characters.`);
      return;
    }
    const now = Date.now();
    if (now - lastSentAt.current < RATE_LIMIT_MS) {
      return; // silently throttle rapid taps
    }
    lastSentAt.current = now;
    setText('');
    send.mutate(body, {
      onError: (e: any) => {
        setText(body); // restore on failure
        const raw = e?.message ?? '';
        const msg = /BLOCKED_USER/i.test(raw)
          ? 'You can no longer message this neighbor.'
          : raw || 'Try again.';
        Alert.alert('Could not send', msg);
      },
    });
  };

  const onReport = () => {
    Alert.alert(
      'Report conversation',
      'Flag this conversation for review? This stores a report; the other person is not notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: () =>
            report.mutate(
              { targetType: 'claim', targetId: claimId, reason: '' },
              {
                onSuccess: () => Alert.alert('Thanks', 'This conversation has been reported.'),
                onError: (e: any) => Alert.alert('Error', e?.message ?? 'Try again.'),
              },
            ),
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: ClaimMessage }) => {
    const mine = item.sender_id === userId;
    const isUpdate = item.kind === 'update'; // grower growth update on a plot reservation
    return (
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            isUpdate && styles.bubbleUpdate,
          ]}
        >
          {isUpdate ? <Text style={styles.updateTag}>🌱 Growth update</Text> : null}
          {item.photo_url ? (
            <Image source={{ uri: item.photo_url }} style={styles.updatePhoto} contentFit="cover" />
          ) : null}
          {item.body ? (
            <Text style={[styles.bubbleText, mine && !isUpdate && styles.bubbleTextMine]}>
              {item.body}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={messages.data ?? []}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyHint}>
            Say hi to {otherName} and sort out the pickup details.
          </Text>
        }
      />

      {/* Outside-Gnome payment shortcut for the buyer on a priced exchange. */}
      {status === 'approved' &&
      userId === claim.claimer_id &&
      (claim.listing?.listing_type === 'sale' || claim.listing?.listing_type === 'plot') &&
      claim.listing?.market_id ? (
        <View style={styles.payWrap}>
          <Pressable
            onPress={() => setPayOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={payOpen ? 'Hide payment options' : 'Show payment options'}
            accessibilityState={{ expanded: payOpen }}
            style={styles.payToggle}
          >
            <Text style={styles.payToggleText}>💸 Pay seller</Text>
            <Text style={styles.payChevron}>{payOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {payOpen ? (
            <View style={styles.payBody}>
              <PayMethodsList
                marketId={claim.listing.market_id}
                amountCents={claim.agreed_price_cents ?? claim.listing.price_cents}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.guidanceRow}>
          <Text style={styles.guidance}>
            For pickup details only. Don&apos;t share financial info or sensitive personal information.
          </Text>
          <Pressable onPress={onReport} hitSlop={8} style={styles.reportBtn}>
            <ShieldAlert size={16} color={Colors.error} />
            <Text style={styles.reportText}>Report</Text>
          </Pressable>
        </View>

        {canWrite ? (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Message about pickup…"
              placeholderTextColor={Colors.textTertiary}
              multiline
              maxLength={MAX_LEN}
            />
            <Pressable
              style={[styles.sendBtn, (!text.trim() || send.isPending) && styles.sendBtnDisabled]}
              onPress={onSend}
              disabled={!text.trim() || send.isPending}
            >
              <Send size={20} color={Colors.textInverse} />
            </Pressable>
          </View>
        ) : (
          <Text style={styles.closedNote}>
            {status === 'completed'
              ? 'This pickup is complete — history only.'
              : 'This conversation is closed.'}
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  list: { padding: 14, paddingBottom: 20, gap: 8 },
  emptyHint: { textAlign: 'center', color: Colors.textSecondary, marginTop: 40, paddingHorizontal: 24 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16 },
  bubbleMine: { backgroundColor: Colors.chatBubbleUser, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.chatBubbleAI, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: Colors.chatBubbleAIText, lineHeight: 20, fontFamily: fonts.regular },
  bubbleTextMine: { color: Colors.chatBubbleUserText },
  bubbleUpdate: {
    backgroundColor: Colors.goldLight,
    borderWidth: 1,
    borderColor: Colors.gold,
    gap: 6,
  },
  updateTag: { fontSize: 12, color: Colors.primary, fontFamily: fonts.bold },
  updatePhoto: { width: 220, height: 160, borderRadius: 10, backgroundColor: Colors.backgroundSecondary },
  footer: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  guidanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  guidance: { flex: 1, fontSize: 11, color: Colors.textTertiary, lineHeight: 15, fontFamily: fonts.regular },
  reportBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  reportText: { fontSize: 12, color: Colors.error, fontFamily: fonts.semibold },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1,
    maxHeight: 110,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: Colors.text, fontFamily: fonts.regular },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  closedNote: { textAlign: 'center',
    color: Colors.textSecondary,
    fontSize: 14,
    paddingVertical: 12, fontFamily: fonts.regular },
  payWrap: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingHorizontal: 12,
  },
  payToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  payToggleText: { fontSize: 13.5, fontFamily: fonts.bold, color: Colors.primary },
  payChevron: { fontSize: 13, color: Colors.primary, fontFamily: fonts.bold },
  payBody: { paddingBottom: 10 },
});
