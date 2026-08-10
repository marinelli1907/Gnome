// Credential upload / resubmit / renew. Documents go to the PRIVATE
// compliance-docs bucket under the seller's own folder (storage RLS), the
// metadata row is inserted PENDING (sellers can never self-approve), and
// success is only reported after BOTH the row and the object provably exist.
import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { decode } from 'base64-arraybuffer';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, ChevronRight, FileText, X } from 'lucide-react-native';
import { Button, Field } from '@/components/ui';
import TaxonomyPicker from '@/components/TaxonomyPicker';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import {
  useMyCredentials,
  useMyProfile,
  useResubmitCredential,
  useSubmitCredential,
} from '@/lib/db';
import { pickImages } from '@/lib/images';
import { supabase } from '@/lib/supabase';
import { breadcrumb, useTaxonomy } from '@/lib/taxonomy';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface PickedDoc {
  kind: 'image' | 'pdf';
  base64: string;
  contentType: string;
  ext: string;
  label: string;
  bytes: number;
}

export default function CredentialUploadScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ scope?: string; resubmit?: string; renewOf?: string }>();
  const taxonomy = useTaxonomy();
  const index = taxonomy.data;
  const profile = useMyProfile(userId ?? undefined);
  const myCreds = useMyCredentials(userId ?? undefined);
  const submitCred = useSubmitCredential(userId ?? undefined);
  const resubmitCred = useResubmitCredential(userId ?? undefined);

  const resubmitTarget = params.resubmit
    ? myCreds.data?.find((c) => c.id === params.resubmit) ?? null
    : null;
  const renewTarget = params.renewOf
    ? myCreds.data?.find((c) => c.id === params.renewOf) ?? null
    : null;
  const template = resubmitTarget ?? renewTarget;

  const [scopeNodeId, setScopeNodeId] = useState<string | null>(params.scope ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [credType, setCredType] = useState(template?.credential_type ?? '');
  const [agency, setAgency] = useState(template?.issuing_agency ?? '');
  const [number, setNumber] = useState(template?.credential_number ?? '');
  const [issueDate, setIssueDate] = useState(template?.issue_date ?? '');
  const [expirationDate, setExpirationDate] = useState('');
  const [notes, setNotes] = useState('');
  const [doc, setDoc] = useState<PickedDoc | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill once the template row loads (deep link can beat the query).
  const templateKey = template?.id ?? '';
  const [seededFor, setSeededFor] = useState('');
  if (template && seededFor !== templateKey) {
    setSeededFor(templateKey);
    if (!credType) setCredType(template.credential_type);
    if (!agency) setAgency(template.issuing_agency ?? '');
    if (!number) setNumber(template.credential_number ?? '');
    if (!scopeNodeId && template.scope?.length) setScopeNodeId(template.scope[0].taxonomy_node_id);
  }

  const scopeNode = index && scopeNodeId ? index.byId.get(scopeNodeId) ?? null : null;
  const sellerState = (profile.data?.state ?? '').trim().toUpperCase();

  const heading = resubmitTarget
    ? 'Resubmit documentation'
    : renewTarget
      ? 'Renew credential'
      : 'Add seller verification';

  const pickPhoto = async () => {
    const picked = await pickImages({ selectionLimit: 1 });
    const asset = picked[0];
    if (!asset?.base64) return;
    const bytes = Math.ceil((asset.base64.length * 3) / 4);
    if (bytes > MAX_BYTES) {
      Alert.alert('Too large', 'Documents must be under 10MB.');
      return;
    }
    setDoc({
      kind: 'image',
      base64: asset.base64,
      contentType: 'image/jpeg',
      ext: 'jpg',
      label: 'Photo of document',
      bytes,
    });
  };

  const pickPdf = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const file = res.assets[0];
      if ((file.size ?? 0) > MAX_BYTES) {
        Alert.alert('Too large', 'Documents must be under 10MB.');
        return;
      }
      const mime = file.mimeType ?? 'application/pdf';
      if (!/^(application\/pdf|image\/jpeg|image\/png)$/.test(mime)) {
        Alert.alert('Unsupported file', 'Use a PDF, JPEG, or PNG.');
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = Math.ceil((base64.length * 3) / 4);
      if (bytes > MAX_BYTES) {
        Alert.alert('Too large', 'Documents must be under 10MB.');
        return;
      }
      setDoc({
        kind: mime === 'application/pdf' ? 'pdf' : 'image',
        base64,
        contentType: mime,
        ext: mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg',
        // Display name only — the uploaded object name is generated, never
        // the user's filename (which can leak device/source details).
        label: file.name ?? 'Document',
        bytes,
      });
    } catch {
      Alert.alert('Couldn’t read file', 'Try a different file.');
    }
  };

  const validate = (): string | null => {
    if (!userId) return 'Sign in first.';
    if (!scopeNode) return 'Pick the category this credential covers.';
    if (!credType.trim()) return 'Enter the credential type (e.g. “ODA Meat Vendor License”).';
    if (!sellerState || !/^[A-Z]{2}$/.test(sellerState))
      return 'Set your state in Edit Profile first — requirements depend on where you sell.';
    if (issueDate && !DATE_RE.test(issueDate)) return 'Issue date must be YYYY-MM-DD.';
    if (expirationDate && !DATE_RE.test(expirationDate)) return 'Expiration date must be YYYY-MM-DD.';
    if (expirationDate && new Date(expirationDate + 'T23:59:59').getTime() < Date.now())
      return 'That expiration date is already in the past.';
    if (!doc && !resubmitTarget) return 'Attach the document (photo or PDF).';
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      Alert.alert('Almost there', problem);
      return;
    }
    setBusy(true);
    try {
      // 1) Upload the document to the private bucket (owner folder = uid).
      let documentPath: string | null = resubmitTarget?.document_path ?? null;
      if (doc) {
        documentPath = `${userId}/${Date.now()}.${doc.ext}`;
        const { error: upErr } = await supabase.storage
          .from('compliance-docs')
          .upload(documentPath, decode(doc.base64), {
            contentType: doc.contentType,
            upsert: false,
          });
        if (upErr) throw new Error(`Document upload failed: ${upErr.message}`);
        // Prove the object exists before claiming anything succeeded.
        const { error: signErr } = await supabase.storage
          .from('compliance-docs')
          .createSignedUrl(documentPath, 60);
        if (signErr) throw new Error('Document did not persist — please try again.');
      }

      // 2) Write the metadata row (PENDING; server forbids anything else).
      if (resubmitTarget) {
        await resubmitCred.mutateAsync({
          credentialId: resubmitTarget.id,
          documentPath,
          expirationDate: expirationDate || null,
          credentialNumber: number.trim() || null,
          sellerNotes: notes.trim() || null,
        });
      } else {
        await submitCred.mutateAsync({
          state: sellerState,
          credentialType: credType.trim(),
          issuingAgency: agency.trim() || null,
          credentialNumber: number.trim() || null,
          issueDate: issueDate || null,
          expirationDate: expirationDate || null,
          documentPath,
          sellerNotes: notes.trim() || null,
          scopeNodeIds: [scopeNode!.id],
          renewalOfId: renewTarget?.id ?? null,
        });
      }

      Alert.alert(
        'Submitted for review',
        'Status: PENDING. Gnome will review your documentation; you’ll see the decision here and any affected drafts can publish automatically once approved.',
        [{ text: 'OK', onPress: () => router.replace('/compliance') }],
      );
    } catch (e: any) {
      Alert.alert('Submission failed', e?.message ?? 'Nothing was submitted. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const stateHint = useMemo(() => {
    if (profile.isLoading) return null;
    if (!sellerState)
      return 'Your profile has no state set. Add it in Edit Profile — verification requirements depend on your location.';
    return `Verifying for: ${sellerState}`;
  }, [profile.isLoading, sellerState]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>{heading}</Text>
        {renewTarget ? (
          <Text style={styles.subhead}>
            Renewing “{renewTarget.credential_type}”. Approved renewals resume your paused listings automatically.
          </Text>
        ) : null}
        {resubmitTarget?.denial_reason ? (
          <View style={styles.denial}>
            <Text style={styles.denialLabel}>What review asked you to fix</Text>
            <Text style={styles.denialText}>{resubmitTarget.denial_reason}</Text>
          </View>
        ) : null}

        <Text style={styles.fieldLabel}>Category this credential covers</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            scopeNode && index ? `Category: ${breadcrumb(index, scopeNode)}. Tap to change.` : 'Choose category'
          }
          onPress={() => setPickerOpen(true)}
          disabled={!!resubmitTarget}
          style={[styles.selector, !scopeNode && styles.selectorEmpty, !!resubmitTarget && { opacity: 0.6 }]}
        >
          <Text style={[styles.selectorText, !scopeNode && styles.selectorPlaceholder]} numberOfLines={1}>
            {scopeNode && index ? breadcrumb(index, scopeNode) : 'Choose category…'}
          </Text>
          <ChevronRight size={18} color={Colors.textTertiary} />
        </Pressable>
        <Text style={styles.hint}>
          Approval is scoped: a bait credential unlocks bait, not meat. Submit one credential per category.
        </Text>

        <Field
          label="Credential type"
          value={credType}
          onChangeText={setCredType}
          placeholder="e.g. ODA Meat Vendor License"
        />
        <Field
          label="Issuing agency (optional)"
          value={agency}
          onChangeText={setAgency}
          placeholder="e.g. Ohio Department of Agriculture"
        />
        <Field
          label="Permit / license / registration № (optional)"
          value={number}
          onChangeText={setNumber}
          placeholder="e.g. MV-2026-0142"
          autoCapitalize="characters"
        />
        <View style={styles.rowFields}>
          <View style={{ flex: 1 }}>
            <Field
              label="Issue date (optional)"
              value={issueDate}
              onChangeText={setIssueDate}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Expiration (optional)"
              value={expirationDate}
              onChangeText={setExpirationDate}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Document</Text>
        {doc ? (
          <View style={styles.docRow}>
            {doc.kind === 'pdf' ? (
              <FileText size={18} color={Colors.primary} />
            ) : (
              <Camera size={18} color={Colors.primary} />
            )}
            <Text style={styles.docLabel} numberOfLines={1}>
              {doc.label} · {(doc.bytes / 1024 / 1024).toFixed(1)}MB
            </Text>
            <Pressable
              onPress={() => setDoc(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Remove attached document"
            >
              <X size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.docBtns}>
            <Pressable accessibilityRole="button" style={styles.docBtn} onPress={() => void pickPhoto()}>
              <Camera size={18} color={Colors.primary} />
              <Text style={styles.docBtnText}>Photo</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.docBtn} onPress={() => void pickPdf()}>
              <FileText size={18} color={Colors.primary} />
              <Text style={styles.docBtnText}>PDF / file</Text>
            </Pressable>
          </View>
        )}
        {resubmitTarget && !doc ? (
          <Text style={styles.hint}>Leaving this empty keeps your previously uploaded document.</Text>
        ) : (
          <Text style={styles.hint}>JPEG, PNG, or PDF, up to 10MB. Stored privately.</Text>
        )}

        <Field
          label="Note to reviewer (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything that helps us verify faster"
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        {stateHint ? <Text style={styles.stateHint}>{stateHint}</Text> : null}

        <Button
          label={resubmitTarget ? 'Resubmit for review' : 'Submit for review'}
          onPress={() => void submit()}
          loading={busy}
        />
        <Text style={styles.disclaimer}>
          Gnome verifies documentation for marketplace access only. Keeping your
          permits current with the issuing agency remains your responsibility.
        </Text>
      </ScrollView>
      {index ? (
        <TaxonomyPicker
          visible={pickerOpen}
          index={index}
          selectedId={scopeNodeId}
          mode="sell"
          title="Which category does it cover?"
          onSelect={(node) => setScopeNodeId(node?.id ?? null)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  heading: { fontSize: 24, fontFamily: 'Fraunces_700Bold', color: Colors.text, marginBottom: 6 },
  subhead: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginBottom: 12, lineHeight: 19 },
  denial: { backgroundColor: '#DC26260D', borderRadius: 12, padding: 12, marginBottom: 14 },
  denialLabel: { fontSize: 12, fontFamily: fonts.bold, color: '#DC2626' },
  denialText: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.text, marginTop: 3, lineHeight: 19 },
  fieldLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, marginBottom: 6 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '0D',
    paddingHorizontal: 14,
    gap: 8,
  },
  selectorEmpty: { borderColor: Colors.border, backgroundColor: Colors.surface, borderStyle: 'dashed' },
  selectorText: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: Colors.text },
  selectorPlaceholder: { color: Colors.textTertiary, fontFamily: fonts.regular },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 6, marginBottom: 14, lineHeight: 17 },
  rowFields: { flexDirection: 'row', gap: 12 },
  docBtns: { flexDirection: 'row', gap: 10 },
  docBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: Colors.surface,
  },
  docBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.primary },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
  },
  docLabel: { flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: Colors.text },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  stateHint: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.textSecondary, marginBottom: 12 },
  disclaimer: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 14, lineHeight: 16, textAlign: 'center' },
});
