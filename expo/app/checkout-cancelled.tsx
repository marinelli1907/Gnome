// Landing pad for the gnome://checkout-cancelled deep link — the cancel twin of
// checkout-success.tsx, which explains why these routes exist at all.
//
// Nothing was charged on this path, and nothing here says otherwise: the draft
// is still sitting on the Post screen exactly as the seller left it, so this
// returns there without comment rather than announcing a failure they already
// chose.
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Colors from '@/constants/colors';

export default function CheckoutCancelled() {
  const router = useRouter();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  useEffect(() => {
    router.replace(kind === 'plan' ? '/upgrade' : '/(tabs)/post');
  }, [kind, router]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
});
