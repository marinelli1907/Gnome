// Marketplace taxonomy: fetch + index + search over the backend-managed tree.
//
// The tree (marketplace_taxonomy_nodes) is ADMIN-MANAGED DATA — nothing here
// hardcodes categories, synonyms, or compliance attributes. The app fetches all
// active nodes once (≈300 rows), builds an in-memory index, and every drilldown,
// chip, subtree filter, and alias match derives from that snapshot.
import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from './supabase';

export interface TaxonomyNode {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  display_order: number;
  active: boolean;
  icon: string | null;
  search_synonyms: string[];
  compliance_classification:
    | 'GENERALLY_UNRESTRICTED'
    | 'CONDITIONAL'
    | 'REGULATED'
    | 'PROHIBITED'
    | 'REVIEW_REQUIRED';
  prohibited: boolean;
}

const NODE_COLUMNS =
  'id,parent_id,name,slug,path,depth,display_order,active,icon,search_synonyms,compliance_classification,prohibited';

export interface TaxonomyIndex {
  nodes: TaxonomyNode[];
  byId: Map<string, TaxonomyNode>;
  byPath: Map<string, TaxonomyNode>;
  childrenOf: (parentId: string | null) => TaxonomyNode[];
  roots: TaxonomyNode[];
}

function buildIndex(nodes: TaxonomyNode[]): TaxonomyIndex {
  const byId = new Map<string, TaxonomyNode>();
  const byPath = new Map<string, TaxonomyNode>();
  const children = new Map<string | null, TaxonomyNode[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    byPath.set(n.path, n);
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
    byPath,
    childrenOf: (parentId) => children.get(parentId) ?? [],
    roots: children.get(null) ?? [],
  };
}

/** The whole active tree, cached. 308 small rows — one query, 10 min fresh. */
export function useTaxonomy() {
  return useQuery({
    queryKey: ['taxonomy'],
    enabled: isSupabaseConfigured,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<TaxonomyIndex> => {
      const { data, error } = await supabase
        .from('marketplace_taxonomy_nodes')
        .select(NODE_COLUMNS)
        .eq('active', true)
        .order('depth')
        .order('display_order');
      if (error) throw error;
      return buildIndex((data ?? []) as TaxonomyNode[]);
    },
  });
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
  return ancestorsOf(index, node)
    .map((n) => n.name)
    .join(' › ');
}

/** Every node id at-or-under `node` — drives the server-side subtree filter. */
export function subtreeIds(index: TaxonomyIndex, node: TaxonomyNode): string[] {
  const prefix = node.path + '/';
  return index.nodes.filter((n) => n.id === node.id || n.path.startsWith(prefix)).map((n) => n.id);
}

/**
 * Alias-aware node matching. Synonyms come from the backend
 * (search_synonyms on each node) — "hamburger" resolves to Ground Beef because
 * the DATA says so, not because this file knows about beef.
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

/**
 * True when `listingNodeId` sits at-or-under any of the given nodes. Used for
 * client-side search: a query that matched "Nightcrawlers" should surface
 * listings filed anywhere in that subtree.
 */
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

/**
 * Legacy-compat shim: the flat `listings.category` column still exists and old
 * clients filter on it, so new listings keep it roughly in sync from the
 * selected node's root. (The forward mapping legacy→node lives in the DB as
 * legacy_category_map; this is the best-effort inverse.)
 */
const ROOT_TO_LEGACY: Record<string, string> = {
  vegetables: 'vegetables',
  fruit: 'fruit',
  herbs: 'herbs',
  eggs: 'eggs',
  seeds: 'seeds',
  plants: 'plants',
  flowers: 'flowers',
  meat: 'meat',
  pet: 'pet_treats',
  'wood-firewood': 'wood',
  'honey-and-syrups': 'honey',
  'garden-goods': 'supplies',
  'preserves-and-pantry': 'farm_fresh',
  'baked-goods': 'farm_fresh',
  'fishing-and-bait': 'other',
};

export function legacyCategoryFor(index: TaxonomyIndex, node: TaxonomyNode): string {
  const root = ancestorsOf(index, node)[0];
  return ROOT_TO_LEGACY[root?.slug ?? ''] ?? 'other';
}

