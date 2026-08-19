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
  // `danger` used to be Harvest Yellow with a white label — 1.63:1, the exact
  // combination the identity spec calls unshippable — and it read as
  // celebration on Void / Decline. It is now the error token: a genuine
  // destructive action is distinguishable from a brand-red primary action, and
  // white on #C62828 measures 5.62:1.
  const bg =
    variant === 'primary'
      ? Colors.primary
      : variant === 'danger'
        ? Colors.error
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
/**
 * A text field has to LOOK like one. The old styling used the card colour on
 * the parchment background with a hairline border — near-invisible, so people
 * couldn't tell where to tap. Inputs now sit on white with a defined border
 * and a green focus ring.
 */
export function Field({
  label,
  style,
  onFocus,
  onBlur,
  ...props
}: { label: string } & TextInputProps) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused, style]}
        placeholderTextColor={Colors.textTertiary}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
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
/**
 * A tinted status pill. `color` is the SEMANTIC HUE — it tints the fill and
 * draws the border; it is never used as the label colour.
 *
 * Why: the label used to be drawn in `color` on a 10% wash of the same colour,
 * which fails for most of the palette and is catastrophic for some. Measured on
 * the composited wash: brand red 3.86:1 and success green 3.98:1 both miss AA,
 * and `Badge color={Colors.accent}` — a real call site in market/pickups — was
 * Harvest Yellow on a yellow wash at 1.50:1, i.e. blank. (Two tokens did pass:
 * error 4.78:1 and AI purple 5.07:1. The rule is still worth applying uniformly,
 * because a component whose legibility depends on which hue a caller happens to
 * pass is a trap, not a design.)
 *
 * Charcoal on the wash is 13:1 or better for every hue in the palette (measured
 * worst case: charcoal #222222 on a 13% Gnome Red wash = 13.0:1; on a 13% Garden
 * Green wash = 14.1:1). The hue still distinguishes at a glance via fill +
 * border, and every caller passes a status WORD, so colour is not the only
 * signal (identity §1b).
 */
export function Badge({ label, color = Colors.primary }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={styles.badgeText}>{label}</Text>
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
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    fontSize: 16,
    color: Colors.text,
    fontFamily: fonts.regular,
  },
  inputFocused: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceElevated,
    shadowColor: Colors.primary,
    shadowOpacity: 0.14,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  avatarFallback: {
    // The initial is white text on this fill, so it needs the INTERACTIVE cut,
    // not the brand cut: white on #E32C27 is 4.51:1, on #E53935 only 4.23:1
    // (and the initial is 16px bold at the default size, not "large text").
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  badgeText: { fontSize: 12, fontFamily: fonts.bold, color: Colors.text },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  emptyEmoji: { fontSize: 48, fontFamily: fonts.regular },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text, textAlign: 'center' },
  emptySub: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
