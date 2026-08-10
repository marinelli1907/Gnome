// One Grow Log timeline entry. Owner notes get a distinct marigold tint and an
// explicit "Owner note" label so they can never be confused with grower
// updates. Only the entry's author gets an Edit affordance (RLS enforces the
// same rule server-side — the affordance just matches reality).
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import {
  STAGES,
  useEditGrowEntry,
  type GrowLogEntry,
  type GrowStage,
} from '@/lib/growlog';
import GrowPhotoThumb from './GrowPhotoThumb';
import StageChips from './StageChips';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function EntryCard({
  entry,
  uid,
  claimId,
  onPhotoPress,
}: {
  entry: GrowLogEntry;
  uid: string;
  claimId: string;
  onPhotoPress: (url: string) => void;
}) {
  const isOwnerNote = entry.kind === 'owner_note';
  const isAuthor = entry.author_id === uid;
  const edit = useEditGrowEntry(uid);

  const [editing, setEditing] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eNotes, setENotes] = useState('');
  const [eStage, setEStage] = useState<GrowStage | null>(null);

  const stageMeta = entry.stage ? STAGES.find((s) => s.value === entry.stage) ?? null : null;
  const edited =
    new Date(entry.updated_at).getTime() > new Date(entry.created_at).getTime() + 60_000;

  const startEdit = () => {
    setETitle(entry.title ?? '');
    setENotes(entry.notes ?? '');
    setEStage(entry.stage ?? null);
    setEditing(true);
  };

  const save = async () => {
    try {
      await edit.mutateAsync({
        entryId: entry.id,
        claimId,
        title: eTitle.trim() || null,
        notes: eNotes.trim() || null,
        stage: isOwnerNote ? null : eStage,
      });
      setEditing(false);
    } catch (e: any) {
      Alert.alert('Couldn’t save', e?.message ?? 'Check your connection and try again.');
    }
  };

  return (
    <View style={[styles.card, isOwnerNote && styles.ownerCard]}>
      <View style={styles.head}>
        <Text style={styles.date}>{fmtDate(entry.created_at)}</Text>
        {isOwnerNote ? (
          <View style={styles.ownerTag}>
            <Text style={styles.ownerTagText}>🏡 Owner note</Text>
          </View>
        ) : null}
        {stageMeta ? (
          <View style={styles.stageChip}>
            <Text style={styles.stageChipText}>
              {stageMeta.emoji} {stageMeta.label}
            </Text>
          </View>
        ) : null}
        {edited ? <Text style={styles.editedText}>edited</Text> : null}
        <View style={{ flex: 1 }} />
        {isAuthor && !editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit this entry"
            onPress={startEdit}
            hitSlop={8}
            style={styles.editBtn}
          >
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      {editing ? (
        <View style={{ gap: 10, marginTop: 8 }}>
          {!isOwnerNote ? <StageChips value={eStage} onChange={setEStage} /> : null}
          <TextInput
            style={styles.input}
            value={eTitle}
            onChangeText={setETitle}
            placeholder="Title (optional)"
            placeholderTextColor={Colors.textTertiary}
            accessibilityLabel="Entry title"
          />
          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={eNotes}
            onChangeText={setENotes}
            placeholder="Notes"
            placeholderTextColor={Colors.textTertiary}
            multiline
            accessibilityLabel="Entry notes"
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setEditing(false)}
              style={{ flex: 1 }}
            />
            <Button
              label="Save"
              onPress={() => void save()}
              loading={edit.isPending}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : (
        <>
          {entry.title ? <Text style={styles.title}>{entry.title}</Text> : null}
          {entry.notes ? <Text style={styles.notes}>{entry.notes}</Text> : null}
          {(entry.photos ?? []).length > 0 ? (
            <View style={styles.photoRow}>
              {entry.photos!.map((p) => (
                <GrowPhotoThumb key={p.id} path={p.storage_path} onPress={onPhotoPress} />
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  // Marigold tint — visibly a different voice than the grower's updates.
  ownerCard: { backgroundColor: '#DFA23A14', borderColor: '#DFA23A66' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  date: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  ownerTag: {
    backgroundColor: '#DFA23A2A',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ownerTagText: { fontSize: 11.5, fontFamily: fonts.bold, color: '#8A6116' },
  stageChip: {
    backgroundColor: Colors.primary + '14',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stageChipText: { fontSize: 11.5, fontFamily: fonts.bold, color: Colors.primary },
  editedText: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary, fontStyle: 'italic' },
  editBtn: { minHeight: 32, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  editBtnText: { fontSize: 13, fontFamily: fonts.bold, color: Colors.primary },
  title: { fontSize: 15.5, fontFamily: fonts.bold, color: Colors.text, marginTop: 6 },
  notes: { fontSize: 14, fontFamily: fonts.regular, color: Colors.text, marginTop: 4, lineHeight: 20 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    fontFamily: fonts.regular,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
});
