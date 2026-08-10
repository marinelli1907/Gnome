'use client';

// Taxonomy Admin — CRUD over marketplace_taxonomy_nodes. Direct table writes
// are allowed by the admin RLS write policy; DB triggers keep invariants
// (archiving a node deactivates its subtree; deleting a node referenced by
// listings is rejected with TAXONOMY_NODE_IN_USE). Slug + path are immutable
// once created so listing links stay stable — rename only changes the name.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

const CLASSIFICATIONS = [
  'GENERALLY_UNRESTRICTED', 'CONDITIONAL', 'REGULATED', 'PROHIBITED', 'REVIEW_REQUIRED',
] as const;
const PLAN_TIERS = ['free', 'grower', 'farm', 'sponsor'];

interface TaxNode {
  id: string; parent_id: string | null; name: string; slug: string; path: string;
  depth: number; display_order: number; active: boolean; archived_at: string | null;
  search_synonyms: string[] | null; compliance_classification: string | null;
  minimum_plan_tier: string | null; local_pickup_only: boolean | null; prohibited: boolean | null;
}

interface EditForm {
  id: string; name: string; synonyms: string; classification: string;
  minimum_plan_tier: string; local_pickup_only: boolean; prohibited: boolean;
}

const kebab = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const classTag = (c: string) =>
  c === 'PROHIBITED' || c === 'REGULATED' ? 'type-sale' : 'type-wanted';

