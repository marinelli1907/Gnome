// Marketplace taxonomy for the web — mirror of expo/lib/taxonomy.ts.
//
// The tree (marketplace_taxonomy_nodes) is ADMIN-MANAGED DATA — nothing here
// hardcodes categories, synonyms, or compliance attributes. The web fetches all
// active nodes once (≈300 small rows, anon-readable), builds an in-memory
// index, and every chip, drilldown, subtree filter, and alias match derives
// from that snapshot. Kept as a local copy so the web build stays hermetic
// (no cross-package imports / React Native resolution).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface TaxonomyNode {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  display_order: number;
  icon: string | null;
  search_synonyms: string[];
}

const NODE_COLUMNS = 'id,parent_id,name,slug,path,depth,display_order,icon,search_synonyms';

export interface TaxonomyIndex {
  nodes: TaxonomyNode[];
  byId: Map<string, TaxonomyNode>;
  childrenOf: (parentId: string | null) => TaxonomyNode[];
  roots: TaxonomyNode[];
}

function buildIndex(nodes: TaxonomyNode[]): TaxonomyIndex {
  const byId = new Map<string, TaxonomyNode>();
  const children = new Map<string | null, TaxonomyNode[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const list = children.get(n.parent_id) ?? [];
    list.push(n);
    children.set(n.parent_id, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }
  return {
    nodes,
    byId,
    childrenOf: (parentId) => children.get(parentId) ?? [],
    roots: children.get(null) ?? [],
  };
}

// One fetch per page load, shared by every caller (module-level promise cache).
let cached: Promise<TaxonomyIndex | null> | null = null;

export function fetchTaxonomy(): Promise<TaxonomyIndex | null> {
  if (!cached) {
    cached = (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/marketplace_taxonomy_nodes?select=${NODE_COLUMNS}&active=eq.true&order=depth,display_order`,
          { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
        );
        if (!res.ok) return null;
        return buildIndex((await res.json()) as TaxonomyNode[]);
      } catch {
        return null;
      }
    })();
    // A failed fetch shouldn't poison the cache for the session.
    void cached.then((v) => { if (v === null) cached = null; });
  }
  return cached;
}

/** Root → … → node, for breadcrumbs like "Vegetables › Tomatoes › Roma". */
export function ancestorsOf(index: TaxonomyIndex, node: TaxonomyNode): TaxonomyNode[] {
  const chain: TaxonomyNode[] = [node];
  let cur = node;
  while (cur.parent_id) {
    const parent = index.byId.get(cur.parent_id);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}

export function breadcrumb(index: TaxonomyIndex, node: TaxonomyNode): string {
  return ancestorsOf(index, node).map((n) => n.name).join(' › ');
}

/** Every node id at-or-under `node` — drives the subtree filter. */
export function subtreeIds(index: TaxonomyIndex, node: TaxonomyNode): Set<string> {
  const prefix = node.path + '/';
  return new Set(
    index.nodes.filter((n) => n.id === node.id || n.path.startsWith(prefix)).map((n) => n.id),
  );
}

/**
 * Alias-aware node matching. Synonyms come from the backend (search_synonyms
 * on each node) — "hamburger" resolves to Ground Beef because the DATA says
 * so, not because this file knows about beef.
 */
export function matchNodes(index: TaxonomyIndex, query: string): TaxonomyNode[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return index.nodes.filter((n) => {
    if (n.name.toLowerCase().includes(q)) return true;
    return n.search_synonyms.some((s) => {
      const syn = s.toLowerCase();
      return syn.includes(q) || q.includes(syn);
    });
  });
}

/** True when `listingNodeId` sits at-or-under any of the given nodes. */
export function nodeInAnySubtree(
  index: TaxonomyIndex,
  listingNodeId: string | null | undefined,
  matched: TaxonomyNode[],
): boolean {
  if (!listingNodeId) return false;
  const node = index.byId.get(listingNodeId);
  if (!node) return false;
  return matched.some((m) => node.id === m.id || node.path.startsWith(m.path + '/'));
}
