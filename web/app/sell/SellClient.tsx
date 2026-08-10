'use client';

// Web sell flow: sign in → photos → (optional ✨ AI draft) → post. Mirrors the
// app's post flow (expo/app/(tabs)/post.tsx + lib/db.ts useCreateListing): same
// tables, same RLS, same draft-listing function, same market attachment — a
// listing posted here is indistinguishable from one posted in the app.
import { useEffect, useRef, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { CATEGORIES } from '../../lib/categories';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

type ListingType = 'free' | 'trade' | 'sale' | 'wanted' | 'plot';

const TYPES: { id: ListingType; label: string; hint: string }[] = [
  { id: 'free', label: 'Share free', hint: 'Give surplus to neighbors' },
  { id: 'trade', label: 'Trade', hint: 'Swap for something you want' },
  { id: 'sale', label: 'Sell', hint: 'Neighborly price, paid at pickup' },
  { id: 'wanted', label: 'Wanted', hint: 'Ask neighbors for something' },
  { id: 'plot', label: 'Offer a plot', hint: 'A neighbor reserves it; you grow their pick' },
];

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

  const [listingType, setListingType] = useState<ListingType>(initialType ?? 'free');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('vegetables');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');       // dollars, string
  const [plotCount, setPlotCount] = useState('1'); // identical plots to post (plot type only)
  const [unit, setUnit] = useState('');
  const [tradeFor, setTradeFor] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('OH');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; slug: string | null; count: number } | null>(null);
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
      // One listing = one reservable plot, so "3 identical plots" = 3 rows —
      // each gets reserved (and comes off the market) independently.
      const n = listingType === 'plot' ? Math.min(10, Math.max(1, Number(plotCount) || 1)) : 1;
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
      };
      const { data: rows, error } = await supabase
        .from('listings')
        .insert(Array.from({ length: n }, () => ({ ...row })))
        .select('id,slug');
      const data = rows?.[0];
      if (error) {
        if (error.message.includes('PLOTS_REQUIRE_PLAN')) {
          throw new Error(
            'Offering plots is a Grower & Farm plan feature — upgrade on the Pricing page and your garden can take reservations.',
          );
        }
        throw new Error(
          error.message.includes('plan')
            ? 'You’ve hit your plan’s active-listing limit — complete or remove an old listing first.'
            : error.message,
        );
      }
      if (!data) throw new Error('Posting failed — try again.');
      logWeb('listing_published', { type: listingType, count: n });
      setDone({ id: data.id, slug: data.slug, count: n });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Posting failed — try again.');
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
    const href = `/listing/${done.slug ? `${done.slug}-` : ''}${done.id}`;
    return (
      <div className="authcard">
        <h2>🎉 {done.count > 1 ? `Your ${done.count} plots are live` : 'Your listing is live'}</h2>
        <p className="sub">Neighbors browsing the web and the Gnome app can see {done.count > 1 ? 'them' : 'it'} right now.</p>
        <div className="row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a className="btn btn-primary btn-sm" href={href}>View your listing</a>
          <a className="btn btn-secondary btn-sm" href="/my">My Market</a>
          <button className="btn btn-secondary btn-sm" onClick={() => {
            setDone(null); setTitle(''); setDescription(''); setQuantity('');
            setPrice(''); setUnit(''); setTradeFor(''); setPhotos([]); setPlotCount('1');
          }}>
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
      </div>

      {listingType === 'plot' && (
        <p className="authhint" style={{ margin: 0 }}>
          🧑‍🌾 A neighbor reserves a plot and picks the crop; you grow it. Offering
          several identical plots? Set the count below and each gets its own
          reservable listing. Plot offers are a{' '}
          <a href="/pricing">Grower &amp; Farm plan</a> feature.
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
          <label>{listingType === 'plot' ? 'Plot size (optional)' : 'Quantity (optional)'}</label>
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
            <label>Identical plots (1–10)</label>
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
          <input value={city} placeholder="Richmond Heights" onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field state">
          <label>State</label>
          <input value={state} maxLength={2} onChange={(e) => setState(e.target.value)} />
        </div>
      </div>

      {error && <p className="autherror">{error}</p>}

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
