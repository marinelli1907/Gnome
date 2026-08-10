// What's planted on this plot. The grower can add, edit, and remove crops; the
// plot owner sees a read-only list. Linking a crop to a taxonomy node is
// optional — it powers the "List harvest" prefill later, nothing else.
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Button, Field } from '@/components/ui';
import TaxonomyPicker from '@/components/TaxonomyPicker';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { breadcrumb, useTaxonomy } from '@/lib/taxonomy';
import { useDeleteCrop, useSaveCrop, type PlotCrop } from '@/lib/growlog';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fmtDay = (ymd: string) =>
  new Date(ymd + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function CropsCard({
  claimId,
  uid,
  canEdit,
  crops,
}: {
  claimId: string;
  uid: string;
  canEdit: boolean;
  crops: PlotCrop[];
}) {
  const taxonomy = useTaxonomy();
  const index = taxonomy.data;
  const saveCrop = useSaveCrop(uid);
  const deleteCrop = useDeleteCrop();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [variety, setVariety] = useState('');
  const [plantedAt, setPlantedAt] = useState('');
  const [taxId, setTaxId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selNode = index && taxId ? index.byId.get(taxId) ?? null : null;

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setVariety('');
    setPlantedAt('');
    setTaxId(null);
  };

  const startAdd = () => {
    resetForm();
    setFormOpen(true);
  };

  const startEdit = (c: PlotCrop) => {
    setEditingId(c.id);
    setName(c.name);
    setVariety(c.variety ?? '');
    setPlantedAt(c.planted_at ?? '');
    setTaxId(c.taxonomy_node_id ?? null);
    setFormOpen(true);
  };

  const submit = async () => {
    if (!name.trim()) {
      Alert.alert('Name the crop', 'What did you plant? e.g., Tomatoes');
      return;
    }
    const planted = plantedAt.trim();
    if (planted && (!DATE_RE.test(planted) || Number.isNaN(new Date(planted + 'T00:00:00').getTime()))) {
      Alert.alert('Check the date', 'Planted date should look like 2026-08-01 (YYYY-MM-DD).');
      return;
    }
    try {
      await saveCrop.mutateAsync({
        claimId,
        id: editingId ?? undefined,
        taxonomyNodeId: taxId,
        name,
        variety: variety.trim() || null,
        plantedAt: planted || null,
      });
      resetForm();
      setFormOpen(false);
    } catch (e: any) {
      Alert.alert('Couldn’t save crop', e?.message ?? 'Check your connection and try again.');
    }
  };

  const confirmDelete = (c: PlotCrop) => {
    Alert.alert('Remove this crop?', `${c.name} comes off the plot list. Log entries stay.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          deleteCrop
            .mutateAsync({ id: c.id, claimId })
            .catch((e: any) => Alert.alert('Couldn’t remove', e?.message ?? 'Try again.')),
      },
    ]);
  };

  return (
    <View style={styles.card}>
      {crops.length === 0 ? (
        <Text style={styles.emptyText}>
          {canEdit
            ? 'Nothing listed yet — add what you planted so the log tells the story.'
            : 'The grower hasn’t listed any crops yet.'}
        </Text>
      ) : (
        crops.map((c) => {
          const node = index && c.taxonomy_node_id ? index.byId.get(c.taxonomy_node_id) ?? null : null;
          return (
            <View key={c.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {c.name}
                  {c.variety ? ` — ${c.variety}` : ''}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {c.planted_at ? `planted ${fmtDay(c.planted_at)}` : 'not planted yet'}
                  {node ? ` · ${node.name}` : ''}
                </Text>
              </View>
              {canEdit ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${c.name}`}
                    onPress={() => startEdit(c)}
                    style={styles.rowBtn}
                  >
                    <Text style={styles.rowBtnText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${c.name}`}
                    onPress={() => confirmDelete(c)}
                    style={styles.rowBtn}
                  >
                    <Text style={[styles.rowBtnText, { color: Colors.error }]}>Remove</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          );
        })
      )}

      {canEdit && formOpen ? (
        <View style={styles.form}>
          <Field label="Crop" value={name} onChangeText={setName} placeholder="Tomatoes" />
          <Field label="Variety (optional)" value={variety} onChangeText={setVariety} placeholder="Roma" />
          <Field
            label="Planted date (optional)"
            value={plantedAt}
            onChangeText={setPlantedAt}
            placeholder="2026-08-01"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.fieldLabel}>Category (optional)</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              selNode && index
                ? `Category: ${breadcrumb(index, selNode)}. Tap to change.`
                : 'Link to a category'
            }
            onPress={() => setPickerOpen(true)}
            style={[styles.catSelector, !selNode && styles.catSelectorEmpty]}
          >
            <Text
              style={[styles.catSelectorText, !selNode && styles.catSelectorPlaceholder]}
              numberOfLines={1}
            >
              {selNode && index ? breadcrumb(index, selNode) : 'Link to a category…'}
            </Text>
            <ChevronRight size={18} color={selNode ? Colors.primary : Colors.textTertiary} />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                resetForm();
                setFormOpen(false);
              }}
              style={{ flex: 1 }}
            />
            <Button
              label={editingId ? 'Save crop' : 'Add crop'}
              onPress={() => void submit()}
              loading={saveCrop.isPending}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : canEdit ? (
        <Button label="Add a crop" variant="ghost" onPress={startAdd} style={{ marginTop: 4 }} />
      ) : null}

      {index ? (
        <TaxonomyPicker
          visible={pickerOpen}
          index={index}
          selectedId={taxId}
          mode="sell"
          onSelect={(node) => setTaxId(node?.id ?? null)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
  },
  emptyText: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
    paddingVertical: 6,
  },
  rowTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  rowSub: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 1 },
  rowBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  rowBtnText: { fontSize: 13, fontFamily: fonts.bold, color: Colors.primary },
  form: { marginTop: 12, gap: 0 },
  fieldLabel: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  catSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '0D',
    paddingHorizontal: 14,
    marginBottom: 16,
    gap: 8,
  },
  catSelectorEmpty: { borderColor: Colors.border, backgroundColor: Colors.background, borderStyle: 'dashed' },
  catSelectorText: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: Colors.text },
  catSelectorPlaceholder: { color: Colors.textTertiary, fontFamily: fonts.regular },
});