/** Best-effort prefill: legacy category id (AI drafter / deep links) → root node. */
export function rootForLegacy(index: TaxonomyIndex, legacyId: string): TaxonomyNode | null {
  for (const [rootSlug, legacy] of Object.entries(ROOT_TO_LEGACY)) {
    if (legacy === legacyId) {
      const node = index.byPath.get(rootSlug);
      if (node) return node;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compliance eligibility (server-derived; the client renders, never decides)
// ---------------------------------------------------------------------------

export type EligibilityReason =
  | 'NOT_SIGNED_IN'
  | 'NO_NODE'
  | 'UNRESTRICTED'
  | 'CONDITIONAL'
  | 'REVIEW_REQUIRED'
  | 'PLAN_REQUIRED'
  | 'CREDENTIAL_OK'
  | 'CREDENTIAL_PENDING'
  | 'CREDENTIAL_EXPIRED'
  | 'CREDENTIAL_DENIED'
  | 'CREDENTIAL_REQUIRED'
  | 'PROHIBITED';

export interface Eligibility {
  allowed: boolean;
  reason: EligibilityReason;
  message: string | null;
  jurisdiction: string | null;
  /** 'profile' = derived from the seller's saved state; 'default' = we could
   *  not tell where the seller is and fell back to US-OH. When 'default' and
   *  the node is restricted, the UI asks for their location instead of
   *  presenting the fallback verdict as final. */
  jurisdiction_source: 'profile' | 'default' | null;
  classification: string | null;
  credential_requirement: string | null;
  issuing_agency: string | null;
  official_source: string | null;
  minimum_plan: string | null;
}

/** Ask the backend whether the signed-in seller may publish in this node. */
export function usePublishEligibility(nodeId?: string | null, uid?: string) {
  return useQuery({
    queryKey: ['eligibility', nodeId, uid],
    enabled: isSupabaseConfigured && !!nodeId && !!uid,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<Eligibility> => {
      const { data, error } = await supabase.rpc('publish_eligibility', {
        p_node_id: nodeId,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Eligibility | undefined;
      if (!row) throw new Error('No eligibility verdict returned.');
      return row;
    },
  });
}

// ---------------------------------------------------------------------------
// Server error codes (the server writes the copy; the client picks the title)
// ---------------------------------------------------------------------------

/** Every prefix a Gnome trigger/RPC raises before the colon. */
export type ServerErrorCode =
  | 'PROHIBITED_ITEM'
  | 'PROHIBITED_CATEGORY'
  | 'RATE_LIMITED'
  | 'COMPLIANCE_BLOCKED'
  | 'PLAN_LIMIT_REACHED'
  | 'PUBLISH_ALLOWANCE_EXHAUSTED'
  | 'NOT_AUTHORIZED'
  | 'LAST_OWNER'
  | 'INVITE_EXPIRED'
  | 'NO_PENDING_INVITE'
  | 'INVALID_ROLE'
  | 'INVALID_EMAIL'
  | 'REASON_REQUIRED'
  | 'OWNER_ONLY'
  | 'UNKNOWN_STATE';

/**
 * Title per code, plus copy for the codes the server raises BARE.
 *
 * The text after the prefix is already written for the person reading it (the
 * trigger composes it from the compliance class's customer_message), so nothing
 * here rewrites a body — the table only supplies a title. `fallback` is used
 * only when the server sent no body at all: `PLAN_LIMIT_REACHED` and the admin
 * codes are raised as a bare token, and a bare token must never reach a screen.
 */
const SERVER_ERRORS: Record<ServerErrorCode, { title: string; fallback: string }> = {
  PROHIBITED_ITEM: {
    title: 'Not allowed on Gnome',
    fallback: 'Gnome can’t carry this one. Editing the wording may help, or contact us if you think that’s wrong.',
  },
  PROHIBITED_CATEGORY: {
    title: 'Not allowed on Gnome',
    fallback: 'Gnome can’t carry items in that category.',
  },
  RATE_LIMITED: {
    title: 'Posting too quickly',
    fallback: 'You’ve posted a lot of listings in the last hour. Try again in a little while.',
  },
  COMPLIANCE_BLOCKED: {
    title: 'Verification required',
    fallback: 'This category needs verification before publishing. You can save a draft instead.',
  },
  PLAN_LIMIT_REACHED: {
    // Transitional: raised by the pre-0104 active-listing gate, which is what production runs
    // until the allowance migrations apply. Delete this entry once 0104 is live everywhere.
    title: 'Listing limit reached',
    fallback: 'You’re at your plan’s listing limit right now. Upgrade, or try again later.',
  },
  PUBLISH_ALLOWANCE_EXHAUSTED: {
    // The 0104 model: a monthly PUBLISH allowance that expiry does not refund. The wording is
    // per-period, never "active listings" — that model is retired.
    title: 'Included listings used up',
    fallback: 'You’ve used your included Sell listings for this period. Publish this one for $0.99, or upgrade for more each month.',
  },
  NOT_AUTHORIZED: {
    title: 'Not permitted',
    fallback: 'Your account can’t do that.',
  },
  LAST_OWNER: {
    title: 'Last owner',
    fallback: 'An account must always keep at least one owner.',
  },
  INVITE_EXPIRED: {
    title: 'Invitation expired',
    fallback: 'That invitation has expired. Ask for a new one.',
  },
  NO_PENDING_INVITE: {
    title: 'No pending invitation',
    fallback: 'There’s no open invitation for this email address.',
  },
  INVALID_ROLE: {
    title: 'Pick a role',
    fallback: 'That isn’t a role this account offers.',
  },
  INVALID_EMAIL: {
    title: 'Check the email',
    fallback: 'That email address doesn’t look right.',
  },
  REASON_REQUIRED: {
    title: 'Add a reason',
    fallback: 'This action is recorded, so it needs a short reason.',
  },
  OWNER_ONLY: {
    title: 'Owners only',
    fallback: 'Only an owner can do that.',
  },
  UNKNOWN_STATE: {
    title: 'Check the state',
    fallback: 'That isn’t a state Gnome recognises.',
  },
};

// Matched anywhere in the string, not just at the start: a PostgREST error can
// arrive wrapped, and the prefix is what identifies it either way.
const SERVER_ERROR_RE = new RegExp(
  `\\b(${Object.keys(SERVER_ERRORS).join('|')})\\b:?[ \\t]*([\\s\\S]*)`,
);

export interface ServerError {
  code: ServerErrorCode;
  /** Ours. */
  title: string;
  /** The server's, prefix stripped. Never contains the code, an errcode or a trigger name. */
  message: string;
  /** COMPLIANCE_BLOCKED only: the eligibility reason it nests. Internal — pick UI from it, never print it. */
  reason?: EligibilityReason;
}

/**
 * Turn a raised server error into something a person can read. Returns null for
 * anything the server did not author copy for (a network blip, a constraint
 * string) so the caller can fall back to its own generic line rather than
 * showing plumbing.
 */
export function parseServerError(raw: string | undefined | null): ServerError | null {
  if (!raw) return null;
  const m = SERVER_ERROR_RE.exec(raw);
  if (!m) return null;
  const code = m[1] as ServerErrorCode;
  const spec = SERVER_ERRORS[code];
  let body = (m[2] ?? '').trim();
  let title = spec.title;
  let reason: EligibilityReason | undefined;
  if (code === 'COMPLIANCE_BLOCKED') {
    // This one nests an eligibility reason: COMPLIANCE_BLOCKED:REASON:copy.
    // The reason chooses the title and is never shown as itself. The colon is
    // required so copy that merely opens on a capitalised word keeps its word.
    const nested = /^([A-Z_]+):[ \t]*([\s\S]*)$/.exec(body);
    if (nested) {
      reason = nested[1] as EligibilityReason;
      title = reason === 'PLAN_REQUIRED' ? 'Paid plan required' : spec.title;
      body = nested[2].trim();
    }
  }
  return { code, title, message: body || spec.fallback, reason };
}

/**
 * The COMPLIANCE_BLOCKED verdict split into its eligibility reason + copy.
 * Kept as its own export because the reason enum is what callers switch on;
 * it shares the one parser above so there is a single prefix table.
 */
export function parseComplianceError(
  message: string | undefined | null,
): { reason: EligibilityReason; message: string } | null {
  const parsed = parseServerError(message);
  if (!parsed || parsed.code !== 'COMPLIANCE_BLOCKED' || !parsed.reason) return null;
  return { reason: parsed.reason, message: parsed.message };
}
