import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_900Black,
} from '@expo-google-fonts/fraunces';
import { AuthProvider } from '@/providers/AuthProvider';
import OfflineBanner from '@/components/OfflineBanner';
import { useNotificationRouting } from '@/lib/useNotificationRouting';
import Colors from '@/constants/colors';

void SplashScreen.preventAutoHideAsync();

// NOTE: there is deliberately no global font default here. React 19 ignores
// defaultProps on function components (RN's Text/TextInput are function
// components), so the old `Text.defaultProps` trick silently did nothing and
// half the app rendered in the system font. Every text style now names its
// Inter family explicitly — see constants/theme.ts `fonts`.

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const headerStyle = {
  headerStyle: { backgroundColor: Colors.surface },
  headerTintColor: Colors.text,
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Fraunces_900Black,
  });

  // Route notification taps (cold start + warm) once the navigator is mounted.
  useNotificationRouting(fontsLoaded);

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <OfflineBanner />
            <Stack screenOptions={{ headerBackTitle: 'Back' }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="onboarding"
                options={{ headerShown: false, gestureEnabled: false }}
              />
              <Stack.Screen
                name="sign-in"
                options={{ presentation: 'modal', title: 'Sign In', ...headerStyle }}
              />
              <Stack.Screen
                name="auth-callback"
                options={{ headerShown: false, gestureEnabled: false }}
              />
              <Stack.Screen
                name="listing/[id]"
                options={{ title: 'Listing', ...headerStyle }}
              />
              <Stack.Screen
                name="listing-performance/[id]"
                options={{ title: 'Listing performance', ...headerStyle }}
              />
              <Stack.Screen
                name="chat/[claimId]"
                options={{ title: 'Pickup chat', ...headerStyle }}
              />
              <Stack.Screen
                name="edit-listing/[id]"
                options={{ title: 'Edit listing', ...headerStyle }}
              />
              <Stack.Screen
                name="market/[id]"
                options={{ title: 'Market', ...headerStyle }}
              />
              <Stack.Screen
                name="market/edit/[id]"
                options={{ title: 'Name your Market', ...headerStyle }}
              />
              <Stack.Screen
                name="market/assistance"
                options={{ title: 'Gnome assistance', ...headerStyle }}
              />
              <Stack.Screen
                name="request/[listingId]"
                options={{ presentation: 'modal', title: 'Send a request', ...headerStyle }}
              />
              <Stack.Screen
                name="upgrade"
                options={{ presentation: 'modal', title: 'Your plan', ...headerStyle }}
              />
              <Stack.Screen
                name="promote/[listingId]"
                options={{ presentation: 'modal', title: 'Feature listing', ...headerStyle }}
              />
              <Stack.Screen
                name="settings"
                options={{ title: 'Settings', ...headerStyle }}
              />
              <Stack.Screen
                name="profile/edit"
                options={{ title: 'Edit profile', ...headerStyle }}
              />
              <Stack.Screen
                name="account-ready"
                options={{ presentation: 'modal', title: 'Account update', ...headerStyle }}
              />
              <Stack.Screen
                name="claim-market"
                options={{ title: 'Claim your Market', ...headerStyle }}
              />
              <Stack.Screen
                name="garden"
                options={{ title: 'Garden Planner', ...headerStyle }}
              />
              <Stack.Screen
                name="compliance/index"
                options={{ title: 'Seller verification', ...headerStyle }}
              />
              <Stack.Screen
                name="compliance/upload"
                options={{ title: 'Verification', ...headerStyle }}
              />
              <Stack.Screen
                name="notebook"
                options={{ title: 'Sales notebook', ...headerStyle }}
              />
              <Stack.Screen
                name="order/[id]"
                options={{ title: 'Pickup order', ...headerStyle }}
              />
              <Stack.Screen
                name="orders"
                options={{ title: 'My pickups & orders', ...headerStyle }}
              />
              <Stack.Screen
                name="market/order/[marketId]"
                options={{ presentation: 'modal', title: 'Order for pickup', ...headerStyle }}
              />
              <Stack.Screen
                name="market/pickups"
                options={{ title: 'Pickups', ...headerStyle }}
              />
              <Stack.Screen
                name="market/pickup-settings"
                options={{ title: 'Pickup availability', ...headerStyle }}
              />
              <Stack.Screen
                name="market/payment-settings"
                options={{ title: 'Payment methods', ...headerStyle }}
              />
              <Stack.Screen
                name="market/delivery-settings"
                options={{ title: 'Delivery', ...headerStyle }}
              />
              <Stack.Screen
                name="market/drops"
                options={{ title: 'Market Drops', ...headerStyle }}
              />
              <Stack.Screen
                name="market/bundles"
                options={{ title: 'Gift Baskets', ...headerStyle }}
              />
              <Stack.Screen
                name="following"
                options={{ title: 'Markets you follow', ...headerStyle }}
              />
              <Stack.Screen
                name="ai-listing"
                options={{ title: 'Zordy listing helper', ...headerStyle }}
              />
              <Stack.Screen
                name="import"
                options={{ presentation: 'modal', title: 'Build My Market', ...headerStyle }}
              />
              <Stack.Screen
                name="growlog/[claimId]"
                options={{ title: 'Grow Log', ...headerStyle }}
              />
            </Stack>
          </AuthProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
