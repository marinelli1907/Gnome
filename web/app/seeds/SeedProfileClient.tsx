'use client';

// The garden profile — where and how you grow, saved to seed_profiles (own-row
// RLS). Seed Drop is not open, so this is preference storage and nothing else:
// no checkout, no basket, no prices, no packet counts. The Payment Link
// checkout that used to live here is deleted, not disabled — it was one unset
// env var away from taking money for a product that can't be fulfilled yet.
// The live-inventory picker went with it: quantity steppers and running totals
// are a cart no matter what the button says.
import { useEffect, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

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

  // packet_count is deliberately left out of the payload: nobody is choosing a
  // Drop size yet, and omitting the column leaves any existing value alone
  // rather than writing a number this form no longer collects.
  async function save() {
    if (!uid) return;
    if (!/^\d{5}$/.test(zip.trim())) { setError('Enter your 5-digit ZIP so Gnome can match your season.'); return; }
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
      preferences: prefs,
      exclusions: exclusions.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSaved(true);
    logWeb('seed_profile_completed');
  }

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) {
    return (
      <SignInCard
        title="Sign in to save your garden profile"
        blurb="One code by email — then tell Gnome how and where you grow. It saves your preferences; Seed Drop itself is still on the way."
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

      {error && <p className="autherror">{error}</p>}

      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : saved ? 'Update my garden profile' : 'Save my garden profile'}
      </button>
      <p className="authhint">
        {saved ? '✓ Profile saved. ' : ''}Saving your profile reserves nothing and costs nothing —
        Seed Drop is still growing. It just means Gnome already knows your zone, your
        space and your sunlight when personalized selections open.
      </p>
    </div>
  );
}
