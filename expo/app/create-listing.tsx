import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera, X, Plus, Truck, MapPin, Package as PackageIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useApp } from '@/providers/AppProvider';
import { Listing, ListingType, ListingCategory, DeliveryOption } from '@/types';
import { currentUser } from '@/mocks/users';
import Colors from '@/constants/colors';

const listingTypes: { id: ListingType; label: string; description: string }[] = [
  { id: 'sell', label: 'Sell', description: 'Set a price' },
  { id: 'trade', label: 'Trade', description: 'Exchange items' },
  { id: 'free', label: 'Free', description: 'Give away' },
];

const categoryOptions: { id: ListingCategory; label: string; emoji: string }[] = [
  { id: 'produce', label: 'Produce', emoji: '🥬' },
  { id: 'herbs', label: 'Herbs', emoji: '🌿' },
  { id: 'fruits', label: 'Fruits', emoji: '🍎' },
  { id: 'seeds', label: 'Seeds', emoji: '🌰' },
  { id: 'seedlings', label: 'Seedlings', emoji: '🌱' },
  { id: 'plants', label: 'Plants', emoji: '🪴' },
  { id: 'flowers', label: 'Flowers', emoji: '💐' },
  { id: 'supplies', label: 'Supplies', emoji: '🧰' },
  { id: 'decor', label: 'Decor', emoji: '🎍' },
  { id: 'handmade', label: 'Handmade', emoji: '🎨' },
  { id: 'gnomes', label: 'Gnomes', emoji: '🍄' },
  { id: 'eggs', label: 'Eggs', emoji: '🥚' },
  { id: 'honey', label: 'Honey', emoji: '🍯' },
  { id: 'baked', label: 'Baked Goods', emoji: '🍞' },
  { id: 'preserves', label: 'Preserves', emoji: '🫙' },
];

const deliveryOptionsList: { id: DeliveryOption; label: string; icon: 'MapPin' | 'Truck' | 'PackageIcon' }[] = [
  { id: 'pickup', label: 'Pickup', icon: 'MapPin' },
  { id: 'local_delivery', label: 'Local Delivery', icon: 'Truck' },
  { id: 'ships', label: 'Ships', icon: 'PackageIcon' },
];

const seedCategories: ListingCategory[] = ['seeds'];
const plantCategories: ListingCategory[] = ['seedlings', 'plants', 'flowers'];
const decorCategories: ListingCategory[] = ['decor', 'handmade', 'gnomes'];
const supplyCategories: ListingCategory[] = ['supplies'];

