import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import SeasonalIcon from '@/components/SeasonalIcon';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { logEvent } from '@/lib/db';
import { isSeasonalPromptDismissed, seasonalDismissalKey } from '@/lib/seasonal';
import { useSeasonalCampaign } from '@/lib/seasonalCampaign';

export default function SeasonalSellerPrompt() {
  const router = useRouter();
  const { data: campaign } = useSeasonalCampaign();
  const [visibility, setVisibility] = useState<{
    campaignId: string;
    dismissed: boolean;
  } | null>(null);

  useEffect(() => {
    let current = true;
    if (!campaign) {
      setVisibility(null);
      return () => {
        current = false;
      };
    }
    const campaignId = campaign.campaign_id;
    void AsyncStorage.getItem(seasonalDismissalKey(campaignId))
      .then((value) => {
        if (current) setVisibility({ campaignId, dismissed: isSeasonalPromptDismissed(value) });
      })
      .catch(() => {
        if (current) setVisibility({ campaignId, dismissed: false });
      });
    return () => {
      current = false;
    };
  }, [campaign]);

  if (
    !campaign ||
    visibility?.campaignId !== campaign.campaign_id ||
    visibility.dismissed
  ) {
    return null;
  }

  const dismiss = () => {
    setVisibility({ campaignId: campaign.campaign_id, dismissed: true });
    void AsyncStorage.setItem(seasonalDismissalKey(campaign.campaign_id), '1');
  };

  return (
    <View style={styles.prompt} accessibilityLabel={`${campaign.title}. ${campaign.seller_prompt}`}>
      <View style={styles.head}>
        <View style={styles.iconWrap} importantForAccessibility="no-hide-descendants">
          <SeasonalIcon iconKey={campaign.icon_key} color={Colors.text} size={20} />
        </View>
        <Text style={styles.title}>{campaign.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${campaign.title} seller suggestion`}
          hitSlop={10}
          onPress={dismiss}
          style={styles.close}
        >
          <X size={19} color={Colors.textSecondary} />
        </Pressable>
      </View>
      <Text style={styles.copy}>{campaign.seller_prompt}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void logEvent('seasonal_seller_cta_clicked', {
            metadata: { campaign_id: campaign.campaign_id },
          });
          router.push('/post');
        }}
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
      >
        <Text style={styles.ctaText}>Create a listing</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E7C64B',
    backgroundColor: '#FFF9E6',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.harvestYellow,
  },
  title: { flex: 1, color: Colors.text, fontFamily: fonts.displayBold, fontSize: 17 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  copy: {
    marginTop: 8,
    color: Colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 20,
  },
  cta: {
    alignSelf: 'flex-start',
    minHeight: 42,
    marginTop: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    justifyContent: 'center',
    backgroundColor: Colors.text,
  },
  ctaText: { color: Colors.textInverse, fontFamily: fonts.bold, fontSize: 14 },
  pressed: { opacity: 0.78 },
});
