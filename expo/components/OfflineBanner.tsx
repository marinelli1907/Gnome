import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';

// App-wide, persistent while offline. Cached listings (react-query) stay visible
// underneath, so it reads as resilient, not broken.
export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setOffline(s.isConnected === false);
    });
    return () => unsub();
  }, []);

  if (!offline) return null;

  return (
    <View style={[styles.banner, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.text}>You&apos;re offline. Showing the latest saved listings.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: Colors.text, paddingHorizontal: 16, paddingBottom: 8 },
  text: { color: '#FFFFFF', fontSize: 13, fontFamily: fonts.medium, textAlign: 'center' },
});
