'use client';

// Web sell flow: sign in → photos → (optional ✨ AI draft) → post. Mirrors the
// app's post flow (expo/app/(tabs)/post.tsx + lib/db.ts useCreateListing): same
// tables, same RLS, same draft-listing function, same market attachment — a
// listing posted here is indistinguishable from one posted in the app.
import { useEffect, useRef, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { CATEGORIES } from '../../lib/categories';
import {
  DEFAULT_LISTING_TYPE,
  listingPath,
  LISTING_TYPE_ACTION_LABEL,
  LISTING_TYPE_BLURB,
  LISTING_TYPE_HINT,
  LISTING_TYPES,
  type ListingType,
} from '../../lib/format';
import {
  isUnderReview,
  mapServerError,
  reviewReason,
  SCREENING_COLS,
  type ServerError,
  type ScreenedListing,
} from '../../lib/gnome';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';
import { HeldForReview, ServerErrorNotice } from '../components/ScreeningNotice';

// Order, labels and hints all come from the canonical config in lib/format —
// this file must never carry its own list or its own idea of the default.
const TYPES: { id: ListingType; label: string; hint: string }[] = LISTING_TYPES.map((id) => ({
  id,
  label: LISTING_TYPE_ACTION_LABEL[id],
  hint: LISTING_TYPE_HINT[id],
}));

const MAX_PHOTOS = 5;

interface Photo { file: File; preview: string }

// Downscale to ≤1280px JPEG so uploads are quick and the AI draft call stays
// under the function's 8MB base64 cap regardless of the original photo size.
async function toJpeg(file: File, maxDim = 1280): Promise<{ blob: Blob; base64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: 'image/jpeg' }), base64 };
}

