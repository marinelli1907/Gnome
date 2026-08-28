// Grow Log — the private plot journal shared by exactly two people: the grower
// (the claimer of a plot_reservation claim) and the plot owner. Everyone else,
// and every other claim type, sees a locked door. The grower posts staged
// updates with photos; the owner leaves visually-distinct owner notes.
// When the plot hits FRUITING/HARVESTING, the grower gets a one-tap path to a
// prefilled (never auto-published) Create Listing form.
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, EmptyState, ErrorState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useClaimThread } from '@/lib/db';
import {
  STAGES,
  growSummary,
  useGrowLog,
  usePlotCrops,
  type PlotCrop,
} from '@/lib/growlog';
import StageProgress from '@/components/growlog/StageProgress';
import CropsCard from '@/components/growlog/CropsCard';
import EntryCard from '@/components/growlog/EntryCard';
import ComposerSheet from '@/components/growlog/ComposerSheet';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function PrivateState() {
  return (
    <View style={[styles.screen, { justifyContent: 'center' }]}>
      <EmptyState
        emoji="🔒"
        title="This Grow Log is private."
        subtitle="Only the grower and the plot owner can see it."
      />
    </View>
  );
}

export default function GrowLogScreen() {
  const { claimId } = useLocalSearchParams<{ claimId: string }>();
  const router = useRouter();
  const { userId } = useAuth();

  const thread = useClaimThread(claimId);
  const claim = thread.data;
  const isGrower = !!userId && !!claim && claim.claimer_id === userId;
  const isOwner = !!userId && !!claim && claim.listing?.owner_id === userId;
  const canView = (isGrower || isOwner) && claim?.claim_type === 'plot_reservation';

  // Queries stay disabled until this viewer is confirmed as a party — RLS
  // would deny them anyway, but there's no reason to even ask.
  const log = useGrowLog(canView ? claimId : undefined);
  const cropsQ = usePlotCrops(canView ? claimId : undefined);

  const entries = useMemo(() => log.data ?? [], [log.data]);
  const crops = useMemo(() => cropsQ.data ?? [], [cropsQ.data]);
  const summary = useMemo(() => growSummary(entries, crops), [entries, crops]);

  const [composerOpen, setComposerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  if (thread.isLoading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }
  if (thread.isError) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ErrorState message="Couldn’t load this Grow Log." onRetry={() => void thread.refetch()} />
      </View>
    );
  }
  if (!claim || !canView || !userId || !claimId) {
    return <PrivateState />;
  }

  const stageMeta = summary.current ? STAGES.find((s) => s.value === summary.current) ?? null : null;
  const showHarvest =
    isGrower && (summary.current === 'HARVESTING' || summary.current === 'FRUITING');

  const goToListing = (crop?: PlotCrop) => {
    // Prefill Create Listing — never publish. The post screen's compliance
    // gate and the seller's own thumbs do the rest.
    const params: Record<string, string> = {
      type: 'sale',
      description: 'Fresh from my garden plot.',
      n: String(Date.now()),
    };
    const title = crop ? `${crop.name}${crop.variety ? ` — ${crop.variety}` : ''}` : '';
    if (title) params.title = title;
    if (crop?.taxonomy_node_id) params.taxNode = crop.taxonomy_node_id;
    router.push({ pathname: '/post', params });
  };

  const listHarvest = () => {
    if (crops.length <= 1) {
      goToListing(crops[0]);
      return;
    }
    Alert.alert('Which crop?', 'Pick the crop you harvested.', [
      ...crops.slice(0, 5).map((c) => ({
        text: `${c.name}${c.variety ? ` — ${c.variety}` : ''}`,
        onPress: () => goToListing(c),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={log.isRefetching || cropsQ.isRefetching}
            onRefresh={() => {
              void thread.refetch();
              void log.refetch();
              void cropsQ.refetch();
            }}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Summary header */}
        <View style={styles.summaryCard}>
          <Text style={styles.plotTitle} numberOfLines={1}>
            {claim.listing?.title ?? 'Garden plot'}
          </Text>
          <Text style={styles.stageLine}>
            {stageMeta ? `${stageMeta.emoji} ${stageMeta.label}` : '🌱 No stage logged yet'}
          </Text>
          <Text style={styles.summarySub}>
            {summary.daysSincePlanted != null && summary.daysSincePlanted >= 0
              ? `Day ${summary.daysSincePlanted} since planted · `
              : ''}
            {summary.photoCount} photo{summary.photoCount === 1 ? '' : 's'}
            {summary.lastUpdate ? ` · updated ${fmtDate(summary.lastUpdate)}` : ''}
          </Text>
        </View>

        <StageProgress current={summary.current} />

        {/* Primary actions per role */}
        {isGrower ? (
          <Button
            label="Add update"
            onPress={() => setComposerOpen(true)}
            style={{ marginTop: 10 }}
          />
        ) : (
          <Button
            label="Add owner note"
            onPress={() => setComposerOpen(true)}
            style={{ marginTop: 10 }}
          />
        )}
        {showHarvest ? (
          <Button
            label="🧺 List harvest on Gnome"
            variant="secondary"
            onPress={listHarvest}
            style={{ marginTop: 8 }}
          />
        ) : null}

        {/* Crops */}
        <Text style={styles.sectionTitle}>What’s planted</Text>
        {cropsQ.isError ? (
          <ErrorState message="Couldn’t load the crop list." onRetry={() => void cropsQ.refetch()} />
        ) : cropsQ.isLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginVertical: 12 }} />
        ) : (
          <CropsCard claimId={claimId} uid={userId} canEdit={isGrower} crops={crops} />
        )}

        {/* Timeline */}
        <Text style={styles.sectionTitle}>Timeline</Text>
        {log.isError ? (
          <ErrorState message="Couldn’t load the log." onRetry={() => void log.refetch()} />
        ) : log.isLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginVertical: 12 }} />
        ) : entries.length === 0 ? (
          <Text style={styles.emptyTimeline}>
            {isGrower
              ? 'No updates yet — add the first one and watch the season unfold. 🌱'
              : 'No updates from your grower yet.'}
          </Text>
        ) : (
          entries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              uid={userId}
              claimId={claimId}
              onPhotoPress={setViewerUrl}
            />
          ))
        )}

        <Text style={styles.privacyFoot}>
          This log is private to you two. Photos are stored privately and never
          appear on public listings.
        </Text>
      </ScrollView>

      <ComposerSheet
        visible={composerOpen}
        mode={isGrower ? 'entry' : 'owner_note'}
        claimId={claimId}
        uid={userId}
        onClose={() => setComposerOpen(false)}
      />

      {/* Full-screen photo viewer */}
      <Modal
        visible={!!viewerUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUrl(null)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={styles.viewerBackdrop}
          onPress={() => setViewerUrl(null)}
        >
          {viewerUrl ? (
            <View pointerEvents="none" style={styles.viewerImgWrap}>
              <Image source={{ uri: viewerUrl }} style={styles.viewerImg} contentFit="contain" />
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  plotTitle: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  stageLine: { fontSize: 24, fontFamily: fonts.displayBold, color: Colors.text, marginTop: 4 },
  summarySub: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginTop: 20, marginBottom: 8 },
  emptyTimeline: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  privacyFoot: {
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: Colors.textTertiary,
    marginTop: 18,
    lineHeight: 16,
    textAlign: 'center',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImgWrap: { width: '100%', height: '100%' },
  viewerImg: { width: '100%', height: '100%' },
});
