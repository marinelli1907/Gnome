import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';

// --- Button --------------------------------------------------------------
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  const bg =
    variant === 'primary'
      ? Colors.primary
      : variant === 'danger'
        ? Colors.accent
        : variant === 'secondary'
          ? Colors.surface
          : 'transparent';
  const fg =
    variant === 'secondary' || variant === 'ghost' ? Colors.primary : Colors.textInverse;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && styles.btnBordered,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

// --- Field ---------------------------------------------------------------
export function Field({
  label,
  ...props
}: { label: string } & TextInputProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={Colors.textTertiary}
        {...props}
      />
    </View>
  );
}

// --- Avatar --------------------------------------------------------------
export function Avatar({
  uri,
  name,
  size = 40,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
}) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
      />
    );
  }
  return (
    <View
      style={[
        styles.avatarFallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={{ color: Colors.textInverse, fontFamily: fonts.bold, fontSize: size * 0.4 }}>
        {initial}
      </Text>
    </View>
  );
}

// --- Badge ---------------------------------------------------------------
export function Badge({ label, color = Colors.primary }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '1A' }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// --- ErrorState (every error gets an action) ----------------------------
export function ErrorState({
  title = 'Something didn’t load',
  message,
  onRetry,
  emoji = '🌧️',
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  emoji?: string;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{message}</Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} style={{ marginTop: 12, paddingHorizontal: 32 }} /> : null}
    </View>
  );
}

// --- EmptyState ----------------------------------------------------------
export function EmptyState({
  emoji,
  title,
  subtitle,
  children,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  btnBordered: { borderWidth: 1.5, borderColor: Colors.primary },
  btnText: { fontSize: 16, fontFamily: fonts.bold },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
    fontFamily: fonts.regular,
  },
  avatarFallback: {
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontFamily: fonts.bold },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text, textAlign: 'center' },
  emptySub: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