export default function SellClient({ initialType }: { initialType?: ListingType }) {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  // First paint is already the right type: an explicit ?type= deep link wins,
  // otherwise the canonical default (Sell). Deriving it here — not correcting it
  // in an effect — is what keeps Share Free from flashing before Sell.
  const [listingType, setListingType] = useState<ListingType>(
    initialType ?? DEFAULT_LISTING_TYPE,
  );
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('vegetables');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');       // dollars, string
  const [plotCount, setPlotCount] = useState('1'); // identical plots to post (plot type only)
  const [unit, setUnit] = useState('');
  const [tradeFor, setTradeFor] = useState('');
  const [reqOptions, setReqOptions] = useState<{ label: string }[]>([]);
  const [optionDraft, setOptionDraft] = useState('');
  const [allowCustomRequest, setAllowCustomRequest] = useState(true);
  const [city, setCity] = useState('');
  const [state, setState] = useState('OH');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A refusal from the server (blocked content, rate limit, plan, compliance),
  // already translated out of Postgres. The form stays on screen underneath it
  // so the seller can edit the wording and try again.
  const [refused, setRefused] = useState<ServerError | null>(null);
  const [done, setDone] = useState<
    { id: string; title: string; count: number; review: boolean; reason: string } | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill town from the profile (set by the app or a previous web post).
  useEffect(() => {
    if (!uid) return;
    supabaseBrowser()
      .from('profiles')
      .select('city,state')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.city) setCity((c) => c || data.city);
        if (data?.state) setState((s) => (s === 'OH' ? data.state : s));
      });
  }, [uid]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...photos];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_PHOTOS) break;
      if (!file.type.startsWith('image/')) continue;
      next.push({ file, preview: URL.createObjectURL(file) });
    }
    setPhotos(next);
  }

  async function aiDraft() {
    if (photos.length === 0 || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const { base64 } = await toJpeg(photos[0].file);
      const { data, error } = await supabaseBrowser().functions.invoke('draft-listing', {
        body: { imageBase64: base64, mediaType: 'image/jpeg', listingType },
      });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? 'AI drafting isn’t available right now.');
      }
      const draft = data?.draft;
      if (!draft) throw new Error(data?.error ?? 'No draft came back — try again.');
      // Fill only empty fields — never clobber what the seller already typed.
      if (!title.trim() && draft.title) setTitle(draft.title);
      if (draft.category) setCategory(draft.category);
      if (!description.trim() && draft.description) setDescription(draft.description);
      if (listingType === 'sale' && !price && draft.suggested_price_cents) {
        setPrice((draft.suggested_price_cents / 100).toFixed(2));
      }
      if (listingType === 'sale' && !unit && draft.suggested_unit) setUnit(draft.suggested_unit);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI drafting failed — fill the form by hand.');
    } finally {
      setDrafting(false);
    }
  }

  async function post() {
    if (!uid || posting) return;
    setError(null);
    setRefused(null);
    if (!title.trim()) return setError('Give your listing a title.');
    if (listingType === 'sale' && (!price || Number(price) <= 0)) {
      return setError('Set a price for a sale listing.');
    }
    if (listingType === 'plot' && (!price || Number(price) <= 0)) {
      return setError('Set a reservation price for your plot.');
    }
    if (listingType === 'trade' && !tradeFor.trim()) {
      return setError('Say what you’d like to trade for.');
    }
    if (!city.trim()) return setError('Add your city so neighbors can find you.');

    setPosting(true);
    try {
      const supabase = supabaseBrowser();

      // 1) Photos → storage (owner-namespaced paths line up with storage RLS).
      const urls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const { blob } = await toJpeg(photos[i].file);
        const path = `${uid}/${Date.now()}-${i}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('listing-images')
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
        urls.push(supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl);
      }

      // 2) Attach to the seller's Market (auto-created at signup) — the public
      // site only shows listings that belong to an active market.
      const { data: market } = await supabase
        .from('markets')
        .select('id')
        .eq('owner_id', uid)
        .limit(1)
        .maybeSingle();

      // 3) Remember the town on the profile for next time.
      void supabase
        .from('profiles')
        .update({ city: city.trim(), state: state.trim().toUpperCase() })
        .eq('id', uid)
        .then(() => {});

      // 4) The listing itself. kind mirror + type-specific fields match the app.
      // A plot listing carries its size (quantity text) and how many identical
      // plots are available (inventory_count) — approvals decrement it and the
      // listing stays live until the last plot is reserved (0072).
      const plotsAvailable =
        listingType === 'plot' ? Math.min(50, Math.max(1, Number(plotCount) || 1)) : null;
      const row = {
        owner_id: uid,
        market_id: market?.id ?? null,
        listing_type: listingType,
        kind: listingType === 'wanted' ? ('wanted' as const) : ('offer' as const),
        title: title.trim(),
        description: description.trim() || null,
        category,
        quantity: quantity.trim() || null,
        photos: urls,
        price_cents:
          listingType === 'sale' || listingType === 'plot'
            ? Math.round(Number(price) * 100)
            : null,
        unit: listingType === 'sale' ? unit.trim() || null : null,
        trade_for: listingType === 'trade' ? tradeFor.trim() : null,
        city: city.trim(),
        state: state.trim().toUpperCase(),
        inventory_count: plotsAvailable,
        ...((listingType === 'wanted' || listingType === 'plot') && reqOptions.length
          ? { request_options: reqOptions } : {}),
        ...(listingType === 'wanted' || listingType === 'plot'
          ? { allow_custom_request: allowCustomRequest } : {}),
      };
      // Ask back only for columns a seller is granted SELECT on: PostgREST runs
      // the returning clause inside the INSERT, so a column the role can't read
      // fails the whole statement and the listing is never saved. (`slug` is
      // revoked on the base table — listingPath() rebuilds the same URL from the
      // title, exactly as My Market does.)
      const { data: rows, error } = await supabase
        .from('listings')
        .insert([row])
        .select('id,status');
      if (error) {
        // Blocked content / rate limit / plan gates all arrive here as a thrown
        // Postgres message. Translate, never echo.
        setRefused(mapServerError(error, 'Posting failed — try again.'));
        return;
      }
      const data = rows?.[0] as { id: string; status: string } | undefined;
      if (!data) throw new Error('Posting failed — try again.');

      // The row saved — but "saved" is not "public". Screening may have held it
      // and quietly downgraded it to 'paused'. Read the screening columns in a
      // SEPARATE statement so that a missing grant on them can never roll back a
      // post that already succeeded; the status we just read back is the
      // fallback signal when they can't be read at all.
      let screened: ScreenedListing = { status: data.status };
      const { data: srow } = await supabase
        .from('listings')
        .select(SCREENING_COLS)
        .eq('id', data.id)
        .maybeSingle();
      if (srow) screened = srow as ScreenedListing;

      const review = isUnderReview(screened);
      logWeb(review ? 'listing_held_for_review' : 'listing_published', {
        type: listingType,
        count: plotsAvailable ?? 1,
      });
      setDone({
        id: data.id,
        title: title.trim(),
        count: 1,
        review,
        reason: reviewReason(screened),
      });
    } catch (e) {
      setRefused(mapServerError(e, 'Posting failed — try again.'));
    } finally {
      setPosting(false);
    }
  }

  if (!ready) return <div className="empty"><p>Loading…</p></div>;

  if (!session) {
    return (
      <SignInCard
        title="Sign in to sell on Gnome"
        blurb="One code by email and your Market is open. Your listing shows here and in the Gnome app."
      />
    );
  }

  if (done) {
    const href = listingPath(done.id, done.title);
    const reset = () => {
      setDone(null); setTitle(''); setDescription(''); setQuantity('');
      setPrice(''); setUnit(''); setTradeFor(''); setPhotos([]); setPlotCount('1');
      setReqOptions([]); setOptionDraft(''); setAllowCustomRequest(true);
    };

    // Saved, but held. Never the live message — the listing is not public, and
    // there is nothing at its public URL to link to yet.
    if (done.review) {
      return (
        <div className="authcard" style={{ maxWidth: 560 }}>
          <HeldForReview reason={done.reason} />
          <div className="row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            <a className="btn btn-primary btn-sm" href="/my">See it in My Market</a>
            <button className="btn btn-secondary btn-sm" onClick={reset}>Post another</button>
          </div>
        </div>
      );
    }

    return (
      <div className="authcard">
        <h2>🎉 Your listing is live</h2>
        <p className="sub">Neighbors browsing the web and the Gnome app can see it right now.</p>
        <div className="row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a className="btn btn-primary btn-sm" href={href}>View your listing</a>
          <a className="btn btn-secondary btn-sm" href="/my">My Market</a>
          <button className="btn btn-secondary btn-sm" onClick={reset}>
            Post another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sellform">
      <div className="seg">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`seg-btn${listingType === t.id ? ' active' : ''}`}
            title={t.hint}
            onClick={() => setListingType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lead copy follows the selected type, so Sell opens with selling
          language and Share Free keeps its own wording when it is picked. */}
      <p className="authhint" style={{ margin: 0 }}>{LISTING_TYPE_BLURB[listingType]}</p>

      <div className="field">
        <label>Photos {listingType === 'wanted' ? '(optional)' : ''}</label>
        <div className="photorow">
          {photos.map((p, i) => (
            <div key={p.preview} className="photocell">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt={`Photo ${i + 1}`} />
              <button type="button" aria-label="Remove photo" onClick={() =>
                setPhotos(photos.filter((_, j) => j !== i))
              }>×</button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button type="button" className="photoadd" onClick={() => fileRef.current?.click()}>
              + Add
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        {photos.length > 0 && listingType !== 'wanted' && listingType !== 'plot' && (
          <button type="button" className="btn btn-secondary btn-sm aidraft" disabled={drafting} onClick={() => void aiDraft()}>
            {drafting ? 'Drafting…' : '✨ Let AI write the listing from your photo'}
          </button>
        )}
        <p className="authhint" style={{ margin: '6px 0 0' }}>
          Selling more than one thing? <a href="/my/import">Build My Market with Gnome</a>{' '}
          turns a screenshot of your stand or listings into draft listings.
        </p>
      </div>

      {listingType === 'plot' && (
        <p className="authhint" style={{ margin: 0 }}>
          🧑‍🌾 Set the plot size and how many identical plots you have — the
          listing stays up until the last one is reserved. Plot offers are a{' '}
          <a href="/pricing">paid plan</a> feature.
        </p>
      )}

      <div className="field">
        <label>Title</label>
        <input
          value={title}
          maxLength={80}
          placeholder={listingType === 'plot' ? '4×8 raised bed — you pick the crop' : 'Fresh cherry tomatoes'}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{listingType === 'plot' ? 'Plot size — e.g. 4×8 ft' : 'Quantity (optional)'}</label>
          <input
            value={quantity}
            placeholder={listingType === 'plot' ? '4×8 raised bed, full sun' : 'About 2 lbs'}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
      </div>

      {listingType === 'sale' && (
        <div className="field-row">
          <div className="field">
            <label>Price (USD)</label>
            <input inputMode="decimal" value={price} placeholder="4.00" onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="field">
            <label>Per (optional)</label>
            <input value={unit} placeholder="dozen, lb, jar…" onChange={(e) => setUnit(e.target.value)} />
          </div>
        </div>
      )}

      {listingType === 'plot' && (
        <div className="field-row">
          <div className="field">
            <label>Reservation price (USD, per plot)</label>
            <input inputMode="decimal" value={price} placeholder="40.00" onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="field">
            <label>Plots available</label>
            <input
              inputMode="numeric"
              value={plotCount}
              placeholder="1"
              onChange={(e) => setPlotCount(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
        </div>
      )}

      {listingType === 'trade' && (
        <div className="field">
          <label>Trade for</label>
          <input value={tradeFor} placeholder="Eggs, zucchini, garden help…" onChange={(e) => setTradeFor(e.target.value)} />
        </div>
      )}

      {(listingType === 'wanted' || listingType === 'plot') && (
        <div className="field">
          <label>{listingType === 'plot' ? 'What can be grown here? (optional)' : 'What would you accept? (optional)'}</label>
          <p className="hint" style={{ marginTop: -2 }}>
            {listingType === 'plot'
              ? 'List the crops you’re willing to grow — buyers pick from these.'
              : 'List variants you’d accept (e.g. Pie pumpkins, Any variety).'}
          </p>
          {reqOptions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {reqOptions.map((o, i) => (
                <button
                  type="button"
                  key={o.label}
                  className="btn btn-secondary btn-sm"
                  aria-label={`Remove ${o.label}`}
                  onClick={() => setReqOptions((prev) => prev.filter((_, j) => j !== i))}
                >
                  {o.label} ✕
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={optionDraft}
              placeholder={listingType === 'plot' ? 'Add a crop…' : 'Add an option…'}
              onChange={(e) => setOptionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const label = optionDraft.trim();
                  if (label && reqOptions.length < 20 && !reqOptions.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
                    setReqOptions((prev) => [...prev, { label }]);
                  }
                  setOptionDraft('');
                }
              }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const label = optionDraft.trim();
                if (label && reqOptions.length < 20 && !reqOptions.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
                  setReqOptions((prev) => [...prev, { label }]);
                }
                setOptionDraft('');
              }}
            >
              + Add
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontWeight: 400 }}>
            <input type="checkbox" checked={allowCustomRequest} onChange={(e) => setAllowCustomRequest(e.target.checked)} />
            Allow “Something else” requests
          </label>
        </div>
      )}

      <div className="field">
        <label>Description (optional)</label>
        <textarea
          rows={3}
          value={description}
          placeholder={
            listingType === 'plot'
              ? 'What can you grow, when is it ready, and how will the neighbor get updates? Set expectations up front — crops are living things.'
              : "A friendly sentence or two about what you're offering."
          }
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label>City</label>
          <input value={city} placeholder="City" onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field state">
          <label>State</label>
          <input value={state} maxLength={2} onChange={(e) => setState(e.target.value)} />
        </div>
      </div>

      {error && <p className="autherror">{error}</p>}
      {refused && <ServerErrorNotice error={refused} />}

      <button className="btn btn-primary" disabled={posting} onClick={() => void post()}>
        {posting
          ? 'Posting…'
          : listingType === 'wanted'
            ? 'Post your ask'
            : listingType === 'plot'
              ? 'Offer your plot'
              : 'Post your listing'}
      </button>
      <p className="authhint">
        Pickup and payment happen in person — Gnome never takes a cut. Listings expire
        automatically ({listingType === 'wanted' ? '30' : listingType === 'plot' ? '45' : '7'} days)
        unless renewed in the app.
      </p>
    </div>
  );
}
