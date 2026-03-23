import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Animated,
} from 'react-native';
import { Stack } from 'expo-router';
import { Check, Crown, Leaf, Store, Zap } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import Colors from '@/constants/colors';
import { subscriptionPlans } from '@/mocks/seller';

const planIcons: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  free: Leaf,
  pro: Zap,
  market: Store,
};

export default function SellerPlanScreen() {
  const [selectedPlan, setSelectedPlan] = useState<string>('pro');
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleSelect = useCallback((planId: string) => {
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
    setSelectedPlan(planId);
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [scaleAnim]);

  const handleSubscribe = useCallback(() => {
    const plan = subscriptionPlans.find(p => p.id === selectedPlan);
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert(
      'Subscription Updated',
      `You've selected the ${plan?.name} plan. In a live app, this would process payment.`,
    );
  }, [selectedPlan]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Seller Plans',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.text,
        }}
      />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <Crown size={32} color={Colors.gold} />
          </View>
          <Text style={styles.heroTitle}>Grow Your{'\n'}Garden Business</Text>
          <Text style={styles.heroSubtitle}>
            Choose a plan that fits your selling goals. Upgrade anytime.
          </Text>
        </View>

        <View style={styles.plansContainer}>
          {subscriptionPlans.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            const IconComp = planIcons[plan.id] || Leaf;
            return (
              <Pressable
                key={plan.id}
                onPress={() => handleSelect(plan.id)}
              >
                <View style={[
                  styles.planCard,
                  isSelected && styles.planCardSelected,
                  plan.highlighted && styles.planCardHighlighted,
                ]}>
                  {plan.highlighted && (
                    <View style={styles.popularBadge}>
                      <Text style={styles.popularText}>Most Popular</Text>
                    </View>
                  )}
                  <View style={styles.planHeader}>
                    <View style={[
                      styles.planIconWrap,
                      { backgroundColor: isSelected ? Colors.primary + '20' : Colors.backgroundSecondary },
                    ]}>
                      <IconComp size={22} color={isSelected ? Colors.primary : Colors.textSecondary} />
                    </View>
                    <View style={styles.planNameCol}>
                      <Text style={[styles.planName, isSelected && styles.planNameSelected]}>
                        {plan.name}
                      </Text>
                      <Text style={styles.planListings}>
                        {plan.maxListings >= 999 ? 'Unlimited' : `Up to ${plan.maxListings}`} listings
                      </Text>
                    </View>
                    <View style={styles.planPriceCol}>
                      {plan.price === 0 ? (
                        <Text style={styles.planPriceFree}>Free</Text>
                      ) : (
                        <>
                          <Text style={[styles.planPrice, isSelected && styles.planPriceSelected]}>
                            ${plan.price}
                          </Text>
                          <Text style={styles.planPeriod}>/{plan.period}</Text>
                        </>
                      )}
                    </View>
                  </View>

                  <View style={styles.featuresContainer}>
                    {plan.features.map((feature, i) => (
                      <View key={i} style={styles.featureRow}>
                        <View style={[
                          styles.checkCircle,
                          { backgroundColor: isSelected ? Colors.primary + '20' : Colors.backgroundSecondary },
                        ]}>
                          <Check size={12} color={isSelected ? Colors.primary : Colors.textTertiary} />
                        </View>
                        <Text style={[styles.featureText, isSelected && styles.featureTextSelected]}>
                          {feature}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {plan.promoCredits > 0 && (
                    <View style={styles.creditsBadge}>
                      <Zap size={12} color={Colors.promoted} />
                      <Text style={styles.creditsText}>
                        {plan.promoCredits} promotion credits/month included
                      </Text>
                    </View>
                  )}

                  {isSelected && (
                    <View style={styles.selectedIndicator}>
                      <View style={styles.selectedDot}>
                        <Check size={14} color="#FFFFFF" />
                      </View>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.ctaSection}>
          <Pressable style={styles.subscribeBtn} onPress={handleSubscribe}>
            <Crown size={18} color="#FFFFFF" />
            <Text style={styles.subscribeBtnText}>
              {selectedPlan === 'free' ? 'Continue with Starter' : `Subscribe to ${subscriptionPlans.find(p => p.id === selectedPlan)?.name}`}
            </Text>
          </Pressable>
          <Text style={styles.ctaNote}>
            Cancel anytime. No long-term commitment required.
          </Text>
        </View>

        <View style={styles.trustSection}>
          <Text style={styles.trustTitle}>Why sellers love Gnome</Text>
          <View style={styles.trustGrid}>
            {[
              { num: '2,400+', label: 'Active sellers' },
              { num: '$48k', label: 'Earned this month' },
              { num: '12k+', label: 'Items traded' },
              { num: '4.8', label: 'Avg seller rating' },
            ].map((item, i) => (
              <View key={i} style={styles.trustItem}>
                <Text style={styles.trustNum}>{item.num}</Text>
                <Text style={styles.trustLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

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
  heroSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 40,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.goldLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 34,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  plansContainer: {
    paddingHorizontal: 20,
    gap: 14,
  },
  planCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 2,
    borderColor: Colors.border,
    position: 'relative',
  },
  planCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: '#FFFFFF',
  },
  planCardHighlighted: {
    borderColor: Colors.primary,
  },
  popularBadge: {
    position: 'absolute',
    top: -11,
    right: 16,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  popularText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  planIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  planNameCol: {
    flex: 1,
  },
  planName: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  planNameSelected: {
    color: Colors.primary,
  },
  planListings: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  planPriceCol: {
    alignItems: 'flex-end',
  },
  planPrice: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  planPriceSelected: {
    color: Colors.primary,
  },
  planPriceFree: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
  },
  planPeriod: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  featuresContainer: {
    gap: 10,
    marginBottom: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },
  featureTextSelected: {
    color: Colors.text,
  },
  creditsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.promotedLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 4,
  },
  creditsText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.promoted,
  },
  selectedIndicator: {
    position: 'absolute',
    top: 16,
    left: 16,
  },
  selectedDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaSection: {
    paddingHorizontal: 20,
    paddingTop: 28,
    alignItems: 'center',
  },
  subscribeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    width: '100%',
  },
  subscribeBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  ctaNote: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 10,
  },
  trustSection: {
    paddingHorizontal: 20,
    marginTop: 32,
  },
  trustTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  trustGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  trustItem: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  trustNum: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  trustLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  bottomSpacer: {
    height: 40,
  },
});
