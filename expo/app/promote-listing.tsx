import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Zap, TrendingUp, Timer, Check, Megaphone, Clock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { promotionOptions } from '@/mocks/seller';
import { useApp } from '@/providers/AppProvider';

const iconMap: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Zap,
  TrendingUp,
  Timer,
};

export default function PromoteListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { listings } = useApp();
  const [selectedTier, setSelectedTier] = useState<string>('boost_24h');

  const listing = listings.find(l => l.id === id);

  const handlePromote = useCallback(() => {
    const option = promotionOptions.find(o => o.id === selectedTier);
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert(
      'Listing Promoted!',
      `Your "${listing?.title}" has been boosted with ${option?.name}. It will appear in promoted sections for ${option?.duration}.`,
      [{ text: 'Done', onPress: () => router.back() }],
    );
  }, [selectedTier, listing, router]);

  if (!listing) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>Listing not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'modal',
          title: 'Promote Listing',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.text,
        }}
      />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.listingPreview}>
          <Megaphone size={24} color={Colors.promoted} />
          <View style={styles.previewInfo}>
            <Text style={styles.previewTitle} numberOfLines={1}>{listing.title}</Text>
            <Text style={styles.previewMeta}>
              {listing.viewCount ?? 0} views · {listing.interestCount ?? 0} interested
            </Text>
          </View>
        </View>

        <View style={styles.headerSection}>
          <Text style={styles.heroTitle}>Boost Your Listing</Text>
          <Text style={styles.heroSubtitle}>
            Get more eyes on your produce. Promoted listings appear at the top of search and on the home feed.
          </Text>
        </View>

        <View style={styles.optionsContainer}>
          {promotionOptions.map((option) => {
            const isSelected = selectedTier === option.id;
            const IconComp = iconMap[option.icon] || Zap;
            return (
              <Pressable
                key={option.id}
                style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                onPress={() => setSelectedTier(option.id)}
              >
                <View style={styles.optionHeader}>
                  <View style={[
                    styles.optionIconWrap,
                    { backgroundColor: isSelected ? Colors.promoted + '20' : Colors.backgroundSecondary },
                  ]}>
                    <IconComp size={20} color={isSelected ? Colors.promoted : Colors.textSecondary} />
                  </View>
                  <View style={styles.optionNameCol}>
                    <Text style={[styles.optionName, isSelected && styles.optionNameSelected]}>
                      {option.name}
                    </Text>
                    <Text style={styles.optionDuration}>
                      <Clock size={10} color={Colors.textTertiary} /> {option.duration}
                    </Text>
                  </View>
                  <Text style={[styles.optionPrice, isSelected && styles.optionPriceSelected]}>
                    ${option.price}
                  </Text>
                </View>
                <Text style={styles.optionDesc}>{option.description}</Text>
                {isSelected && (
                  <View style={styles.selectedCheck}>
                    <Check size={14} color="#FFFFFF" />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.benefitsSection}>
          <Text style={styles.benefitsTitle}>What you get</Text>
          {[
            'Priority placement in home feed "Promoted Near You"',
            'Higher ranking in Explore search results',
            'Promoted badge on your listing card',
            'Urgency labels for perishable items',
            'Up to 3x more views on average',
          ].map((benefit, i) => (
            <View key={i} style={styles.benefitRow}>
              <View style={styles.benefitDot} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.promoteBtn} onPress={handlePromote}>
          <Zap size={18} color="#FFFFFF" />
          <Text style={styles.promoteBtnText}>
            Promote for ${promotionOptions.find(o => o.id === selectedTier)?.price}
          </Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          Promotion will be active immediately after confirmation. No refunds for active promotions.
        </Text>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notFoundText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  listingPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.promotedLight,
    borderRadius: 14,
    padding: 14,
  },
  previewInfo: {
    flex: 1,
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  previewMeta: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  optionsContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
  },
  optionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    position: 'relative',
  },
  optionCardSelected: {
    borderColor: Colors.promoted,
    backgroundColor: '#FFFFFF',
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  optionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionNameCol: {
    flex: 1,
  },
  optionName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  optionNameSelected: {
    color: Colors.promoted,
  },
  optionDuration: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  optionPrice: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  optionPriceSelected: {
    color: Colors.promoted,
  },
  optionDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  selectedCheck: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.promoted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  benefitsSection: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  benefitsTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 14,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  benefitDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.promoted,
    marginTop: 6,
  },
  benefitText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 18,
  },
  promoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.promoted,
    borderRadius: 16,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 28,
  },
  promoteBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  disclaimer: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: 40,
    marginTop: 12,
  },
  bottomSpacer: {
    height: 40,
  },
});
