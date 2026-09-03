'use client';

import { useEffect, useRef } from 'react';
import type { WebListing } from '@/lib/gnome';
import { logWeb } from '@/lib/analytics';
import type { SeasonalCampaign, SeasonalIconKey } from '@/lib/seasonal';
import ListingCard from './ListingCard';

const ICONS: Record<SeasonalIconKey, string> = {
  leaf: '🍃',
  sprout: '🌱',
  sun: '☀',
  snowflake: '❄',
  gift: '🎁',
  harvest: '🌾',
};

export default function SeasonalDiscovery({
  campaign,
  listings,
  onSearch,
}: {
  campaign: SeasonalCampaign;
  listings: WebListing[];
  onSearch: (query: string) => void;
}) {
  const viewedCampaign = useRef<string | null>(null);

  useEffect(() => {
    if (viewedCampaign.current === campaign.campaign_id) return;
    viewedCampaign.current = campaign.campaign_id;
    logWeb('seasonal_section_viewed', {
      campaign_id: campaign.campaign_id,
      match_count: listings.length,
    });
  }, [campaign.campaign_id, listings.length]);

  if (listings.length === 0) return null;
  const titleId = `seasonal-${campaign.campaign_id}`;

  return (
    <section className="seasonal-discovery" aria-labelledby={titleId}>
      <div className="seasonal-heading">
        <span className="seasonal-icon" aria-hidden="true">{ICONS[campaign.icon_key]}</span>
        <div>
          <h2 id={titleId}>{campaign.title}</h2>
          <p>{campaign.subtitle}</p>
        </div>
      </div>

      {campaign.search_chips.length > 0 && (
        <div className="seasonal-chips" role="group" aria-label={`${campaign.title} searches`}>
          {campaign.search_chips.map((chip) => (
            <button
              key={chip.query.toLocaleLowerCase('en-US')}
              type="button"
              onClick={() => {
                logWeb('seasonal_search_chip_clicked', {
                  campaign_id: campaign.campaign_id,
                  query: chip.query,
                });
                onSearch(chip.query);
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <div className="seasonal-list" role="list">
        {listings.map((listing) => (
          <div className="seasonal-listing" role="listitem" key={listing.id}>
            <ListingCard listing={listing} seasonalCampaignId={campaign.campaign_id} />
          </div>
        ))}
      </div>
    </section>
  );
}
