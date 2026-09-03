'use client';

import {
  loadSeasonalCampaign,
  type SeasonalCampaign,
} from './seasonal';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const CACHE_KEY = 'gnome:seasonal-campaign:v1';
const FETCH_TIMEOUT_MS = 2500;
const CAMPAIGN_COLUMNS = [
  'campaign_id',
  'schema_version',
  'enabled',
  'priority',
  'starts_on',
  'ends_on',
  'title',
  'subtitle',
  'icon_key',
  'keywords',
  'taxonomy_targets',
  'seller_prompt',
  'zordy_context',
  'search_chips',
].join(',');

async function fetchCampaignRows(): Promise<unknown> {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('Seasonal configuration unavailable.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      select: CAMPAIGN_COLUMNS,
      enabled: 'eq.true',
      order: 'priority.desc,starts_on.desc,campaign_id.asc',
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/seasonal_campaigns?${params}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Seasonal configuration request failed.');
    return response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getSeasonalCampaign(now = new Date()): Promise<SeasonalCampaign | null> {
  const result = await loadSeasonalCampaign({
    fetchRows: fetchCampaignRows,
    readCache: async () => window.localStorage.getItem(CACHE_KEY),
    writeCache: async (value) => window.localStorage.setItem(CACHE_KEY, value),
    now,
  });
  return result.campaign;
}