export default function CreateListingScreen() {
  const router = useRouter();
  const { addListing } = useApp();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [type, setType] = useState<ListingType>('sell');
  const [category, setCategory] = useState<ListingCategory>('produce');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [tradeFor, setTradeFor] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>(['pickup']);

  const [packetSize, setPacketSize] = useState('');
  const [plantingSeason, setPlantingSeason] = useState('');
  const [sunNeeds, setSunNeeds] = useState('');
  const [waterNeeds, setWaterNeeds] = useState('');
  const [potSize, setPotSize] = useState('');
  const [material, setMaterial] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [isHandmade, setIsHandmade] = useState(false);
  const [weight, setWeight] = useState('');

  const isSeedCategory = seedCategories.includes(category);
  const isPlantCategory = plantCategories.includes(category);
  const isDecorCategory = decorCategories.includes(category);
  const isSupplyCategory = supplyCategories.includes(category);

  const toggleDelivery = useCallback((option: DeliveryOption) => {
    setDeliveryOptions(prev =>
      prev.includes(option)
        ? prev.filter(o => o !== option)
        : [...prev, option]
    );
  }, []);

  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setImages(prev => [...prev, result.assets[0]!.uri]);
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please add a title for your listing.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Missing Description', 'Please add a description.');
      return;
    }

    const newListing: Listing = {
      id: `listing-${Date.now()}`,
      title: title.trim(),
      description: description.trim(),
      images: images.length > 0 ? images : ['https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600&h=400&fit=crop'],
      price: type === 'sell' && price ? parseFloat(price) : undefined,
      type,
      category,
      status: 'active',
      quantity: quantity.trim() || 'Various',
      tradeFor: type === 'trade' ? tradeFor.trim() : undefined,
      pickupLocation: pickupLocation.trim() || 'To be arranged',
      availableFrom: new Date().toISOString().split('T')[0] ?? '',
      seller: currentUser,
      distance: 0,
      createdAt: new Date().toISOString(),
      deliveryOptions: deliveryOptions.length > 0 ? deliveryOptions : ['pickup'],
      seedMeta: isSeedCategory ? {
        packetSize: packetSize.trim() || undefined,
        plantingSeason: plantingSeason.trim() || undefined,
      } : undefined,
      plantMeta: isPlantCategory ? {
        sunNeeds: sunNeeds.trim() || undefined,
        waterNeeds: waterNeeds.trim() || undefined,
        potSize: potSize.trim() || undefined,
      } : undefined,
      decorMeta: isDecorCategory ? {
        material: material.trim() || undefined,
        dimensions: dimensions.trim() || undefined,
        handmade: isHandmade || undefined,
      } : undefined,
      supplyMeta: isSupplyCategory ? {
        weight: weight.trim() || undefined,
      } : undefined,
    };

    addListing(newListing);

    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    router.back();
  }, [title, description, images, type, category, price, quantity, tradeFor, pickupLocation, deliveryOptions, addListing, router, isSeedCategory, isPlantCategory, isDecorCategory, isSupplyCategory, packetSize, plantingSeason, sunNeeds, waterNeeds, potSize, material, dimensions, isHandmade, weight]);

  const DeliveryIcon = ({ iconName, size, color }: { iconName: string; size: number; color: string }) => {
    if (iconName === 'Truck') return <Truck size={size} color={color} />;
    if (iconName === 'PackageIcon') return <PackageIcon size={size} color={color} />;
    return <MapPin size={size} color={color} />;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New Listing' }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.imageSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageRow}>
            {images.map((uri, i) => (
              <View key={i} style={styles.imageThumb}>
                <Image source={{ uri }} style={styles.thumbImage} contentFit="cover" />
                <Pressable style={styles.removeImageBtn} onPress={() => removeImage(i)}>
                  <X size={14} color={Colors.textInverse} />
                </Pressable>
              </View>
            ))}
            <Pressable style={styles.addImageBtn} onPress={pickImage}>
              <Camera size={24} color={Colors.primary} />
              <Text style={styles.addImageText}>Add Photo</Text>
            </Pressable>
          </ScrollView>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>Listing Type</Text>
          <View style={styles.typeRow}>
            {listingTypes.map(lt => (
              <Pressable
                key={lt.id}
                style={[styles.typeCard, type === lt.id && styles.typeCardActive]}
                onPress={() => setType(lt.id)}
              >
                <Text style={[styles.typeLabel, type === lt.id && styles.typeLabelActive]}>{lt.label}</Text>
                <Text style={[styles.typeDesc, type === lt.id && styles.typeDescActive]}>{lt.description}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Cherokee Purple Tomato Seeds"
            placeholderTextColor={Colors.textTertiary}
            value={title}
            onChangeText={setTitle}
            maxLength={60}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe your item, how it was grown or made, etc."
            placeholderTextColor={Colors.textTertiary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            maxLength={500}
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryGrid}>
            {categoryOptions.map(cat => (
              <Pressable
                key={cat.id}
                style={[styles.categoryChip, category === cat.id && styles.categoryChipActive]}
                onPress={() => setCategory(cat.id)}
              >
                <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                <Text style={[styles.categoryText, category === cat.id && styles.categoryTextActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {type === 'sell' && (
            <>
              <Text style={styles.label}>Price ($)</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                placeholderTextColor={Colors.textTertiary}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
              />
            </>
          )}

          {type === 'trade' && (
            <>
              <Text style={styles.label}>What do you want in trade?</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Herbs, eggs, or other veggies"
                placeholderTextColor={Colors.textTertiary}
                value={tradeFor}
                onChangeText={setTradeFor}
              />
            </>
          )}

          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., 2 lbs, 1 packet, 6 seedlings"
            placeholderTextColor={Colors.textTertiary}
            value={quantity}
            onChangeText={setQuantity}
          />

          <Text style={styles.label}>Delivery Options</Text>
          <View style={styles.deliveryRow}>
            {deliveryOptionsList.map(opt => {
              const isSelected = deliveryOptions.includes(opt.id);
              return (
                <Pressable
                  key={opt.id}
                  style={[styles.deliveryChip, isSelected && styles.deliveryChipActive]}
                  onPress={() => toggleDelivery(opt.id)}
                >
                  <DeliveryIcon
                    iconName={opt.icon}
                    size={14}
                    color={isSelected ? Colors.textOnPrimary : Colors.primary}
                  />
                  <Text style={[styles.deliveryText, isSelected && styles.deliveryTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Pickup Location</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., SE Hawthorne & 39th"
            placeholderTextColor={Colors.textTertiary}
            value={pickupLocation}
            onChangeText={setPickupLocation}
          />

          {isSeedCategory && (
            <View style={styles.metaSection}>
              <Text style={styles.metaSectionTitle}>🌰 Seed Details</Text>
              <Text style={styles.label}>Packet Size</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., ~30 seeds"
                placeholderTextColor={Colors.textTertiary}
                value={packetSize}
                onChangeText={setPacketSize}
              />
              <Text style={styles.label}>Planting Season</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Spring (Mar-May)"
                placeholderTextColor={Colors.textTertiary}
                value={plantingSeason}
                onChangeText={setPlantingSeason}
              />
            </View>
          )}

          {isPlantCategory && (
            <View style={styles.metaSection}>
              <Text style={styles.metaSectionTitle}>🪴 Plant Details</Text>
              <Text style={styles.label}>Sun Needs</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Full sun, Partial shade"
                placeholderTextColor={Colors.textTertiary}
                value={sunNeeds}
                onChangeText={setSunNeeds}
              />
              <Text style={styles.label}>Water Needs</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Regular, Low"
                placeholderTextColor={Colors.textTertiary}
                value={waterNeeds}
                onChangeText={setWaterNeeds}
              />
              <Text style={styles.label}>Pot Size</Text>
              <TextInput
                style={styles.input}
                placeholder='e.g., 4" pot'
                placeholderTextColor={Colors.textTertiary}
                value={potSize}
                onChangeText={setPotSize}
              />
            </View>
          )}

          {isDecorCategory && (
            <View style={styles.metaSection}>
              <Text style={styles.metaSectionTitle}>🎨 Item Details</Text>
              <Text style={styles.label}>Material</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Ceramic, Wood, Concrete"
                placeholderTextColor={Colors.textTertiary}
                value={material}
                onChangeText={setMaterial}
              />
              <Text style={styles.label}>Dimensions</Text>
              <TextInput
                style={styles.input}
                placeholder='e.g., 8" H × 4" W'
                placeholderTextColor={Colors.textTertiary}
                value={dimensions}
                onChangeText={setDimensions}
              />
              <Pressable
                style={[styles.toggleRow]}
                onPress={() => setIsHandmade(!isHandmade)}
              >
                <View style={[styles.toggleCheck, isHandmade && styles.toggleCheckActive]}>
                  {isHandmade && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.toggleLabel}>This item is handmade</Text>
              </Pressable>
            </View>
          )}

          {isSupplyCategory && (
            <View style={styles.metaSection}>
              <Text style={styles.metaSectionTitle}>🧰 Supply Details</Text>
              <Text style={styles.label}>Weight / Volume</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., 5 gallons, 40 lbs"
                placeholderTextColor={Colors.textTertiary}
                value={weight}
                onChangeText={setWeight}
              />
            </View>
          )}

          <Pressable style={styles.submitBtn} onPress={handleSubmit}>
            <Plus size={20} color={Colors.textInverse} />
            <Text style={styles.submitBtnText}>Create Listing</Text>
          </Pressable>

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  imageSection: {
    paddingVertical: 16,
  },
  imageRow: {
    paddingHorizontal: 20,
    gap: 12,
  },
  imageThumb: {
    width: 100,
    height: 100,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImageBtn: {
    width: 100,
    height: 100,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  addImageText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  formSection: {
    paddingHorizontal: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
    marginTop: 16,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  typeCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  typeCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  typeLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  typeLabelActive: {
    color: Colors.textInverse,
  },
  typeDesc: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  typeDescActive: {
    color: 'rgba(255,255,255,0.7)',
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryEmoji: {
    fontSize: 14,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  categoryTextActive: {
    color: Colors.textInverse,
  },
  deliveryRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  deliveryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  deliveryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  deliveryText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  deliveryTextActive: {
    color: Colors.textOnPrimary,
  },
  metaSection: {
    marginTop: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metaSectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  toggleCheck: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  toggleCheckActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: {
    color: Colors.textInverse,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  toggleLabel: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 28,
  },
  submitBtnText: {
    color: Colors.textInverse,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  bottomSpacer: {
    height: 60,
  },
});
