'use client';

// "Build my Seed Drop" — the personalization profile. Five quick questions,
// saved to seed_profiles (own-row RLS). Checkout goes through the Stripe
// Payment Link with client_reference_id=seed_<uid>; the verified webhook
// creates the order and the DATABASE engine picks the seeds. Nothing here
// decides inventory.
import { useEffect, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

const STARTER_LINK = process.env.NEXT_PUBLIC_SEED_LINK_STARTER;

const SIZES = [
  ['windowsill', 'Windowsill'], ['containers', 'Containers'], ['small_bed', 'Small raised bed'],
  ['medium', 'Medium garden'], ['large', 'Large garden'], ['greenhouse', 'Greenhouse'],
  ['unsure', 'Not sure'],
] as const;
const SUNS = [
  ['full', 'Full sun'], ['partial', 'Partial sun'], ['shade', 'Mostly shade'], ['unsure', 'Not sure'],
] as const;
const EXP = [
  ['first_time', 'First-timer'], ['beginner', 'Beginner'], ['some', 'Some experience'], ['experienced', 'Experienced'],
] as const;

// Per-packet price and shipping. Env-overridable so pricing isn't a code
// change; the totals shown here are what the buyer is asked to pay.
const PACKET_CENTS = Number(process.env.NEXT_PUBLIC_SEED_PACKET_CENTS ?? 350);
const SHIP_CENTS = Number(process.env.NEXT_PUBLIC_SEED_SHIP_CENTS ?? 495);
const FREE_SHIP_AT = Number(process.env.NEXT_PUBLIC_SEED_FREE_SHIP_AT ?? 8);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

type Rec = {
  product_id: string; crop: string; variety: string | null; category: string;
  description: string | null; days_to_maturity: number | null;
  packet_seed_count: number | null; in_stock: number;
  recommended: boolean; why: string | null;
};
const PREFS = [
  'vegetables', 'herbs', 'flowers', 'pollinator plants', 'salad garden',
  'salsa garden', 'container garden', 'surprise me',
];

export default function SeedProfileClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [zip, setZip] = useState('');
  const [zone, setZone] = useState<string>('6');
  const [zoneAuto, setZoneAuto] = useState(false);
  const [sizes, setSizes] = useState<string[]>([]);
  // Every question with options is multi-answer now.
  const [suns, setSuns] = useState<string[]>([]);
  const [exps, setExps] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<string[]>([]);
  const [exclusions, setExclusions] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gnome's picks from REAL stock for this zone — the buyer can overrule any
  // of it. `qty` is the basket: product_id -> packets of it (absent = not in
  // the box). It starts as our recommendation, one packet each.
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [touchedPicks, setTouchedPicks] = useState(false);

  const totalPackets = Object.values(qty).reduce((a, b) => a + b, 0);
  const shipCents = totalPackets === 0 || totalPackets >= FREE_SHIP_AT ? 0 : SHIP_CENTS;
  const totalCents = totalPackets * PACKET_CENTS + shipCents;
  // Never let someone order more packets than we physically have.
  const maxFor = (r: Rec) => Math.max(0, Math.min(10, r.in_stock ?? 0));
  // delta is applied to whatever is in the basket right now, so rapid repeat
  // taps on +/− each count instead of collapsing onto one stale render value.
  const bumpQty = (id: string, delta: number, max: number) => {
    setTouchedPicks(true);
    setQty((q) => {
      const next = { ...q };
      const n = Math.max(0, Math.min(max, (q[id] ?? 0) + delta));
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  };

  useEffect(() => {
    if (!uid) return;
    logWeb('seed_profile_started');
    supabaseBrowser().from('seed_profiles').select('*').eq('user_id', uid).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        if (data.zip) setZip(data.zip);
        if (data.zone) setZone(String(data.zone));
        if (data.garden_sizes?.length) setSizes(data.garden_sizes);
        else if (data.garden_size && data.garden_size !== 'unsure') setSizes([data.garden_size]);
        if (data.suns?.length) setSuns(data.suns);
        else if (data.sun) setSuns([data.sun]);
        if (data.experiences?.length) setExps(data.experiences);
        else if (data.experience) setExps([data.experience]);
        if (data.preferences?.length) setPrefs(data.preferences);
        if (data.exclusions?.length) setExclusions(data.exclusions.join(', '));
        setSaved(true);
      });
  }, [uid]);

  // Ask the database what it would actually send, from live stock for this
  // zone. Re-runs as the answers change; the buyer's own edits are preserved
  // once they've touched the basket.
  useEffect(() => {
    if (!uid) return;
    const t = setTimeout(async () => {
      const { data, error: e } = await supabaseBrowser().rpc('seed_recommendations', {
        p_zone: Number(zone),
        p_suns: suns,
        p_experiences: exps,
        p_sizes: sizes,
        p_preferences: prefs,
        p_exclusions: exclusions.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
        p_limit: 24,
      });
      if (e) return;
      const rows = (data ?? []) as Rec[];
      setRecs(rows);
      if (!touchedPicks) {
        setQty(Object.fromEntries(
          rows.filter((r) => r.recommended && (r.in_stock ?? 0) > 0).map((r) => [r.product_id, 1]),
        ));
      }
    }, 350);
    return () => clearTimeout(t);
  }, [uid, zone, suns, exps, sizes, prefs, exclusions, touchedPicks]);

  // Auto hardiness zone from ZIP: geocode via Nominatim (keyless), then a
  // latitude-band estimate calibrated to USDA zones (±1 zone typical; the
  // select stays editable, and the engine only shifts timing at extremes).
  useEffect(() => {
    if (!/^\d{5}$/.test(zip)) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&country=us&postalcode=${zip}`,
          { headers: { Accept: 'application/json' } },
        );
        const rows = (await res.json()) as { lat: string }[];
        if (!rows[0]) return;
        const lat = Number(rows[0].lat);
        if (!lat) return;
        const est = Math.min(10, Math.max(3, Math.round(10.5 - 0.302 * (lat - 25.8))));
        setZone(String(est));
        setZoneAuto(true);
      } catch { /* zone stays manual */ }
    }, 500);
    return () => clearTimeout(t);
  }, [zip]);

  async function save(): Promise<boolean> {
    if (!uid) return false;
    if (!/^\d{5}$/.test(zip.trim())) { setError('Enter your 5-digit ZIP so we can match your season.'); return false; }
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().from('seed_profiles').upsert({
      user_id: uid,
      zip: zip.trim(),
      zone: Number(zone),
      garden_sizes: sizes,
      garden_size: sizes[0] ?? 'unsure',   // legacy single-value mirror
      suns,
      experiences: exps,
      sun: suns[0] ?? 'unsure',            // legacy mirrors keep the old
      experience: exps[0] ?? 'beginner',   // engine + admin views working
      packet_count: totalPackets || null,
      preferences: prefs,
      exclusions: exclusions.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) { setError(error.message); return false; }
    setSaved(true);
    logWeb('seed_profile_completed');
    return true;
  }

  async function checkout() {
    const ok = await save();
    if (!ok) return;
    if (STARTER_LINK && uid) {
      logWeb('seed_checkout_started');
      window.location.href = `${STARTER_LINK}?client_reference_id=seed_${uid}`;
    }
  }

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) {
    return (
      <SignInCard
        title="Sign in to build your Seed Drop"
        blurb="One code by email — then tell Gnome about your garden and we’ll build your box from what’s in stock and in season."
      />
    );
  }

  return (
    <div className="sellform" id="build">
      <div className="field">
        <label>ZIP code</label>
        <input inputMode="numeric" maxLength={5} value={zip} placeholder="ZIP code"
          onChange={(e) => setZip(e.target.value.replace(/[^0-9]/g, ''))} />
      </div>

      <div className="field">
        <label>Hardiness zone{zoneAuto ? ' — set automatically from your ZIP, adjust if you know better' : ' (best guess is fine)'}</label>
        <select value={zone} onChange={(e) => { setZone(e.target.value); setZoneAuto(false); }}>
          {[3, 4, 5, 6, 7, 8, 9, 10].map((z) => (
            <option key={z} value={z}>Zone {z}{z === 6 ? ' — most of NE Ohio' : ''}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Where will these grow? (pick all that apply)</label>
        <div className="chiprow">
          {SIZES.filter(([v]) => v !== 'unsure').map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={`chip${sizes.includes(v) ? ' active' : ''}`}
              onClick={() => setSizes(sizes.includes(v) ? sizes.filter((s) => s !== v) : [...sizes, v])}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Sunlight (pick all that apply)</label>
        <div className="chiprow">
          {SUNS.map(([v, l]) => (
            <button key={v} type="button" className={`chip${suns.includes(v) ? ' active' : ''}`}
              onClick={() => setSuns(suns.includes(v) ? suns.filter((s) => s !== v) : [...suns, v])}>{l}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Experience (pick all that apply)</label>
        <div className="chiprow">
          {EXP.map(([v, l]) => (
            <button key={v} type="button" className={`chip${exps.includes(v) ? ' active' : ''}`}
              onClick={() => setExps(exps.includes(v) ? exps.filter((s) => s !== v) : [...exps, v])}>{l}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>What sounds good? (pick any)</label>
        <div className="chiprow">
          {PREFS.map((p) => (
            <button key={p} type="button" className={`chip${prefs.includes(p) ? ' active' : ''}`}
              onClick={() => setPrefs(prefs.includes(p) ? prefs.filter((x) => x !== p) : [...prefs, p])}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Anything to leave out? (optional)</label>
        <input value={exclusions} placeholder="cilantro, sunflower…" onChange={(e) => setExclusions(e.target.value)} />
      </div>

      {/* Your box: Gnome's picks from real stock, fully editable. */}
      <div className="field">
        <label>Your packets — Gnome picked these, change anything you like</label>
        {recs === null ? (
          <p className="authhint">Checking what’s in stock for zone {zone}…</p>
        ) : recs.length === 0 ? (
          <p className="authhint">
            Nothing is in stock for your answers right now. Save your profile and
            you’ll be first in line when the next lots land — we never sell seed
            we don’t physically have.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recs.map((r) => {
                const n = qty[r.product_id] ?? 0;
                const max = maxFor(r);
                const soldOut = max === 0;
                return (
                  <div
                    key={r.product_id}
                    className={`chip${n > 0 ? ' active' : ''}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                      padding: '10px 12px', borderRadius: 12, cursor: 'default',
                      opacity: soldOut ? 0.55 : 1,
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      <strong>{r.crop}{r.variety ? ` — ${r.variety}` : ''}</strong>
                      <span style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>
                        {r.recommended ? 'Gnome’s pick · ' : ''}{r.why}
                        {r.packet_seed_count ? ` · ~${r.packet_seed_count} seeds/packet` : ''}
                        {soldOut ? ' · out of stock' : ''}
                      </span>
                    </span>

                    {soldOut ? null : n === 0 ? (
                      <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => bumpQty(r.product_id, 1, max)}>
                        Add
                      </button>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button type="button" className="btn btn-secondary btn-sm"
                          aria-label={`One fewer packet of ${r.crop}`}
                          onClick={() => bumpQty(r.product_id, -1, max)}>−</button>
                        <strong style={{ minWidth: 44, textAlign: 'center' }}>
                          {n} pkt{n === 1 ? '' : 's'}
                        </strong>
                        <button type="button" className="btn btn-secondary btn-sm"
                          aria-label={`One more packet of ${r.crop}`}
                          disabled={n >= max}
                          onClick={() => bumpQty(r.product_id, 1, max)}>+</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="authhint" style={{ marginTop: 10 }}>
              {totalPackets === 0 ? (
                <>Your box is empty — add a packet of anything above.</>
              ) : (
                <>
                  <strong>{totalPackets} packet{totalPackets === 1 ? '' : 's'}</strong>
                  {' · '}{money(totalPackets * PACKET_CENTS)}
                  {shipCents === 0 ? ' + free shipping' : ` + ${money(shipCents)} shipping`}
                  {' = '}<strong>{money(totalCents)}</strong>
                  {totalPackets < FREE_SHIP_AT
                    ? ` — add ${FREE_SHIP_AT - totalPackets} more packet${FREE_SHIP_AT - totalPackets === 1 ? '' : 's'} for free shipping`
                    : ''}
                </>
              )}
            </p>
          </>
        )}
      </div>

      {error && <p className="autherror">{error}</p>}

      {STARTER_LINK ? (
        <button className="btn btn-primary" disabled={busy} onClick={() => void checkout()}>
          {busy ? 'Saving…' : 'Save & start my Seed Drop — $12 founding intro (then $24.99/season)'}
        </button>
      ) : (
        <>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : saved ? 'Update my garden profile' : 'Save my garden profile'}
          </button>
          <p className="authhint">
            {saved ? '✓ Profile saved. ' : ''}Seasonal Seed Drops: one personalized Drop each growing season, up to 4/year — profile
            holders are first in line, and your box is built from real stock the day you order.
          </p>
        </>
      )}
    </div>
  );
}
