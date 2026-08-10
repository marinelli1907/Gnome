// Grow Log data layer: private journal on a plot reservation (claim).
// Photos ride the existing EXIF-stripping pipeline into the PRIVATE grow-log
// bucket (path <claimId>/…) and render via short-lived signed URLs.
import { decode } from 'base64-arraybuffer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase, isSupabaseConfigured } from './supabase';
import { normalizeImageAsset } from './images';
import { logEvent } from './db';

export type GrowStage =
  | 'PLOT_PREP' | 'PLANTED' | 'SPROUTED' | 'GROWING'
  | 'FLOWERING' | 'FRUITING' | 'HARVESTING' | 'FINISHED';

export const STAGES: { value: GrowStage; label: string; emoji: string }[] = [
  { value: 'PLOT_PREP', label: 'Plot Prepared', emoji: '🧑‍🌾' },
  { value: 'PLANTED', label: 'Planted', emoji: '🌱' },
  { value: 'SPROUTED', label: 'Sprouted', emoji: '🌿' },
  { value: 'GROWING', label: 'Growing', emoji: '🪴' },
  { value: 'FLOWERING', label: 'Flowering', emoji: '🌼' },
  { value: 'FRUITING', label: 'Fruiting', emoji: '🍅' },
  { value: 'HARVESTING', label: 'Harvesting', emoji: '🧺' },
  { value: 'FINISHED', label: 'Finished', emoji: '✅' },
];

export const stageLabel = (s: GrowStage | null | undefined) =>
  STAGES.find((x) => x.value === s)?.label ?? null;

export interface GrowLogEntry {
  id: string;
  claim_id: string;
  author_id: string;
  kind: 'entry' | 'owner_note';
  stage: GrowStage | null;
  title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  photos?: { id: string; storage_path: string }[];
}

export interface PlotCrop {
  id: string;
  claim_id: string;
  taxonomy_node_id: string | null;
  name: string;
  variety: string | null;
  planted_at: string | null;
  expected_harvest: string | null;
  status: 'planned' | 'growing' | 'harvested' | 'finished';
  quantity: number | null;
}

export function useGrowLog(claimId?: string) {
  return useQuery({
    queryKey: ['growLog', claimId],
    enabled: isSupabaseConfigured && !!claimId,
    queryFn: async (): Promise<GrowLogEntry[]> => {
      const { data, error } = await supabase
        .from('plot_grow_logs')
        .select('*, photos:plot_grow_log_photos(id, storage_path)')
        .eq('claim_id', claimId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as GrowLogEntry[];
    },
  });
}

export function usePlotCrops(claimId?: string) {
  return useQuery({
    queryKey: ['plotCrops', claimId],
    enabled: isSupabaseConfigured && !!claimId,
    queryFn: async (): Promise<PlotCrop[]> => {
      const { data, error } = await supabase
        .from('plot_crops')
        .select('*')
        .eq('claim_id', claimId as string)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as PlotCrop[];
    },
  });
}

/** Derived summary — stages only, no fabricated percentages. */
export function growSummary(entries: GrowLogEntry[], crops: PlotCrop[]) {
  const staged = entries.filter((e) => e.stage);
  const current = staged.length ? (staged[0].stage as GrowStage) : null;
  const planted = crops
    .map((c) => c.planted_at)
    .filter(Boolean)
    .sort()[0] as string | undefined;
  const daysSincePlanted = planted
    ? Math.floor((Date.now() - new Date(planted + 'T00:00:00').getTime()) / 86_400_000)
    : null;
  const photoCount = entries.reduce((n, e) => n + (e.photos?.length ?? 0), 0);
  const lastUpdate = entries[0]?.created_at ?? null;
  return { current, daysSincePlanted, photoCount, lastUpdate };
}

/**
 * Upload 1–4 EXIF-stripped photos to the private grow-log bucket and verify
 * each object exists before reporting success.
 */
export async function uploadGrowPhotos(
  claimId: string, assets: ImagePickerAsset[],
): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < Math.min(assets.length, 4); i++) {
    const asset = assets[i].mimeType === 'image/jpeg' && assets[i].base64
      ? assets[i]
      : await normalizeImageAsset(assets[i]);
    if (!asset.base64) throw new Error('Photo is missing data.');
    const path = `${claimId}/${Date.now()}-${i}.jpg`;
    const { error } = await supabase.storage
      .from('grow-log')
      .upload(path, decode(asset.base64), { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
    const { error: signErr } = await supabase.storage
      .from('grow-log').createSignedUrl(path, 60);
    if (signErr) throw new Error('Photo did not persist — try again.');
    paths.push(path);
  }
  return paths;
}

export async function growPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('grow-log').createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}

