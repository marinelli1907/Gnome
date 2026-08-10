// The Grow Log composer. Growers post updates (optional stage, title, notes,
// up to 4 photos through the EXIF-stripping picker); plot owners post notes
// (title + notes only — no stage, no photos). Failures alert clearly and the
// form is preserved so nothing typed is ever lost.
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Camera, X } from 'lucide-react-native';
import { Button, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAddGrowEntry, type GrowStage } from '@/lib/growlog';
import { pickImages } from '@/lib/images';
import StageChips from './StageChips';

const MAX_PHOTOS = 4;

export default function ComposerSheet({
  visible,
  mode,
  claimId,
  uid,
  onClose,
}: {
  visible: boolean;
  mode: 'entry' | 'owner_note';
  claimId: string;
  uid: string;
  onClose: () => void;
}) {
  const addEntry = useAddGrowEntry(uid);
  const [stage, setStage] = useState<GrowStage | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [assets, setAssets] = useState<ImagePickerAsset[]>([]);

  const isEntry = mode === 'entry';

  const addPhotos = async () => {
    const picked = await pickImages({ selectionLimit: MAX_PHOTOS - assets.length });
    if (picked.length) setAssets((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  };

  const removeAsset = (uri: string) => setAssets((prev) => prev.filter((a) => a.uri !== uri));

  const submit = async () => {
    if (!isEntry && !notes.trim()) {
      Alert.alert('Write your note', 'A quick line for your grower is all it takes.');
      return;
    }
    if (isEntry && !stage && !title.trim() && !notes.trim() && assets.length === 0) {
      Alert.alert('Nothing to post yet', 'Pick a stage, write a note, or add a photo.');
      return;
    }
    try {
      await addEntry.mutateAsync({
        claimId,
        kind: mode,
        stage: isEntry ? stage : null,
        title: title.trim() || null,
        notes: notes.trim() || null,
        photoAssets: isEntry && assets.length ? assets : undefined,
      });
      // Only a confirmed save clears the form.
      setStage(null);
      setTitle('');
      setNotes('');
      setAssets([]);
      onClose();
    } catch (e: any) {
      Alert.alert(
        'Couldn’t post',
        (e?.message ?? 'Check your connection and try again.') + ' Your draft is still here.',
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: Colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{isEntry ? 'Add update' : 'Add owner note'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={10}
            style={styles.closeBtn}
          >
            <X size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {isEntry ? (
            <>
              <Text style={styles.label}>Stage (optional)</Text>
              <StageChips value={stage} onChange={setStage} />
              <View style={{ height: 12 }} />
            </>
          ) : (
            <Text style={styles.ownerHint}>
              Your note shows up in the grower’s timeline, clearly marked as from you.
            </Text>
          )}

          <Field
            label="Title (optional)"
            value={title}
            onChangeText={setTitle}
            placeholder={isEntry ? 'First ripe tomato!' : 'Water schedule'}
          />
          <Field
            label={isEntry ? 'Notes' : 'Note'}
            value={notes}
            onChangeText={setNotes}
            placeholder={
              isEntry
                ? 'How’s the plot doing?'
                : 'Anything your grower should know about the plot.'
            }
            multiline
            numberOfLines={4}
            style={styles.multiline}
          />

          {isEntry ? (
            <>
              <Text style={styles.label}>Photos (up to {MAX_PHOTOS})</Text>
              <View style={styles.photoRow}>
                {assets.map((a) => (
                  <View key={a.uri} style={styles.photo}>
                    <Image source={{ uri: a.uri }} style={styles.photoImg} contentFit="cover" />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove photo"
                      style={styles.removeBtn}
                      onPress={() => removeAsset(a.uri)}
                    >
                      <X size={14} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {assets.length < MAX_PHOTOS ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add photos"
                    style={styles.addPhoto}
                    onPress={() => void addPhotos()}
                  >
                    <Camera size={24} color={Colors.primary} />
                    <Text style={styles.addPhotoText}>Add photo</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.privacyNote}>
                Photos are private to you and the plot owner.
              </Text>
            </>
          ) : null}

          <Button
            label={isEntry ? 'Post update' : 'Post note'}
            onPress={() => void submit()}
            loading={addEntry.isPending}
            style={{ marginTop: 8 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  label: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  ownerHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 12,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  photo: { width: 76, height: 76, borderRadius: 12, overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%' },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhoto: {
    width: 76,
    height: 76,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  addPhotoText: { fontSize: 10, color: Colors.primary, textAlign: 'center', fontFamily: fonts.semibold },
  privacyNote: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginBottom: 8 },
});