export default function TaxonomyClient() {
  const [nodes, setNodes] = useState<TaxNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addFor, setAddFor] = useState<string | 'root' | null>(null); // parent id, 'root', or closed
  const [addName, setAddName] = useState('');
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from('marketplace_taxonomy_nodes')
      .select('id,parent_id,name,slug,path,depth,display_order,active,archived_at,search_synonyms,compliance_classification,minimum_plan_tier,local_pickup_only,prohibited')
      .order('path')
      .limit(1000);
    if (error) setError(error.message);
    setNodes((data as TaxNode[]) ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, TaxNode[]>();
    for (const n of nodes) {
      const key = n.parent_id ?? 'root';
      m.set(key, [...(m.get(key) ?? []), n]);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
    }
    return m;
  }, [nodes]);
  const roots = childrenOf.get('root') ?? [];

  async function addNode(parent: TaxNode | null) {
    const name = addName.trim();
    const slug = kebab(name);
    if (!name || !slug) return setError('Give the new node a name.');
    const siblings = childrenOf.get(parent?.id ?? 'root') ?? [];
    if (siblings.some((s) => s.slug === slug)) return setError(`A sibling with slug “${slug}” already exists.`);
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('marketplace_taxonomy_nodes').insert({
      parent_id: parent?.id ?? null,
      name, slug,
      path: parent ? `${parent.path}/${slug}` : slug,
      depth: parent ? parent.depth + 1 : 0,
      display_order: siblings.reduce((m, s) => Math.max(m, s.display_order), 0) + 1,
      active: true,
    });
    setBusy(false);
    if (error) setError(error.message);
    else {
      setAddFor(null); setAddName('');
      if (parent) setExpanded((e) => ({ ...e, [parent.id]: true }));
      await load();
    }
  }

  // Reorder within siblings by swapping display_order (same pattern as
  // MyMarketClient.moveListing — write both rows, then refetch).
  async function move(node: TaxNode, dir: 'up' | 'down') {
    const siblings = childrenOf.get(node.parent_id ?? 'root') ?? [];
    const idx = siblings.findIndex((s) => s.id === node.id);
    const other = siblings[dir === 'up' ? idx - 1 : idx + 1];
    if (!other) return;
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    // Guard against duplicate display_order values making a swap a no-op.
    const a = other.display_order === node.display_order ? node.display_order + (dir === 'up' ? -1 : 1) : other.display_order;
    const [r1, r2] = await Promise.all([
      sb.from('marketplace_taxonomy_nodes').update({ display_order: a }).eq('id', node.id),
      sb.from('marketplace_taxonomy_nodes').update({ display_order: node.display_order }).eq('id', other.id),
    ]);
    const err = r1.error ?? r2.error;
    if (err) setError(err.message);
    await load();
    setBusy(false);
  }

  async function saveEdit() {
    if (!edit) return;
    if (!edit.name.trim()) return setError('The node needs a name.');
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('marketplace_taxonomy_nodes').update({
      name: edit.name.trim(), // slug/path intentionally untouched
      search_synonyms: edit.synonyms.split(',').map((s) => s.trim()).filter(Boolean),
      compliance_classification: edit.classification,
      minimum_plan_tier: edit.minimum_plan_tier || null,
      local_pickup_only: edit.local_pickup_only,
      prohibited: edit.prohibited,
    }).eq('id', edit.id);
    setBusy(false);
    if (error) setError(error.message);
    else { setEdit(null); await load(); }
  }

  async function archive(node: TaxNode) {
    if (!window.confirm(`Archive “${node.name}”? A database trigger deactivates its whole subtree automatically.`)) return;
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('marketplace_taxonomy_nodes')
      .update({ archived_at: new Date().toISOString() }).eq('id', node.id);
    setBusy(false);
    if (error) setError(error.message);
    else await load();
  }

  async function reactivate(node: TaxNode) {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('marketplace_taxonomy_nodes')
      .update({ archived_at: null, active: true }).eq('id', node.id);
    setBusy(false);
    if (error) setError(error.message);
    else await load();
  }

  async function remove(node: TaxNode) {
    if (!window.confirm(`Permanently delete “${node.name}” (${node.path})? This cannot be undone. If listings use it, the database will refuse.`)) return;
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('marketplace_taxonomy_nodes').delete().eq('id', node.id);
    setBusy(false);
    if (error) {
      setError(error.message.includes('TAXONOMY_NODE_IN_USE')
        ? 'This node is used by listings — archive it instead.'
        : error.message);
    } else await load();
  }

  function renderNode(node: TaxNode): ReactNode {
    const kids = childrenOf.get(node.id) ?? [];
    const siblings = childrenOf.get(node.parent_id ?? 'root') ?? [];
    const idx = siblings.findIndex((s) => s.id === node.id);
    const open = !!expanded[node.id];
    const cls = node.compliance_classification;
    return (
      <div key={node.id}>
        <div className="lot-row" style={{ paddingLeft: node.depth * 20 }}>
          <button className="linkbtn" style={{ width: 18, color: 'var(--muted)' }}
            onClick={() => setExpanded((e) => ({ ...e, [node.id]: !open }))}
            aria-label={open ? 'Collapse' : 'Expand'}>
            {kids.length > 0 ? (open ? '▾' : '▸') : '·'}
          </button>
          <span style={{ fontWeight: 600 }}>{node.name}</span>
          <span className="mm-expiry">{node.slug}</span>
          {cls && cls !== 'GENERALLY_UNRESTRICTED' && <span className={`tag ${classTag(cls)}`}>{cls}</span>}
          {node.prohibited && <span className="tag type-sale">prohibited</span>}
          {node.local_pickup_only && <span className="tag">pickup only</span>}
          {node.minimum_plan_tier && <span className="tag">≥ {node.minimum_plan_tier}</span>}
          {node.archived_at
            ? <span className="tag type-sale">archived</span>
            : !node.active && <span className="tag">inactive</span>}
          <span className="lot-actions">
            <button className="mm-btn" title="Move up" disabled={busy || idx <= 0} onClick={() => void move(node, 'up')}>↑</button>
            <button className="mm-btn" title="Move down" disabled={busy || idx >= siblings.length - 1} onClick={() => void move(node, 'down')}>↓</button>
            <button className="mm-btn" disabled={busy} onClick={() => {
              setAddFor(null);
              setEdit(edit?.id === node.id ? null : {
                id: node.id, name: node.name,
                synonyms: (node.search_synonyms ?? []).join(', '),
                classification: node.compliance_classification ?? 'GENERALLY_UNRESTRICTED',
                minimum_plan_tier: node.minimum_plan_tier ?? '',
                local_pickup_only: !!node.local_pickup_only,
                prohibited: !!node.prohibited,
              });
            }}>✏️ Edit</button>
            <button className="mm-btn" disabled={busy} onClick={() => { setEdit(null); setAddName(''); setAddFor(addFor === node.id ? null : node.id); }}>+ Child</button>
            {node.archived_at
              ? <button className="mm-btn" disabled={busy} title="Children stay archived — reactivate them individually" onClick={() => void reactivate(node)}>Reactivate</button>
              : <button className="mm-btn" disabled={busy} onClick={() => void archive(node)}>Archive</button>}
            <button className="mm-btn danger" disabled={busy} onClick={() => void remove(node)}>Delete</button>
          </span>
        </div>

        {addFor === node.id && (
          <div className="locrow" style={{ marginLeft: node.depth * 20 + 24, marginBottom: 8 }}>
            <input autoFocus placeholder={`New child of ${node.name}…`} value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addNode(node); }} />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void addNode(node)}>Add</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setAddFor(null)}>Cancel</button>
          </div>
        )}

        {edit?.id === node.id && (
          <div className="preview-note" style={{ marginLeft: node.depth * 20 + 24 }}>
            <div className="field"><label>Name</label>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <p className="mm-expiry" style={{ margin: '4px 0 0' }}>
              Renaming changes the display name only — slug “{node.slug}” and path “{node.path}” stay stable so existing listings keep working.
            </p>
            <div className="field" style={{ marginTop: 8 }}><label>Search synonyms (comma-separated)</label>
              <input value={edit.synonyms} placeholder="e.g. courgette, summer squash"
                onChange={(e) => setEdit({ ...edit, synonyms: e.target.value })} /></div>
            <div className="field-row" style={{ marginTop: 8 }}>
              <div className="field"><label>Compliance classification</label>
                <select value={edit.classification} onChange={(e) => setEdit({ ...edit, classification: e.target.value })}>
                  {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div className="field"><label>Minimum plan tier</label>
                <select value={edit.minimum_plan_tier} onChange={(e) => setEdit({ ...edit, minimum_plan_tier: e.target.value })}>
                  <option value="">none</option>
                  {[...new Set([...PLAN_TIERS, ...(edit.minimum_plan_tier && !PLAN_TIERS.includes(edit.minimum_plan_tier) ? [edit.minimum_plan_tier] : [])])]
                    .map((p) => <option key={p} value={p}>{p}</option>)}
                </select></div>
            </div>
            <div className="chiprow" style={{ marginTop: 8 }}>
              <button type="button" className={`chip${edit.local_pickup_only ? ' active' : ''}`}
                onClick={() => setEdit({ ...edit, local_pickup_only: !edit.local_pickup_only })}>
                📍 Local pickup only
              </button>
              <button type="button" className={`chip${edit.prohibited ? ' active' : ''}`}
                onClick={() => setEdit({ ...edit, prohibited: !edit.prohibited })}>
                🚫 Prohibited
              </button>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveEdit()}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        )}

        {open && kids.map((k) => renderNode(k))}
      </div>
    );
  }

  if (!loaded && !error) return <div className="empty"><p>Loading taxonomy…</p></div>;

  return (
    <div>
      {error && <p className="autherror">{error}</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="mm-expiry">
          {nodes.length} nodes · {roots.length} top-level categories ·{' '}
          {nodes.filter((n) => n.archived_at).length} archived
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="mm-btn" onClick={() => setExpanded(Object.fromEntries(nodes.map((n) => [n.id, true])))}>Expand all</button>
          <button className="mm-btn" onClick={() => setExpanded({})}>Collapse all</button>
          <button className="btn btn-primary btn-sm" onClick={() => { setEdit(null); setAddName(''); setAddFor(addFor === 'root' ? null : 'root'); }}>
            + Root category
          </button>
        </div>
      </div>

      {addFor === 'root' && (
        <div className="locrow" style={{ marginBottom: 12 }}>
          <input autoFocus placeholder="New top-level category…" value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addNode(null); }} />
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void addNode(null)}>Add</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setAddFor(null)}>Cancel</button>
        </div>
      )}

      <div className="preview-note" style={{ marginTop: 0 }}>
        {roots.length === 0 && <div className="empty"><p>No taxonomy nodes yet.</p></div>}
        {roots.map((r) => renderNode(r))}
      </div>
    </div>
  );
}
