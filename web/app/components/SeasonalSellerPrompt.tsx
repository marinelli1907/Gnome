'use client';

import { useEffect, useState } from 'react';
import { logWeb } from '@/lib/analytics';
import {
  isSeasonalPromptDismissed,
  seasonalDismissalKey,
  type SeasonalCampaign,
  type SeasonalIconKey,
} from '@/lib/seasonal';
import { getSeasonalCampaign } from '@/lib/seasonalClient';

const ICONS: Record<SeasonalIconKey, string> = {
  leaf: '🍃',
  sprout: '🌱',
  sun: '☀',
  snowflake: '❄',
  gift: '🎁',
  harvest: '🌾',
};

export default function SeasonalSellerPrompt() {
  const [campaign, setCampaign] = useState<SeasonalCampaign | null>(null);
  const [checkedCampaignId, setCheckedCampaignId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    void getSeasonalCampaign().then((next) => {
      if (!alive || !next) return;
      let wasDismissed = false;
      try {
        wasDismissed = isSeasonalPromptDismissed(
          window.localStorage.getItem(seasonalDismissalKey(next.campaign_id)),
        );
      } catch {
        // Private browsing can disable storage; the prompt remains usable.
      }
      if (alive) {
        setCampaign(next);
        setDismissed(wasDismissed);
        setCheckedCampaignId(next.campaign_id);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!campaign || checkedCampaignId !== campaign.campaign_id || dismissed) return null;

  return (
    <aside className="seasonal-seller" aria-label={`${campaign.title} seller suggestion`}>
      <span className="seasonal-icon" aria-hidden="true">{ICONS[campaign.icon_key]}</span>
      <div className="seasonal-seller-copy">
        <strong>{campaign.title}</strong>
        <p>{campaign.seller_prompt}</p>
        <a
          className="btn btn-primary btn-sm"
          href="/sell"
          onClick={() => logWeb('seasonal_seller_cta_clicked', { campaign_id: campaign.campaign_id })}
        >
          Create a listing
        </a>
      </div>
      <button
        type="button"
        className="seasonal-seller-close"
        aria-label={`Dismiss ${campaign.title} seller suggestion`}
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(seasonalDismissalKey(campaign.campaign_id), '1');
          } catch {
            // Dismiss for this render even when storage is unavailable.
          }
        }}
      >
        ×
      </button>
    </aside>
  );
}
