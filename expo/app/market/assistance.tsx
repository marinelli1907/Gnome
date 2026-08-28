import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ShieldCheck } from 'lucide-react-native';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type Level = 'OFF' | 'SUPPORT' | 'MANAGED';

const LEVELS: { id: Level; name: string; detail: string }[] = [
  { id: 'OFF', name: 'Off', detail: 'Gnome cannot manage ordinary Market details for you.' },
  { id: 'SUPPORT', name: 'Support only', detail: 'Gnome may prepare suggestions. You approve every change.' },
  { id: 'MANAGED', name: 'Managed Market', detail: 'Authorize only the ordinary actions you select below.' },
];

const ACTIONS = [
  ['CREATE_LISTING_DRAFT', 'Prepare listing drafts'],
  ['EDIT_MARKET_DESCRIPTION', 'Edit Market description'],
  ['UPDATE_LISTING_QUANTITY', 'Update listing quantity'],
  ['MARK_SOLD_OUT', 'Mark listings sold out'],
  ['UPDATE_HOURS', 'Update stand hours'],
  ['PAUSE_LISTING', 'Pause listings'],
  ['PREPARE_PROMOTION', 'Prepare promotions'],
] as const;

export default function MarketAssistanceScreen() {
  const [level, setLevel] = useState<Level>('OFF');
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('market_assistance_authorizations')
      .select('level,allowed_actions').maybeSingle();
    if (error) Alert.alert('Could not load assistance', error.message);
    if (data) {
      setLevel(data.level as Level);
      setActions((data.allowed_actions as string[]) ?? []);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const chooseLevel = (next: Level) => {
    setLevel(next);
    if (next !== 'MANAGED') setActions([]);
  };
  const toggle = (action: string) => setActions((current) =>
    current.includes(action) ? current.filter((a) => a !== action) : [...current, action]);

  const save = () => {
    const detail = level === 'MANAGED'
      ? `You are authorizing ${actions.length} selected ordinary Market action${actions.length === 1 ? '' : 's'}. You can revoke this at any time.`
      : level === 'SUPPORT' ? 'Gnome may prepare suggestions, but you must approve every change.'
        : 'This revokes ordinary Market-management permission.';
    Alert.alert(`Set assistance to ${LEVELS.find((l) => l.id === level)?.name}?`, detail, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: level === 'OFF' ? 'destructive' : 'default', onPress: async () => {
        setBusy(true);
        const { error } = await supabase.rpc('set_market_assistance', {
          p_level: level,
          p_allowed_actions: level === 'MANAGED' ? actions : [],
        });
        setBusy(false);
        if (error) Alert.alert('Could not save assistance', error.message);
        else Alert.alert('Assistance updated', level === 'OFF' ? 'Managed Market permission is revoked.' : 'Your selected controls are now active.');
      } },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.intro}>
        <ShieldCheck size={24} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Gnome assistance</Text>
          <Text style={styles.body}>You stay in control of your Market. These permissions never include your password, identity, policies, banking, payouts, or compliance verification.</Text>
        </View>
      </View>

      {LEVELS.map((item) => (
        <Pressable key={item.id} onPress={() => chooseLevel(item.id)} style={[styles.option, level === item.id && styles.optionActive]}>
          <View style={[styles.check, level === item.id && styles.checkActive]}>{level === item.id && <Check size={15} color="#FFFFFF" />}</View>
          <View style={{ flex: 1 }}><Text style={styles.optionTitle}>{item.name}</Text><Text style={styles.body}>{item.detail}</Text></View>
        </Pressable>
      ))}

      {level === 'MANAGED' && (
        <View style={styles.actions}>
          <Text style={styles.sectionTitle}>Allowed actions</Text>
          {ACTIONS.map(([id, label]) => (
            <Pressable key={id} onPress={() => toggle(id)} style={styles.actionRow}>
              <View style={[styles.box, actions.includes(id) && styles.boxActive]}>{actions.includes(id) && <Check size={14} color="#FFFFFF" />}</View>
              <Text style={styles.actionText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Button label={busy ? 'Saving…' : level === 'OFF' ? 'Turn assistance off' : 'Save assistance'}
        disabled={busy || (level === 'MANAGED' && actions.length === 0)} onPress={save} />
      <Text style={styles.foot}>Moderation and safety actions remain available to Gnome under the Marketplace Rules regardless of this setting.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  content: { padding: 18, paddingBottom: 48, gap: 10 },
  intro: { flexDirection: 'row', gap: 11, paddingBottom: 8 },
  title: { fontFamily: fonts.bold, fontSize: 21, color: Colors.text },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textSecondary, marginTop: 2 },
  option: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 8, backgroundColor: Colors.surface, padding: 13 },
  optionActive: { borderWidth: 2, borderColor: Colors.primary, padding: 12, backgroundColor: Colors.primary + '08' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
  checkActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionTitle: { fontFamily: fonts.bold, fontSize: 15, color: Colors.text },
  actions: { marginTop: 5, borderTopWidth: 1, borderColor: Colors.borderLight, paddingTop: 12, gap: 4 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 13, textTransform: 'uppercase', color: Colors.text, marginBottom: 4 },
  actionRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
  boxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  actionText: { fontFamily: fonts.semibold, fontSize: 13.5, color: Colors.text },
  foot: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: Colors.textTertiary, textAlign: 'center' },
});
