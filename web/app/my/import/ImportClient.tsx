'use client';

// "Build My Market with Gnome" — the seller-facing review flow over the
// market-import extraction endpoint. Upload up to 4 photos/screenshots and/or
// paste listing text → market-import reads it (nothing is written) → the seller
// reviews the candidates here → create_import_drafts turns the approved ones
// into normal listing_drafts → the drafts section below publishes/discards/edits
// through the EXISTING draft RPCs.
//
// Two hard rules carried from the extraction contract:
//   * source images are NEVER uploaded to storage — they are read as base64 in
//     memory and sent straight to the function (an extraction source and a
//     listing photo are different concepts);
//   * every sentence and derivation comes from lib/importReview (byte-identical
//     twin in expo) — this file renders pixels, never meanings of its own.
import { useRef, useState } from 'react';
import { CATEGORIES } from '../../../lib/categories';
import { LISTING_TYPE_ACTION_LABEL, listingPath, TYPE_LABEL } from '../../../lib/format';
import { mapServerError, type ServerError } from '../../../lib/gnome';
import {
  allowanceSummary,
  categoryLabel,
  COMPLIANCE_NOTE,
  conflictHeadline,
  conflictsFor,
  createButtonLabel,
  duplicateLabel,
  fieldIssues,
  importLimitCopy,
  priceLabel,
  resultHeadline,
  selectedCount,
  toCreatePayload,
  type ImportAllowance,
  type ImportCandidate,
  type ImportConflict,
  type ReviewCandidate,
  type TaxonomySuggestion,
} from '../../../lib/importReview';
import { supabaseBrowser } from '../../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../../components/auth';
import { ServerErrorNotice } from '../../components/ScreeningNotice';

const MAX_SOURCES = 4;

// The unit vocabulary create_import_drafts accepts (0115 allowed_units) — a
// select keeps a hand edit from tripping BAD_UNIT server-side.
const UNITS = [
  'lb', 'oz', 'each', 'bunch', 'dozen', 'half-dozen', 'jar', 'basket', 'pint', 'quart',
  'bag', 'loaf', 'head', 'ear', 'peck', 'half-peck', 'bushel', 'half-bushel', 'flat', 'stem',
] as const;

const IMPORT_TYPES = ['sale', 'free', 'trade', 'wanted'] as const;

interface SourceImage { file: File; preview: string }

/** The market-import 200 body (contract in supabase/functions/market-import). */
interface Extraction {
  source_type: string;
  seller_context: string;
  multi_product: boolean;
  candidates: ImportCandidate[];
  missing_information: string[];
  conflicts: ImportConflict[];
  overall_confidence: string;
  recommended_next_action: string;
}

/** The create_import_drafts return shape (0115). */
interface CreateResult {
  drafts_created: number;
  drafts_already_existed: number;
  draft_ids: string[];
  duplicates: { candidate_index: number; product_name: string; existing_listing_id: string }[];
  allowance: ImportAllowance;
}

interface ImportDraft {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  listing_type: string;
  price_cents: number | null;
  unit: string | null;
  quantity: string | null;
  status: 'pending' | 'published' | 'discarded';
  published_listing_id: string | null;
  import_candidate_index: number | null;
}

