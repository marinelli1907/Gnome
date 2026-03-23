import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { User, Listing, Conversation, ChatMessage, Order, AppNotification, SellerReview, OrderStatus } from '@/types';
import { currentUser } from '@/mocks/users';
import { mockListings } from '@/mocks/listings';
import { mockConversations } from '@/mocks/conversations';
import { mockOrders, mockNotifications, mockReviews } from '@/mocks/orders';

const LISTINGS_KEY = 'gnome_listings';
const WISHLIST_KEY = 'gnome_wishlist';
const FOLLOWED_SELLERS_KEY = 'gnome_followed_sellers';
const _ORDERS_KEY = 'gnome_orders';
const _NOTIFICATIONS_KEY = 'gnome_notifications';

export const [AppProvider, useApp] = createContextHook(() => {
  const [user, setUser] = useState<User>(currentUser);
  const [listings, setListings] = useState<Listing[]>(mockListings);
  const [conversations, setConversations] = useState<Conversation[]>(mockConversations);
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const [followedSellerIds, setFollowedSellerIds] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>(mockOrders);
  const [notifications, setNotifications] = useState<AppNotification[]>(mockNotifications);
  const [reviews] = useState<SellerReview[]>(mockReviews);
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hi there! 🌱 I'm your garden assistant. Ask me anything about growing plants, identifying pests, or diagnosing plant problems. You can also share a photo of your plants and I'll help diagnose any issues!",
      timestamp: new Date().toISOString(),
    },
  ]);

  const listingsQuery = useQuery({
    queryKey: ['listings'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(LISTINGS_KEY);
      return stored ? JSON.parse(stored) as Listing[] : mockListings;
    },
  });

  const wishlistQuery = useQuery({
    queryKey: ['wishlist'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(WISHLIST_KEY);
      return stored ? JSON.parse(stored) as string[] : [];
    },
  });

  const followedQuery = useQuery({
    queryKey: ['followedSellers'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(FOLLOWED_SELLERS_KEY);
      return stored ? JSON.parse(stored) as string[] : [];
    },
  });

  useEffect(() => {
    if (listingsQuery.data) {
      setListings(listingsQuery.data);
    }
  }, [listingsQuery.data]);

  useEffect(() => {
    if (wishlistQuery.data) {
      setWishlistIds(wishlistQuery.data);
    }
  }, [wishlistQuery.data]);

  useEffect(() => {
    if (followedQuery.data) {
      setFollowedSellerIds(followedQuery.data);
    }
  }, [followedQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (updated: Listing[]) => {
      await AsyncStorage.setItem(LISTINGS_KEY, JSON.stringify(updated));
      return updated;
    },
  });

  const saveWishlistMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await AsyncStorage.setItem(WISHLIST_KEY, JSON.stringify(ids));
      return ids;
    },
  });

  const saveFollowedMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await AsyncStorage.setItem(FOLLOWED_SELLERS_KEY, JSON.stringify(ids));
      return ids;
    },
  });

  const addListing = useCallback((listing: Listing) => {
    const updated = [listing, ...listings];
    setListings(updated);
    saveMutation.mutate(updated);
  }, [listings, saveMutation]);

  const updateListingStatus = useCallback((listingId: string, status: Listing['status']) => {
    const updated = listings.map(l => l.id === listingId ? { ...l, status } : l);
    setListings(updated);
    saveMutation.mutate(updated);
  }, [listings, saveMutation]);

  const toggleWishlist = useCallback((listingId: string) => {
    const updated = wishlistIds.includes(listingId)
      ? wishlistIds.filter(id => id !== listingId)
      : [...wishlistIds, listingId];
    setWishlistIds(updated);
    saveWishlistMutation.mutate(updated);
  }, [wishlistIds, saveWishlistMutation]);

  const isInWishlist = useCallback((listingId: string) => {
    return wishlistIds.includes(listingId);
  }, [wishlistIds]);

  const toggleFollowSeller = useCallback((sellerId: string) => {
    const updated = followedSellerIds.includes(sellerId)
      ? followedSellerIds.filter(id => id !== sellerId)
      : [...followedSellerIds, sellerId];
    setFollowedSellerIds(updated);
    saveFollowedMutation.mutate(updated);
  }, [followedSellerIds, saveFollowedMutation]);

  const isFollowingSeller = useCallback((sellerId: string) => {
    return followedSellerIds.includes(sellerId);
  }, [followedSellerIds]);

  const addAiMessage = useCallback((message: ChatMessage) => {
    setAiMessages(prev => [...prev, message]);
  }, []);

  const updateOrderStatus = useCallback((orderId: string, status: OrderStatus) => {
    const updated = orders.map(o => o.id === orderId ? { ...o, status, updatedAt: new Date().toISOString() } : o);
    setOrders(updated);
  }, [orders]);

  const addOrder = useCallback((order: Order) => {
    setOrders(prev => [order, ...prev]);
  }, []);

  const markNotificationRead = useCallback((notifId: string) => {
    setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, read: true } : n));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const unreadNotifCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const buyerOrders = useMemo(() =>
    orders.filter(o => o.buyer.id === user.id || o.buyer.id === 'current-user'),
  [orders, user.id]);

  const sellerOrders = useMemo(() =>
    orders.filter(o => o.seller.id === user.id || o.seller.id === 'current-user'),
  [orders, user.id]);

  const getOrderForListing = useCallback((listingId: string) => {
    return orders.find(o =>
      o.listing.id === listingId &&
      (o.buyer.id === user.id || o.buyer.id === 'current-user') &&
      !['completed', 'canceled'].includes(o.status)
    );
  }, [orders, user.id]);

  const getReviewsForSeller = useCallback((sellerId: string) => {
    return reviews.filter(r => r.seller.id === sellerId);
  }, [reviews]);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => ({ ...prev, ...updates }));
  }, []);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return useMemo(() => ({
    user,
    listings,
    conversations,
    setConversations,
    aiMessages,
    addAiMessage,
    addListing,
    updateListingStatus,
    totalUnread,
    isLoading: listingsQuery.isLoading,
    wishlistIds,
    toggleWishlist,
    isInWishlist,
    followedSellerIds,
    toggleFollowSeller,
    isFollowingSeller,
    orders,
    buyerOrders,
    sellerOrders,
    addOrder,
    updateOrderStatus,
    getOrderForListing,
    notifications,
    unreadNotifCount,
    markNotificationRead,
    markAllNotificationsRead,
    reviews,
    getReviewsForSeller,
    updateUser,
  }), [user, listings, conversations, setConversations, aiMessages, addAiMessage, addListing, updateListingStatus, totalUnread, listingsQuery.isLoading, wishlistIds, toggleWishlist, isInWishlist, followedSellerIds, toggleFollowSeller, isFollowingSeller, orders, buyerOrders, sellerOrders, addOrder, updateOrderStatus, getOrderForListing, notifications, unreadNotifCount, markNotificationRead, markAllNotificationsRead, reviews, getReviewsForSeller, updateUser]);
});
