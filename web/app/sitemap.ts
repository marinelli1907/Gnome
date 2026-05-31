import type { MetadataRoute } from 'next';
import { getActiveListings } from '@/lib/gnome';
import { listingPath } from '@/lib/format';

export const revalidate = 300;

const BASE = 'https://gnome.boonesystems.app';
const CITIES = [
  'richmond-heights',
  'lyndhurst',
  'mayfield-heights',
  'south-euclid',
  'cleveland-heights',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const listings = await getActiveListings({ limit: 200 });
  return [
    { url: BASE, changeFrequency: 'daily', priority: 1 },
    ...CITIES.map((c) => ({
      url: `${BASE}/near/${c}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...listings.map((l) => ({
      url: `${BASE}${listingPath(l.id, l.title)}`,
      lastModified: new Date(l.created_at),
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
  ];
}
