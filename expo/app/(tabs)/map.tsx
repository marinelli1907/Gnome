import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Navigation } from 'lucide-react-native';
import MapListings from '@/components/MapListings';
import ListingCard from '@/components/ListingCard';
import { Button, EmptyState, ErrorState } from '@/components/ui';
import { Skeleton } from '@/components/Skeleton';
import { TYPE_FILTERS } from '@/lib/listingType';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useListings } from '@/lib/db';
import { getCurrentCoords, RADIUS_OPTIONS, type Coords, type RadiusOption } from '@/lib/location';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Listing, ListingType } from '@/types';

const DEFAULT_CENTER: Coords = { lat: 41.5573, lng: -81.5101 }; // Richmond Heights, OH

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locState, setLocState] = useState<'pending' | 'ok' | 'denied'>('pending');
  const [radius, setRadius] = useState<RadiusOption>(10);
  const [typeFilter, setTypeFilter] = useState<'all' | ListingType>('all');
  const [selected, setSelected] = useState<Listing | null>(null);

  const requestLocation = async () => {
    setLocState('pending');
    const c = await getCurrentCoords();
    if (c) {
      setCoords(c);
      setLocState('ok');
    } else {
      setLocState('denied');
    }
  };
  useEffect(() => {
    void requestLocation();
  }, []);

  const center = coords ?? DEFAULT_CENTER;
  const filters = useMemo(
    () => ({ coords: center, radius, category: null, listingType: typeFilter }),
    [center, radius, typeFilter],
  );
  const { data, isLoading, error, refetch } = useListings(filters);
  const listings = data ?? [];

  const Header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>Gardens Near You</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {TYPE_FILTERS.map((o) => {
          const active = typeFilter === o.value;
          return (
            <Pressable key={o.value} onPress={() => setTypeFilter(o.value)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {RADIUS_OPTIONS.map((o) => {
          const active = radius === o.value;
          return (
            <Pressable key={String(o.value)} onPress={() => setRadius(o.value)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {locState === 'denied' && (
        <View style={styles.locBanner}>
          <Text style={styles.locText}>Showing the Richmond Heights area — turn on location for gardens near you.</Text>
          <Pressable onPress={requestLocation} style={styles.locBtn}>
            <Navigation size={14} color={Colors.primary} />
            <Text style={styles.locBtnText}>Enable</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const body = () => {
    if (!isSupabaseConfigured) {
      return <EmptyState emoji="🔌" title="Connect Supabase" subtitle="Add your Supabase keys to load the map." />;
    }
    if (isLoading || locState === 'pending') {
      return <Skeleton style={styles.mapSkeleton} />;
    }
    if (error) {
      return <ErrorState title="Couldn’t load the map" message="Check your connection and try again." onRetry={() => refetch()} />;
    }
    if (listings.length === 0) {
      return (
        <EmptyState
          emoji="🗺️"
          title="No fresh listings on the map near you yet"
          subtitle="Be the first grower in your area."
        >
          <Button label="Create listing" onPress={() => router.push('/post')} style={{ marginTop: 12, paddingHorizontal: 28 }} />
        </EmptyState>
      );
    }
    return <MapListings listings={listings} center={coords} onSelect={setSelected} />;
  };

  return (
    <View style={styles.screen}>
      {Header}
      <View style={styles.mapArea}>{body()}</View>

      {selected && (
        <View style={[styles.preview, { paddingBottom: insets.bottom + 8 }]}>
          <Pressable style={styles.previewClose} onPress={() => setSelected(null)} hitSlop={8}>
            <X size={18} color={Colors.textSecondary} />
          </Pressable>
          <ListingCard listing={selected} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingBottom: 4 },
  title: { fontSize: 26, fontFamily: fonts.bold, color: Colors.primaryDark, marginBottom: 10 },
  chips: { gap: 8, paddingBottom: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  locBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.gold + '22',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  locText: { flex: 1, fontSize: 12, fontFamily: fonts.medium, color: Colors.text, lineHeight: 17 },
  locBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locBtnText: { color: Colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  mapArea: { flex: 1 },
  mapSkeleton: { flex: 1, margin: 16, borderRadius: 16 },
  preview: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  previewClose: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
});
