'use client';

// Compliance Center — admin review of seller credentials (cottage-food permits,
// egg licenses, …). This UI holds NO authority: reads succeed only because the
// admin RLS policies allow them, and every review decision goes through the
// hardened admin_review_credential RPC — never a direct status write. The RPC
// enforces the reason requirement server-side (REASON_REQUIRED) and writes
// compliance_audit_log; the UI mirrors that rule so admins can't even try.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

type CredStatus =
  | 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'DENIED'
  | 'EXPIRED' | 'RENEWAL_REQUIRED' | 'REVOKED';
type ReviewAction = 'APPROVE' | 'DENY' | 'REQUEST_RESUBMISSION' | 'REVOKE';
type AdverseAction = Exclude<ReviewAction, 'APPROVE'>;

interface Credential {
  id: string; seller_id: string; market_id: string | null;
  country: string | null; state: string | null; county: string | null; city: string | null;
  credential_type: string | null; issuing_agency: string | null; credential_number: string | null;
  issue_date: string | null; expiration_date: string | null; document_path: string | null;
  status: CredStatus; submitted_at: string | null; reviewed_at: string | null; reviewed_by: string | null;
  denial_reason: string | null; admin_notes: string | null; seller_notes: string | null;
  renewal_of_id: string | null; created_at: string; updated_at: string | null;
}
interface ScopeRow { credential_id: string; taxonomy_node_id: string }
interface TaxNode {
  id: string; parent_id: string | null; name: string; slug: string;
  path: string; depth: number; active: boolean; archived_at: string | null;
}
interface ProfileRow { id: string; name: string | null; city: string | null; county: string | null; state: string | null }
interface MarketRow { id: string; owner_id: string; name: string | null; plan: string | null }
interface RuleRow {
  jurisdiction: string; taxonomy_node_id: string | null; classification: string | null;
  rule_type: string | null; credential_requirement: string | null; issuing_agency: string | null;
  minimum_plan: string | null; official_source: string | null; review_status: string | null; notes: string | null;
}
interface AuditRow {
  credential_id: string; seller_id: string; actor_id: string | null;
  actor_role: 'seller' | 'admin' | 'system'; action: string;
  old_status: string | null; new_status: string | null; reason: string | null; created_at: string;
}
// listings: explicit columns only — column grants make select('*') fail (42501).
const LISTING_COLS = 'id,owner_id,market_id,listing_type,title,category,status,created_at,expires_at,taxonomy_node_id';
interface ListingRow {
  id: string; owner_id: string; market_id: string | null; listing_type: string;
  title: string; category: string | null; status: string; created_at: string;
  expires_at: string | null; taxonomy_node_id: string | null;
}

const EXPIRING_DAYS = 30;       // "expiring soon" horizon
const RENEWAL_STALE_DAYS = 3;   // RENEWAL_REQUIRED still unanswered after this

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoInDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString() : '—');
const daysUntil = (d: string) => Math.ceil((+new Date(d) - Date.now()) / 86400_000);
const inSubtree = (nodePath: string, scopePath: string) =>
  nodePath === scopePath || nodePath.startsWith(scopePath + '/');
const statusTag = (s: CredStatus) =>
  s === 'APPROVED' ? 'type-free'
  : s === 'PENDING' || s === 'RENEWAL_REQUIRED' ? 'type-wanted'
  : s === 'NOT_SUBMITTED' ? ''
  : 'type-sale';

const th: CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700,
  color: 'var(--muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
};
const td: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', fontSize: 14 };

