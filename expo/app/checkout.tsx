import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  CreditCard, Smartphone, MapPin, Truck, Package,
  Shield, CheckCircle, Clock,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import { Order, OrderType } from '@/types';
import { currentUser } from '@/mocks/users';
import Colors from '@/constants/colors';

type PaymentOption = 'card' | 'apple_pay' | 'pay_on_pickup';

const paymentOptions: { id: PaymentOption; label: string; sublabel: string; icon: React.ComponentType<{ size: number; color: string }> }[] = [
  { id: 'pay_on_pickup', label: 'Pay on Pickup', sublabel: 'Cash or card at pickup', icon: MapPin },
  { id: 'card', label: 'Card ending in 4242', sublabel: 'Visa debit', icon: CreditCard },
  { id: 'apple_pay', label: 'Apple Pay', sublabel: 'Quick checkout', icon: Smartphone },
];

export default function CheckoutScreen() {
  const { listingId, orderType } = useLocalSearchParams<{ listingId: string; orderType: string }>();
  const router = useRouter();
  const { listings, addOrder } = useApp();
  const [selectedPayment, setSelectedPayment] = useState<PaymentOption>('pay_on_pickup');
  const [pickupNote, setPickupNote] = useState('');
  const [quantity] = useState('1');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const listing = listings.find(l => l.id === listingId);

  const type: OrderType = useMemo(() => {
    if (orderType === 'trade') return 'trade';
    if (orderType === 'delivery') return 'delivery';
    if (orderType === 'pickup') return 'pickup';
    if (orderType === 'reserve') return 'reserve';
    return 'buy';
  }, [orderType]);

  const subtotal = listing?.price ? listing.price * parseInt(quantity || '1', 10) : 0;
  const serviceFee = subtotal > 0 ? Math.round(subtotal * 0.05 * 100) / 100 : 0;
  const deliveryFee = type === 'delivery' ? 2.99 : 0;
  const total = subtotal + serviceFee + deliveryFee;

  const handlePlaceOrder = useCallback(() => {
    if (!listing) return;
    setIsSubmitting(true);

    setTimeout(() => {
      const newOrder: Order = {
        id: `order-${Date.now()}`,
        listing,
        buyer: currentUser,
        seller: listing.seller,
        status: 'awaiting_response',
        type,
        quantity: listing.quantity,
        totalPrice: total > 0 ? total : undefined,
        deliveryNotes: pickupNote || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addOrder(newOrder);
      setIsSubmitting(false);
      Alert.alert(
        'Order Placed!',
        'Your request has been sent to the seller. You\'ll be notified when they respond.',
        [{ text: 'View Orders', onPress: () => router.replace('/orders') }]
      );
    }, 1200);
  }, [listing, type, total, pickupNote, addOrder, router]);

  if (!listing) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>Listing not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.listingCard}>
          <Image source={{ uri: listing.images[0] }} style={styles.listingImage} contentFit="cover" />
          <View style={styles.listingInfo}>
            <Text style={styles.listingTitle} numberOfLines={2}>{listing.title}</Text>
            <Text style={styles.listingSeller}>{listing.seller.name}</Text>
            <View style={styles.listingMeta}>
              <MapPin size={12} color={Colors.primaryLight} />
              <Text style={styles.listingDistance}>{listing.distance} mi · {listing.pickupLocation}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Type</Text>
          <View style={styles.orderTypeCard}>
            {type === 'buy' && <Package size={18} color={Colors.primary} />}
            {type === 'delivery' && <Truck size={18} color={Colors.info} />}
            {type === 'pickup' && <MapPin size={18} color={Colors.freshGreen} />}
            {type === 'reserve' && <Clock size={18} color={Colors.promoted} />}
            {type === 'trade' && <Package size={18} color={Colors.trade} />}
            <View style={styles.orderTypeInfo}>
              <Text style={styles.orderTypeLabel}>
                {type === 'buy' ? 'Purchase' : type === 'delivery' ? 'Local Delivery' : type === 'pickup' ? 'Pickup Request' : type === 'reserve' ? 'Reserve Item' : 'Trade Request'}
              </Text>
              <Text style={styles.orderTypeDesc}>
                {type === 'delivery' ? 'Delivered to your address' : type === 'trade' ? 'Propose an item trade' : 'Pick up from seller\'s location'}
              </Text>
            </View>
          </View>
        </View>

        {listing.pickupWindow && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pickup Window</Text>
            <View style={styles.pickupCard}>
              <Clock size={16} color={Colors.primary} />
              <Text style={styles.pickupText}>{listing.pickupWindow}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Note for Seller</Text>
          <TextInput
            style={styles.noteInput}
            placeholder="Add pickup time preference, special instructions..."
            placeholderTextColor={Colors.textTertiary}
            value={pickupNote}
            onChangeText={setPickupNote}
            multiline
            maxLength={200}
          />
        </View>

        {subtotal > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment Method</Text>
            {paymentOptions.map(option => {
              const IconComp = option.icon;
              const isSelected = selectedPayment === option.id;
              return (
                <Pressable
                  key={option.id}
                  style={[styles.paymentOption, isSelected && styles.paymentOptionSelected]}
                  onPress={() => setSelectedPayment(option.id)}
                >
                  <View style={[styles.paymentIconWrap, isSelected && styles.paymentIconWrapSelected]}>
                    <IconComp size={18} color={isSelected ? Colors.primary : Colors.textTertiary} />
                  </View>
                  <View style={styles.paymentInfo}>
                    <Text style={[styles.paymentLabel, isSelected && styles.paymentLabelSelected]}>{option.label}</Text>
                    <Text style={styles.paymentSublabel}>{option.sublabel}</Text>
                  </View>
                  <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.summaryCard}>
            {subtotal > 0 && (
              <>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal</Text>
                  <Text style={styles.summaryValue}>${subtotal.toFixed(2)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Service fee (5%)</Text>
                  <Text style={styles.summaryValue}>${serviceFee.toFixed(2)}</Text>
                </View>
                {deliveryFee > 0 && (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Delivery fee</Text>
                    <Text style={styles.summaryValue}>${deliveryFee.toFixed(2)}</Text>
                  </View>
                )}
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryTotal}>Total</Text>
                  <Text style={styles.summaryTotalValue}>${total.toFixed(2)}</Text>
                </View>
              </>
            )}
            {subtotal === 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{listing.type === 'free' ? 'Free listing' : 'Trade request'}</Text>
                <Text style={[styles.summaryValue, { color: Colors.freshGreen }]}>
                  {listing.type === 'free' ? 'Free' : 'Trade'}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.trustRow}>
          <Shield size={14} color={Colors.primary} />
          <Text style={styles.trustText}>Protected by Gnome Buyer Guarantee</Text>
        </View>

        <Pressable
          style={[styles.placeOrderBtn, isSubmitting && styles.placeOrderBtnDisabled]}
          onPress={handlePlaceOrder}
          disabled={isSubmitting}
        >
          <CheckCircle size={18} color={Colors.textInverse} />
          <Text style={styles.placeOrderText}>
            {isSubmitting ? 'Placing Order...' : total > 0 ? `Place Order · $${total.toFixed(2)}` : 'Send Request'}
          </Text>
        </Pressable>

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
    backgroundColor: Colors.background,
  },
  notFoundText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  listingCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    margin: 20,
    borderRadius: 16,
    padding: 14,
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  listingImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  listingInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  listingTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  listingSeller: {
    fontSize: 13,
    color: Colors.primaryLight,
    fontWeight: '600' as const,
    marginBottom: 4,
  },
  listingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listingDistance: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  orderTypeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  orderTypeInfo: {
    flex: 1,
  },
  orderTypeLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  orderTypeDesc: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  pickupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickupText: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  noteInput: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 80,
    textAlignVertical: 'top' as const,
  },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  paymentOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '06',
  },
  paymentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  paymentIconWrapSelected: {
    backgroundColor: Colors.primary + '15',
  },
  paymentInfo: {
    flex: 1,
  },
  paymentLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  paymentLabelSelected: {
    color: Colors.primary,
  },
  paymentSublabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterSelected: {
    borderColor: Colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: 8,
  },
  summaryTotal: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  summaryTotalValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  trustText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  placeOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  placeOrderBtnDisabled: {
    opacity: 0.6,
  },
  placeOrderText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  bottomSpacer: {
    height: 40,
  },
});
