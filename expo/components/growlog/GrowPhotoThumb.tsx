// Thumbnail for a private grow-log photo. Resolves a short-lived signed URL
// once per mount (cached in component state), and hands the URL up on tap for
// full-screen viewing. Failed loads get an explicit retry — no silent blanks.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { growPhotoUrl } from '@/lib/growlog';

export default function GrowPhotoThumb({
  path,
  size = 72,
  onPress,
}: {
  path: string;
  size?: number;
  onPress: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    growPhotoUrl(path)
      .then(setUrl)
      .catch(() => setFailed(true));
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  const box = { width: size, height: size };
  if (failed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Photo failed to load. Tap to retry."
        onPress={load}
        style={[styles.box, box]}
      >
        <Text style={styles.retry}>↻</Text>
      </Pressable>
    );
  }
  if (!url) {
    return (
      <View style={[styles.box, box]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="View photo full screen"
      onPress={() => onPress(url)}
    >
      <Image source={{ uri: url }} style={[styles.img, box]} contentFit="cover" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: { borderRadius: 10 },
  retry: { fontSize: 20, color: Colors.textSecondary, fontFamily: fonts.bold },
});
