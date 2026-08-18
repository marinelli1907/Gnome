// Landing pad for the gnome://checkout-success deep link.
//
// billing-checkout configures that URL as Stripe's return target for app
// checkouts, and lib/billing.ts opens the hosted page with
// openAuthSessionAsync('gnome://checkout'), which is SUPPOSED to intercept the
// redirect and close the browser itself. On Android it does not always win the
// race: the redirect escapes to the OS, Android hands the deep link to the app,
// and expo-router looks for a /checkout-success route. Without this file it
// finds none and renders "This screen doesn't exist." — immediately after the
// customer's money left their card. Verified on an Android 16 emulator against
// a real Stripe TEST payment: the purchase completed, the authorization was
// consumed, the listing published, and the seller still saw an error screen.
//
// This route exists so that path lands somewhere honest instead. It decides
// nothing about the payment: purchaseOverage() is still polling the server on
// the screen underneath, and the server (not the browser's return) is what
// says whether the publish happened. So this only steps out of the way and
// returns to Post, where that reconciliation finishes and navigates.
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';

export default function CheckoutSuccess() {
  const router = useRouter();
  useEffect(() => {
    // replace(), not push(): the deep link should leave no entry to go "back"
    // into, or the seller can navigate into a dead checkout screen afterwards.
    router.replace('/(tabs)/post');
  }, [router]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={styles.text}>Finishing your publish…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: Colors.background },
  text: { color: Colors.textSecondary, fontSize: 15 },
});
