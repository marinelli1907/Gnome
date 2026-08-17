// Market Drops — seller management. A Market Drop is a time-boxed collection of the
// seller's EXISTING listings ("Saturday Harvest, Sat 8AM–1PM"). Creation goes through
// the canonical create_market_drop RPC (the same one the AI's confirm path uses);
// schedule/cancel are plain owner-scoped RLS updates. Drops never touch the listings
// themselves — no allowance, no renewal, no expiry reset.
//
// NOT the Seed Drop. Seller-facing copy always says "Market Drop".
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket, logEvent } from '@/lib/db';
import { dropShareUrl } from '@/lib/links';
import { supabase } from '@/lib/supabase';

type DropRow = {
  id: string; title: string; description: string | null;
  starts_at: string; ends_at: string;
  status: 'draft' | 'scheduled' | 'cancelled';
  item_count?: number;
};
type OwnListing = { id: string; title: string; price_cents: number | null; unit: string | null };

const fmtWindow = (startsAt: string, endsAt: string) => {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const day = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${t(s)} – ${t(e)}`;
};

const phaseOf = (d: DropRow): string => {
  if (d.status !== 'scheduled') return d.status;
  const now = Date.now();
  if (now < Date.parse(d.starts_at)) return 'upcoming';
  if (now >= Date.parse(d.ends_at)) return 'ended';
  return 'live';
};

// Chip copy — LIVE NOW keeps its shout; everything else reads like a person wrote it.
const phaseLabel = (phase: string): string => {
  if (phase === 'live') return 'LIVE NOW';
  if (phase === 'draft') return 'Draft';
  if (phase === 'upcoming') return 'Coming up';
  if (phase === 'ended') return 'Ended';
  return phase.charAt(0).toUpperCase() + phase.slice(1);
};

/** "YYYY-MM-DD" + "HH:MM" (device-local time) -> Date, or null. */
const parseLocal = (day: string, time: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.trim()) || !/^\d{1,2}:\d{2}$/.test(time.trim())) return null;
  const d = new Date(`${day.trim()}T${time.trim().padStart(5, '0')}:00`);
  return Number.isFinite(d.getTime()) ? d : null;
};

export default function MarketDropsScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;
  const marketSlug = market.data?.slug;

  const [drops, setDrops] = useState<DropRow[]>([]);
  const [listings, setListings] = useState<OwnListing[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [day, setDay] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('13:00');
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    if (!marketId) return;
    // Long-ended Drops (30+ days) stay out of the list — this screen is for
    // what's coming up, not a full history.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: ds } = await supabase.from('market_drops')
      .select('id,title,description,starts_at,ends_at,status')
      .eq('market_id', marketId).neq('status', 'cancelled')
      .gte('ends_at', cutoff)
      .order('starts_at', { ascending: true });
    const rows = (ds ?? []) as DropRow[];
    if (rows.length) {
      const { data: items } = await supabase.from('market_drop_items')
        .select('drop_id').in('drop_id', rows.map((d) => d.id));
      const counts = new Map<string, number>();
      for (const i of items ?? []) counts.set(i.drop_id, (counts.get(i.drop_id) ?? 0) + 1);
      for (const d of rows) d.item_count = counts.get(d.id) ?? 0;
    }
    setDrops(rows);
    const { data: ls } = await supabase.from('listings')
      .select('id,title,price_cents,unit')
      .eq('market_id', marketId).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(60);
    setListings((ls ?? []) as OwnListing[]);
  }, [marketId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async (publish: boolean) => {
    const ids = Object.keys(picked).filter((k) => picked[k]);
    const starts = parseLocal(day, startTime);
    const ends = parseLocal(day, endTime);
    if (!title.trim()) { Alert.alert('Name it', 'Give the Market Drop a name.'); return; }
    if (!starts || !ends) { Alert.alert('When?', 'Use the date as YYYY-MM-DD and times as HH:MM.'); return; }
    if (ends.getTime() <= starts.getTime()) { Alert.alert('Times', 'The Drop has to end after it starts.'); return; }
    if (!ids.length) { Alert.alert('Pick listings', 'Choose at least one listing for the Drop.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('create_market_drop', {
        p_title: title.trim(),
        p_starts_at: starts.toISOString(),
        p_ends_at: ends.toISOString(),
        p_listing_ids: ids,
        p_description: null,
        p_publish: publish,
        p_request: null,
      });
      if (error) throw error;
      void logEvent(publish ? 'drop_scheduled' : 'drop_created', { userId: userId ?? null });
      setCreating(false); setTitle(''); setDay(''); setPicked({});
      await refresh();
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      Alert.alert('Couldn’t save the Drop',
        /RESERVED_TITLE/.test(msg) ? '“Seed” names are reserved — pick a different name.'
          : /WINDOW_IN_PAST/.test(msg) ? 'That window is already in the past.'
          : /WINDOW_TOO_LONG/.test(msg) ? 'Keep a Drop to two weeks or less.'
          : /DROP_ITEM_LIMIT/.test(msg) ? 'A Market Drop holds up to 30 items.'
          : 'Check the details and try again.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (d: DropRow, status: 'scheduled' | 'cancelled') => {
    setBusy(true);
    try {
      const { error } = await supabase.from('market_drops').update({ status }).eq('id', d.id);
      if (error) throw error;
      if (status === 'cancelled') void logEvent('drop_cancelled', { userId: userId ?? null });
      await refresh();
    } catch {
      Alert.alert('Hmm', 'That change didn’t stick — try again.');
    } finally {
      setBusy(false);
    }
  };

  const share = async (d: DropRow) => {
    if (!marketSlug) return;
    const url = dropShareUrl(marketSlug, d.id);
    void logEvent('drop_shared', { userId: userId ?? null });
    try { await Share.share({ message: `${d.title} — ${fmtWindow(d.starts_at, d.ends_at)}\n${url}` }); } catch { /* cancelled */ }
  };

  // Cancelling is immediate and (from here) one-way — make the seller say so.
  const confirmCancel = (d: DropRow) => {
    Alert.alert(
      'Cancel this Drop?',
      "Buyers will stop seeing it immediately — this can't be undone here.",
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel Drop', style: 'destructive', onPress: () => void setStatus(d, 'cancelled') },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}>
      <Text style={styles.blurb}>
        A Market Drop is a time-boxed pick of your existing listings — “Saturday Harvest,
        Sat 8 AM–1 PM”. It shows on your public Market and never changes the listings themselves.
      </Text>

      {drops.length === 0 && !creating && (
        <EmptyState emoji="🧺" title="No Market Drops yet"
          subtitle="Bundle what you’ll have ready and give buyers a time to show up." />
      )}

      {drops.map((d) => (
        <View key={d.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {d.title}{'  '}
            <Text style={styles.badge}>
              {phaseLabel(phaseOf(d))}
            </Text>
          </Text>
          <Text style={styles.cardMeta}>
            {fmtWindow(d.starts_at, d.ends_at)} · {d.item_count ?? 0} item{(d.item_count ?? 0) === 1 ? '' : 's'}
          </Text>
          <View style={styles.row}>
            {d.status === 'draft' && (
              <Button label="Schedule it" onPress={() => void setStatus(d, 'scheduled')} loading={busy} />
            )}
            {d.status === 'scheduled' && (
              <>
                <Pressable onPress={() => void share(d)} hitSlop={6}><Text style={styles.link}>Share Drop</Text></Pressable>
                <Pressable onPress={() => confirmCancel(d)} hitSlop={6}>
                  <Text style={styles.linkMuted}>Cancel Drop</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      ))}

      {!creating ? (
        <Button label="+ New Market Drop" onPress={() => setCreating(true)} />
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Drop name</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle}
            placeholder="Saturday Harvest" placeholderTextColor={Colors.textTertiary} maxLength={80} />
          <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={day} onChangeText={setDay}
            placeholder="2026-08-22" placeholderTextColor={Colors.textTertiary} autoCapitalize="none" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Starts (HH:MM)</Text>
              <TextInput style={styles.input} value={startTime} onChangeText={setStartTime}
                placeholder="08:00" placeholderTextColor={Colors.textTertiary} autoCapitalize="none" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Ends (HH:MM)</Text>
              <TextInput style={styles.input} value={endTime} onChangeText={setEndTime}
                placeholder="13:00" placeholderTextColor={Colors.textTertiary} autoCapitalize="none" />
            </View>
          </View>
          <Text style={styles.label}>Pick from your live listings</Text>
          {listings.map((l) => (
            <Pressable key={l.id} style={styles.pickRow}
              onPress={() => setPicked((p) => ({ ...p, [l.id]: !p[l.id] }))}>
              <Text style={styles.pickMark}>{picked[l.id] ? '☑' : '☐'}</Text>
              <Text style={styles.pickTitle} numberOfLines={1}>{l.title}</Text>
              {l.price_cents != null && (
                <Text style={styles.pickPrice}>
                  ${(l.price_cents / 100).toFixed(2).replace(/\.00$/, '')}{l.unit ? `/${l.unit}` : ''}
                </Text>
              )}
            </Pressable>
          ))}
          {listings.length === 0 && <Text style={styles.cardMeta}>No live listings to pick from yet.</Text>}
          <View style={styles.row}>
            <Button label="Schedule Drop" onPress={() => void create(true)} loading={busy} />
            <Pressable onPress={() => void create(false)} hitSlop={6}><Text style={styles.link}>Save draft</Text></Pressable>
            <Pressable onPress={() => setCreating(false)} hitSlop={6}><Text style={styles.linkMuted}>Close</Text></Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  blurb: { fontFamily: fonts.regular, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 12, gap: 8,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15, color: Colors.text },
  badge: { fontFamily: fonts.semibold, fontSize: 11, color: Colors.primary },
  cardMeta: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontFamily: fonts.regular, fontSize: 14, color: Colors.text,
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  pickMark: { fontFamily: fonts.regular, fontSize: 16, color: Colors.primary },
  pickTitle: { fontFamily: fonts.regular, fontSize: 14, color: Colors.text, flex: 1 },
  pickPrice: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.primary },
  linkMuted: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.textTertiary },
});
