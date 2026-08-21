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
          // D3: 'Gnome AI' was the second-widest label and truncated at
          // Android's Large font setting. 'Ask AI' keeps the meaning.
          title: 'Ask AI',
          // v5 identity: Gnome AI owns purple. This is the ONLY tab that
          // overrides the bar's green active tint — every other tab stays on
          // the default, and inactive stays neutral slate, so the bar reads as
          // one product rather than six colours.
          tabBarActiveTintColor: Colors.aiPurple,
          tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          // D3: label only — the route is still `activity`, so every
          // router.push('/(tabs)/activity'), deep link and notification target
          // is untouched. "My Gnome" was the widest label in the bar and
          // ellipsized at the default font size on a 360dp phone; "Market" is
          // narrower and says what the screen actually is.
          title: 'Market',
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
