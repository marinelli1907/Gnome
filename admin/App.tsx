// GNOME ADMIN — the internal operating app. Same Supabase backend and auth
// identities as consumer Gnome; a normal user who signs in here hits the
// admin_me() gate and sees "You don't have access" — no privileged data ever
// loads client-side because every read/mutation below is RLS/permission-
// checked server-side (admin_has_perm / audited RPCs). No service keys here.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable,
  RefreshControl, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true } },
);

const C = {
  bg: '#F7F5EE', surface: '#FFFFFF', green: '#143023', mid: '#4E6E5D',
  muted: '#6C7A72', border: '#E2DFD3', red: '#A33A2E', gold: '#B98A2F',
};
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

type Me = { user_id: string; role: string; permissions: string[]; is_owner: boolean };
type Tab = 'home' | 'ai' | 'more';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null | 'denied' | 'loading'>('loading');
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe('loading'); return; }
    supabase.rpc('admin_me').then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      setMe(row ? (row as Me) : 'denied');
    });
  }, [session]);

  if (!session) return <SignIn />;
  if (me === 'loading') {
    return <Centered><ActivityIndicator color={C.green} size="large" /></Centered>;
  }
  if (me === 'denied') {
    return (
      <Centered>
        <Text style={s.deniedEmoji}>🔒</Text>
        <Text style={s.deniedTitle}>You don’t have access to Gnome Admin.</Text>
        <Text style={s.deniedSub}>This app is for the Gnome team. Your regular Gnome account still works in the Gnome app.</Text>
        <Pressable style={s.btn} onPress={() => supabase.auth.signOut()}>
          <Text style={s.btnText}>Sign out</Text>
        </Pressable>
      </Centered>
    );
  }
  const admin = me as Me;
  const can = (p: string) => admin.permissions?.includes('*') || admin.permissions?.includes(p);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.header}>
        <Text style={s.brand}>🧑‍🌾 Gnome Admin</Text>
        <Text style={s.role}>{admin.role}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <Home />}
        {tab === 'ai' && <AiHQ can={can} />}
        {tab === 'more' && <More can={can} isOwner={admin.is_owner} />}
      </View>
      <View style={s.tabbar}>
        {([['home', '🏠 Home'], ['ai', '🤖 AI HQ'], ['more', '☰ More']] as [Tab, string][]).map(([t, label]) => (
          <Pressable key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- Sign in
function SignIn() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) Alert.alert('Sign in failed', error.message);
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Centered>
        <Text style={{ fontSize: 40 }}>🧑‍🌾</Text>
        <Text style={s.signTitle}>Gnome Admin</Text>
        <Text style={s.deniedSub}>The Gnome business, in your pocket.</Text>
        <TextInput style={s.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address"
          value={email} onChangeText={setEmail} placeholderTextColor={C.muted} />
        <TextInput style={s.input} placeholder="Password" secureTextEntry value={pw} onChangeText={setPw}
          placeholderTextColor={C.muted} />
        <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={go} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>
      </Centered>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------- Home (Daily Brief)
function Home() {
  const [brief, setBrief] = useState<Record<string, unknown> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.rpc('admin_daily_brief');
    setBrief(data as Record<string, unknown>);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!brief) return <Centered><ActivityIndicator color={C.green} /></Centered>;
  const n = (k: string) => Number(brief[k] ?? 0);
  const attention: [string, number][] = ([
    ['Pending credentials', n('pending_compliance')],
    ['Seed orders need review', n('seed_orders_needing_review')],
    ['Open reports', n('open_reports')],
    ['Low seed lots', n('low_inventory_lots')],
    ['AI approvals waiting', n('ai_pending_approvals')],
    ['Comps expiring (30d)', n('comp_expiring_30d')],
  ] as [string, number][]).filter(([, v]) => v > 0);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <Text style={s.h2}>Needs your attention</Text>
      {attention.length === 0
        ? <Card><Text style={s.cardBig}>All clear 🌱</Text><Text style={s.cardSub}>Nothing is waiting on you right now.</Text></Card>
        : attention.map(([label, v]) => (
            <Card key={label}><Text style={s.cardBig}>{v}</Text><Text style={s.cardSub}>{label}</Text></Card>
          ))}
      <Text style={s.h2}>Today</Text>
      <Row2 items={[['Orders', n('orders_today')], ['Pickups', n('pickups_today')], ['Deliveries', n('deliveries_today')]]} />
      <Text style={s.h2}>Business</Text>
      <Row2 items={[['Users', n('users')], ['Markets', n('active_markets')], ['Live listings', n('live_listings')]]} />
      <Row2 items={[['MRR', Number(brief.mrr_cents ?? 0) / 100], ['Comp grants', n('active_comp_grants')], ['Seed queue', n('seed_orders_to_pack')]]} money0 />
      <Card>
        <Text style={s.cardSub}>Plan mix</Text>
        <Text style={s.cardText}>{Object.entries((brief.plan_mix as Record<string, number>) ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</Text>
      </Card>
      <Card>
        <Text style={s.cardSub}>AI</Text>
        <Text style={s.cardText}>
          writes {brief.ai_writes_paused ? 'PAUSED 🔒' : 'enabled'} · today {money(Number(brief.ai_usage_today_cents ?? 0))}
        </Text>
      </Card>
      <Text style={s.stamp}>Generated {new Date(String(brief.generated_at)).toLocaleTimeString()}</Text>
    </ScrollView>
  );
}

// ---------------------------------------------------------------- AI HQ
function AiHQ({ can }: { can: (p: string) => boolean }) {
  const [reqs, setReqs] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: r }, { data: a }, { data: st }] = await Promise.all([
      supabase.from('ai_action_requests').select('*').order('requested_at', { ascending: false }).limit(30),
      supabase.from('ai_agents').select('*').order('id'),
      supabase.from('ai_settings').select('writes_paused').limit(1).maybeSingle(),
    ]);
    setReqs(r ?? []); setAgents(a ?? []); setPaused(st?.writes_paused ?? null);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const review = async (id: string, approve: boolean) => {
    const { error } = await supabase.rpc('admin_review_ai_action', { p_request: id, p_approve: approve });
    if (error) Alert.alert('Failed', error.message); else void load();
  };
  const execute = async (id: string) => {
    const { error } = await supabase.rpc('admin_execute_ai_action', { p_request: id });
    if (error) Alert.alert('Failed', error.message); else void load();
  };
  const togglePause = async (v: boolean) => {
    const { error } = await supabase.rpc('admin_set_ai_paused', { p_paused: v });
    if (error) Alert.alert('Failed', error.message); else setPaused(v);
  };

  const pending = reqs.filter((r) => r.status === 'PENDING');
  const approved = reqs.filter((r) => r.status === 'APPROVED');

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardBig}>{paused ? 'AI writes paused 🔒' : 'AI writes enabled'}</Text>
            <Text style={s.cardSub}>Kill switch — server-enforced. Reads/reports keep working.</Text>
          </View>
          {can('ai.pause_actions') && paused != null && (
            <Switch value={!paused} onValueChange={(v) => void togglePause(!v)} trackColor={{ true: C.green }} />
          )}
        </View>
      </Card>

      <Text style={s.h2}>Needs approval ({pending.length})</Text>
      {pending.length === 0 && <Card><Text style={s.cardSub}>No AI actions waiting.</Text></Card>}
      {pending.map((r) => (
        <Card key={r.id}>
          <Text style={s.cardTitle}>{r.human_summary}</Text>
          <Text style={s.cardSub}>{r.agent_id} · {r.requested_action} · risk {r.risk_level} · {r.reason ?? ''}</Text>
          <Text style={s.mono}>{JSON.stringify(r.parameters)}</Text>
          {can('ai.approve_actions') && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <SmallBtn label="Approve" onPress={() => void review(r.id, true)} />
              <SmallBtn label="Reject" danger onPress={() => void review(r.id, false)} />
            </View>
          )}
        </Card>
      ))}

      {approved.length > 0 && <Text style={s.h2}>Approved — ready to execute</Text>}
      {approved.map((r) => (
        <Card key={r.id}>
          <Text style={s.cardTitle}>{r.human_summary}</Text>
          {can('ai.approve_actions') && <SmallBtn label="Execute now" onPress={() => void execute(r.id)} />}
        </Card>
      ))}

      <Text style={s.h2}>Agents</Text>
      {agents.map((a) => (
        <Card key={a.id}>
          <Text style={s.cardTitle}>{a.name}</Text>
          <Text style={s.cardSub}>{a.status} · L{a.automation_level} · {a.provider}/{a.model} · budget {money(a.daily_budget_cents)}/day</Text>
        </Card>
      ))}

      <Text style={s.h2}>Handled</Text>
      {reqs.filter((r) => ['EXECUTED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(r.status)).slice(0, 10).map((r) => (
        <Card key={r.id}><Text style={s.cardSub}>{r.status} · {r.human_summary}</Text></Card>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- More (Users / Entitlements / Team / Audit)
function More({ can, isOwner }: { can: (p: string) => boolean; isOwner: boolean }) {
  const [view, setView] = useState<'menu' | 'users' | 'team' | 'audit'>('menu');
  if (view === 'users') return <Users back={() => setView('menu')} can={can} />;
  if (view === 'team') return <Team back={() => setView('menu')} />;
  if (view === 'audit') return <Audit back={() => setView('menu')} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {can('users.view') && <MenuRow label="👥 Users & Entitlements" onPress={() => setView('users')} />}
      {can('admins.view') && <MenuRow label="🛡 Admin Team" onPress={() => setView('team')} />}
      <MenuRow label="📜 Audit Log" onPress={() => setView('audit')} />
      <Card>
        <Text style={s.cardSub}>
          Markets, Listings, Orders, Compliance, Inventory, Seed Drop, Plots, Finance,
          Support, Taxonomy — next build. Backend permissions for all of them are live.
        </Text>
      </Card>
      <Pressable style={[s.btn, { marginTop: 20 }]} onPress={() => supabase.auth.signOut()}>
        <Text style={s.btnText}>Sign out</Text>
      </Pressable>
      {isOwner && <Text style={s.stamp}>Signed in as OWNER — the highest-risk actions require this role.</Text>}
    </ScrollView>
  );
}

function Users({ back, can }: { back: () => void; can: (p: string) => boolean }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [ent, setEnt] = useState<any | null>(null);
  const [mkt, setMkt] = useState<any | null>(null);

  const search = async () => {
    const { data } = await supabase.from('profiles')
      .select('id,name,city,state,user_type,suspended,created_at')
      .ilike('name', `%${q}%`).limit(20);
    setRows(data ?? []); setSel(null);
  };
  const open = async (p: any) => {
    setSel(p); setEnt(null); setMkt(null);
    const { data: m } = await supabase.from('markets').select('id,name,plan').eq('owner_id', p.id).limit(1).maybeSingle();
    setMkt(m);
    if (m) {
      const { data: e } = await supabase.rpc('admin_market_entitlements', { p_market: m.id });
      setEnt(e);
    }
  };
  const grant = (plan: 'grower' | 'farm', days: number | null, reason: string) => {
    if (!mkt) return;
    const expires = days ? new Date(Date.now() + days * 864e5).toISOString() : null;
    Alert.alert(`Grant ${plan}?`, `${reason} — ${days ? days + ' days' : 'no expiration'}. This changes real entitlements.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Grant', onPress: async () => {
        const { error } = await supabase.rpc('admin_grant_plan',
          { p_market: mkt.id, p_plan: plan, p_expires: expires, p_reason: reason });
        if (error) Alert.alert('Failed', error.message); else void open(sel);
      } },
    ]);
  };
  const revoke = (gid: string) => {
    Alert.alert('Revoke this grant?', 'The Market falls back to its next valid entitlement.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('admin_revoke_grant', { p_grant: gid, p_reason: 'Revoked from Gnome Admin' });
        if (error) Alert.alert('Failed', error.message); else void open(sel);
      } },
    ]);
  };
  const suspend = (v: boolean) => {
    Alert.alert(v ? 'Suspend this user?' : 'Restore this user?', sel.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: v ? 'Suspend' : 'Restore', style: v ? 'destructive' : 'default', onPress: async () => {
        const { error } = await supabase.rpc('admin_set_suspended', { p_user: sel.id, p_suspended: v });
        if (error) Alert.alert('Failed', error.message);
        else { setSel({ ...sel, suspended: v }); }
      } },
    ]);
  };

  if (sel) {
    const grants = (ent?.grants ?? []) as any[];
    const activeGrants = grants.filter((g) => g.status === 'ACTIVE' && (!g.expires_at || new Date(g.expires_at) > new Date()));
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <BackRow label="← Users" onPress={() => setSel(null)} />
        <Card>
          <Text style={s.cardBig}>{sel.name}</Text>
          <Text style={s.cardSub}>{sel.city ?? ''} {sel.state ?? ''} · {sel.user_type} · joined {String(sel.created_at).slice(0, 10)}</Text>
          {sel.suspended && <Text style={[s.cardSub, { color: C.red }]}>SUSPENDED</Text>}
          {can('users.suspend') && (
            <SmallBtn label={sel.suspended ? 'Restore user' : 'Suspend user'} danger={!sel.suspended}
              onPress={() => suspend(!sel.suspended)} />
          )}
        </Card>
        {mkt ? (
          <Card>
            <Text style={s.cardTitle}>🏡 {mkt.name}</Text>
            <Text style={s.cardSub}>
              Effective plan: {ent?.effective?.plan ?? '…'} · source: {ent?.effective?.source ?? '…'}
              {ent?.effective?.grant_expires ? ` · until ${String(ent.effective.grant_expires).slice(0, 10)}` : ''}
            </Text>
            <Text style={s.cardSub}>Stripe/base plan: {ent?.base_plan ?? mkt.plan}</Text>
            {can('subscriptions.grant_complimentary') && (
              <>
                <Text style={s.h3}>Grant free subscription</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <SmallBtn label="Grower · 30d" onPress={() => grant('grower', 30, 'Founding Grower')} />
                  <SmallBtn label="Grower · 1yr" onPress={() => grant('grower', 365, 'Founding Grower')} />
                  <SmallBtn label="Farm · 90d" onPress={() => grant('farm', 90, 'Farm pilot')} />
                  <SmallBtn label="Grower · ∞" onPress={() => grant('grower', null, 'Founding Grower')} />
                </View>
              </>
            )}
            {activeGrants.length > 0 && (
              <>
                <Text style={s.h3}>Active comps</Text>
                {activeGrants.map((g) => (
                  <View key={g.id} style={{ marginTop: 6 }}>
                    <Text style={s.cardText}>
                      {g.plan} · {g.reason} · {g.expires_at ? `until ${String(g.expires_at).slice(0, 10)}` : 'no expiration'}
                    </Text>
                    {can('subscriptions.revoke_complimentary') && (
                      <SmallBtn label="Revoke" danger onPress={() => revoke(g.id)} />
                    )}
                  </View>
                ))}
              </>
            )}
          </Card>
        ) : (
          <Card><Text style={s.cardSub}>No Market yet (hasn’t posted).</Text></Card>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <BackRow label="← More" onPress={back} />
      <TextInput style={s.input} placeholder="Search users by name…" value={q} onChangeText={setQ}
        onSubmitEditing={search} returnKeyType="search" placeholderTextColor={C.muted} autoCapitalize="none" />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => void open(item)}>
            <Card>
              <Text style={s.cardTitle}>{item.name}{item.suspended ? '  ⛔' : ''}</Text>
              <Text style={s.cardSub}>{item.city ?? ''} {item.state ?? ''} · {item.user_type}</Text>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={s.cardSub}>Search for a user to inspect and manage entitlements.</Text>}
      />
    </View>
  );
}

function Team({ back }: { back: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.rpc('admin_list_team').then(({ data }) => setRows((data as any[]) ?? []));
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <BackRow label="← More" onPress={back} />
      <Text style={s.h2}>Admin team</Text>
      {rows.map((r) => (
        <Card key={r.id}>
          <Text style={s.cardTitle}>{r.name ?? r.email ?? r.user_id.slice(0, 8)}</Text>
          <Text style={s.cardSub}>{r.role} · {r.status} · since {String(r.created_at).slice(0, 10)}</Text>
        </Card>
      ))}
      <Card><Text style={s.cardSub}>Invites & role changes run through audited backend RPCs (admin_upsert_member / admin_revoke_member) — UI next build.</Text></Card>
    </ScrollView>
  );
}

function Audit({ back }: { back: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from('admin_audit_log').select('*').order('id', { ascending: false }).limit(50)
      .then(({ data }) => setRows((data as any[]) ?? []));
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <BackRow label="← More" onPress={back} />
      <Text style={s.h2}>Audit log</Text>
      {rows.map((r) => (
        <Card key={r.id}>
          <Text style={s.cardTitle}>{r.action}</Text>
          <Text style={s.cardSub}>{r.actor_type} · {r.resource_type ?? ''} · {String(r.created_at).slice(0, 19).replace('T', ' ')}</Text>
          {r.reason ? <Text style={s.cardText}>“{r.reason}”</Text> : null}
        </Card>
      ))}
      {rows.length === 0 && <Card><Text style={s.cardSub}>No admin activity recorded yet.</Text></Card>}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- bits
function Centered({ children }: { children: React.ReactNode }) {
  return <View style={[s.centered]}>{children}</View>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <View style={s.card}>{children}</View>;
}
function Row2({ items, money0 }: { items: [string, number][]; money0?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.map(([label, v], i) => (
        <View key={label} style={[s.card, { flex: 1 }]}>
          <Text style={s.cardBig}>{money0 && i === 0 ? `$${v.toFixed(0)}` : v}</Text>
          <Text style={s.cardSub}>{label}</Text>
        </View>
      ))}
    </View>
  );
}
function SmallBtn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={[s.smallBtn, danger && { backgroundColor: C.red }]} onPress={onPress}>
      <Text style={s.smallBtnText}>{label}</Text>
    </Pressable>
  );
}
function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={s.menuRow} onPress={onPress}>
      <Text style={s.menuText}>{label}</Text><Text style={{ color: C.muted }}>›</Text>
    </Pressable>
  );
}
function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={{ marginBottom: 10 }}><Text style={{ color: C.green, fontWeight: '700', fontSize: 15 }}>{label}</Text></Pressable>;
}

const s = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 28, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  brand: { fontSize: 20, fontWeight: '800', color: C.green },
  role: { fontSize: 11, fontWeight: '800', color: C.gold, letterSpacing: 0.5 },
  tabbar: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabBtnActive: { borderTopWidth: 2, borderColor: C.green },
  tabText: { fontSize: 13, fontWeight: '600', color: C.muted },
  tabTextActive: { color: C.green, fontWeight: '800' },
  h2: { fontSize: 15, fontWeight: '800', color: C.green, marginTop: 14, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  h3: { fontSize: 13, fontWeight: '800', color: C.mid, marginTop: 12, marginBottom: 6 },
  card: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  cardBig: { fontSize: 22, fontWeight: '800', color: C.green },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.green },
  cardSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  cardText: { fontSize: 13.5, color: C.mid, marginTop: 4 },
  mono: { fontSize: 11, color: C.muted, marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  stamp: { fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 14 },
  input: {
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.green, width: '100%', marginBottom: 10, minWidth: 260,
  },
  btn: { backgroundColor: C.green, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28, marginTop: 6 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  smallBtn: { backgroundColor: C.green, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginTop: 8 },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  menuRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: C.border,
  },
  menuText: { fontSize: 15, fontWeight: '700', color: C.green },
  signTitle: { fontSize: 26, fontWeight: '800', color: C.green },
  deniedEmoji: { fontSize: 40 },
  deniedTitle: { fontSize: 18, fontWeight: '800', color: C.green, textAlign: 'center' },
  deniedSub: { fontSize: 13.5, color: C.muted, textAlign: 'center', lineHeight: 19 },
});
