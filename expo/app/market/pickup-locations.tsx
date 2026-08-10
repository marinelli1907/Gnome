// Pickup locations manager — the seller's list of places buyers can collect
// from. One location is free forever; paid plans unlock more, and a downgrade
// restricts the extras rather than deleting them.
//
// Everything here reads through my_pickup_locations() because the exact street
// address is not SELECTable by authenticated clients (0054).
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, EmptyState, ErrorState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket } from '@/lib/db';
import { UpgradeCard } from '@/components/pickup/UpgradeCard';
import {
  countLiveLocations,
  LOCATION_TYPE_LABELS,
  parsePickupLimitError,
  planLabel,
  summarizeHours,
  useAllLocationHours,
  useDeactivateLocation,
  useLocationAllowance,
  usePickupLocations,
  useSaveLocation,
  useSetDefaultLocation,
  type PickupLocation,
} from '@/lib/pickuplocations';

const AMBER = '#B45309';

export default function PickupLocationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;

  const locations = usePickupLocations(marketId);
  const allowanceQ = useLocationAllowance(marketId);
  const hours = useAllLocationHours(marketId);
  const setDefault = useSetDefaultLocation(marketId);
  const deactivate = useDeactivateLocation(marketId);
  const saveLocation = useSaveLocation(marketId);

  const [busyId, setBusyId] = useState<string | null>(null);

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔑" title="Sign in" subtitle="Pickup locations belong to your Market.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (market.isLoading || locations.isLoading || allowanceQ.isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (!marketId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🏡"
          title="No Market yet"
          subtitle="Post a listing to create your Market first."
        />
      </View>
    );
  }
  if (locations.isError) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState
          message="Couldn’t load your pickup locations."
          onRetry={() => locations.refetch()}
        />
      </View>
    );
  }

  const rows = locations.data ?? [];
  const allowance = allowanceQ.data ?? 1;
  const used = countLiveLocations(rows);
  const atLimit = used >= allowance;
  const plan = planLabel(market.data?.plan);

  /** Never invent a schedule: if the hours query is down, say so. */
  const scheduleLine = (locationId: string): string => {
    if (hours.isError) return 'Schedule unavailable';
    if (hours.isLoading) return 'Loading schedule…';
    return summarizeHours((hours.data ?? []).filter((h) => h.location_id === locationId));
  };

  const openLocation = (id: string, section?: 'schedule') =>
    router.push({
      pathname: '/market/pickup-location/[id]',
      params: section ? { id, section } : { id },
    });

  // At the limit the button is unavailable and the upgrade card below it says
  // why — the add form never opens on a plan that can't hold another location.
  const onAdd = () => {
    if (atLimit) return;
    openLocation('new');
  };

  const runSetDefault = (loc: PickupLocation) => {
    setBusyId(loc.id);
    setDefault.mutate(loc.id, {
      onError: (e: any) => {
        const limit = parsePickupLimitError(e);
        Alert.alert(
          'Couldn’t set the default',
          limit
            ? `You’ve reached the ${limit.allowance}-location limit on ${plan}. Upgrade to use this location again.`
            : (e?.message ?? 'Try again.'),
        );
      },
      onSettled: () => setBusyId(null),
    });
  };

  const runDeactivate = (loc: PickupLocation) => {
    if (loc.is_default) {
      Alert.alert(
        'Set another default first',
        'This is your default pickup location. Choose a different default, then you can turn this one off.',
      );
      return;
    }
    Alert.alert(
      `Turn off ${loc.nickname}?`,
      'Buyers stop seeing it and no new slots are generated. Nothing is deleted — its hours and past orders stay put.',
      [
        { text: 'Keep it on', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () => {
            setBusyId(loc.id);
            deactivate.mutate(
              { id: loc.id, isDefault: loc.is_default },
              {
                onError: (e: any) =>
                  Alert.alert('Couldn’t turn it off', e?.message ?? 'Try again.'),
                onSettled: () => setBusyId(null),
              },
            );
          },
        },
      ],
    );
  };

  const runReactivate = (loc: PickupLocation) => {
    setBusyId(loc.id);
    saveLocation.mutate(
      { id: loc.id, active: true },
      {
        onError: (e: any) => {
          const limit = parsePickupLimitError(e);
          Alert.alert(
            limit ? 'Not included on your plan' : 'Couldn’t turn it back on',
            limit
              ? `You’ve reached the ${limit.allowance}-location limit on ${plan}. Upgrade to add more pickup locations.`
              : (e?.message ?? 'Try again.'),
          );
        },
        onSettled: () => setBusyId(null),
      },
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
      refreshControl={
        <RefreshControl
          refreshing={locations.isRefetching}
          onRefresh={() => {
            locations.refetch();
            hours.refetch();
          }}
          tintColor={Colors.primary}
        />
      }
    >
      <Text style={styles.intro}>
        Where buyers come to collect. Each location keeps its own hours, slot
        length and instructions — a porch, a farm stand, a Saturday booth.
      </Text>

      <Text style={styles.usage} accessibilityLabel={`${used} of ${allowance} locations used on ${plan}`}>
        {used} of {allowance} location{allowance === 1 ? '' : 's'} used · {plan} plan
      </Text>

      {rows.length === 0 ? (
        <EmptyState
          emoji="🧺"
          title="No pickup locations yet"
          subtitle="Add one and set the windows when people can come by. Your exact address stays private until a pickup is confirmed."
        />
      ) : null}

      {rows.map((loc) => {
        const restricted = loc.plan_restricted;
        const inactive = !loc.active;
        const busy = busyId === loc.id;
        return (
          <View
            key={loc.id}
            style={[styles.card, restricted && styles.cardRestricted, inactive && styles.cardInactive]}
          >
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {loc.nickname}
              </Text>
              {loc.is_default ? <Badge label="Default" /> : null}
              {inactive ? <Badge label="Off" color={Colors.textTertiary} /> : null}
            </View>

            <Text style={styles.metaLine}>{LOCATION_TYPE_LABELS[loc.location_type]}</Text>
            <Text style={styles.metaLine}>{scheduleLine(loc.id)}</Text>
            {loc.city ? (
              <Text style={styles.metaLine}>
                {[loc.city, loc.state].filter(Boolean).join(', ')}
              </Text>
            ) : null}

            {restricted ? (
              <View style={styles.restrictedBox}>
                <Text style={styles.restrictedText}>
                  Not included on your current plan — upgrade to use this location again
                </Text>
                <Pressable
                  onPress={() => router.push('/upgrade')}
                  accessibilityRole="button"
                  accessibilityLabel={`View plans to restore ${loc.nickname}`}
                  style={[styles.actionBtn, styles.actionAmber, { marginTop: 8, alignSelf: 'flex-start' }]}
                >
                  <Text style={[styles.actionText, styles.actionTextAmber]}>View Plans</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                onPress={() => openLocation(loc.id)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${loc.nickname}`}
                style={styles.actionBtn}
              >
                <Text style={styles.actionText}>Edit</Text>
              </Pressable>

              <Pressable
                onPress={() => openLocation(loc.id, 'schedule')}
                accessibilityRole="button"
                accessibilityLabel={`Set the schedule for ${loc.nickname}`}
                style={styles.actionBtn}
              >
                <Text style={styles.actionText}>Schedule</Text>
              </Pressable>

              {!loc.is_default && !restricted && !inactive ? (
                <Pressable
                  onPress={() => runSetDefault(loc)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Make ${loc.nickname} the default pickup location`}
                  style={[styles.actionBtn, styles.actionPrimary]}
                >
                  <Text style={[styles.actionText, styles.actionTextPrimary]}>
                    {busy && setDefault.isPending ? 'Setting…' : 'Set Default'}
                  </Text>
                </Pressable>
              ) : null}

              {inactive ? (
                <Pressable
                  onPress={() => runReactivate(loc)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Turn ${loc.nickname} back on`}
                  style={[styles.actionBtn, styles.actionPrimary]}
                >
                  <Text style={[styles.actionText, styles.actionTextPrimary]}>
                    {busy && saveLocation.isPending ? 'Turning on…' : 'Turn back on'}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => runDeactivate(loc)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Deactivate ${loc.nickname}`}
                  style={styles.actionBtn}
                >
                  <Text style={[styles.actionText, styles.actionTextDanger]}>Deactivate</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}

      <Button
        label="+ Add pickup location"
        onPress={onAdd}
        disabled={atLimit}
        style={{ marginTop: 16 }}
      />

      {atLimit ? (
        <View style={{ marginTop: 12 }}>
          <UpgradeCard
            title={`You’ve reached the ${allowance}-location limit on ${plan}.`}
            body="Upgrade to add more pickup locations"
          />
        </View>
      ) : null}

      <Text style={styles.footnote}>
        Your exact street address is never shown before a pickup is confirmed.
        Public farm stands and businesses can opt in to showing theirs.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  intro: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 10,
  },
  usage: { fontSize: 13, fontFamily: fonts.bold, color: Colors.text, marginBottom: 12 },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardRestricted: { backgroundColor: AMBER + '0D', borderColor: AMBER + '55' },
  cardInactive: { opacity: 0.75 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: { flex: 1, fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  metaLine: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  restrictedBox: { marginTop: 10 },
  restrictedText: { fontSize: 13, fontFamily: fonts.semibold, color: AMBER, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionBtn: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0D' },
  actionAmber: { borderColor: AMBER, backgroundColor: AMBER + '0D' },
  actionText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  actionTextPrimary: { color: Colors.primary },
  actionTextAmber: { color: AMBER },
  actionTextDanger: { color: Colors.error },
  footnote: {
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: Colors.textTertiary,
    marginTop: 16,
    lineHeight: 16,
    textAlign: 'center',
  },
});
