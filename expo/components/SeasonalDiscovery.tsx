import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ListingCard from '@/components/ListingCard';
import SeasonalIcon from '@/components/SeasonalIcon';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { logEvent } from '@/lib/db';
import type { SeasonalCampaign } from '@/lib/seasonal';
import type { Listing } from '@/types';

export default function SeasonalDiscovery({
  campaign,
  listings,
  onSearch,
}: {
  campaign: SeasonalCampaign;
  listings: Listing[];
  onSearch: (query: string) => void;
}) {
  const viewedCampaign = useRef<string | null>(null);

  useEffect(() => {
    if (viewedCampaign.current === campaign.campaign_id) return;
    viewedCampaign.current = campaign.campaign_id;
    void logEvent('seasonal_section_viewed', {
      metadata: { campaign_id: campaign.campaign_id, match_count: listings.length },
    });
  }, [campaign.campaign_id, listings.length]);

  if (listings.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.iconWrap} importantForAccessibility="no-hide-descendants">
          <SeasonalIcon iconKey={campaign.icon_key} color={Colors.text} size={22} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.title} accessibilityRole="header">{campaign.title}</Text>
          <Text style={styles.subtitle}>{campaign.subtitle}</Text>
        </View>
      </View>

      {campaign.search_chips.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroller}
          contentContainerStyle={styles.chips}
        >
          {campaign.search_chips.map((chip) => (
            <Pressable
              key={chip.query.toLocaleLowerCase('en-US')}
              accessibilityRole="button"
              accessibilityLabel={`Search for ${chip.label}`}
              onPress={() => {
                void logEvent('seasonal_search_chip_clicked', {
                  metadata: { campaign_id: campaign.campaign_id, query: chip.query },
                });
                onSearch(chip.query);
              }}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipText}>{chip.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.listScroller}
        contentContainerStyle={styles.list}
      >
        {listings.map((listing) => (
          <View key={listing.id} style={styles.card}>
            <ListingCard listing={listing} seasonalCampaignId={campaign.campaign_id} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: -16,
    marginBottom: 12,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E7C64B',
    backgroundColor: '#FFF9E6',
  },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.harvestYellow,
  },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { color: Colors.text, fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 25 },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  chipScroller: { marginTop: 12 },
  chips: { paddingHorizontal: 16, gap: 8 },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.text,
    backgroundColor: Colors.surface,
  },
  chipText: { color: Colors.text, fontFamily: fonts.bold, fontSize: 13 },
  listScroller: { marginTop: 14 },
  list: { paddingHorizontal: 16, gap: 12 },
  card: { width: 272 },
  pressed: { opacity: 0.75 },
});
