import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { isSupabaseConfigured, supabase } from './supabase';
import {
  loadSeasonalCampaign,
  seasonalDateKey,
  type SeasonalCampaign,
} from './seasonal';

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .from('seasonal_campaigns')
      .select(CAMPAIGN_COLUMNS)
      .eq('enabled', true)
      .order('priority', { ascending: false })
      .order('starts_on', { ascending: false })
      .order('campaign_id', { ascending: true })
      .abortSignal(controller.signal);
    if (error) throw error;
    return data ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSeasonalCampaign(now = new Date()): Promise<SeasonalCampaign | null> {
  if (!isSupabaseConfigured) return null;
  const result = await loadSeasonalCampaign({
    fetchRows: fetchCampaignRows,
    readCache: () => AsyncStorage.getItem(CACHE_KEY),
    writeCache: (value) => AsyncStorage.setItem(CACHE_KEY, value),
    now,
  });
  return result.campaign;
}

/** Independent, fail-closed query: Browse's normal listing query never waits on it. */
export function useSeasonalCampaign() {
  return useQuery({
    queryKey: ['seasonal-campaign', seasonalDateKey()],
    enabled: isSupabaseConfigured,
    queryFn: () => getSeasonalCampaign(),
    staleTime: 15 * 60 * 1000,
    retry: false,
  });
}
