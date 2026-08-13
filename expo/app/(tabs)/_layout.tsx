import { Tabs, useRouter, type Href } from 'expo-router';
import { Sprout, Map as MapIcon, PlusCircle, Home, User, Sparkles } from 'lucide-react-native';
import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { registerForPushNotifications } from '@/lib/notifications';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export default function TabLayout() {
  const { userId } = useAuth();
  const router = useRouter();
  const checkedFor = useRef<string | null>(null);

  useEffect(() => {
    if (userId) void registerForPushNotifications(userId);
  }, [userId]);

  // Send a brand-new account through the welcome chat exactly once. Checked
  // per user id, so it never loops and never re-appears after completing or
  // skipping. Any failure here is silent — onboarding must never block the app.
  useEffect(() => {
    if (!userId || !isSupabaseConfigured || checkedFor.current === userId) return;
    checkedFor.current = userId;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('my_onboarding_state');
        if (cancelled || error) return;
        if (data && data.completed === false) router.replace('/onboarding' as Href);
      } catch { /* never block the app on this */ }
    })();
    return () => { cancelled = true; };
  }, [userId, router]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.tabBarActive,
        tabBarInactiveTintColor: Colors.tabBarInactive,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.tabBar,
          borderTopColor: Colors.tabBarBorder,
          borderTopWidth: 1,
          ...(Platform.OS === 'web' ? { height: 60 } : {}),
        },
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.semibold },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Browse',
          tabBarIcon: ({ color, size }) => <Sprout color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }) => <MapIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: 'Post',
          tabBarIcon: ({ color, size }) => <PlusCircle color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: 'Gnome AI',
          tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'My Gnome',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
