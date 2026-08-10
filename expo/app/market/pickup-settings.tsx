// Pickup availability used to live here as a single market-wide editor: one
// address, one set of weekly windows. A Market can now have several pickup
// locations (0052–0054), each with its own address, privacy setting, slot rules
// and schedule — so the editing lives per location at /market/pickup-location.
//
// The route stays registered because it is deep-linked from older builds and
// from the Market tools list; it now points people at the manager rather than
// silently 404-ing.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket } from '@/lib/db';
import {
  countLiveLocations,
  planLabel,
  useLocationAllowance,
  usePickupLocations,
} from '@/lib/pickuplocations';

export default function PickupSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;
  const locations = usePickupLocations(marketId);
  const allowance = useLocationAllowance(marketId);

  const rows = locations.data ?? [];
  const used = countLiveLocations(rows);
  const max = allowance.data ?? 1;
  const ready = !!marketId && !locations.isLoading && !allowance.isLoading;

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.card}>
        <Text style={styles.title}>Pickup lives per location now</Text>
        <Text style={styles.body}>
          Hours, slot length, lead time and instructions are set on each pickup
          location — your porch, a farm stand, a Saturday booth — so buyers pick
          a time at the place they’re actually coming to.
        </Text>
        {ready ? (
          <Text style={styles.usage}>
            {used} of {max} location{max === 1 ? '' : 's'} used · {planLabel(market.data?.plan)} plan
          </Text>
        ) : null}
        <Button
          label="Manage pickup locations"
          onPress={() => router.replace('/market/pickup-locations')}
          style={{ marginTop: 14 }}
        />
      </View>
      <Text style={styles.footnote}>
        Nothing was lost in the move: your old pickup setup became your default
        location, with its hours and exceptions attached.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background, padding: 16, justifyContent: 'center' },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 18,
  },
  title: { fontSize: 18, fontFamily: fonts.displayBold, color: Colors.text },
  body: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginTop: 8,
  },
  usage: { fontSize: 13, fontFamily: fonts.bold, color: Colors.text, marginTop: 12 },
  footnote: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 16,
  },
});