export default function ComplianceClient() {
  const [creds, setCreds] = useState<Credential[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [nodes, setNodes] = useState<TaxNode[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [paused, setPaused] = useState<ListingRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [markets, setMarkets] = useState<Record<string, MarketRow>>({});
  const [loaded, setLoaded] = useState(false);

  const [fStatus, setFStatus] = useState<'all' | CredStatus>('all');
  const [fState, setFState] = useState('all');
  const [fCategory, setFCategory] = useState('all'); // root node id
  const [fExpiry, setFExpiry] = useState<'any' | '30' | '60' | '90' | 'expired'>('any');
  const [q, setQ] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [sellerListings, setSellerListings] = useState<ListingRow[]>([]);
  const [pendingAction, setPendingAction] = useState<AdverseAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const sb = supabaseBrowser();
    const [c, s, n, r, p] = await Promise.all([
      sb.from('seller_credentials').select('*').order('created_at', { ascending: false }).limit(1000),
      sb.from('credential_taxonomy_scope').select('credential_id,taxonomy_node_id').limit(5000),
      sb.from('marketplace_taxonomy_nodes')
        .select('id,parent_id,name,slug,path,depth,active,archived_at').order('path').limit(1000),
      sb.from('compliance_rules')
        .select('jurisdiction,taxonomy_node_id,classification,rule_type,credential_requirement,issuing_agency,minimum_plan,official_source,review_status,notes')
        .limit(1000),
      sb.from('listings').select(LISTING_COLS).eq('status', 'paused')
        .order('created_at', { ascending: false }).limit(200),
    ]);
    const firstErr = c.error ?? s.error ?? n.error ?? r.error ?? p.error;
    if (firstErr) setError(firstErr.message);
    const credRows = (c.data as Credential[]) ?? [];
    const pausedRows = (p.data as unknown as ListingRow[]) ?? [];
    setCreds(credRows);
    setScopes((s.data as ScopeRow[]) ?? []);
    setNodes((n.data as TaxNode[]) ?? []);
    setRules((r.data as RuleRow[]) ?? []);
    setPaused(pausedRows);

    // Names for every seller/owner in view; market + plan for every credential.
    const sellerIds = [...new Set([...credRows.map((x) => x.seller_id), ...pausedRows.map((x) => x.owner_id)])];
    const marketIds = [...new Set(credRows.map((x) => x.market_id).filter((x): x is string => !!x))];
    if (sellerIds.length > 0) {
      const { data } = await sb.from('profiles').select('id,name,city,county,state').in('id', sellerIds);
      setProfiles(Object.fromEntries(((data as ProfileRow[]) ?? []).map((x) => [x.id, x])));
    }
    if (marketIds.length > 0) {
      const { data } = await sb.from('markets').select('id,owner_id,name,plan').in('id', marketIds);
      setMarkets(Object.fromEntries(((data as MarketRow[]) ?? []).map((x) => [x.id, x])));
    }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const scopesByCred = useMemo(() => {
    const m = new Map<string, TaxNode[]>();
    for (const s of scopes) {
      const node = nodeById.get(s.taxonomy_node_id);
      if (!node) continue;
      const arr = m.get(s.credential_id) ?? [];
      arr.push(node);
      m.set(s.credential_id, arr);
    }
    return m;
  }, [scopes, nodeById]);
  const roots = useMemo(
    () => nodes.filter((n) => n.parent_id === null).sort((a, b) => a.name.localeCompare(b.name)),
    [nodes]);

  const sellerName = (id: string) => profiles[id]?.name ?? `${id.slice(0, 8)}…`;
  const marketOf = (c: Credential) => (c.market_id ? markets[c.market_id] : undefined);

  // ---- Dashboard buckets (computed from the full admin-visible credential set)
  const today = isoToday();
  const soon = isoInDays(EXPIRING_DAYS);
  const pending = creds.filter((c) => c.status === 'PENDING');
  const approved = creds.filter((c) => c.status === 'APPROVED');
  const expiringSoon = approved.filter((c) => c.expiration_date && c.expiration_date <= soon);
  const expired = creds.filter((c) => c.status === 'EXPIRED');
  const denied = creds.filter((c) => c.status === 'DENIED');
  const revoked = creds.filter((c) => c.status === 'REVOKED');
  const renewalStale = creds.filter((c) =>
    c.status === 'RENEWAL_REQUIRED'
    && +new Date(c.updated_at ?? c.created_at) < Date.now() - RENEWAL_STALE_DAYS * 86400_000);
  const missingDoc = creds.filter((c) => !c.document_path && c.status !== 'NOT_SUBMITTED');
  const pausedByOwner = useMemo(() => {
    const m = new Map<string, ListingRow[]>();
    for (const l of paused) m.set(l.owner_id, [...(m.get(l.owner_id) ?? []), l]);
    return [...m.entries()];
  }, [paused]);

  // ---- Queue filtering ------------------------------------------------------
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const root = fCategory === 'all' ? null : nodeById.get(fCategory);
    return creds.filter((c) => {
      if (fStatus !== 'all' && c.status !== fStatus) return false;
      if (fState !== 'all' && c.state !== fState) return false;
      if (root && !(scopesByCred.get(c.id) ?? []).some((n) => inSubtree(n.path, root.path))) return false;
      if (fExpiry !== 'any') {
        if (!c.expiration_date) return false;
        if (fExpiry === 'expired') { if (c.expiration_date >= today) return false; }
        // Windows include already-past dates: "≤ 30d" = expires within 30 days or overdue.
        else if (c.expiration_date > isoInDays(Number(fExpiry))) return false;
      }
      if (needle) {
        const hay = [sellerName(c.seller_id), marketOf(c)?.name ?? '', c.credential_number ?? '']
          .join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => {
      const pa = a.status === 'PENDING' ? 0 : 1;
      const pb = b.status === 'PENDING' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return +new Date(b.submitted_at ?? b.created_at) - +new Date(a.submitted_at ?? a.created_at);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds, fStatus, fState, fCategory, fExpiry, q, nodeById, scopesByCred, profiles, markets, today]);

  const states = useMemo(
    () => [...new Set(creds.map((c) => c.state).filter((s): s is string => !!s))].sort(),
    [creds]);

  // ---- Detail data ----------------------------------------------------------
  const sel = useMemo(() => creds.find((c) => c.id === selectedId) ?? null, [creds, selectedId]);

  useEffect(() => {
    if (!sel) { setAudit([]); setSellerListings([]); return; }
    let stale = false;
    const sb = supabaseBrowser();
    void (async () => {
      const [a, l] = await Promise.all([
        sb.from('compliance_audit_log')
          .select('credential_id,seller_id,actor_id,actor_role,action,old_status,new_status,reason,created_at')
          .eq('credential_id', sel.id).order('created_at', { ascending: false }).limit(100),
        sb.from('listings').select(LISTING_COLS).eq('owner_id', sel.seller_id)
          .order('created_at', { ascending: false }).limit(100),
      ]);
      if (stale) return;
      if (a.error ?? l.error) setError((a.error ?? l.error)!.message);
      setAudit((a.data as AuditRow[]) ?? []);
      setSellerListings((l.data as unknown as ListingRow[]) ?? []);
    })();
    return () => { stale = true; };
  }, [sel]);

  const selScope = sel ? scopesByCred.get(sel.id) ?? [] : [];
  const selMarket = sel ? marketOf(sel) : undefined;
  const selRules = useMemo(() => {
    if (!sel) return [];
    const jurState = `${sel.country || 'US'}-${sel.state ?? ''}`;
    return rules.filter((r) => {
      if (r.jurisdiction !== jurState && r.jurisdiction !== (sel.country || 'US')) return false;
      if (!r.taxonomy_node_id) return true; // jurisdiction-wide rule
      const ruleNode = nodeById.get(r.taxonomy_node_id);
      if (!ruleNode) return false;
      return selScope.some((s) => inSubtree(s.path, ruleNode.path) || inSubtree(ruleNode.path, s.path));
    });
  }, [sel, rules, nodeById, selScope]);
  const selPrevious = sel ? creds.filter((c) => c.seller_id === sel.seller_id && c.id !== sel.id) : [];
  const renewalChain = useMemo(() => {
    if (!sel) return [];
    const byId = new Map(creds.map((c) => [c.id, c]));
    const chain: Credential[] = [];
    const seen = new Set<string>([sel.id]);
    let cur = sel.renewal_of_id ? byId.get(sel.renewal_of_id) : undefined;
    while (cur && !seen.has(cur.id)) { chain.push(cur); seen.add(cur.id); cur = cur.renewal_of_id ? byId.get(cur.renewal_of_id) : undefined; }
    return chain;
  }, [sel, creds]);
  const renewedBy = sel ? creds.filter((c) => c.renewal_of_id === sel.id) : [];
  const scopedListings = useMemo(() => {
    if (!sel) return [];
    return sellerListings.filter((l) => {
      if (!l.taxonomy_node_id) return false;
      const node = nodeById.get(l.taxonomy_node_id);
      return !!node && selScope.some((s) => inSubtree(node.path, s.path));
    });
  }, [sel, sellerListings, nodeById, selScope]);

  // ---- Actions --------------------------------------------------------------
  // The only write path: the RPC validates admin, reason, and expiry server-side.
  async function review(action: ReviewAction, reasonText: string | null) {
    if (!sel) return;
    if (action !== 'APPROVE' && !reasonText?.trim()) {
      return setError('A reason is required to deny, request resubmission, or revoke.');
    }
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc('admin_review_credential', {
      p_credential: sel.id, p_action: action, p_reason: reasonText?.trim() || null,
    });
    setBusy(false);
    if (error) {
      setError(error.message.includes('CANNOT_APPROVE_EXPIRED')
        ? `${error.message} — the expiration date is in the past, so this can't be approved. Ask the seller for a renewal instead.`
        : error.message);
    } else {
      setPendingAction(null); setReason('');
      await load(); // never optimistic — refetch, and the [sel] effect refreshes the audit trail
    }
  }

  async function viewDocument(path: string) {
    setBusy(true); setError(null);
    const { data, error } = await supabaseBrowser().storage.from('compliance-docs').createSignedUrl(path, 300);
    setBusy(false);
    if (error) setError(error.message);
    else if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  function openCard(status: 'all' | CredStatus, expiry: typeof fExpiry = 'any') {
    setSelectedId(null); setFStatus(status); setFExpiry(expiry); setFState('all'); setFCategory('all'); setQ('');
  }

  if (!loaded && !error) return <div className="empty"><p>Loading compliance data…</p></div>;

  const cards: { label: string; value: number; hot?: boolean; onClick: () => void }[] = [
    { label: 'Pending review', value: pending.length, hot: pending.length > 0, onClick: () => openCard('PENDING') },
    { label: `Expiring ≤ ${EXPIRING_DAYS} days`, value: expiringSoon.length, hot: expiringSoon.length > 0, onClick: () => openCard('APPROVED', '30') },
    { label: 'Expired', value: expired.length, onClick: () => openCard('EXPIRED') },
    { label: 'Approved', value: approved.length, onClick: () => openCard('APPROVED') },
    { label: 'Denied', value: denied.length, onClick: () => openCard('DENIED') },
    { label: 'Revoked', value: revoked.length, onClick: () => openCard('REVOKED') },
  ];

  // ============================ Detail view =================================
  if (sel) {
    const adverseLabels: Record<AdverseAction, string> = {
      DENY: 'Deny', REQUEST_RESUBMISSION: 'Request resubmission', REVOKE: 'Revoke',
    };
    const seller = profiles[sel.seller_id];
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedId(null); setPendingAction(null); setReason(''); }}>
            ← Back to queue
          </button>
          <span className={`tag ${statusTag(sel.status)}`}>{sel.status}</span>
        </div>
        {error && <p className="autherror">{error}</p>}

        <div className="preview-note">
          <div><strong>Seller:</strong> {sellerName(sel.seller_id)}
            {seller && (seller.city || seller.county || seller.state)
              ? ` — ${[seller.city, seller.county, seller.state].filter(Boolean).join(', ')}` : ''}
            {' · '}<span className="mm-expiry">{sel.seller_id.slice(0, 8)}…</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Market:</strong> {selMarket ? `${selMarket.name ?? 'Unnamed market'} · ${(selMarket.plan ?? 'free') === 'free' ? 'free plan' : `${selMarket.plan} plan (paid)`}` : 'no market linked'}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Category scope:</strong>{' '}
            {selScope.length === 0 ? 'no categories scoped' : selScope.map((n) => (
              <span key={n.id} className="tag" style={{ marginRight: 4 }}>{n.name}</span>
            ))}
          </div>
        </div>

        <div className="preview-note">
          <strong>Credential</strong>
          <div style={{ marginTop: 6 }}>Type: {sel.credential_type ?? '—'} · Permit #: {sel.credential_number ?? '—'}</div>
          <div>Issuer: {sel.issuing_agency ?? '—'}</div>
          <div>Jurisdiction: {[sel.city, sel.county, sel.state, sel.country].filter(Boolean).join(', ') || '—'}</div>
          <div>
            Issued {fmtDate(sel.issue_date)} · Expires {fmtDate(sel.expiration_date)}
            {sel.expiration_date && (
              <span className={`tag ${sel.expiration_date < today ? 'type-sale' : sel.expiration_date <= soon ? 'type-wanted' : 'type-free'}`} style={{ marginLeft: 6 }}>
                {sel.expiration_date < today
                  ? `expired ${-daysUntil(sel.expiration_date)}d ago`
                  : `${daysUntil(sel.expiration_date)}d left`}
              </span>
            )}
          </div>
          <div>Submitted {sel.submitted_at ? new Date(sel.submitted_at).toLocaleString() : '—'} · Last reviewed {sel.reviewed_at ? new Date(sel.reviewed_at).toLocaleString() : 'never'}</div>
          {sel.seller_notes && <div style={{ marginTop: 4 }}>📝 Seller notes: {sel.seller_notes}</div>}
          {sel.admin_notes && <div style={{ marginTop: 4 }}>🗒 Admin notes: {sel.admin_notes}</div>}
          {sel.denial_reason && <div style={{ marginTop: 4 }}>⛔ Last denial reason: {sel.denial_reason}</div>}
          <div style={{ marginTop: 8 }}>
            {sel.document_path
              ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void viewDocument(sel.document_path!)}>📄 View document</button>
              : <span className="tag type-sale">No document attached</span>}
          </div>
        </div>

        <div className="preview-note">
          <strong>Review decision</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy}
              onClick={() => { setPendingAction(null); setReason(''); void review('APPROVE', null); }}>
              ✓ Approve
            </button>
            {(Object.keys(adverseLabels) as AdverseAction[]).map((a) => (
              <button key={a} className={`mm-btn${pendingAction === a ? '' : ' danger'}`} disabled={busy}
                onClick={() => { setPendingAction(pendingAction === a ? null : a); setError(null); }}>
                {adverseLabels[a]}
              </button>
            ))}
          </div>
          {pendingAction && (
            <div style={{ marginTop: 10 }}>
              <div className="field">
                <label>Reason (required — the seller sees this, and the server rejects the action without it)</label>
                <textarea rows={2} value={reason} autoFocus
                  placeholder={pendingAction === 'REQUEST_RESUBMISSION'
                    ? 'e.g. Document is blurry — please re-upload a readable scan.'
                    : 'e.g. Permit number does not match the issuing agency record.'}
                  onChange={(e) => setReason(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={busy || !reason.trim()}
                  onClick={() => void review(pendingAction, reason)}>
                  {busy ? 'Working…' : `Confirm ${adverseLabels[pendingAction].toLowerCase()}`}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setPendingAction(null); setReason(''); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <section className="section" style={{ paddingTop: 6 }}>
          <div className="section-head"><h2>Matching compliance rules</h2></div>
          {selRules.length === 0 && <p className="mm-expiry">No compliance_rules rows match this state + category scope.</p>}
          {selRules.map((r, i) => (
            <div key={i} className="preview-note" style={{ marginTop: 6 }}>
              <div>
                <strong>{r.jurisdiction}</strong>
                {r.taxonomy_node_id ? ` · ${nodeById.get(r.taxonomy_node_id)?.name ?? r.taxonomy_node_id}` : ' · jurisdiction-wide'}
                {r.classification && <span className="tag" style={{ marginLeft: 6 }}>{r.classification}</span>}
                {r.review_status && <span className="tag" style={{ marginLeft: 4 }}>{r.review_status}</span>}
              </div>
              <div style={{ marginTop: 4 }}>
                {r.rule_type ? `${r.rule_type}: ` : ''}{r.credential_requirement ?? 'no credential requirement recorded'}
                {r.issuing_agency ? ` · issued by ${r.issuing_agency}` : ''}
                {r.minimum_plan ? ` · min plan ${r.minimum_plan}` : ''}
              </div>
              {r.notes && <div style={{ marginTop: 4 }}>📝 {r.notes}</div>}
              {r.official_source && (
                <div style={{ marginTop: 4 }}>
                  <a href={r.official_source} target="_blank" rel="noopener noreferrer">Official source ↗</a>
                </div>
              )}
            </div>
          ))}
        </section>

        <section className="section" style={{ paddingTop: 6 }}>
          <div className="section-head"><h2>Listings in scoped categories</h2></div>
          {selScope.length === 0 && <p className="mm-expiry">No scope set — cannot match listings to a category subtree.</p>}
          {selScope.length > 0 && scopedListings.length === 0 && <p className="mm-expiry">No listings by this seller in the scoped subtree.</p>}
          <div className="mm-list">
            {scopedListings.map((l) => (
              <div key={l.id} className="mm-row">
                <div className="mm-info">
                  <span className="mm-title">{l.title}</span>
                  <div className="mm-meta">
                    <span className={`tag type-${l.listing_type}`}>{l.listing_type}</span>
                    <span className={`tag ${l.status === 'paused' ? 'type-sale' : ''}`}>{l.status}</span>
                    <span className="mm-expiry">{nodeById.get(l.taxonomy_node_id ?? '')?.name ?? l.category ?? ''}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section" style={{ paddingTop: 6 }}>
          <div className="section-head"><h2>Other credentials from this seller</h2></div>
          {renewalChain.length > 0 && (
            <p className="mm-expiry" style={{ marginBottom: 6 }}>
              Renewal chain: this credential renews {renewalChain.map((c) => `${c.credential_type ?? 'credential'} (${c.status}, exp ${fmtDate(c.expiration_date)})`).join(' → renews ')}
            </p>
          )}
          {renewedBy.length > 0 && (
            <p className="mm-expiry" style={{ marginBottom: 6 }}>
              Renewed by: {renewedBy.map((c) => `${c.credential_type ?? 'credential'} (${c.status})`).join(', ')}
            </p>
          )}
          {selPrevious.length === 0 && <p className="mm-expiry">No other credentials on file.</p>}
          <div className="mm-list">
            {selPrevious.map((c) => (
              <div key={c.id} className="mm-row">
                <div className="mm-info">
                  <span className="mm-title">{c.credential_type ?? 'credential'} · {c.credential_number ?? 'no number'}</span>
                  <div className="mm-meta">
                    <span className={`tag ${statusTag(c.status)}`}>{c.status}</span>
                    <span className="mm-expiry">exp {fmtDate(c.expiration_date)}</span>
                    {c.renewal_of_id === sel.id && <span className="tag">renews this one</span>}
                    {sel.renewal_of_id === c.id && <span className="tag">renewed by this one</span>}
                  </div>
                </div>
                <div className="mm-btns">
                  <button className="mm-btn" onClick={() => { setSelectedId(c.id); setPendingAction(null); setReason(''); }}>Open</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section" style={{ paddingTop: 6 }}>
          <div className="section-head"><h2>Audit timeline</h2></div>
          {audit.length === 0 && <p className="mm-expiry">No audit entries yet.</p>}
          <div className="mm-list">
            {audit.map((a, i) => (
              <div key={i} className="mm-row">
                <div className="mm-info">
                  <span className="mm-title">
                    {a.action} <span className="mm-expiry">by {a.actor_role}</span>
                    {a.old_status && a.new_status ? <span className="mm-expiry"> · {a.old_status} → {a.new_status}</span> : null}
                  </span>
                  <div className="mm-meta">
                    <span className="mm-expiry">{new Date(a.created_at).toLocaleString()}</span>
                    {a.reason && <span className="mm-expiry">📝 {a.reason}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  // ============================ Dashboard + queue ============================
  return (
    <div>
      {error && <p className="autherror">{error}</p>}

      <div className="dash-cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {cards.map((c) => (
          <button key={c.label} className={`dash-card${c.hot ? ' hot' : ''}`} onClick={c.onClick}>
            <span className="dc-value">{c.value}</span>
            <span className="dc-label">{c.label}</span>
          </button>
        ))}
      </div>

      <section className="section" style={{ paddingTop: 10 }}>
        <div className="section-head"><h2>Needs attention</h2></div>
        <div className="mm-list">
          {expiringSoon.map((c) => (
            <div key={c.id} className="mm-row">
              <div className="mm-info">
                <span className="mm-title">
                  {sellerName(c.seller_id)}: {c.credential_type ?? 'credential'}{' '}
                  {c.expiration_date! < today
                    ? `expired ${-daysUntil(c.expiration_date!)}d ago`
                    : `expires in ${daysUntil(c.expiration_date!)}d`} ({fmtDate(c.expiration_date)})
                </span>
              </div>
              <div className="mm-btns"><button className="mm-btn" onClick={() => setSelectedId(c.id)}>Review</button></div>
            </div>
          ))}
          {renewalStale.map((c) => (
            <div key={c.id} className="mm-row">
              <div className="mm-info">
                <span className="mm-title">
                  {sellerName(c.seller_id)}: resubmission requested {Math.floor((Date.now() - +new Date(c.updated_at ?? c.created_at)) / 86400_000)}d ago — still waiting
                </span>
                <div className="mm-meta"><span className="tag type-wanted">RENEWAL_REQUIRED</span></div>
              </div>
              <div className="mm-btns"><button className="mm-btn" onClick={() => setSelectedId(c.id)}>Open</button></div>
            </div>
          ))}
          {pausedByOwner.map(([owner, ls]) => (
            <div key={owner} className="mm-row">
              <div className="mm-info">
                <span className="mm-title">{sellerName(owner)} has {ls.length} paused listing{ls.length === 1 ? '' : 's'}</span>
                <div className="mm-meta" style={{ flexWrap: 'wrap' }}>
                  {ls.slice(0, 4).map((l) => <span key={l.id} className="tag">{l.title}</span>)}
                  {ls.length > 4 && <span className="mm-expiry">+{ls.length - 4} more</span>}
                </div>
              </div>
            </div>
          ))}
          {missingDoc.map((c) => (
            <div key={c.id} className="mm-row">
              <div className="mm-info">
                <span className="mm-title">{sellerName(c.seller_id)}: {c.credential_type ?? 'credential'} has no document attached</span>
                <div className="mm-meta"><span className={`tag ${statusTag(c.status)}`}>{c.status}</span></div>
              </div>
              <div className="mm-btns"><button className="mm-btn" onClick={() => setSelectedId(c.id)}>Open</button></div>
            </div>
          ))}
          {expiringSoon.length + renewalStale.length + pausedByOwner.length + missingDoc.length === 0 && (
            <div className="empty"><p>Compliance is quiet. 🌱 Nothing needs you right now.</p></div>
          )}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 10 }}>
        <div className="section-head"><h2>Credential queue</h2></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input style={{ flex: '1 1 220px', maxWidth: 320 }} value={q}
            placeholder="Search seller, market, permit #…" onChange={(e) => setQ(e.target.value)} />
          <select style={{ width: 'auto' }} value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)}>
            <option value="all">All statuses</option>
            {(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'RENEWAL_REQUIRED', 'REVOKED', 'NOT_SUBMITTED'] as CredStatus[])
              .map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={{ width: 'auto' }} value={fState} onChange={(e) => setFState(e.target.value)}>
            <option value="all">All states</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={{ width: 'auto' }} value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="all">All categories</option>
            {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select style={{ width: 'auto' }} value={fExpiry} onChange={(e) => setFExpiry(e.target.value as typeof fExpiry)}>
            <option value="any">Any expiration</option>
            <option value="30">Expires ≤ 30d</option>
            <option value="60">Expires ≤ 60d</option>
            <option value="90">Expires ≤ 90d</option>
            <option value="expired">Already expired</option>
          </select>
        </div>

        {filtered.length === 0 && <div className="empty"><p>No credentials match these filters.</p></div>}
        {filtered.length > 0 && (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Seller', 'Market', 'State', 'Category scope', 'Type', 'Permit #', 'Issuer', 'Expiration', 'Submitted', 'Status']
                    .map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const scope = scopesByCred.get(c.id) ?? [];
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(c.id)}>
                      <td style={td}><strong>{sellerName(c.seller_id)}</strong></td>
                      <td style={td}>{marketOf(c)?.name ?? '—'}</td>
                      <td style={td}>{c.state ?? '—'}</td>
                      <td style={td}>
                        {scope.slice(0, 2).map((n) => n.name).join(', ') || '—'}
                        {scope.length > 2 ? ` +${scope.length - 2}` : ''}
                      </td>
                      <td style={td}>{c.credential_type ?? '—'}</td>
                      <td style={td}>{c.credential_number ?? '—'}</td>
                      <td style={td}>{c.issuing_agency ?? '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {fmtDate(c.expiration_date)}
                        {c.expiration_date && c.expiration_date < today && <span className="tag type-sale" style={{ marginLeft: 4 }}>past</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(c.submitted_at)}</td>
                      <td style={td}><span className={`tag ${statusTag(c.status)}`}>{c.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
