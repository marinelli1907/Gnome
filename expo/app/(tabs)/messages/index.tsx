import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { MessageCircle, Clock, CheckCircle, MapPin, Truck } from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import { Conversation } from '@/types';
import Colors from '@/constants/colors';

function timeAgo(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { conversations, orders } = useApp();

  const getOrderForConversation = useCallback((conv: Conversation) => {
    if (!conv.listing) return null;
    return orders.find(o =>
      o.listing.id === conv.listing?.id &&
      (o.buyer.id === conv.otherUser.id || o.seller.id === conv.otherUser.id) &&
      !['completed', 'canceled'].includes(o.status)
    );
  }, [orders]);

  const renderConversation = useCallback(({ item }: { item: Conversation }) => {
    const hasUnread = item.unreadCount > 0;
    const relatedOrder = getOrderForConversation(item);
    const orderStatusConfig: Record<string, { label: string; color: string; icon: React.ComponentType<{ size: number; color: string }> }> = {
      awaiting_response: { label: 'Awaiting Response', color: Colors.promoted, icon: Clock },
      accepted: { label: 'Accepted', color: Colors.info, icon: CheckCircle },
      ready_for_pickup: { label: 'Ready for Pickup', color: Colors.freshGreen, icon: MapPin },
      out_for_delivery: { label: 'Out for Delivery', color: Colors.info, icon: Truck },
    };
    const orderConfig = relatedOrder ? orderStatusConfig[relatedOrder.status] : null;

    return (
      <Pressable
        style={styles.conversationRow}
        onPress={() => router.push(`/chat/${item.id}`)}
      >
        <View style={styles.avatarContainer}>
          <Image
            source={{ uri: item.otherUser.avatar }}
            style={styles.avatar}
            contentFit="cover"
          />
          {hasUnread && <View style={styles.unreadDot} />}
        </View>
        <View style={styles.conversationContent}>
          <View style={styles.conversationTop}>
            <Text style={[styles.userName, hasUnread && styles.userNameUnread]} numberOfLines={1}>
              {item.otherUser.name}
            </Text>
            <Text style={[styles.timeText, hasUnread && styles.timeTextUnread]}>
              {timeAgo(item.lastMessage.timestamp)}
            </Text>
          </View>
          {item.listing && (
            <View style={styles.listingRef}>
              <View style={styles.listingDot} />
              <Text style={styles.listingRefText} numberOfLines={1}>{item.listing.title}</Text>
            </View>
          )}
          {relatedOrder && orderConfig && (
            <View style={[styles.orderContext, { backgroundColor: orderConfig.color + '10' }]}>
              <orderConfig.icon size={10} color={orderConfig.color} />
              <Text style={[styles.orderContextText, { color: orderConfig.color }]}>{orderConfig.label}</Text>
            </View>
          )}
          <Text style={[styles.lastMessage, hasUnread && styles.lastMessageUnread]} numberOfLines={2}>
            {item.lastMessage.senderId === 'current-user' ? 'You: ' : ''}{item.lastMessage.text}
          </Text>
        </View>
        {hasUnread && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
          </View>
        )}
      </Pressable>
    );
  }, [router, getOrderForConversation]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={item => item.id}
        renderItem={renderConversation}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <MessageCircle size={40} color={Colors.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>Start a conversation by messaging a seller about their listing</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
  },
  listContent: {
    paddingBottom: 100,
  },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  unreadDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.background,
  },
  conversationContent: {
    flex: 1,
  },
  conversationTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
  },
  userNameUnread: {
    fontWeight: '700',
  },
  timeText: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginLeft: 8,
  },
  timeTextUnread: {
    color: Colors.primary,
    fontWeight: '600',
  },
  listingRef: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  listingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.secondary,
  },
  listingRefText: {
    fontSize: 12,
    color: Colors.secondary,
    fontWeight: '500',
  },
  lastMessage: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  lastMessageUnread: {
    color: Colors.text,
    fontWeight: '500',
  },
  unreadBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: Colors.textInverse,
    fontSize: 11,
    fontWeight: '700',
  },
  separator: {
    height: 1,
    backgroundColor: Colors.divider,
    marginLeft: 86,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  orderContext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 3,
  },
  orderContextText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
});
