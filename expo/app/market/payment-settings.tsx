// Seller payment methods — one card per method with an enable switch and the
// handle buyers need. Saved per card; only enabled methods are ever shown to
// buyers. Gnome never touches the money.
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket } from '@/lib/db';
import {
  METHOD_LABEL,
  useMarketPaymentMethods,
  useSavePaymentMethod,
  type MarketPaymentMethod,
  type PaymentMethodKind,
} from '@/lib/marketops';

const METHODS: PaymentMethodKind[] = ['venmo', 'paypal', 'cashapp', 'zelle', 'cash', 'other'];

const HANDLE_META: Partial<
  Record<PaymentMethodKind, { label: string; placeholder: string; hint?: string }>
> = {
  venmo: { label: 'Venmo username', placeholder: 'your-username' },
  paypal: { label: 'PayPal.Me name', placeholder: 'YourName' },
  cashapp: { label: '$Cashtag', placeholder: '$yourcashtag' },
  zelle: {
    label: 'Zelle identifier (email or phone)',
    placeholder: 'you@example.com',
    hint: 'Zelle has no public payment link — buyers see this identifier.',
  },
};

function MethodCard({
  method,
  saved,
  marketId,
}: {
  method: PaymentMethodKind;
  saved: MarketPaymentMethod | undefined;
  marketId: string;
}) {
  const save = useSavePaymentMethod(marketId);
  const [enabled, setEnabled] = useState(false);
  const [handle, setHandle] = useState('');
  const [label, setLabel] = useState('');
  const [instructions, setInstructions] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (saved && !seeded) {
      setEnabled(saved.enabled);
      setHandle(saved.handle ?? '');
      setLabel(saved.label ?? '');
      setInstructions(saved.instructions ?? '');
      setSeeded(true);
    }
  }, [saved, seeded]);

  const meta = HANDLE_META[method];
  const needsHandle = method === 'venmo' || method === 'paypal' || method === 'cashapp' || method === 'zelle';

  const onSave = async () => {
    if (enabled && needsHandle && !handle.trim()) {
      Alert.alert('Add your handle', `Buyers need your ${METHOD_LABEL[method]} details to pay you.`);
      return;
    }
    try {
      await save.mutateAsync({
        method,
        enabled,
        handle: handle || null,
        label: label || null,
        instructions: instructions || null,
      });
      setDirty(false);
    } catch (e: any) {
      Alert.alert('Couldn’t save', e?.message ?? 'Check your connection and try again.');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{METHOD_LABEL[method]}</Text>
        <Switch
          value={enabled}
          onValueChange={(v) => {
            setEnabled(v);
            setDirty(true);
          }}
          trackColor={{ true: Colors.primary, false: Colors.border }}
          thumbColor={Colors.surfaceElevated}
          accessibilityRole="switch"
          accessibilityLabel={`${METHOD_LABEL[method]} ${enabled ? 'enabled' : 'disabled'}`}
        />
      </View>

      {meta ? (
        <Field
          label={meta.label}
          value={handle}
          onChangeText={(t) => {
            setHandle(t);
            setDirty(true);
          }}
          placeholder={meta.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
      {meta?.hint ? <Text style={styles.hint}>{meta.hint}</Text> : null}

      {method === 'cash' ? (
        <Text style={styles.hint}>Buyers see “Cash at pickup” — nothing else to set up.</Text>
      ) : null}

      {method === 'other' ? (
        <>
          <Field
            label="Label"
            value={label}
            onChangeText={(t) => {
              setLabel(t);
              setDirty(true);
            }}
            placeholder="Check, farm credit…"
          />
          <Field
            label="Instructions for buyers"
            value={instructions}
            onChangeText={(t) => {
              setInstructions(t);
              setDirty(true);
            }}
            placeholder="How should buyers pay this way?"
            multiline
            numberOfLines={2}
            style={styles.multiline}
          />
        </>
      ) : null}

      {dirty ? (
        <Button label="Save" onPress={() => void onSave()} loading={save.isPending} />
      ) : null}
    </View>
  );
}

export default function PaymentSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;
  const methods = useMarketPaymentMethods(marketId);

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔑" title="Sign in" subtitle="Payment methods belong to your Market.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (market.isLoading || (marketId && methods.isLoading)) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (!marketId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🏡" title="No Market yet" subtitle="Post a listing to create your Market first." />
      </View>
    );
  }

  const byMethod = new Map((methods.data ?? []).map((m) => [m.method, m]));

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          How buyers pay you at pickup. Only enabled methods are shown to buyers — Gnome never
          processes the payment.
        </Text>
        {METHODS.map((m) => (
          <MethodCard key={m} method={m} saved={byMethod.get(m)} marketId={marketId} />
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  intro: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 19, marginBottom: 14 },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 4,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textTertiary, lineHeight: 17, marginBottom: 8 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
});