// Downscale to ≤1600px JPEG in memory. Larger than the sell flow's 1280 because
// screenshots carry text that has to stay legible to the model; still far under
// the function's 8MB base64 cap. The bytes go straight into the request body —
// NEVER into a storage bucket.
async function toBase64Jpeg(file: File, maxDim = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

// Best-effort analytics straight into public.events (the expo logEvent pattern —
// these names are shared with the app, so no web_ prefix). Never throws into UI.
function logImportEvent(
  eventType: string,
  userId: string | null | undefined,
  metadata?: Record<string, unknown>,
) {
  try {
    void supabaseBrowser()
      .from('events')
      .insert({ event_type: eventType, user_id: userId ?? null, metadata: metadata ?? {} })
      .then(() => {}, () => {});
  } catch { /* analytics is best-effort */ }
}

/** "$12" / "12" / "$12.50" → integer cents, or null when it doesn't parse. */
function parseDollars(v: string): number | null {
  if (!/\d/.test(v)) return null;
  const n = Number(v.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDollarInput(cents: number | null): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

/** The candidate's current value for a conflicted field (for highlighting a pick). */
function conflictFieldValue(c: ImportCandidate, field: string): string | number | null {
  if (field === 'price') return c.price_cents;
  if (field === 'unit') return c.unit;
  if (field === 'quantity') return c.quantity;
  if (field === 'availability') return c.availability;
  if (field === 'pickup') return c.pickup;
  return null;
}

export default function ImportClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;
  const fileRef = useRef<HTMLInputElement>(null);

  // --- input phase ---
  const [sources, setSources] = useState<SourceImage[]>([]);
  const [pasted, setPasted] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- review phase ---
  const [requestId, setRequestId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  // Server-resolved suggestions, immutable per candidate: the picker's options
  // stay complete even after "Let me pick later" empties the live selection.
  const [suggestions, setSuggestions] = useState<TaxonomySuggestion[][]>([]);
  const [list, setList] = useState<ReviewCandidate[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  // Dollar text the seller is mid-typing, per candidate; cents live on the candidate.
  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({});
  const [creating, setCreating] = useState(false);
  const [refused, setRefused] = useState<ServerError | null>(null);

  // --- result + drafts phase ---
  const [result, setResult] = useState<CreateResult | null>(null);
  const [dismissedDups, setDismissedDups] = useState<number[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState<ImportDraft[] | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<ServerError | null>(null);
  const [draftEdit, setDraftEdit] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState({
    title: '', price: '', unit: '', description: '', category: 'produce',
  });

  function addFiles(fl: FileList | null) {
    if (!fl) return;
    const next = [...sources];
    for (const file of Array.from(fl)) {
      if (next.length >= MAX_SOURCES) break;
      if (!file.type.startsWith('image/')) continue;
      next.push({ file, preview: URL.createObjectURL(file) });
    }
    setSources(next);
  }

  function cancelInputs() {
    setSources([]);
    setPasted('');
    setError(null);
  }

  async function analyze() {
    if (analyzing || (sources.length === 0 && !pasted.trim())) return;
    setAnalyzing(true);
    setError(null);
    logImportEvent('import_extraction_started', uid, {
      images: sources.length, has_text: pasted.trim().length > 0,
    });
    try {
      // Read the sources as base64 in memory — no storage upload, ever.
      const images: { image_base64: string; media_type: string }[] = [];
      for (const s of sources) {
        images.push({ image_base64: await toBase64Jpeg(s.file), media_type: 'image/jpeg' });
      }
      const body: Record<string, unknown> = {};
      if (images.length) body.images = images;
      if (pasted.trim()) body.text = pasted.trim();

      const { data, error: fnErr } = await supabaseBrowser().functions.invoke('market-import', { body });
      if (fnErr) {
        const resp = (await (fnErr as { context?: Response }).context?.json?.().catch(() => null)) as
          { error?: string; message?: string } | null;
        const code = resp?.error;
        logImportEvent('import_extraction_failed', uid, { reason: code ?? 'NETWORK' });
        if (code === 'DAILY_LIMIT') setError(importLimitCopy(resp?.message));
        else if (resp?.message) setError(resp.message);
        else setError('Couldn’t reach Gnome — check your connection and try again.');
        return;
      }
      const ext = data?.extraction as Extraction | undefined;
      const reqId = data?.request_id as string | undefined;
      const sugg = (data?.taxonomy_suggestions ?? []) as TaxonomySuggestion[][];
      if (!ext || !reqId || !Array.isArray(ext.candidates) || ext.candidates.length === 0) {
        logImportEvent('import_extraction_failed', uid, { reason: 'EMPTY_RESULT' });
        setError('Gnome couldn’t find any products in that — try a clearer photo, or paste the text.');
        return;
      }
      setRequestId(reqId);
      setExtraction(ext);
      setSuggestions(sugg);
      // Everything defaults to selected; taxonomy_suggestions[i] belongs to candidates[i].
      setList(ext.candidates.map((c, i) => ({ candidate: c, selected: true, taxonomy: sugg[i] ?? [] })));
      setPriceDrafts({});
      setEditIdx(null);
      logImportEvent('import_extraction_succeeded', uid, {
        source_type: ext.source_type,
        multi_product: ext.multi_product,
        candidates: ext.candidates.length,
      });
    } catch {
      logImportEvent('import_extraction_failed', uid, { reason: 'NETWORK' });
      setError('Couldn’t reach Gnome — check your connection and try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  // --- review helpers -------------------------------------------------------

  function patchCandidate(i: number, patch: Partial<ImportCandidate>) {
    setList((l) => l.map((rc, j) => (j === i ? { ...rc, candidate: { ...rc.candidate, ...patch } } : rc)));
  }

  function setSelected(i: number, selected: boolean) {
    setList((l) => l.map((rc, j) => (j === i ? { ...rc, selected } : rc)));
  }

  function setAllSelected(selected: boolean) {
    setList((l) => l.map((rc) => ({ ...rc, selected })));
  }

  // Category: options come from THIS candidate's server-resolved suggestions
  // only — the client never fabricates taxonomy ids. Choosing a suggestion also
  // pins category_terms to [its name] so the server re-maps to that exact node;
  // "Let me pick later" clears both so nothing steers the mapping.
  function pickCategory(i: number, value: string) {
    const opts = suggestions[i] ?? [];
    if (value === 'later') {
      setList((l) => l.map((rc, j) => (j === i
        ? { ...rc, taxonomy: [], candidate: { ...rc.candidate, category_terms: [] } }
        : rc)));
      return;
    }
    const s = opts.find((o) => o.id === value);
    if (!s) return;
    setList((l) => l.map((rc, j) => (j === i
      ? {
          ...rc,
          taxonomy: [s, ...opts.filter((o) => o.id !== s.id)],
          candidate: { ...rc.candidate, category_terms: [s.name] },
        }
      : rc)));
  }

  function onPriceInput(i: number, raw: string) {
    const v = raw.replace(/[^0-9.]/g, '');
    setPriceDrafts((p) => ({ ...p, [i]: v }));
    patchCandidate(i, { price_cents: v.trim() === '' ? null : parseDollars(v) });
  }

  // A tap on one of the conflicting readings writes that value onto the edited
  // candidate. Until the seller picks, the field stays missing — never preselected.
  function chooseConflictValue(i: number, k: ImportConflict, v: string) {
    if (k.field === 'price') {
      const cents = parseDollars(v);
      setPriceDrafts((p) => ({ ...p, [i]: centsToDollarInput(cents) }));
      patchCandidate(i, { price_cents: cents });
    } else if (k.field === 'unit') patchCandidate(i, { unit: v });
    else if (k.field === 'quantity') patchCandidate(i, { quantity: v });
    else if (k.field === 'availability') patchCandidate(i, { availability: v });
    else if (k.field === 'pickup') patchCandidate(i, { pickup: v });
  }

  async function createDrafts() {
    if (!requestId || creating) return;
    const payload = toCreatePayload(list);
    if (payload.length === 0) return;
    setCreating(true);
    setRefused(null);
    try {
      const { data, error: rpcErr } = await supabaseBrowser().rpc('create_import_drafts', {
        p_import_id: requestId,
        p_candidates: payload,
      });
      if (rpcErr) {
        const raw = rpcErr.message ?? '';
        if (raw.includes('NO_MARKET')) {
          setRefused({
            code: 'UNKNOWN', title: 'No Market yet',
            message: 'Post one listing first to open your Market, then import the rest.',
          });
        } else if (raw.includes('IMPORT_DRAFTS_LIMIT')) {
          setRefused({
            code: 'UNKNOWN', title: 'Draft pile is full',
            message: 'You have a lot of pending imported drafts — publish or discard some first.',
          });
        } else {
          setRefused(mapServerError(rpcErr, 'Creating drafts failed — nothing was saved. Try again.'));
        }
        return;
      }
      // Only a parsed response counts as success.
      const res = data as CreateResult | null;
      if (!res || typeof res.drafts_created !== 'number') {
        setRefused(mapServerError(null, 'Creating drafts failed — nothing was saved. Try again.'));
        return;
      }
      setResult(res);
    } finally {
      setCreating(false);
    }
  }

  // --- drafts section (existing RPCs; RLS-scoped reads) ---------------------

  async function loadDrafts() {
    if (!requestId) return;
    const { data } = await supabaseBrowser()
      .from('listing_drafts')
      .select('id,title,description,category,listing_type,price_cents,unit,quantity,status,published_listing_id,import_candidate_index')
      .eq('import_request_id', requestId)
      .order('import_candidate_index', { ascending: true });
    setDrafts((data as ImportDraft[]) ?? []);
  }

  async function publishDraft(d: ImportDraft) {
    setDraftBusy(d.id);
    setDraftError(null);
    const { error: rpcErr } = await supabaseBrowser().rpc('publish_listing_draft', { p_draft: d.id });
    setDraftBusy(null);
    // PUBLISH_ALLOWANCE_EXHAUSTED arrives here and mapServerError renders the
    // honest copy: included publishes are used; later or $0.99 via the existing
    // flows. No checkout lives on this page.
    if (rpcErr) setDraftError(mapServerError(rpcErr, 'Publishing failed — the draft is still saved.'));
    else await loadDrafts();
  }

  async function discardDraft(d: ImportDraft) {
    setDraftBusy(d.id);
    setDraftError(null);
    const { error: rpcErr } = await supabaseBrowser().rpc('discard_listing_draft', { p_draft: d.id });
    setDraftBusy(null);
    if (rpcErr) setDraftError(mapServerError(rpcErr));
    else await loadDrafts();
  }

  function openDraftEdit(d: ImportDraft) {
    setDraftEdit(d.id);
    setDraftForm({
      title: d.title ?? '',
      price: centsToDollarInput(d.price_cents),
      unit: d.unit ?? '',
      description: d.description ?? '',
      category: d.category ?? 'produce',
    });
  }

  async function saveDraftEdit(d: ImportDraft) {
    setDraftBusy(d.id);
    setDraftError(null);
    // Plain owner UPDATE under listing_drafts RLS — same edit the app offers.
    const { error: upErr } = await supabaseBrowser()
      .from('listing_drafts')
      .update({
        title: draftForm.title.trim() || null,
        price_cents: draftForm.price.trim() === '' ? null : parseDollars(draftForm.price),
        unit: draftForm.unit || null,
        description: draftForm.description.trim() || null,
        category: draftForm.category,
        updated_at: new Date().toISOString(),
      })
      .eq('id', d.id);
    setDraftBusy(null);
    if (upErr) setDraftError(mapServerError(upErr));
    else {
      setDraftEdit(null);
      await loadDrafts();
    }
  }

  // priceLabel is the canonical "$4 / lb" wording; it only reads price_cents+unit.
  const draftPrice = (d: ImportDraft) =>
    priceLabel({ price_cents: d.price_cents, unit: d.unit ?? '' } as ImportCandidate);

  // --- render ---------------------------------------------------------------

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) {
    return (
      <SignInCard
        title="Sign in to build your Market"
        blurb="Upload a screenshot or photo of what you already sell and Gnome turns it into draft listings."
      />
    );
  }

  const multi = extraction?.multi_product === true;
  const nSelected = selectedCount(list);

  const head = (
    <div className="mm-head" style={{ marginBottom: 12 }}>
      <div>
        <h1>Build My Market with Gnome</h1>
        <p className="mm-stats">
          Already selling on Facebook, at a farm stand, or somewhere else? Upload a
          screenshot or photo and Gnome can turn what you sell into draft listings.
        </p>
      </div>
    </div>
  );

  // ---------- result + drafts ----------
  if (result) {
    const allow = allowanceSummary(result.allowance);
    const totalForThisImport = result.drafts_created + result.drafts_already_existed;
    const dups = result.duplicates.filter((d) => !dismissedDups.includes(d.candidate_index));
    return (
      <div>
        {head}
        <div className="authcard" style={{ maxWidth: 640 }}>
          <h2>{resultHeadline(totalForThisImport)}</h2>
          {result.drafts_already_existed > 0 && (
            <p className="sub">
              {result.drafts_already_existed} of them already existed from an earlier
              try — nothing was duplicated.
            </p>
          )}
          <p className="sub">
            {allow.text}
            {allow.suggestUpgrade && <> <a href="/pricing">View Plans</a></>}
          </p>
          {dups.map((d) => (
            <div key={d.candidate_index} className="preview-note">
              <strong>{duplicateLabel(d.product_name)}</strong>
              <p className="imp-note">
                The new draft is already saved — both are kept either way, and
                nothing was overwritten.
              </p>
              <div className="imp-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setDismissedDups((p) => [...p, d.candidate_index])}
                >
                  Create New Draft
                </button>
                <a
                  className="btn btn-secondary btn-sm"
                  href={listingPath(d.existing_listing_id, d.product_name)}
                >
                  Use Existing
                </a>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setShowDrafts(true); void loadDrafts(); }}
            >
              Review Drafts
            </button>
            <a className="btn btn-secondary btn-sm" href="/my">My Market</a>
          </div>
        </div>

        {showDrafts && (
          <section className="section">
            <div className="section-head"><h2>Your imported drafts</h2></div>
            {draftError && <ServerErrorNotice error={draftError} />}
            {drafts === null && <p className="authhint">Loading drafts…</p>}
            {drafts?.length === 0 && <p className="authhint">No drafts found for this import.</p>}
            <div className="mm-list">
              {(drafts ?? []).map((d) => (
                <div key={d.id}>
                  <div className="mm-row">
                    <div className="mm-info">
                      <span className="mm-title">{d.title ?? 'Untitled draft'}</span>
                      <div className="mm-meta">
                        {draftPrice(d) && <span className="tag type-sale">{draftPrice(d)}</span>}
                        {d.listing_type !== 'sale' && (
                          <span className={`tag type-${d.listing_type}`}>
                            {TYPE_LABEL[d.listing_type as keyof typeof TYPE_LABEL] ?? d.listing_type}
                          </span>
                        )}
                        {d.status === 'pending' && <span className="tag">Draft</span>}
                        {d.status === 'published' && <span className="tag type-free">Published</span>}
                        {d.status === 'discarded' && <span className="tag">Discarded</span>}
                      </div>
                    </div>
                    <div className="mm-btns">
                      {d.status === 'pending' && (
                        <>
                          <button
                            className="mm-btn"
                            disabled={draftBusy === d.id}
                            onClick={() => (draftEdit === d.id ? setDraftEdit(null) : openDraftEdit(d))}
                          >
                            {draftEdit === d.id ? 'Close' : 'Edit'}
                          </button>
                          <button
                            className="mm-btn"
                            disabled={draftBusy === d.id}
                            onClick={() => void publishDraft(d)}
                          >
                            Publish
                          </button>
                          <button
                            className="mm-btn danger"
                            disabled={draftBusy === d.id}
                            onClick={() => void discardDraft(d)}
                          >
                            Discard
                          </button>
                        </>
                      )}
                      {d.status === 'published' && d.published_listing_id && (
                        <a className="mm-btn" href={listingPath(d.published_listing_id, d.title ?? '')}>
                          View
                        </a>
                      )}
                    </div>
                  </div>
                  {draftEdit === d.id && d.status === 'pending' && (
                    <div className="preview-note" style={{ marginTop: 8 }}>
                      <div className="field-row">
                        <div className="field"><label>Title</label>
                          <input maxLength={80} value={draftForm.title}
                            onChange={(e) => setDraftForm({ ...draftForm, title: e.target.value })} /></div>
                        <div className="field" style={{ maxWidth: 120 }}><label>Price $</label>
                          <input inputMode="decimal" value={draftForm.price}
                            onChange={(e) => setDraftForm({ ...draftForm, price: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
                        <div className="field" style={{ maxWidth: 140 }}><label>Per</label>
                          <select value={draftForm.unit}
                            onChange={(e) => setDraftForm({ ...draftForm, unit: e.target.value })}>
                            <option value="">—</option>
                            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select></div>
                      </div>
                      <div className="field" style={{ marginTop: 8 }}><label>Category</label>
                        <select value={draftForm.category}
                          onChange={(e) => setDraftForm({ ...draftForm, category: e.target.value })}>
                          {CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                          ))}
                        </select></div>
                      <div className="field" style={{ marginTop: 8 }}><label>Description</label>
                        <textarea rows={3} value={draftForm.description}
                          onChange={(e) => setDraftForm({ ...draftForm, description: e.target.value })} /></div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                        <button className="btn btn-primary btn-sm" disabled={draftBusy === d.id}
                          onClick={() => void saveDraftEdit(d)}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setDraftEdit(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="authhint">
              A published listing can still be held for review — its live status
              shows in <a href="/my">My Market</a>.
            </p>
          </section>
        )}
      </div>
    );
  }

  // ---------- review ----------
  if (extraction && list.length > 0) {
    return (
      <div>
        {head}
        {multi && (
          <>
            <div className="section-head" style={{ marginBottom: 8 }}>
              <h2>Gnome found {list.length} things you may be selling.</h2>
            </div>
            <div className="imp-actions" style={{ marginBottom: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setAllSelected(true)}>Select All</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setAllSelected(false)}>Deselect All</button>
            </div>
          </>
        )}
        <div className="imp-cards">
          {list.map((rc, i) => {
            const c = rc.candidate;
            const issues = fieldIssues(rc);
            const conflicts = conflictsFor(c, extraction.conflicts);
            const price = priceLabel(c);
            const catValue = rc.taxonomy[0]?.id ?? 'later';
            return (
              <div key={i} className={`imp-card${multi && !rc.selected ? ' off' : ''}`}>
                <div className="imp-card-head">
                  {multi && (
                    <input
                      type="checkbox"
                      checked={rc.selected}
                      aria-label={`Include ${c.product_name}`}
                      onChange={(e) => setSelected(i, e.target.checked)}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="imp-name">
                      {c.product_name}{c.variety ? ` · ${c.variety}` : ''}
                    </div>
                    <div className="imp-sub">
                      {categoryLabel(rc)}
                      {price && <> · <strong>{price}</strong></>}
                      {c.availability && <> · {c.availability}</>}
                    </div>
                    {issues.length > 0 && (
                      <div className="imp-chips">
                        {issues.map((t) => <span key={t} className="imp-chip">{t}</span>)}
                      </div>
                    )}
                    {conflicts.map((k) => (
                      <div key={`${k.field}-${k.values.join('|')}`} className="imp-conflict">
                        <strong>{conflictHeadline(k)}</strong>
                        {k.note && <p className="imp-note" style={{ marginTop: 4 }}>{k.note}</p>}
                        <div className="imp-conflict-values">
                          {k.values.map((v) => {
                            const active = k.field === 'price'
                              ? parseDollars(v) != null && c.price_cents === parseDollars(v)
                              : conflictFieldValue(c, k.field) === v;
                            return (
                              <button
                                key={v}
                                type="button"
                                className={`chip${active ? ' active' : ''}`}
                                onClick={() => chooseConflictValue(i, k, v)}
                              >
                                {v}
                              </button>
                            );
                          })}
                          {k.field === 'price' && (
                            <input
                              inputMode="decimal"
                              placeholder="Enter another price"
                              style={{ maxWidth: 170 }}
                              value={priceDrafts[i] ?? centsToDollarInput(c.price_cents)}
                              onChange={(e) => onPriceInput(i, e.target.value)}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                    {c.compliance_attention_required && (
                      <p className="imp-note">🔎 {COMPLIANCE_NOTE}</p>
                    )}
                  </div>
                  <div className="mm-btns">
                    <button className="mm-btn" onClick={() => setEditIdx(editIdx === i ? null : i)}>
                      {editIdx === i ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {editIdx === i && (
                  <div className="imp-edit">
                    <div className="field-row">
                      <div className="field"><label>Product name</label>
                        <input maxLength={80} value={c.product_name}
                          onChange={(e) => patchCandidate(i, { product_name: e.target.value })} /></div>
                      <div className="field"><label>Variety</label>
                        <input maxLength={80} value={c.variety}
                          onChange={(e) => patchCandidate(i, { variety: e.target.value })} /></div>
                    </div>
                    <div className="field-row" style={{ marginTop: 8 }}>
                      <div className="field"><label>Listing type</label>
                        <select value={c.proposed_listing_type}
                          onChange={(e) => patchCandidate(i, {
                            proposed_listing_type: e.target.value as ImportCandidate['proposed_listing_type'],
                          })}>
                          {IMPORT_TYPES.map((t) => (
                            <option key={t} value={t}>{LISTING_TYPE_ACTION_LABEL[t]}</option>
                          ))}
                        </select></div>
                      <div className="field"><label>Category</label>
                        <select value={catValue} onChange={(e) => pickCategory(i, e.target.value)}>
                          {(suggestions[i] ?? []).map((s) => (
                            <option key={s.id} value={s.id}>{s.path.split('/').join(' › ')}</option>
                          ))}
                          <option value="later">Let me pick later</option>
                        </select></div>
                    </div>
                    <div className="field-row" style={{ marginTop: 8 }}>
                      <div className="field" style={{ maxWidth: 130 }}><label>Price $</label>
                        <input inputMode="decimal"
                          value={priceDrafts[i] ?? centsToDollarInput(c.price_cents)}
                          onChange={(e) => onPriceInput(i, e.target.value)} /></div>
                      <div className="field" style={{ maxWidth: 150 }}><label>Per</label>
                        <select value={c.unit} onChange={(e) => patchCandidate(i, { unit: e.target.value })}>
                          <option value="">—</option>
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select></div>
                      <div className="field"><label>Quantity</label>
                        <input maxLength={160} value={c.quantity} placeholder="About 2 lbs"
                          onChange={(e) => patchCandidate(i, { quantity: e.target.value })} /></div>
                    </div>
                    <div className="field" style={{ marginTop: 8 }}><label>Description</label>
                      <textarea rows={3} maxLength={600} value={c.description}
                        onChange={(e) => patchCandidate(i, { description: e.target.value })} /></div>
                    <div className="field" style={{ marginTop: 8 }}><label>Availability</label>
                      <input maxLength={160} value={c.availability} placeholder="Saturdays at the stand"
                        onChange={(e) => patchCandidate(i, { availability: e.target.value })} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {refused && <ServerErrorNotice error={refused} />}
        <div className="imp-actions" style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary"
            disabled={creating || nSelected === 0}
            onClick={() => void createDrafts()}
          >
            {creating ? 'Creating…' : createButtonLabel(nSelected)}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setExtraction(null); setList([]); setRequestId(null); setRefused(null);
            }}
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  // ---------- input ----------
  const hasAnything = sources.length > 0 || pasted.trim().length > 0;
  return (
    <div>
      {head}
      <div className="sellform" style={{ maxWidth: 640 }}>
        <div className="field">
          <label>Photos or screenshots (up to {MAX_SOURCES})</label>
          {sources.length > 0 && (
            <div className="photorow">
              {sources.map((s, i) => (
                <div key={s.preview} className="photocell">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.preview} alt={`Source ${i + 1}`} />
                  <button type="button" aria-label="Remove image" onClick={() =>
                    setSources(sources.filter((_, j) => j !== i))
                  }>×</button>
                </div>
              ))}
              {sources.length < MAX_SOURCES && (
                <button type="button" className="photoadd" onClick={() => fileRef.current?.click()}>
                  + Add
                </button>
              )}
            </div>
          )}
          {sources.length === 0 && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => fileRef.current?.click()}
            >
              Upload photos or screenshots
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        <div className="field">
          <label>Or paste your listing text</label>
          <textarea
            rows={5}
            value={pasted}
            placeholder="Roma tomatoes $4/lb, fresh eggs $5/dozen, zucchini 3 for $2…"
            onChange={(e) => setPasted(e.target.value)}
          />
        </div>

        {error && <p className="autherror">{error}</p>}

        {hasAnything && (
          <div className="imp-actions">
            <button className="btn btn-primary" disabled={analyzing} onClick={() => void analyze()}>
              {analyzing ? 'Gnome is looking through what you sell…' : 'See what Gnome finds'}
            </button>
            {!analyzing && (
              <button className="btn btn-secondary" onClick={cancelInputs}>Cancel</button>
            )}
          </div>
        )}
        <p className="authhint" style={{ margin: 0 }}>
          Your uploads are only read to build the drafts — they’re never stored,
          and they don’t become listing photos.
        </p>
      </div>
    </div>
  );
}