export function useAddGrowEntry(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      claimId: string;
      kind: 'entry' | 'owner_note';
      stage?: GrowStage | null;
      title?: string | null;
      notes?: string | null;
      photoAssets?: ImagePickerAsset[];
    }): Promise<GrowLogEntry> => {
      if (!uid) throw new Error('Sign in first.');
      // Photos first: if the row insert then fails, orphaned objects are still
      // invisible to everyone but the plot parties, and retry replaces them.
      const paths = input.photoAssets?.length
        ? await uploadGrowPhotos(input.claimId, input.photoAssets)
        : [];
      const { data, error } = await supabase
        .from('plot_grow_logs')
        .insert({
          claim_id: input.claimId,
          author_id: uid,
          kind: input.kind,
          stage: input.kind === 'entry' ? input.stage ?? null : null,
          title: input.title?.trim() || null,
          notes: input.notes?.trim() || null,
        })
        .select('*')
        .single();
      if (error) throw error;
      const entry = data as GrowLogEntry;
      if (paths.length) {
        const { error: pErr } = await supabase
          .from('plot_grow_log_photos')
          .insert(paths.map((p) => ({ log_id: entry.id, storage_path: p })));
        if (pErr) throw new Error(`Entry saved but photos failed to attach: ${pErr.message}`);
      }
      return entry;
    },
    onSuccess: (entry) => {
      void logEvent(entry.kind === 'entry' ? 'grow_log_entry' : 'plot_owner_note', {
        userId: uid, metadata: { claim_id: entry.claim_id, stage: entry.stage },
      });
      void supabase.functions.invoke('notify', {
        body: {
          event: entry.kind === 'entry' ? 'grow_log_update' : 'plot_owner_note',
          claimId: entry.claim_id,
        },
      }).catch(() => {});
      qc.invalidateQueries({ queryKey: ['growLog', entry.claim_id] });
    },
  });
}

export function useEditGrowEntry(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entryId: string; claimId: string; title?: string | null; notes?: string | null; stage?: GrowStage | null }) => {
      const { data, error } = await supabase
        .from('plot_grow_logs')
        .update({ title: input.title, notes: input.notes, stage: input.stage })
        .eq('id', input.entryId)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You can only edit your own entries.');
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: ['growLog', input.claimId] }),
  });
}

export function useSaveCrop(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      claimId: string;
      id?: string;
      taxonomyNodeId?: string | null;
      name: string;
      variety?: string | null;
      plantedAt?: string | null;
      status?: PlotCrop['status'];
      quantity?: number | null;
    }): Promise<void> => {
      const row = {
        claim_id: input.claimId,
        taxonomy_node_id: input.taxonomyNodeId ?? null,
        name: input.name.trim(),
        variety: input.variety?.trim() || null,
        planted_at: input.plantedAt || null,
        status: input.status ?? 'growing',
        quantity: input.quantity ?? null,
        updated_at: new Date().toISOString(),
      };
      const q = input.id
        ? supabase.from('plot_crops').update(row).eq('id', input.id).select('id')
        : supabase.from('plot_crops').insert(row).select('id');
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) throw new Error('Crop was not saved.');
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: ['plotCrops', input.claimId] }),
  });
}

export function useDeleteCrop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; claimId: string }) => {
      const { error } = await supabase.from('plot_crops').delete().eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: ['plotCrops', input.claimId] }),
  });
}

/** Structured context for Ask Gnome — read-only, party-gated server-side. */
export async function fetchGrowContext(claimId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('grow_log_context', { p_claim: claimId });
  if (error) return null;
  return data as Record<string, unknown>;
}
