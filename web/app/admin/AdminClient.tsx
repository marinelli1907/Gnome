'use client';

// Minimal moderation console. This UI holds NO authority: every query and
// mutation below succeeds only because 0024's RLS policies grant it to rows
// in the admins table — a non-admin hitting the same endpoints gets empty
// reads and 0-row writes. Every action also records an admin_actions row.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

interface Report {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  status: 'open' | 'reviewed' | 'actioned' | 'dismissed';
  admin_notes: string | null;
  created_at: string;
}
interface AdminListing {
  id: string; title: string; status: string; listing_type: string;
  owner_id: string; created_at: string;
}
interface AdminProfile { id: string; name: string | null; suspended: boolean }
interface Action {
  id: string; action: string; target_type: string; target_id: string | null;
  note: string | null; created_at: string;
}

type Tab = 'reports' | 'listings' | 'users' | 'audit';

export default function AdminClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('reports');
  const [reports, setReports] = useState<Report[]>([]);
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [users, setUsers] = useState<AdminProfile[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin gate: RLS lets a user read only their own admins row — a non-admin
  // simply gets zero rows here (and zero rows from everything below).
  useEffect(() => {
    if (!uid) return;
    supabaseBrowser().from('admins').select('user_id').eq('user_id', uid).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [uid]);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [r, a] = await Promise.all([
      sb.from('reports').select('*').order('created_at', { ascending: false }).limit(50),
      sb.from('admin_actions').select('id,action,target_type,target_id,note,created_at')
        .order('created_at', { ascending: false }).limit(50),
    ]);
    setReports((r.data as Report[]) ?? []);
    setActions((a.data as Action[]) ?? []);
  }, []);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  async function audit(action: string, targetType: string, targetId: string | null, extra?: string) {
    await supabaseBrowser().from('admin_actions').insert({
      admin_id: uid, action, target_type: targetType, target_id: targetId, note: extra ?? (note.trim() || null),
    });
  }

  async function resolveReport(r: Report, status: Report['status']) {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('reports').update({
      status, admin_notes: note.trim() || r.admin_notes, resolved_by: uid, resolved_at: new Date().toISOString(),
    }).eq('id', r.id);
    if (error) setError(error.message);
    else { await audit(`report_${status}`, r.target_type, r.target_id); setNote(''); await load(); }
    setBusy(false);
  }

  async function searchListings() {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('listings')
      .select('id,title,status,listing_type,owner_id,created_at')
      .or(`title.ilike.*${q}*,id.eq.${/^[0-9a-f-]{36}$/.test(q) ? q : '00000000-0000-0000-0000-000000000000'}`)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) setError(error.message);
    setListings((data as AdminListing[]) ?? []);
  }

  async function setListingStatus(l: AdminListing, status: 'removed' | 'active') {
    setBusy(true); setError(null);
    const patch: Record<string, unknown> = { status };
    if (status === 'active') patch.expires_at = new Date(Date.now() + 7 * 86400_000).toISOString();
    const { error } = await supabaseBrowser().from('listings').update(patch).eq('id', l.id);
    if (error) setError(error.message);
    else { await audit(status === 'removed' ? 'listing_removed' : 'listing_restored', 'listing', l.id); await searchListings(); }
    setBusy(false);
  }

  async function searchUsers() {
    const { data, error } = await supabaseBrowser()
      .from('profiles').select('id,name,suspended')
      .or(`name.ilike.*${q}*,id.eq.${/^[0-9a-f-]{36}$/.test(q) ? q : '00000000-0000-0000-0000-000000000000'}`)
      .limit(25);
    if (error) setError(error.message);
    setUsers((data as AdminProfile[]) ?? []);
  }

  async function setSuspended(p: AdminProfile, suspended: boolean) {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('profiles').update({ suspended }).eq('id', p.id);
    if (error) setError(error.message);
    else { await audit(suspended ? 'user_suspended' : 'user_restored', 'user', p.id); await searchUsers(); }
    setBusy(false);
  }

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) return <SignInCard title="Moderation sign-in" blurb="Admins only." />;
  if (isAdmin === null) return <div className="empty"><p>Checking access…</p></div>;
  if (!isAdmin) {
    return (
      <div className="empty">
        <div className="emoji">🔒</div>
        <h2>Not authorized</h2>
        <p>This area is for Gnome staff. Nothing here is accessible to your account.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mm-head">
        <div>
          <h1>Moderation</h1>
          <p className="mm-stats">
            <strong>{reports.filter((r) => r.status === 'open').length}</strong> open reports
          </p>
        </div>
      </div>

      <div className="seg" style={{ maxWidth: 480, marginBottom: 18 }}>
        {(['reports', 'listings', 'users', 'audit'] as Tab[]).map((t) => (
          <button key={t} type="button" className={`seg-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <p className="autherror">{error}</p>}

      {tab === 'reports' && (
        <div className="mm-list">
          {reports.length === 0 && <div className="empty"><p>No reports. Quiet neighborhood. 🌱</p></div>}
          {reports.map((r) => (
            <div key={r.id} className="mm-row">
              <div className="mm-thumb"><span>🚩</span></div>
              <div className="mm-info">
                <span className="mm-title">{r.target_type} · {r.target_id.slice(0, 8)}…</span>
                <div className="mm-meta">
                  <span className={`tag ${r.status === 'open' ? 'type-sale' : 'type-free'}`}>{r.status}</span>
                  {r.reason && <span className="mm-expiry">“{r.reason}”</span>}
                  {r.admin_notes && <span className="mm-expiry">📝 {r.admin_notes}</span>}
                </div>
              </div>
              {r.status === 'open' && (
                <div className="mm-btns">
                  <button className="mm-btn" disabled={busy} onClick={() => void resolveReport(r, 'reviewed')}>Reviewed</button>
                  <button className="mm-btn" disabled={busy} onClick={() => void resolveReport(r, 'actioned')}>Actioned</button>
                  <button className="mm-btn danger" disabled={busy} onClick={() => void resolveReport(r, 'dismissed')}>Dismiss</button>
                </div>
              )}
            </div>
          ))}
          <div className="field" style={{ maxWidth: 480 }}>
            <label>Note attached to the next action (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note…" />
          </div>
        </div>
      )}

      {(tab === 'listings' || tab === 'users') && (
        <div>
          <div className="locrow" style={{ marginBottom: 14 }}>
            <input
              value={q}
              placeholder={tab === 'listings' ? 'Search listings by title or UUID' : 'Search users by name or UUID'}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void (tab === 'listings' ? searchListings() : searchUsers()); }}
            />
            <button className="btn btn-primary btn-sm" onClick={() => void (tab === 'listings' ? searchListings() : searchUsers())}>
              Search
            </button>
          </div>

          {tab === 'listings' && (
            <div className="mm-list">
              {listings.map((l) => (
                <div key={l.id} className="mm-row">
                  <div className="mm-info">
                    <span className="mm-title">{l.title}</span>
                    <div className="mm-meta">
                      <span className={`tag type-${l.listing_type}`}>{l.listing_type}</span>
                      <span className="tag">{l.status}</span>
                    </div>
                  </div>
                  <div className="mm-btns">
                    {l.status !== 'removed' ? (
                      <button className="mm-btn danger" disabled={busy} onClick={() => void setListingStatus(l, 'removed')}>Remove</button>
                    ) : (
                      <button className="mm-btn" disabled={busy} onClick={() => void setListingStatus(l, 'active')}>Restore</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'users' && (
            <div className="mm-list">
              {users.map((p) => (
                <div key={p.id} className="mm-row">
                  <div className="mm-info">
                    <span className="mm-title">{p.name ?? 'Unnamed'} · {p.id.slice(0, 8)}…</span>
                    <div className="mm-meta">
                      {p.suspended && <span className="tag type-sale">suspended</span>}
                    </div>
                  </div>
                  <div className="mm-btns">
                    {!p.suspended ? (
                      <button className="mm-btn danger" disabled={busy} onClick={() => void setSuspended(p, true)}>Suspend</button>
                    ) : (
                      <button className="mm-btn" disabled={busy} onClick={() => void setSuspended(p, false)}>Restore</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="mm-list">
          {actions.length === 0 && <div className="empty"><p>No admin actions recorded yet.</p></div>}
          {actions.map((a) => (
            <div key={a.id} className="mm-row">
              <div className="mm-info">
                <span className="mm-title">{a.action} · {a.target_type}{a.target_id ? ` · ${a.target_id.slice(0, 8)}…` : ''}</span>
                <div className="mm-meta">
                  <span className="mm-expiry">{new Date(a.created_at).toLocaleString()}</span>
                  {a.note && <span className="mm-expiry">📝 {a.note}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
