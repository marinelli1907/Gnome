import { Tabs } from 'expo-router';
import { Sprout, PlusCircle, Bell, User } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/providers/AuthProvider';
import { registerForPushNotifications } from '@/lib/notifications';

export default function TabLayout() {
  const { userId } = useAuth();

  useEffect(() => {
    if (userId) void registerForPushNotifications(userId);
  }, [userId]);

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
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
        name="post"
        options={{
          title: 'Post',
          tabBarIcon: ({ color, size }) => <PlusCircle color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size }) => <Bell color={color} size={size} />,
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
