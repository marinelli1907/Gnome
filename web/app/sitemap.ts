import type { MetadataRoute } from 'next';
import { getAllActiveListingRefs, getAllActiveMarketRefs } from '@/lib/gnome';
import { CATEGORIES } from '@/lib/categories';
import { listingPath, marketPath } from '@/lib/format';

export const revalidate = 600;

const BASE = 'https://gnomefarmersmarket.com';
const AREAS = ['lyndhurst-oh', 'richmond-heights-oh', 'mayfield-heights-oh', 'south-euclid-oh'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [listings, markets] = await Promise.all([getAllActiveListingRefs(), getAllActiveMarketRefs()]);
  return [
    { url: BASE, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/plots`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/trust`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/support`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/delete-account`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/privacy`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/terms`, changeFrequency: 'monthly', priority: 0.4 },
    ...AREAS.map((a) => ({ url: `${BASE}/near/${a}`, changeFrequency: 'daily' as const, priority: 0.8 })),
    ...CATEGORIES.map((c) => ({ url: `${BASE}/category/${c.id}`, changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...markets.map((m) => ({ url: `${BASE}${marketPath(m.slug)}`, lastModified: new Date(m.created_at), changeFrequency: 'daily' as const, priority: 0.6 })),
    ...listings.map((l) => ({ url: `${BASE}${listingPath(l.id, l.slug)}`, lastModified: new Date(l.created_at), changeFrequency: 'daily' as const, priority: 0.5 })),
  ];
}
