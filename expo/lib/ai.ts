// AI listing drafts — client for the `draft-listing` Edge Function.
// Snap a photo → Claude drafts title/category/description (+ price for sales).
// Best-effort feature: every failure surfaces a friendly message and the user
// just fills the form by hand, exactly as before.
import { supabase, isSupabaseConfigured } from './supabase';
import type { ListingType } from '@/types';

export interface ListingDraft {
  title: string;
  category: string;
  description: string;
  suggested_price_cents: number | null;
  suggested_unit: string | null;
}

export async function draftListingFromPhoto(input: {
  base64: string;
  mimeType?: string | null;
  listingType: ListingType;
}): Promise<ListingDraft> {
  if (!isSupabaseConfigured) throw new Error('Not connected.');
  const { data, error } = await supabase.functions.invoke('draft-listing', {
    body: {
      imageBase64: input.base64,
      mediaType: input.mimeType ?? 'image/jpeg',
      listingType: input.listingType,
    },
  });
  if (error) {
    // FunctionsHttpError carries the function's JSON body with our message.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? 'AI drafting isn’t available right now.');
  }
  if (!data?.draft) throw new Error(data?.error ?? 'No draft came back — try again.');
  return data.draft as ListingDraft;
}

// --- Garden planner — client for the `garden-planner` Edge Function. --------
export interface PlannerTurn {
  role: 'user' | 'assistant';
  content: string;
}

export async function askGardenPlanner(input: {
  location: string;
  messages: PlannerTurn[];
  /** Optional plant photo → the planner diagnoses from it (garden-planner v9). */
  imageBase64?: string;
  mediaType?: string;
}): Promise<string> {
  if (!isSupabaseConfigured) throw new Error('Not connected.');
  const { data, error } = await supabase.functions.invoke('garden-planner', {
    body: {
      location: input.location,
      messages: input.messages,
      ...(input.imageBase64
        ? { imageBase64: input.imageBase64, mediaType: input.mediaType ?? 'image/jpeg' }
        : {}),
    },
  });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? 'The planner isn’t available right now.');
  }
  if (!data?.reply) throw new Error(data?.error ?? 'No plan came back — try again.');
  return data.reply as string;
}
