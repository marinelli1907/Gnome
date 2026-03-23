import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  UserPlus, Heart, ShoppingBag, CheckCircle, MapPin, Clock,
  Megaphone, Bell, AlertTriangle, Star, Package, CheckCheck,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import { AppNotification, NotificationType } from '@/types';
import Colors from '@/constants/colors';

const notifIconMap: Record<NotificationType, { icon: React.ComponentType<{ size: number; color: string }>; color: string; bg: string }> = {
  follow: { icon: UserPlus, color: Colors.info, bg: Colors.info + '15' },
  save: { icon: Heart, color: Colors.accent, bg: Colors.accent + '15' },
  order_request: { icon: ShoppingBag, color: Colors.promoted, bg: Colors.promoted + '15' },
  order_accepted: { icon: CheckCircle, color: Colors.freshGreen, bg: Colors.freshGreen + '15' },
  order_ready: { icon: MapPin, color: Colors.primary, bg: Colors.primary + '15' },
  order_completed: { icon: Package, color: Colors.primary, bg: Colors.primary + '15' },
  promo_ending: { icon: Clock, color: Colors.urgentOrange, bg: Colors.urgentOrange + '15' },
  new_listing: { icon: Megaphone, color: Colors.info, bg: Colors.info + '15' },
  low_inventory: { icon: AlertTriangle, color: Colors.urgentOrange, bg: Colors.urgentOrange + '15' },
  item_sold: { icon: Star, color: Colors.freshGreen, bg: Colors.freshGreen + '15' },
  review_received: { icon: Star, color: Colors.secondaryLight, bg: Colors.secondaryLight + '15' },
};

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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function NotificationCard({ notification, onPress }: { notification: AppNotification; onPress: () => void }) {
  const config = notifIconMap[notification.type];
  const IconComp = config.icon;

  return (
    <Pressable
      style={[styles.notifCard, !notification.read && styles.notifCardUnread]}
      onPress={onPress}
    >
      <View style={styles.notifLeft}>
        {notification.avatar ? (
          <View style={styles.notifAvatarWrap}>
            <Image source={{ uri: notification.avatar }} style={styles.notifAvatar} contentFit="cover" />
            <View style={[styles.notifIconOverlay, { backgroundColor: config.bg }]}>
              <IconComp size={10} color={config.color} />
            </View>
          </View>
        ) : (
          <View style={[styles.notifIconCircle, { backgroundColor: config.bg }]}>
            <IconComp size={18} color={config.color} />
          </View>
        )}
      </View>
      <View style={styles.notifContent}>
        <View style={styles.notifTopRow}>
          <Text style={[styles.notifTitle, !notification.read && styles.notifTitleUnread]} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.notifTime}>{timeAgo(notification.createdAt)}</Text>
        </View>
        <Text style={styles.notifBody} numberOfLines={2}>{notification.body}</Text>
      </View>
      {notification.listingImage && (
        <Image source={{ uri: notification.listingImage }} style={styles.notifListingImage} contentFit="cover" />
      )}
      {!notification.read && <View style={styles.unreadDot} />}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications, markNotificationRead, markAllNotificationsRead, unreadNotifCount } = useApp();

  const handlePress = useCallback((notification: AppNotification) => {
    markNotificationRead(notification.id);
    if (notification.actionUrl) {
      router.push(notification.actionUrl as any);
    }
  }, [markNotificationRead, router]);

  const renderNotification = useCallback(({ item }: { item: AppNotification }) => (
    <NotificationCard notification={item} onPress={() => handlePress(item)} />
  ), [handlePress]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerRight: () => unreadNotifCount > 0 ? (
            <Pressable onPress={markAllNotificationsRead} style={styles.markAllBtn}>
              <CheckCheck size={18} color={Colors.primary} />
            </Pressable>
          ) : null,
        }}
      />
      <View style={styles.container}>
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          renderItem={renderNotification}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Bell size={40} color={Colors.textTertiary} />
              </View>
              <Text style={styles.emptyTitle}>No notifications</Text>
              <Text style={styles.emptyText}>You're all caught up!</Text>
            </View>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  markAllBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  listContent: {
    paddingBottom: 40,
  },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  notifCardUnread: {
    backgroundColor: Colors.primary + '06',
  },
  notifLeft: {},
  notifAvatarWrap: {
    position: 'relative',
  },
  notifAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  notifIconOverlay: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.background,
  },
  notifIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifContent: {
    flex: 1,
  },
  notifTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  notifTitleUnread: {
    fontWeight: '700' as const,
  },
  notifTime: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  notifBody: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  notifListingImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  unreadDot: {
    position: 'absolute',
    left: 8,
    top: '50%',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    marginTop: -3,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.divider,
    marginLeft: 76,
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
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
