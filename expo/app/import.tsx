// Build My Market with Gnome — import what a seller already sells elsewhere.
//
// Sources (up to 4 photos/screenshots + optional pasted text) are read as
// base64 IN MEMORY and sent straight to the market-import function. They are
// NEVER uploaded to any storage bucket: an extraction source is not a listing
// photo (the created drafts get photos: {} server-side, and sellers add real
// photos later through the normal edit flow).
//
// All wording and payload shaping comes from @/lib/importReview — the shared
// semantics module with a byte-identical twin on web. This file only renders.
// Creation calls create_import_drafts, which validates everything again and
// makes ordinary listing_drafts; publishing stays in the existing flows and
// never happens here.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react-native';
import { Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { logEvent } from '@/lib/db';
import { canBuyDigitalInApp } from '@/lib/digitalPurchase';
import { pickImages } from '@/lib/images';
import {
  COMPLIANCE_NOTE, allowanceSummary, categoryLabel, conflictHeadline, conflictsFor,
  createButtonLabel, duplicateLabel, fieldIssues, importLimitCopy, priceLabel,
  resultHeadline, selectedCount, toCreatePayload,
  type ImportAllowance, type ImportCandidate, type ImportConflict,
  type ReviewCandidate, type TaxonomySuggestion,
} from '@/lib/importReview';

const MAX_SOURCES = 4;

type Extraction = {
  source_type: string;
  seller_context: string;
  multi_product: boolean;
  candidates: ImportCandidate[];
  missing_information: string[];
  conflicts: ImportConflict[];
  overall_confidence: string;
  recommended_next_action: string;
};

type CreateResult = {
  drafts_created: number;
  drafts_already_existed: number;
  draft_ids: string[];
  duplicates: { candidate_index: number; product_name: string; existing_listing_id: string }[];
  allowance: ImportAllowance;
};

const LISTING_TYPES: { key: ImportCandidate['proposed_listing_type']; label: string }[] = [
  { key: 'sale', label: 'Sell' },
  { key: 'free', label: 'Free' },
  { key: 'trade', label: 'Trade' },
  { key: 'wanted', label: 'Wanted' },
];

/** "$12" / "12.50" → integer cents, or null when unreadable. */
function parseCents(v: string): number | null {
  const digits = v.replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export default function ImportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { userId } = useAuth();

  const [phase, setPhase] = useState<'input' | 'analyzing' | 'review' | 'done'>('input');
  const [assets, setAssets] = useState<ImagePickerAsset[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  // Review state.
  const [requestId, setRequestId] = useState<string | null>(null);
  const [multi, setMulti] = useState(false);
  const [list, setList] = useState<ReviewCandidate[]>([]);
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  // The server's original suggestions per candidate — the editor's option set
  // even after "Let me pick later" empties a candidate's live taxonomy.
  const [suggestions, setSuggestions] = useState<TaxonomySuggestion[][]>([]);
  const [editing, setEditing] = useState<{ index: number; rc: ReviewCandidate } | null>(null);
  const [creating, setCreating] = useState(false);

  // Done state.
  const [result, setResult] = useState<CreateResult | null>(null);
  const [ackedDups, setAckedDups] = useState<number[]>([]);

  const count = selectedCount(list);

  const patch = useCallback((index: number, fn: (rc: ReviewCandidate) => ReviewCandidate) => {
    setList((l) => l.map((rc, i) => (i === index ? fn(rc) : rc)));
  }, []);

  // --- Input --------------------------------------------------------------

  const addFromLibrary = async () => {
    setError(null);
    const room = MAX_SOURCES - assets.length;
    if (room <= 0) return;
    const picked = await pickImages({ selectionLimit: room });
    if (picked.length) setAssets((prev) => [...prev, ...picked].slice(0, MAX_SOURCES));
  };

  const removeAsset = (uri: string) => setAssets((prev) => prev.filter((a) => a.uri !== uri));

  const cancelInputs = () => { setAssets([]); setPastedText(''); setError(null); };

  // --- Analyze ------------------------------------------------------------

  const analyze = async () => {
    const text = pastedText.trim();
    const images = assets
      .filter((a) => a.base64)
      .map((a) => ({ image_base64: a.base64!, media_type: 'image/jpeg' }));
    if (!images.length && !text) return;
    setError(null);
    setCanRetry(false);
    setPhase('analyzing');
    void logEvent('import_extraction_started', {
      userId, metadata: { images: images.length, has_text: !!text },
    });

    const fail = (reason: string, message: string, retryable = true) => {
      void logEvent('import_extraction_failed', { userId, metadata: { reason } });
      setError(message);
      setCanRetry(retryable);
      setPhase('input');
    };

    try {
      const { data, error: e } = await supabase.functions.invoke('market-import', {
        body: { ...(images.length ? { images } : {}), ...(text ? { text } : {}) },
      });
      if (e) {
        // FunctionsHttpError carries the function's JSON body with our message.
        const body = await (e as { context?: Response }).context?.json?.().catch(() => null);
        const code = typeof body?.error === 'string' ? body.error : null;
        const msg = typeof body?.message === 'string' ? body.message : null;
        if (code === 'DAILY_LIMIT') return fail(code, importLimitCopy(msg), false);
        if (code) return fail(code, msg ?? 'Gnome couldn’t read that — try again in a moment.');
        return fail('network', 'Couldn’t reach Gnome — check your connection and try again.');
      }
      if (data?.error) {
        if (data.error === 'DAILY_LIMIT') return fail(String(data.error), importLimitCopy(data.message), false);
        return fail(String(data.error), data.message ?? 'Gnome couldn’t read that — try again in a moment.');
      }

      // Nothing is shown as success until the response parses.
      const extraction = data?.extraction as Extraction | undefined;
      const reqId = typeof data?.request_id === 'string' ? data.request_id : null;
      if (!extraction || !Array.isArray(extraction.candidates) || !reqId) {
        return fail('bad_response', 'Gnome couldn’t read that — try again in a moment.');
      }
      const sugg = (Array.isArray(data.taxonomy_suggestions) ? data.taxonomy_suggestions : []) as TaxonomySuggestion[][];
      void logEvent('import_extraction_succeeded', {
        userId,
        metadata: {
          source_type: extraction.source_type,
          multi_product: extraction.multi_product,
          candidates: extraction.candidates.length,
        },
      });
      if (!extraction.candidates.length) {
        setError('Gnome couldn’t find anything for sale in that — try a clearer photo, or paste the listing text.');
        setCanRetry(true);
        setPhase('input');
        return;
      }
      setRequestId(reqId);
      // multi_product === false → streamlined single-candidate review. A false
      // flag alongside several candidates would make the single card lie about
      // what the create button submits, so candidate count wins that tie.
      setMulti(extraction.multi_product === true || extraction.candidates.length > 1);
      setConflicts(Array.isArray(extraction.conflicts) ? extraction.conflicts : []);
      setSuggestions(extraction.candidates.map((_, i) => sugg[i] ?? []));
      setList(extraction.candidates.map((c, i) => ({
        candidate: c, selected: true, taxonomy: sugg[i] ?? [],
      })));
      setEditing(null);
      setPhase('review');
    } catch {
      fail('network', 'Couldn’t reach Gnome — check your connection and try again.');
    }
  };

  // --- Create -------------------------------------------------------------

  const create = async () => {
    if (!requestId || creating) return;
    const payload = toCreatePayload(list);
    if (!payload.length) return;
    setCreating(true);
    try {
      const { data, error: e } = await supabase.rpc('create_import_drafts', {
        p_import_id: requestId, p_candidates: payload,
      });
      if (e) throw e;
      const res = data as CreateResult | null;
      if (!res || typeof res.drafts_created !== 'number') {
        throw new Error('BAD_RESPONSE');
      }
      // Imported drafts are ordinary listing_drafts — surface them in the AI tab.
      await qc.invalidateQueries({ queryKey: ['listing-drafts', userId] });
      setResult(res);
      setAckedDups([]);
      setPhase('done');
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      Alert.alert(
        'Couldn’t create drafts',
        /IMPORT_DRAFTS_LIMIT/.test(msg) ? 'You have a lot of imported drafts waiting already — publish or discard some first.'
        : /NO_MARKET/.test(msg) ? 'Post once from the Post tab to create your Market first.'
        : /BAD_UNIT/.test(msg) ? 'One of the units isn’t recognized — use simple ones like lb, each, or bunch.'
        : 'Nothing was created — try again in a moment.',
      );
    } finally {
      setCreating(false);
    }
  };

  // --- Render -------------------------------------------------------------

  if (!userId || !isSupabaseConfigured) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🧺"
          title="Sign in first"
          subtitle="Build My Market is tied to your own Market."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  if (phase === 'analyzing') {
    return (
      <View style={[styles.screen, styles.center, { padding: 24 }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.analyzingText}>Gnome is looking through what you sell…</Text>
      </View>
    );
  }

  if (phase === 'done' && result) {
    return (
      <DoneView
        result={result}
        ackedDups={ackedDups}
        onAckDup={(i) => setAckedDups((prev) => [...prev, i])}
        onViewListing={(id) => router.push(`/listing/${id}`)}
        onViewPlans={() => router.push('/upgrade')}
        onReviewDrafts={() => router.replace('/(tabs)/ai')}
        bottomInset={insets.bottom}
      />
    );
  }

  if (phase === 'review') {
    if (!multi) {
      // Single product — a streamlined review, no multi-item chrome.
      const rc = list[0];
      return (
        <View style={styles.screen}>
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}>
            <Text style={styles.reviewHeader}>Here’s what Gnome found.</Text>
            {editing?.index === 0 ? (
              <CandidateEditor
                rc={editing.rc}
                options={suggestions[0] ?? []}
                onChange={(next) => setEditing({ index: 0, rc: next })}
                onCancel={() => setEditing(null)}
                onSave={() => { patch(0, () => editing.rc); setEditing(null); }}
              />
            ) : (
              <SingleCard
                rc={rc}
                conflicts={conflictsFor(rc.candidate, conflicts)}
                onPrice={(cents) => patch(0, (r) => ({ ...r, candidate: { ...r.candidate, price_cents: cents } }))}
                onEdit={() => setEditing({ index: 0, rc: { ...rc, candidate: { ...rc.candidate } } })}
              />
            )}
          </ScrollView>
          <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 10 }]}>
            <Button label={createButtonLabel(1)} onPress={() => void create()} loading={creating} />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.screen}>
        <FlatList
          data={list}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
          ListHeaderComponent={
            <View style={styles.listHead}>
              <Text style={styles.reviewHeader}>
                Gnome found {list.length} things you may be selling.
              </Text>
              <View style={styles.selectRow}>
                <Pressable onPress={() => setList((l) => l.map((rc) => ({ ...rc, selected: true })))} hitSlop={6}>
                  <Text style={styles.link}>Select All</Text>
                </Pressable>
                <Pressable onPress={() => setList((l) => l.map((rc) => ({ ...rc, selected: false })))} hitSlop={6}>
                  <Text style={styles.linkMuted}>Deselect All</Text>
                </Pressable>
              </View>
            </View>
          }
          renderItem={({ item: rc, index }) => (
            editing?.index === index ? (
              <CandidateEditor
                rc={editing.rc}
                options={suggestions[index] ?? []}
                onChange={(next) => setEditing({ index, rc: next })}
                onCancel={() => setEditing(null)}
                onSave={() => { patch(index, () => editing.rc); setEditing(null); }}
              />
            ) : (
              <CandidateCard
                rc={rc}
                conflicts={conflictsFor(rc.candidate, conflicts)}
                onToggle={() => patch(index, (r) => ({ ...r, selected: !r.selected }))}
                onPrice={(cents) => patch(index, (r) => ({ ...r, candidate: { ...r.candidate, price_cents: cents } }))}
                onEdit={() => setEditing({ index, rc: { ...rc, candidate: { ...rc.candidate } } })}
              />
            )
          )}
        />
        <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 10 }]}>
          <Button
            label={createButtonLabel(count)}
            onPress={() => void create()}
            loading={creating}
            disabled={count === 0}
          />
        </View>
      </View>
    );
  }

  // --- Input phase --------------------------------------------------------
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Build My Market with Gnome</Text>
      <Text style={styles.support}>
        Already selling on Facebook, at a farm stand, or somewhere else? Upload a
        screenshot or photo and Gnome can turn what you sell into draft listings.
      </Text>

      {assets.length > 0 && (
        <View style={styles.thumbRow}>
          {assets.map((a) => (
            <View key={a.uri} style={styles.thumb}>
              <Image source={{ uri: a.uri }} style={styles.thumbImg} />
              <Pressable style={styles.thumbRemove} onPress={() => removeAsset(a.uri)} hitSlop={6}>
                <X size={13} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={styles.pickRow}>
        <Pressable
          style={[styles.pickBtn, assets.length >= MAX_SOURCES && styles.pickBtnOff]}
          onPress={() => void addFromLibrary()}
          disabled={assets.length >= MAX_SOURCES}
        >
          <ImagePlus size={18} color={assets.length >= MAX_SOURCES ? Colors.textTertiary : Colors.primary} />
          <Text style={[styles.pickText, assets.length >= MAX_SOURCES && styles.pickTextOff]}>
            Upload photos or screenshots
          </Text>
        </Pressable>
      </View>
      <Text style={styles.limitNote}>Up to {MAX_SOURCES} images.</Text>

      <Text style={styles.fieldLabel}>Or paste your listing text</Text>
      <TextInput
        style={styles.textArea}
        value={pastedText}
        onChangeText={setPastedText}
        placeholder="Roma tomatoes $4/lb, fresh eggs $6/dozen…"
        placeholderTextColor={Colors.textTertiary}
        multiline
      />

      {error && <Text style={styles.error}>{error}</Text>}
      {error && canRetry && (
        <Pressable style={styles.retry} onPress={() => void analyze()}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      )}

      <Button
        label="Analyze with Gnome"
        onPress={() => void analyze()}
        disabled={!assets.length && !pastedText.trim()}
        style={{ marginTop: 16 }}
      />
      {(assets.length > 0 || !!pastedText) && (
        <Pressable onPress={cancelInputs} style={styles.cancelBtn} hitSlop={6}>
          <Text style={styles.linkMuted}>Cancel</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Review cards
// ---------------------------------------------------------------------------

function IssueChips({ rc }: { rc: ReviewCandidate }) {
  const issues = fieldIssues(rc);
  if (!issues.length) return null;
  return (
    <View style={styles.chipRow}>
      {issues.map((s) => (
        <View key={s} style={styles.issueChip}><Text style={styles.issueChipText}>{s}</Text></View>
      ))}
    </View>
  );
}

/**
 * Conflict block: the server refused to pick between disagreeing sources, and
 * so do we — competing values are tappable, nothing is preselected, and an
 * unresolved price simply stays missing.
 */
function ConflictBlock({ conflicts, priceCents, onPrice }: {
  conflicts: ImportConflict[];
  priceCents: number | null;
  onPrice: (cents: number | null) => void;
}) {
  const [custom, setCustom] = useState('');
  if (!conflicts.length) return null;
  return (
    <View style={styles.conflictBox}>
      {conflicts.map((k, i) => (
        <View key={`${k.field}-${i}`} style={{ gap: 6 }}>
          <Text style={styles.conflictHead}>{conflictHeadline(k)}</Text>
          {!!k.note && <Text style={styles.conflictNote}>{k.note}</Text>}
          {k.field === 'price' ? (
            <>
              <View style={styles.chipRow}>
                {k.values.map((v) => {
                  const cents = parseCents(v);
                  const active = cents != null && priceCents === cents && custom === '';
                  return (
                    <Pressable
                      key={v}
                      onPress={() => { setCustom(''); onPrice(cents); }}
                      style={[styles.valueChip, active && styles.valueChipActive]}
                    >
                      <Text style={[styles.valueChipText, active && styles.valueChipTextActive]}>{v}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                style={styles.priceInput}
                value={custom}
                keyboardType="decimal-pad"
                placeholder="Enter another price"
                placeholderTextColor={Colors.textTertiary}
                onChangeText={(v) => { setCustom(v); onPrice(parseCents(v)); }}
              />
            </>
          ) : (
            <Text style={styles.conflictNote}>{k.values.join(' · ')}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function SingleCard({ rc, conflicts, onPrice, onEdit }: {
  rc: ReviewCandidate;
  conflicts: ImportConflict[];
  onPrice: (cents: number | null) => void;
  onEdit: () => void;
}) {
  const c = rc.candidate;
  const price = priceLabel(c);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {c.product_name}{c.variety ? <Text style={styles.cardVariety}> · {c.variety}</Text> : null}
      </Text>
      {!!price && <Text style={styles.cardPrice}>{price}</Text>}
      {!!c.availability && <Text style={styles.cardMeta}>{c.availability}</Text>}
      <Text style={styles.cardMeta}>{categoryLabel(rc)}</Text>
      {!!c.description && <Text style={styles.cardDesc}>{c.description}</Text>}
      <IssueChips rc={rc} />
      <ConflictBlock conflicts={conflicts} priceCents={c.price_cents} onPrice={onPrice} />
      {c.compliance_attention_required && <Text style={styles.compliance}>{COMPLIANCE_NOTE}</Text>}
      <View style={styles.cardActions}>
        <Pressable onPress={onEdit} hitSlop={6}><Text style={styles.link}>Edit</Text></Pressable>
      </View>
    </View>
  );
}

function CandidateCard({ rc, conflicts, onToggle, onPrice, onEdit }: {
  rc: ReviewCandidate;
  conflicts: ImportConflict[];
  onToggle: () => void;
  onPrice: (cents: number | null) => void;
  onEdit: () => void;
}) {
  const c = rc.candidate;
  const price = priceLabel(c);
  return (
    <View style={[styles.card, !rc.selected && styles.cardDeselected]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            {c.product_name}{c.variety ? <Text style={styles.cardVariety}> · {c.variety}</Text> : null}
          </Text>
          <Text style={styles.cardMeta}>{categoryLabel(rc)}</Text>
          {!!price && <Text style={styles.cardPrice}>{price}</Text>}
        </View>
        <Pressable
          onPress={onToggle}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rc.selected }}
          style={[styles.check, rc.selected && styles.checkOn]}
        >
          {rc.selected && <Text style={styles.checkMark}>✓</Text>}
        </Pressable>
      </View>
      <IssueChips rc={rc} />
      <ConflictBlock conflicts={conflicts} priceCents={c.price_cents} onPrice={onPrice} />
      {c.compliance_attention_required && <Text style={styles.compliance}>{COMPLIANCE_NOTE}</Text>}
      <View style={styles.cardActions}>
        <Pressable onPress={onEdit} hitSlop={6}><Text style={styles.link}>Edit</Text></Pressable>
        {rc.selected && (
          <Pressable onPress={onToggle} hitSlop={6}><Text style={styles.linkMuted}>Deselect</Text></Pressable>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Editor — an expanding card over the same ReviewCandidate
// ---------------------------------------------------------------------------

function CandidateEditor({ rc, options, onChange, onSave, onCancel }: {
  rc: ReviewCandidate;
  /** The server's original taxonomy suggestions — the only category options. */
  options: TaxonomySuggestion[];
  onChange: (rc: ReviewCandidate) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const c = rc.candidate;
  const set = (p: Partial<ImportCandidate>) => onChange({ ...rc, candidate: { ...c, ...p } });
  const dollars = c.price_cents != null ? (c.price_cents / 100).toFixed(2) : '';
  const chosenId = rc.taxonomy[0]?.id ?? null;

  const pickCategory = (s: TaxonomySuggestion | null) => {
    if (s == null) {
      // "Let me pick later" → no node; the seller confirms in the drafts review.
      onChange({ ...rc, taxonomy: [], candidate: { ...c, category_terms: [] } });
      return;
    }
    // The chosen suggestion's exact name travels back as the only category
    // term, so the server re-maps to exactly that node.
    onChange({
      ...rc,
      taxonomy: [s, ...options.filter((o) => o.id !== s.id)],
      candidate: { ...c, category_terms: [s.name] },
    });
  };

  return (
    <View style={[styles.card, styles.cardEditing]}>
      <Text style={styles.editLabel}>Product name</Text>
      <TextInput style={styles.editInput} value={c.product_name}
        onChangeText={(v) => set({ product_name: v })} placeholderTextColor={Colors.textTertiary} />

      <Text style={styles.editLabel}>Variety</Text>
      <TextInput style={styles.editInput} value={c.variety}
        onChangeText={(v) => set({ variety: v })} placeholder="Roma, heirloom…" placeholderTextColor={Colors.textTertiary} />

      <Text style={styles.editLabel}>Listing type</Text>
      <View style={styles.chipRow}>
        {LISTING_TYPES.map((t) => {
          const active = c.proposed_listing_type === t.key;
          return (
            <Pressable key={t.key} onPress={() => set({ proposed_listing_type: t.key })}
              style={[styles.valueChip, active && styles.valueChipActive]}>
              <Text style={[styles.valueChipText, active && styles.valueChipTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.editLabel}>Category</Text>
      <View style={styles.chipRow}>
        {options.map((s) => {
          const active = chosenId === s.id;
          return (
            <Pressable key={s.id} onPress={() => pickCategory(s)}
              style={[styles.valueChip, active && styles.valueChipActive]}>
              <Text style={[styles.valueChipText, active && styles.valueChipTextActive]}>{s.name}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => pickCategory(null)}
          style={[styles.valueChip, chosenId == null && styles.valueChipActive]}>
          <Text style={[styles.valueChipText, chosenId == null && styles.valueChipTextActive]}>
            Let me pick later
          </Text>
        </Pressable>
      </View>

      <View style={styles.editRow}>
        <View style={styles.editCol}>
          <Text style={styles.editLabel}>Price ($)</Text>
          <TextInput
            style={styles.editInput}
            value={dollars}
            keyboardType="decimal-pad"
            onChangeText={(v) => set({ price_cents: parseCents(v) })}
            placeholderTextColor={Colors.textTertiary}
          />
        </View>
        <View style={styles.editCol}>
          <Text style={styles.editLabel}>Unit</Text>
          <TextInput style={styles.editInput} value={c.unit}
            onChangeText={(v) => set({ unit: v.toLowerCase().trim() })}
            placeholder="lb, each, bunch" placeholderTextColor={Colors.textTertiary} />
        </View>
      </View>

      <Text style={styles.editLabel}>Quantity</Text>
      <TextInput style={styles.editInput} value={c.quantity}
        onChangeText={(v) => set({ quantity: v })} placeholder="about 2 lbs" placeholderTextColor={Colors.textTertiary} />

      <Text style={styles.editLabel}>Description</Text>
      <TextInput style={[styles.editInput, styles.editArea]} value={c.description}
        onChangeText={(v) => set({ description: v })} multiline placeholderTextColor={Colors.textTertiary} />

      <Text style={styles.editLabel}>Availability</Text>
      <TextInput style={styles.editInput} value={c.availability}
        onChangeText={(v) => set({ availability: v })} placeholder="Saturdays at the stand" placeholderTextColor={Colors.textTertiary} />

      <View style={styles.cardActions}>
        <Button label="Save" onPress={onSave} />
        <Pressable onPress={onCancel} hitSlop={6}><Text style={styles.linkMuted}>Cancel</Text></Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Done — server truth: created counts, allowance sentence, duplicate notes
// ---------------------------------------------------------------------------

function DoneView({ result, ackedDups, onAckDup, onViewListing, onViewPlans, onReviewDrafts, bottomInset }: {
  result: CreateResult;
  ackedDups: number[];
  onAckDup: (candidateIndex: number) => void;
  onViewListing: (id: string) => void;
  onViewPlans: () => void;
  onReviewDrafts: () => void;
  bottomInset: number;
}) {
  const created = result.drafts_created + result.drafts_already_existed;
  const allowance = useMemo(
    () => allowanceSummary(result.allowance, { canBuyExtras: canBuyDigitalInApp }),
    [result.allowance],
  );
  const dups = result.duplicates.filter((d) => !ackedDups.includes(d.candidate_index));
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 40 }]}
    >
      <Text style={styles.doneEmoji}>🌱</Text>
      <Text style={styles.doneHeadline}>{resultHeadline(created)}</Text>
      <Text style={styles.doneAllowance}>{allowance.text}</Text>
      {allowance.suggestUpgrade && (
        <Pressable onPress={onViewPlans} hitSlop={6}>
          <Text style={styles.plansLink}>View Plans</Text>
        </Pressable>
      )}

      {dups.map((d) => (
        <View key={d.candidate_index} style={styles.dupCard}>
          <Text style={styles.dupTitle}>{duplicateLabel(d.product_name)}</Text>
          <Text style={styles.dupNote}>
            The new draft was created too — both are kept, nothing was replaced.
          </Text>
          <View style={styles.cardActions}>
            <Button label="Create New Draft" onPress={() => onAckDup(d.candidate_index)} style={{ flex: 1, height: 42 }} />
            <Pressable onPress={() => onViewListing(d.existing_listing_id)} hitSlop={6}>
              <Text style={styles.link}>Use Existing</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Button label="Review Drafts" onPress={onReviewDrafts} style={{ marginTop: 20 }} />
      <Text style={styles.doneFootnote}>
        Drafts wait in Gnome AI until you review them — nothing is live yet.
      </Text>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, gap: 10 },

  heading: { fontSize: 25, fontFamily: fonts.displayBold, color: Colors.text },
  support: { fontSize: 14.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 21, marginBottom: 6 },

  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%', backgroundColor: Colors.backgroundSecondary },
  thumbRemove: {
    position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: Colors.overlay, alignItems: 'center', justifyContent: 'center',
  },
  pickRow: { flexDirection: 'row', gap: 8 },
  pickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 13,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  pickBtnSquare: {
    width: 48, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  pickBtnOff: { borderColor: Colors.borderLight },
  pickText: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.primary },
  pickTextOff: { color: Colors.textTertiary },
  limitNote: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textTertiary },

  fieldLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, marginTop: 8 },
  textArea: {
    backgroundColor: Colors.surfaceElevated, borderWidth: 1.5, borderColor: Colors.inputBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 84,
    fontSize: 15, color: Colors.text, fontFamily: fonts.regular, textAlignVertical: 'top',
  },
  error: { fontSize: 14, fontFamily: fonts.regular, color: Colors.error, marginTop: 4 },
  retry: {
    alignSelf: 'flex-start', backgroundColor: Colors.surface, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: Colors.primary,
  },
  retryText: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.primary },
  cancelBtn: { alignSelf: 'center', marginTop: 12 },

  analyzingText: { marginTop: 14, fontSize: 15, fontFamily: fonts.semibold, color: Colors.textSecondary, textAlign: 'center' },

  listHead: { gap: 8, marginBottom: 4 },
  reviewHeader: { fontSize: 20, fontFamily: fonts.displayBold, color: Colors.text, lineHeight: 27 },
  selectRow: { flexDirection: 'row', gap: 18, alignItems: 'center' },

  card: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, gap: 6,
    borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 10,
  },
  cardDeselected: { opacity: 0.55 },
  cardEditing: { borderColor: Colors.primary, borderWidth: 1.5 },
  cardTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  cardTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  cardVariety: { fontFamily: fonts.regular, color: Colors.textSecondary },
  cardPrice: { fontSize: 14.5, fontFamily: fonts.semibold, color: Colors.text, marginTop: 2 },
  cardMeta: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  cardDesc: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 19 },
  compliance: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.warning, marginTop: 2 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.primary },
  linkMuted: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.textTertiary },

  check: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: Colors.inputBorder,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceElevated,
  },
  checkOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkMark: { color: Colors.textOnPrimary, fontSize: 14, fontFamily: fonts.bold },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  issueChip: {
    backgroundColor: Colors.gold + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  // An issue chip is a warning, and Harvest Yellow on a yellow wash was
  // 1.55:1. #B45309 on the same wash measures 4.68:1.
  issueChipText: { fontSize: 12, fontFamily: fonts.semibold, color: Colors.warning },
  valueChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderLight,
  },
  valueChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  valueChipText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  valueChipTextActive: { color: Colors.textInverse },

  conflictBox: {
    backgroundColor: Colors.background, borderRadius: 10, padding: 10, gap: 8, marginTop: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  conflictHead: { fontSize: 13.5, fontFamily: fonts.bold, color: Colors.text },
  conflictNote: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 17 },
  priceInput: {
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.inputBorder,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: Colors.text, fontFamily: fonts.regular, alignSelf: 'flex-start', minWidth: 160,
  },

  editLabel: { fontFamily: fonts.semibold, fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
  editInput: {
    backgroundColor: Colors.surfaceElevated, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: fonts.regular, fontSize: 14, color: Colors.text,
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  editArea: { minHeight: 68, textAlignVertical: 'top' },
  editRow: { flexDirection: 'row', gap: 10 },
  editCol: { flex: 1 },

  stickyBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },

  doneEmoji: { fontSize: 44, textAlign: 'center', marginTop: 8 },
  doneHeadline: { fontSize: 24, fontFamily: fonts.displayBold, color: Colors.text, textAlign: 'center' },
  doneAllowance: {
    fontSize: 14.5, fontFamily: fonts.regular, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 21,
  },
  plansLink: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.primary, textAlign: 'center', marginTop: 2 },
  dupCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, gap: 4, marginTop: 10,
    borderWidth: 1, borderColor: Colors.gold,
  },
  dupTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  dupNote: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 18 },
  doneFootnote: {
    fontSize: 12, fontFamily: fonts.regular, color: Colors.textTertiary,
    textAlign: 'center', marginTop: 8,
  },
});
