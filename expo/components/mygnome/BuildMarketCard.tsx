import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';

// Entry point for the Build My Market import flow: sellers who already sell
// elsewhere (Facebook, a farm stand) bring their inventory over as drafts.
// The screen itself owns all the copy and semantics — this is just the door.
export default function BuildMarketCard() {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <Pressable style={styles.card} onPress={() => router.push('/import' as never)} accessibilityRole="button">
        <Text style={styles.emoji}>🧺</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Build My Market with Gnome</Text>
          <Text style={styles.sub}>
            Already selling somewhere else? Upload a screenshot or photo and Gnome
            turns what you sell into draft listings.
          </Text>
        </View>
        <ChevronRight size={20} color={Colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  emoji: { fontSize: 24 },
  title: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  sub: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 1, lineHeight: 17 },
});
