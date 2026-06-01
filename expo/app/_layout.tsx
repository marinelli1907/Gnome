import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/providers/AuthProvider';
import Colors from '@/constants/colors';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const headerStyle = {
  headerStyle: { backgroundColor: Colors.surface },
  headerTintColor: Colors.text,
};

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerBackTitle: 'Back' }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="sign-in"
                options={{ presentation: 'modal', title: 'Sign In', ...headerStyle }}
              />
              <Stack.Screen
                name="listing/[id]"
                options={{ title: 'Listing', ...headerStyle }}
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
                options={{ title: 'Name your garden', ...headerStyle }}
              />
              <Stack.Screen
                name="request/[listingId]"
                options={{ presentation: 'modal', title: 'Send a request', ...headerStyle }}
              />
            </Stack>
          </AuthProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
