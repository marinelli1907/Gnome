export function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'listing';
}

/** Turn a city slug ("richmond-heights") into a display name ("Richmond Heights"). */
export function cityLabel(slug: string): string {
  return (slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'your area';
}

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Extract the trailing listing UUID from a "[slug]-[id]" path segment. */
export function idFromSlugId(slugId: string): string | null {
  const m = (slugId || '').match(UUID_RE);
  return m ? m[1] : null;
}

export function listingPath(id: string, title: string): string {
  return `/listing/${slugify(title)}-${id}`;
}

export function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
}
