// GNOME ADMIN — the internal operating app. Same Supabase backend and auth
// identities as consumer Gnome; a normal user who signs in here hits the
// admin_me() gate and sees "You don't have access" — no privileged data ever
// loads client-side because every read/mutation below is RLS/permission-
// checked server-side (admin_has_perm / audited RPCs). No service keys here.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable,
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
type Tab = 'home' | 'fulfill' | 'ai' | 'more';

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
        {tab === 'fulfill' && <Fulfill can={can} />}
        {tab === 'ai' && <AiHQ can={can} />}
        {tab === 'more' && <More can={can} isOwner={admin.is_owner} />}
      </View>
      <View style={s.tabbar}>
        {([['home', '🏠 Home'], ['fulfill', '📦 Fulfill'], ['ai', '🤖 AI HQ'], ['more', '☰ More']] as [Tab, string][]).map(([t, label]) => (
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
  const [reads, setReads] = useState<boolean | null>(null);
  const [usageToday, setUsageToday] = useState<{ cents: number; actualCents: number; fails: number } | null>(null);
  const [providers, setProviders] = useState<{ stats: any; health: any } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [room, setRoom] = useState<any | null>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [{ data: r }, { data: a }, { data: st }, { data: rm }, { data: usage }, { data: pstats }, health] = await Promise.all([
      supabase.from('ai_action_requests').select('*').order('requested_at', { ascending: false }).limit(30),
      supabase.from('ai_agents').select('*').order('id'),
      supabase.from('ai_settings').select('writes_paused, reads_enabled, allow_paid_fallback').limit(1).maybeSingle(),
      supabase.from('ai_rooms').select('*').eq('status', 'active').order('updated_at', { ascending: false }).limit(12),
      supabase.from('ai_usage_log').select('estimated_cost_cents, actual_cost_cents, success').gte('created_at', since.toISOString()).limit(400),
      supabase.rpc('admin_ai_provider_stats'),
      supabase.functions.invoke('ai-health', { body: {} }).then((x) => x.data).catch(() => null),
    ]);
    setReqs(r ?? []); setAgents(a ?? []);
    setPaused(st?.writes_paused ?? null); setReads(st?.reads_enabled ?? null);
    setRooms(rm ?? []);
    setProviders({ stats: (pstats as any) ?? {}, health });
    const rows = (usage ?? []) as any[];
    setUsageToday({
      cents: rows.reduce((t, x) => t + Number(x.estimated_cost_cents ?? 0), 0),
      actualCents: rows.reduce((t, x) => t + Number(x.actual_cost_cents ?? 0), 0),
      fails: rows.filter((x) => x.success === false).length,
    });
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
  const toggleReads = async (v: boolean) => {
    const { error } = await supabase.rpc('admin_set_ai_reads', { p_enabled: v });
    if (error) Alert.alert('Failed', error.message); else setReads(v);
  };
  const openChat = async (agentId: string, agentName: string) => {
    // 1:1 = a room with exactly one agent; reuse an existing one when present.
    const existing = rooms.find((r) => (r.agent_ids ?? []).length === 1 && r.agent_ids[0] === agentId);
    if (existing) { setRoom(existing); return; }
    const { data: uid } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('ai_rooms')
      .insert({ title: agentName, agent_ids: [agentId], created_by: uid.user?.id })
      .select('*').single();
    if (error) Alert.alert('Failed', error.message); else { setRoom(data); void load(); }
  };

  if (room) return <RoomView room={room} back={() => { setRoom(null); void load(); }} agents={agents} />;
  if (composing) {
    return <NewBoardroom agents={agents.filter((a) => a.status !== 'disabled')}
      back={() => setComposing(false)}
      created={(r) => { setComposing(false); setRoom(r); void load(); }} />;
  }

  const pending = reqs.filter((r) => r.status === 'PENDING');
  const approved = reqs.filter((r) => r.status === 'APPROVED');
  const enabledAgents = agents.filter((a) => a.status !== 'disabled');

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardBig}>{paused ? 'AI actions paused 🔒' : 'AI actions enabled'}</Text>
            <Text style={s.cardSub}>Kill switch for AI-initiated changes (approve/execute). Server-enforced.</Text>
          </View>
          {can('ai.pause_actions') && paused != null && (
            <Switch value={!paused} onValueChange={(v) => void togglePause(!v)} trackColor={{ true: C.green }} />
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{reads === false ? 'AI features paused 🔒' : 'AI features on'}</Text>
            <Text style={s.cardSub}>Emergency stop for paid AI calls — Listing Assistant & Boardroom.</Text>
          </View>
          {can('ai.kill_switch') && reads != null && (
            <Switch value={reads !== false} onValueChange={(v) => void toggleReads(v)} trackColor={{ true: C.green }} />
          )}
        </View>
        {providers && (
          <View style={{ marginTop: 8 }}>
            {(() => {
              const h = providers.health?.providers ?? {};
              const st = providers.stats ?? {};
              const line = (name: string, key: string) => {
                const cfg = h[key]?.configured;
                const ps = st[key];
                const ok = ps?.last_success ? ` · last ok ${String(ps.last_success).slice(5, 16).replace('T', ' ')}` : '';
                const bad = ps?.fails_today > 0 ? ` · ⚠️ ${ps.fails_today} fail${ps.fails_today === 1 ? '' : 's'} today` : '';
                return `${name}: ${cfg === undefined ? '…' : cfg ? 'configured' : 'not configured'}${cfg ? ok + bad : ''}`;
              };
              const hq = providers.health?.hq;
              return (
                <>
                  <Text style={s.cardSub}>{line('Gemini (primary, free tier)', 'gemini')}</Text>
                  <Text style={s.cardSub}>{line('OpenAI', 'openai')}</Text>
                  <Text style={s.cardSub}>{line('Anthropic', 'anthropic')}</Text>
                  {hq && <Text style={s.cardSub}>Gnome HQ runs on {hq.provider}/{hq.model}</Text>}
                  <Text style={s.cardSub}>
                    Paid fallback {providers.health?.settings?.allow_paid_fallback ? 'ON' : 'OFF'}
                    {usageToday ? ` · today actual ${money(usageToday.actualCents)} · paid-equivalent ${money(usageToday.cents)}` : ''}
                  </Text>
                </>
              );
            })()}
          </View>
        )}
      </Card>

      <Text style={s.h2}>Boardroom</Text>
      <Card>
        <Text style={s.cardSub}>Talk to one agent, or put several in a room. Bounded discussion, HQ synthesis. Chat can’t change production — actions still go through approvals.</Text>
        <SmallBtn label="🏛 New Boardroom" onPress={() => setComposing(true)} />
      </Card>
      {rooms.map((r) => (
        <Pressable key={r.id} onPress={() => setRoom(r)}>
          <Card>
            <Text style={s.cardTitle}>{(r.agent_ids ?? []).length > 1 ? '🏛' : '💬'} {r.title}</Text>
            <Text style={s.cardSub}>{(r.agent_ids ?? []).join(', ')} · {String(r.updated_at).slice(0, 16).replace('T', ' ')}</Text>
          </Card>
        </Pressable>
      ))}

      <Text style={s.h2}>Agents — tap to chat</Text>
      {enabledAgents.map((a) => (
        <Pressable key={a.id} onPress={() => void openChat(a.id, a.name)}>
          <Card>
            <Text style={s.cardTitle}>💬 {a.name}</Text>
            <Text style={s.cardSub}>{a.status} · L{a.automation_level} · budget {money(a.daily_budget_cents)}/day</Text>
          </Card>
        </Pressable>
      ))}

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

      {agents.some((a) => a.status === 'disabled') && (
        <Card>
          <Text style={s.cardSub}>
            Not yet enabled: {agents.filter((a) => a.status === 'disabled').map((a) => a.name).join(', ')}
          </Text>
        </Card>
      )}

      <Text style={s.h2}>Handled</Text>
      {reqs.filter((r) => ['EXECUTED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(r.status)).slice(0, 10).map((r) => (
        <Card key={r.id}><Text style={s.cardSub}>{r.status} · {r.human_summary}</Text></Card>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- More (Users / Entitlements / Team / Audit)
type MoreView = 'menu' | 'users' | 'team' | 'audit' | 'inventory' | 'commercial' | 'seasons' | 'listings' | 'markets' | 'moderation' | 'support' | 'stripe';
function More({ can, isOwner }: { can: (p: string) => boolean; isOwner: boolean }) {
  const [view, setView] = useState<MoreView>('menu');
  if (view === 'users') return <Users back={() => setView('menu')} can={can} />;
  if (view === 'team') return <Team back={() => setView('menu')} can={can} isOwner={isOwner} />;
  if (view === 'audit') return <Audit back={() => setView('menu')} />;
  if (view === 'inventory') return <Inventory back={() => setView('menu')} can={can} />;
  if (view === 'commercial') return <Commercial back={() => setView('menu')} can={can} />;
  if (view === 'seasons') return <Seasons back={() => setView('menu')} can={can} />;
  if (view === 'listings') return <Listings back={() => setView('menu')} can={can} />;
  if (view === 'markets') return <Markets back={() => setView('menu')} />;
  if (view === 'moderation') return <Moderation back={() => setView('menu')} can={can} isOwner={isOwner} />;
  if (view === 'support') return <Support back={() => setView('menu')} can={can} />;
  if (view === 'stripe') return <BillingHealth back={() => setView('menu')} isOwner={isOwner} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {can('subscriptions.view') && <MenuRow label="💰 Revenue & Promotions" onPress={() => setView('commercial')} />}
      {can('seed_drop.view') && <MenuRow label="🌦 Seed Drop Seasons" onPress={() => setView('seasons')} />}
      {can('inventory.view') && <MenuRow label="🌱 Inventory" onPress={() => setView('inventory')} />}
      {can('listings.view') && <MenuRow label="🏷 Listings" onPress={() => setView('listings')} />}
      {can('listings.moderate') && <MenuRow label="⚖️ Moderation Queue" onPress={() => setView('moderation')} />}
      {can('markets.view') && <MenuRow label="🏡 Markets" onPress={() => setView('markets')} />}
      {can('support.view') && <MenuRow label="🚩 Support & Reports" onPress={() => setView('support')} />}
      {can('users.view') && <MenuRow label="👥 Users & Entitlements" onPress={() => setView('users')} />}
      {can('subscriptions.view') && <MenuRow label="💳 Billing Health" onPress={() => setView('stripe')} />}
      {can('admins.view') && <MenuRow label="🛡 Admin Team" onPress={() => setView('team')} />}
      <MenuRow label="📜 Audit Log" onPress={() => setView('audit')} />
      <Card>
        <Text style={s.cardSub}>
          Seed Drop fulfillment lives in the 📦 Fulfill tab. AI agents can propose
          actions in the Boardroom — they land in AI HQ for your one-tap approval.
        </Text>
      </Card>
      <Pressable style={[s.btn, { marginTop: 20 }]} onPress={() => supabase.auth.signOut()}>
        <Text style={s.btnText}>Sign out</Text>
      </Pressable>
      {isOwner && <Text style={s.stamp}>Signed in as OWNER — the highest-risk actions require this role.</Text>}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- Listings moderation
function Listings({ back, can }: { back: () => void; can: (p: string) => boolean }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_listings_search', { p_q: q || null, p_status: filter });
    setRows((data as any[]) ?? []);
  }, [q, filter]);
  useEffect(() => { void load(); }, [load]);
  const moderate = (l: any, status: 'paused' | 'active') => {
    Alert.alert(status === 'paused' ? 'Pause this listing?' : 'Restore this listing?', l.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: status === 'paused' ? 'Pause' : 'Restore', style: status === 'paused' ? 'destructive' : 'default', onPress: async () => {
        const { error } = await supabase.rpc('admin_set_listing_status', { p_listing: l.id, p_status: status, p_reason: 'Moderated from Gnome Admin' });
        if (error) Alert.alert('Failed', error.message); else void load();
      } },
    ]);
  };
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <BackRow label="← More" onPress={back} />
      <TextInput style={s.input} placeholder="Search listings by title…" value={q} onChangeText={setQ}
        onSubmitEditing={load} returnKeyType="search" placeholderTextColor={C.muted} autoCapitalize="none" />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        {([['All', null], ['Active', 'active'], ['Paused', 'paused']] as [string, string | null][]).map(([label, v]) => (
          <Pressable key={label} onPress={() => setFilter(v)} style={[s.chip, filter === v && s.chipActive]}>
            <Text style={[s.chipText, filter === v && s.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <Card>
            <Text style={s.cardTitle}>{item.title}{item.is_featured ? ' ✨' : ''}{item.open_reports > 0 ? `  🚩${item.open_reports}` : ''}</Text>
            <Text style={s.cardSub}>{item.market ?? item.owner} · {item.listing_type} · {item.status} · {String(item.created_at).slice(0, 10)}</Text>
            {can('listings.pause') && item.status === 'active' && <SmallBtn label="Pause" danger onPress={() => moderate(item, 'paused')} />}
            {can('listings.restore') && item.status === 'paused' && <SmallBtn label="Restore" onPress={() => moderate(item, 'active')} />}
          </Card>
        )}
        ListEmptyComponent={<Text style={s.cardSub}>No listings match.</Text>}
      />
    </View>
  );
}

// ---------------------------------------------------------------- Markets
function Markets({ back }: { back: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.rpc('admin_markets_overview');
    setRows((data as any[]) ?? []); setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <BackRow label="← More" onPress={back} />
      <Text style={s.h2}>Markets ({rows.length})</Text>
      {rows.map((m) => (
        <Card key={m.id}>
          <Text style={s.cardTitle}>{m.name}</Text>
          <Text style={s.cardSub}>{m.owner ?? ''} · {m.plan} ({m.source}) · {m.active_listings} active · {m.status}</Text>
        </Card>
      ))}
      {rows.length === 0 && <Card><Text style={s.cardSub}>No markets yet.</Text></Card>}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- Support & Reports
function Support({ back, can }: { back: () => void; can: (p: string) => boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.from('reports').select('*').is('resolved_at', null).order('created_at', { ascending: false }).limit(50);
    setRows((data as any[]) ?? []); setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const resolve = (r: any) => {
    Alert.alert('Resolve this report?', r.reason ?? r.target_type, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resolve', onPress: async () => {
        const { error } = await supabase.rpc('admin_resolve_report', { p_report: r.id, p_note: 'Resolved from Gnome Admin' });
        if (error) Alert.alert('Failed', error.message); else void load();
      } },
    ]);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <BackRow label="← More" onPress={back} />
      <Text style={s.h2}>Open reports ({rows.length})</Text>
      {rows.map((r) => (
        <Card key={r.id}>
          <Text style={s.cardTitle}>{r.target_type} report</Text>
          <Text style={s.cardSub}>{r.reason ?? '—'} · {String(r.created_at).slice(0, 16).replace('T', ' ')}</Text>
          {can('support.resolve') && <SmallBtn label="Resolve" onPress={() => resolve(r)} />}
        </Card>
      ))}
      {rows.length === 0 && <Card><Text style={s.cardBig}>All clear 🎉</Text><Text style={s.cardSub}>No open reports.</Text></Card>}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- Billing Health
function BillingHealth({ back, isOwner }: { back: () => void; isOwner: boolean }) {
  const [h, setH] = useState<any | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.rpc('admin_billing_health');
    setH(data as any); setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const live = h?.payments_live_enabled === true;
  const products: any[] = h?.products ?? [];
  const testMissing = products.filter((p) => p.active && !p.test_ready);
  const toggleLive = (v: boolean) => {
    Alert.alert(
      v ? 'Enable LIVE payments?' : 'Disable live payments',
      v ? 'This lets Gnome create REAL Stripe charges. Only do this after reviewing test-mode QA and confirming live prices + webhook are set. Owner action, audited.'
        : 'Gnome returns to test mode. No live charges will be created.',
      [{ text: 'Cancel', style: 'cancel' },
       { text: v ? 'Enable live' : 'Disable', style: v ? 'destructive' : 'default', onPress: async () => {
         const { error } = await supabase.rpc('admin_set_payments_live', { p_enabled: v });
         if (error) Alert.alert('Failed', error.message); else void load();
       } }]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <BackRow label="← More" onPress={back} />
      <Card>
        <Text style={s.cardBig}>{live ? 'LIVE payments ON 🔴' : 'Test mode 🧪'}</Text>
        <Text style={s.cardSub}>
          {live ? 'Gnome is creating real Stripe charges.' : 'Gnome creates Stripe TEST charges only — no real money moves. Live payments stay OFF until you enable them.'}
        </Text>
        {isOwner && h?.payments_live_enabled != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={s.cardTitle}>Payments Live</Text>
            <Switch value={live} onValueChange={toggleLive} trackColor={{ true: C.red }} />
          </View>
        )}
      </Card>

      <Text style={s.h2}>Product mapping</Text>
      {products.map((p) => (
        <Card key={p.key}>
          <Text style={s.cardTitle}>{p.test_ready ? '🧪✅' : p.active ? '🧪⬜️' : '💤'} {p.key}</Text>
          <Text style={s.cardSub}>
            {p.description} · {p.unit_amount_cents ? money(p.unit_amount_cents) : 'variable'}
            {'  ·  '}test: {p.test_ready ? 'READY' : 'MISSING PRICE'} · live: {p.live_ready ? 'READY' : 'not set'}
          </Text>
        </Card>
      ))}
      <Card>
        <Text style={s.cardSub}>
          {testMissing.length === 0
            ? 'All active products have a test price — run the test-mode QA matrix.'
            : `${testMissing.length} active product${testMissing.length === 1 ? '' : 's'} need a TEST price before test checkout works.`}
        </Text>
      </Card>

      <Text style={s.h2}>Events</Text>
      <Card>
        <Text style={s.cardSub}>Last Stripe event: {h?.last_event ? `${h.last_event.type} · ${h.last_event.livemode ? 'live' : 'test'} · ${String(h.last_event.at).slice(0, 16).replace('T', ' ')}` : '— none yet'}</Text>
        <Text style={s.cardSub}>Last test payment: {h?.last_test_payment ? `${money(h.last_test_payment.amount_cents)} · ${String(h.last_test_payment.at).slice(0, 16).replace('T', ' ')}` : '— none'}</Text>
        <Text style={s.cardSub}>Last live payment: {h?.last_live_payment ? `${money(h.last_live_payment.amount_cents)} · ${String(h.last_live_payment.at).slice(0, 16).replace('T', ' ')}` : '— none (good, pre-launch)'}</Text>
        <Text style={s.cardSub}>Events 30d: {h?.events_test_30d ?? 0} test · {h?.events_live_30d ?? 0} live</Text>
      </Card>
    </ScrollView>
  );
}

function Users({ back, can }: { back: () => void; can: (p: string) => boolean }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [ent, setEnt] = useState<any | null>(null);
  const [mkt, setMkt] = useState<any | null>(null);
  const [promo, setPromo] = useState<any | null>(null);

  const search = async () => {
    const { data } = await supabase.from('profiles')
      .select('id,name,city,state,user_type,suspended,created_at')
      .ilike('name', `%${q}%`).limit(20);
    setRows(data ?? []); setSel(null);
  };
  const open = async (p: any) => {
    setSel(p); setEnt(null); setMkt(null); setPromo(null);
    const { data: m } = await supabase.from('markets').select('id,name,plan').eq('owner_id', p.id).limit(1).maybeSingle();
    setMkt(m);
    if (m) {
      const [{ data: e }, { data: ps }] = await Promise.all([
        supabase.rpc('admin_market_entitlements', { p_market: m.id }),
        supabase.rpc('market_promotion_status', { p_market: m.id }),
      ]);
      setEnt(e); setPromo(ps as any);
    }
  };
  const grantPromoCredits = () => {
    if (!mkt) return;
    Alert.alert('Grant 3 promotion credits?', 'Complimentary purchased-style credits (never expire at monthly reset). Audited.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Grant', onPress: async () => {
        const { error } = await supabase.rpc('admin_grant_promo_credits', { p_market: mkt.id, p_qty: 3, p_reason: 'Admin comp from Gnome Admin' });
        if (error) Alert.alert('Failed', error.message); else void open(sel);
      } },
    ]);
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
            {promo && (
              <Text style={s.cardSub}>
                Promotions: {promo.included_remaining} of {promo.included_allowance} included left · resets {String(promo.resets_on).slice(5)}
                {promo.purchased_balance > 0 ? ` · ${promo.purchased_balance} purchased banked` : ''}
                {(promo.active?.length ?? 0) > 0 ? ` · ${promo.active.length} active now` : ''}
              </Text>
            )}
            {can('promotions.grant') && (
              <SmallBtn label="Grant 3 promo credits" onPress={grantPromoCredits} />
            )}
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

// ---------------------------------------------------------------- Admin team
// Who can open this console. An invitation is a row with an email and no account
// yet; it becomes a member when that person signs in and accepts. Invitee names
// and emails live on this screen and nowhere else — they are never logged.
type TeamMember = {
  id: string; user_id: string | null; display_name: string | null; email: string | null;
  role: string; status: string; invite_state: 'active' | 'pending' | 'expired' | 'revoked';
  created_at: string; invite_expires_at: string | null; revoked_at: string | null;
  is_last_owner: boolean;
};

function Team({ back, can, isOwner }: {
  back: () => void; can: (p: string) => boolean; isOwner: boolean;
}) {
  const [rows, setRows] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<{ role: string; label: string }[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [err, setErr] = useState<ServerError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The server gate is `admin_is_owner() or admin_has_perm('admin.manage')`.
  // This mirrors it to hide chrome only — every RPC re-checks it.
  const canManage = can('admin.manage');

  const load = useCallback(async () => {
    setRefreshing(true);
    const [r, ro, au] = await Promise.all([
      supabase.rpc('admin_team_roster'),
      supabase.rpc('admin_team_roles'),
      supabase.rpc('admin_team_audit', { p_limit: 30 }),
    ]);
    const failed = r.error ?? ro.error ?? au.error;
    setErr(failed ? serverError(failed) : null);
    setRows((r.data as TeamMember[]) ?? []);
    setRoles((ro.data as { role: string; label: string }[]) ?? []);
    setAudit((au.data as any[]) ?? []);
    setLoaded(true); setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const roleLabel = (r: string) => roles.find((x) => x.role === r)?.label ?? r;
  const who = (m: TeamMember) => m.display_name || m.email || m.id.slice(0, 8);
  const expiry = (iso: string | null) => {
    if (!iso) return 'no expiry set';
    const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5);
    const on = String(iso).slice(0, 10);
    if (days < 0) return `expired ${on}`;
    if (days === 0) return `expires today (${on})`;
    return `expires in ${days} day${days === 1 ? '' : 's'} (${on})`;
  };
  const group = (state: TeamMember['invite_state']) => rows.filter((m) => m.invite_state === state);

  const invite = async () => {
    if (!role || !email.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_invite_teammate',
      { p_email: email.trim(), p_name: name.trim() || null, p_role: role });
    setBusy(false);
    if (error) { setErr(serverError(error)); setNotice(null); return; }
    setErr(null); setEmail(''); setName(''); setRole(null);
    setNotice('Invitation created. It waits under “Invitations waiting” until they sign in to Gnome Admin and accept it.');
    void load();
  };
  const changeRole = (m: TeamMember, next: string) => {
    Alert.alert('Change this role?',
      `${who(m)} becomes ${roleLabel(next)}. What they can do changes the moment they reload. Audited.`,
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Change role', onPress: async () => {
         setBusy(true);
         const { error } = await supabase.rpc('admin_set_teammate_role',
           { p_admin: m.id, p_role: next, p_reason: 'Role changed from Gnome Admin' });
         setBusy(false);
         if (error) { setErr(serverError(error)); setNotice(null); }
         else { setErr(null); setNotice(`${who(m)} is now ${roleLabel(next)}.`); setEditing(null); }
         void load();
       } }]);
  };
  const remove = (m: TeamMember) => {
    const isInvite = m.invite_state === 'pending' || m.invite_state === 'expired';
    Alert.alert(
      isInvite ? 'Revoke this invitation?' : 'Remove from the team?',
      isInvite
        ? `${who(m)} will not be able to accept it. You can send a new invitation any time.`
        : `${who(m)} loses access to Gnome Admin immediately. Their ordinary Gnome account is untouched.`,
      [{ text: 'Cancel', style: 'cancel' },
       { text: isInvite ? 'Revoke' : 'Remove', style: 'destructive', onPress: async () => {
         setBusy(true);
         const { error } = await supabase.rpc('admin_remove_teammate',
           { p_admin: m.id, p_reason: isInvite ? 'Invitation revoked from Gnome Admin' : 'Removed from Gnome Admin' });
         setBusy(false);
         if (error) { setErr(serverError(error)); setNotice(null); }
         else { setErr(null); setNotice(isInvite ? 'Invitation revoked.' : `${who(m)} no longer has access.`); }
         void load();
       } }]);
  };

  const memberCard = (m: TeamMember) => {
    const isInvite = m.invite_state === 'pending' || m.invite_state === 'expired';
    return (
      <Card key={m.id}>
        <Text style={s.cardTitle}>{who(m)}</Text>
        <Text style={s.cardSub}>
          {roleLabel(m.role)}
          {m.invite_state === 'active' ? ` · on the team since ${String(m.created_at).slice(0, 10)}` : ''}
          {m.invite_state === 'pending' ? ` · invited ${String(m.created_at).slice(0, 10)} · ${expiry(m.invite_expires_at)}` : ''}
          {m.invite_state === 'expired' ? ` · invited ${String(m.created_at).slice(0, 10)} · ${expiry(m.invite_expires_at)}` : ''}
          {m.invite_state === 'revoked' ? ` · removed ${String(m.revoked_at ?? m.created_at).slice(0, 10)}` : ''}
        </Text>
        {m.invite_state === 'active' && m.status !== 'active' && (
          <Text style={[s.cardSub, { color: C.gold }]}>Account status: {m.status}</Text>
        )}
        {m.invite_state === 'expired' && (
          <Text style={s.cardSub}>They never accepted in time. Send a fresh invitation — the old one can’t be revived.</Text>
        )}
        {m.is_last_owner && (
          <Text style={[s.cardSub, { color: C.gold }]}>
            Gnome needs at least one owner, so this account can’t be removed or moved to another role. Make someone else an owner first.
          </Text>
        )}
        {canManage && m.invite_state !== 'revoked' && (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {m.invite_state === 'active' && (
              <SmallBtn label={editing === m.id ? 'Close' : 'Change role'} disabled={busy || m.is_last_owner}
                onPress={() => setEditing(editing === m.id ? null : m.id)} />
            )}
            {m.invite_state === 'expired' && (
              <SmallBtn label="Invite again" onPress={() => {
                setEmail(m.email ?? ''); setName(m.display_name ?? ''); setRole(m.role); setErr(null);
                setNotice('The invite form at the bottom is filled in — check the role, then send.');
              }} />
            )}
            <SmallBtn label={isInvite ? 'Revoke invitation' : 'Remove'} danger
              disabled={busy || m.is_last_owner} onPress={() => remove(m)} />
          </View>
        )}
        {editing === m.id && !m.is_last_owner && (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {roles.map((o) => (
              <Pressable key={o.role} disabled={busy || o.role === m.role}
                onPress={() => changeRole(m, o.role)}
                style={[s.chip, o.role === m.role && s.chipActive]}>
                <Text style={[s.chipText, o.role === m.role && s.chipTextActive]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>
    );
  };

  const active = group('active');
  const pending = group('pending');
  const expired = group('expired');
  const revoked = group('revoked');

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <BackRow label="← More" onPress={back} />
      {err && <ErrorCard e={err} />}
      {notice && (
        <Card>
          <Text style={s.cardTitle}>✅ {notice}</Text>
          <Pressable onPress={() => setNotice(null)}><Text style={s.cardSub}>Dismiss</Text></Pressable>
        </Card>
      )}
      {!loaded && <Card><Text style={s.cardSub}>Loading the team…</Text></Card>}

      <Text style={s.h2}>On the team ({active.length})</Text>
      {loaded && active.length === 0 && <Card><Text style={s.cardSub}>Nobody has accepted yet.</Text></Card>}
      {active.map(memberCard)}

      {pending.length > 0 && (
        <>
          <Text style={s.h2}>Invitations waiting ({pending.length})</Text>
          {pending.map(memberCard)}
        </>
      )}
      {expired.length > 0 && (
        <>
          <Text style={s.h2}>Expired invitations ({expired.length})</Text>
          {expired.map(memberCard)}
        </>
      )}
      {revoked.length > 0 && (
        <>
          <Text style={s.h2}>Removed ({revoked.length})</Text>
          {revoked.map(memberCard)}
        </>
      )}

      {canManage && (
        <>
          <Text style={s.h2}>Invite a teammate</Text>
          <Card>
            <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="Work email"
              autoCapitalize="none" keyboardType="email-address" placeholderTextColor={C.muted} />
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Name (optional)"
              placeholderTextColor={C.muted} />
            <Text style={s.h3}>Role</Text>
            {roles.length === 0 && <Text style={s.cardSub}>No roles came back from the server — pull to refresh.</Text>}
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {roles.map((o) => (
                <Pressable key={o.role} onPress={() => setRole(o.role)} style={[s.chip, role === o.role && s.chipActive]}>
                  <Text style={[s.chipText, role === o.role && s.chipTextActive]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            <SmallBtn label="Send invitation" disabled={busy || !email.trim() || !role} onPress={() => void invite()} />
            <Text style={s.cardSub}>
              They get access when they sign in to Gnome Admin with this email and accept. Until then the invitation grants nothing.
              {isOwner ? '' : ' Only an owner can invite another owner.'}
            </Text>
          </Card>
        </>
      )}

      <Text style={s.h2}>Team history</Text>
      {audit.length === 0 && <Card><Text style={s.cardSub}>No team changes recorded yet.</Text></Card>}
      {audit.map((a, i) => (
        <Card key={i}>
          <Text style={s.cardTitle}>{a.action}</Text>
          <Text style={s.cardSub}>
            {a.target ? `${a.target} · ` : ''}{a.actor_type} · {String(a.at ?? '').slice(0, 16).replace('T', ' ')}
          </Text>
          {a.reason ? <Text style={s.cardText}>“{a.reason}”</Text> : null}
        </Card>
      ))}
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

// ---------------------------------------------------------------- Boardroom
const ROOM_PRESETS: { title: string; agents: string[] }[] = [
  { title: 'Daily Standup', agents: ['gnome_hq', 'operations', 'inventory', 'seeds'] },
  { title: 'Growth Council', agents: ['gnome_hq', 'operations', 'security'] },
  { title: 'Seed Drop Ops', agents: ['inventory', 'seeds'] },
];

function NewBoardroom({ agents, back, created }: {
  agents: any[]; back: () => void; created: (room: any) => void;
}) {
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : (p.length < 5 ? [...p, id] : p));
  const create = async (t: string, ids: string[]) => {
    if (!ids.length) { Alert.alert('Pick at least one agent'); return; }
    const { data: uid } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('ai_rooms')
      .insert({ title: t || ids.join(' + '), agent_ids: ids, created_by: uid.user?.id })
      .select('*').single();
    if (error) Alert.alert('Failed', error.message); else created(data);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <BackRow label="← AI HQ" onPress={back} />
      <Text style={s.h2}>New Boardroom</Text>
      <Text style={s.cardSub}>Up to 5 agents. They answer you and can push back on each other for one bounded round; HQ wraps it up. Being in a room never expands what an agent may do.</Text>
      {ROOM_PRESETS.map((p) => (
        <Pressable key={p.title} onPress={() => void create(p.title, p.agents.filter((id) => agents.some((a) => a.id === id)))}>
          <Card><Text style={s.cardTitle}>⚡ {p.title}</Text><Text style={s.cardSub}>{p.agents.join(', ')}</Text></Card>
        </Pressable>
      ))}
      <Text style={s.h3}>Or build your own</Text>
      <TextInput style={s.input} placeholder="Room name (optional)" value={title} onChangeText={setTitle} placeholderTextColor={C.muted} />
      {agents.map((a) => (
        <Pressable key={a.id} onPress={() => toggle(a.id)}>
          <Card>
            <Text style={s.cardTitle}>{picked.includes(a.id) ? '☑' : '☐'} {a.name}</Text>
          </Card>
        </Pressable>
      ))}
      <Pressable style={s.btn} onPress={() => void create(title, picked)}>
        <Text style={s.btnText}>Open room ({picked.length})</Text>
      </Pressable>
    </ScrollView>
  );
}

function RoomView({ room, back, agents }: { room: any; back: () => void; agents: any[] }) {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const agentName = (id?: string | null) => agents.find((a) => a.id === id)?.name ?? id ?? 'Gnome';

  const load = useCallback(async () => {
    const { data } = await supabase.from('ai_room_messages')
      .select('*').eq('room_id', room.id).order('id', { ascending: true }).limit(200);
    setMsgs(data ?? []);
  }, [room.id]);
  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setDraft('');
    setMsgs((m) => [...m, { id: 'local', sender_type: 'admin', content: text }]);
    const { data, error } = await supabase.functions.invoke('boardroom', {
      body: { room_id: room.id, message: text },
    });
    if (error || data?.error) {
      Alert.alert('Boardroom', data?.message ?? data?.detail ?? error?.message ?? 'Failed');
    }
    await load();
    setSending(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={{ flex: 1, padding: 16 }}>
        <BackRow label={`← ${room.title}`} onPress={back} />
        <FlatList
          data={msgs}
          keyExtractor={(m, i) => String(m.id ?? i)}
          renderItem={({ item }) => (
            <View style={[s.bubble, item.sender_type === 'admin' ? s.bubbleMe : item.sender_type === 'system' ? s.bubbleSys : s.bubbleAgent]}>
              {item.sender_type === 'agent' && <Text style={s.bubbleWho}>{agentName(item.sender_agent_id)}</Text>}
              <Text style={item.sender_type === 'admin' ? s.bubbleTextMe : s.bubbleText}>{item.content}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={s.cardSub}>Ask anything — agents answer with real Gnome numbers.</Text>}
        />
        {sending && <Text style={s.cardSub}>The room is thinking…</Text>}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <TextInput style={[s.input, { flex: 1, marginBottom: 0, minWidth: 0 }]} placeholder="Message the room…"
            value={draft} onChangeText={setDraft} multiline placeholderTextColor={C.muted} />
          <Pressable style={[s.btn, { marginTop: 0, opacity: sending ? 0.5 : 1 }]} onPress={() => void send()} disabled={sending}>
            <Text style={s.btnText}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------- Seed Drop fulfillment
function Fulfill({ can }: { can: (p: string) => boolean }) {
  const [queue, setQueue] = useState<any[]>([]);
  const [order, setOrder] = useState<any | null>(null);
  const [picking, setPicking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lane, setLane] = useState<'review' | 'pick' | 'packed' | 'shipped'>('pick');

  const load = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase.rpc('admin_seed_queue');
    if (error) Alert.alert('Failed', error.message);
    setQueue((data as any[]) ?? []);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!can('seed_drop.view')) {
    return <Centered><Text style={s.deniedTitle}>Seed Drop access not enabled for your role.</Text></Centered>;
  }

  const lanes: Record<string, any[]> = {
    review: queue.filter((o) => o.status === 'needs_review'),
    pick: queue.filter((o) => ['paid', 'selected'].includes(o.status)),
    packed: queue.filter((o) => o.status === 'packed'),
    shipped: queue.filter((o) => o.status === 'shipped'),
  };

  const refreshOrder = async (id: string) => {
    const { data } = await supabase.rpc('admin_seed_queue');
    const q = (data as any[]) ?? [];
    setQueue(q);
    const fresh = q.find((o) => o.id === id);
    if (fresh) setOrder(fresh); else { setOrder(null); setPicking(false); }
  };
  const pick = async (itemId: string) => {
    const { error } = await supabase.rpc('admin_pick_seed_item', { p_item: itemId });
    if (error) Alert.alert('Pick failed', error.message); else await refreshOrder(order.id);
  };
  const pack = () => {
    const unpicked = (order.items ?? []).filter((i: any) => i.status === 'reserved').length;
    Alert.alert('Pack this order?', unpicked ? `${unpicked} packet(s) not marked picked — pack anyway?` : 'All packets picked. Seal the envelope.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pack', onPress: async () => {
        const { error } = await supabase.rpc('admin_pack_seed_order',
          { p_order: order.id, p_override_reason: unpicked ? 'packed with unpicked items (owner override)' : null });
        if (error) Alert.alert('Pack failed', error.message); else await refreshOrder(order.id);
      } },
    ]);
  };
  const ship = () => {
    let carrier = 'USPS'; let tracking = '';
    Alert.prompt?.('Ship — tracking number', 'USPS tracking (optional, Enter to skip)', async (t) => {
      tracking = t ?? '';
      const { error } = await supabase.rpc('admin_ship_seed_order', { p_order: order.id, p_carrier: carrier, p_tracking: tracking });
      if (error) Alert.alert('Ship failed', error.message); else await refreshOrder(order.id);
    });
  };

  // ---- Pick Mode: garage-usable, huge type, one hand ----
  if (order && picking) {
    const items = (order.items ?? []) as any[];
    const remaining = items.filter((i) => i.status === 'reserved');
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <BackRow label="← Done picking" onPress={() => setPicking(false)} />
        <Text style={s.h2}>Pick · {order.customer ?? 'order'}</Text>
        {remaining.length === 0 && <Card><Text style={s.cardBig}>All picked ✅</Text></Card>}
        {items.map((i) => (
          <Pressable key={i.id} disabled={i.status !== 'reserved'} onPress={() => void pick(i.id)}>
            <View style={[s.pickCard, i.status !== 'reserved' && { opacity: 0.35 }]}>
              <Text style={s.pickBin}>{i.bin ?? 'no bin'}</Text>
              <Text style={s.pickName}>{i.qty} × {i.crop}{i.variety ? ` — ${i.variety}` : ''}</Text>
              <Text style={s.pickLot}>lot {i.lot ?? '—'}{i.lot_status !== 'fresh' && i.lot_status !== 'active' ? `  ⚠️ ${i.lot_status}` : ''}</Text>
              <Text style={s.pickTap}>{i.status === 'reserved' ? 'TAP WHEN IN HAND' : i.status.toUpperCase()}</Text>
            </View>
          </Pressable>
        ))}
        {remaining.length === 0 && can('seed_drop.pack') && (
          <Pressable style={s.btn} onPress={pack}><Text style={s.btnText}>Pack order →</Text></Pressable>
        )}
      </ScrollView>
    );
  }

  // ---- Order detail ----
  if (order) {
    const shipTo = order.ship ?? order.profile_snapshot?.ship ?? null;
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshOrder(order.id)} tintColor={C.green} />}>
        <BackRow label="← Queue" onPress={() => setOrder(null)} />
        <Card>
          <Text style={s.cardBig}>{order.customer ?? 'Seed Drop order'}</Text>
          <Text style={s.cardSub}>{order.status.toUpperCase()} · {String(order.created_at).slice(0, 10)}{order.tracking ? ` · ${order.tracking}` : ''}</Text>
          {shipTo ? <Text style={s.cardText}>{[shipTo.name, shipTo.address_line, `${shipTo.city ?? ''} ${shipTo.state ?? ''} ${shipTo.postal_code ?? ''}`].filter(Boolean).join('\n')}</Text> : null}
        </Card>
        <Text style={s.h3}>Packets</Text>
        {(order.items ?? []).map((i: any) => (
          <Card key={i.id}>
            <Text style={s.cardTitle}>{i.qty} × {i.crop}{i.variety ? ` — ${i.variety}` : ''}</Text>
            <Text style={s.cardSub}>bin {i.bin ?? '—'} · lot {i.lot ?? '—'} · {i.status}</Text>
          </Card>
        ))}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {['paid', 'selected', 'needs_review'].includes(order.status) && can('seed_drop.pick') && (
            <SmallBtn label="▶ Start Picking" onPress={() => setPicking(true)} />
          )}
          {['paid', 'selected', 'needs_review'].includes(order.status) && can('seed_drop.pack') && (
            <SmallBtn label="Pack" onPress={pack} />
          )}
          {order.status === 'packed' && can('seed_drop.ship') && (
            <SmallBtn label="🚚 Ship" onPress={ship} />
          )}
        </View>
      </ScrollView>
    );
  }

  // ---- Queue ----
  const laneDefs: [typeof lane, string, number][] = [
    ['review', 'Review', lanes.review.length],
    ['pick', 'To pick', lanes.pick.length],
    ['packed', 'Packed', lanes.packed.length],
    ['shipped', 'Shipped', lanes.shipped.length],
  ];
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
        {laneDefs.map(([k, label, count]) => (
          <Pressable key={k} style={[s.lane, lane === k && s.laneActive]} onPress={() => setLane(k)}>
            <Text style={[s.laneText, lane === k && s.laneTextActive]}>{label} {count ? `(${count})` : ''}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={lanes[lane]}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => setOrder(item)}>
            <Card>
              <Text style={s.cardTitle}>{item.customer ?? 'Order'} · {(item.items ?? []).reduce((t: number, i: any) => t + Number(i.qty ?? 0), 0)} packets</Text>
              <Text style={s.cardSub}>{(item.items ?? []).map((i: any) => i.crop).join(', ').slice(0, 70)}</Text>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={<Card><Text style={s.cardSub}>Nothing in this lane. 🌱</Text></Card>}
      />
    </View>
  );
}

// ---------------------------------------------------------------- Inventory
function Inventory({ back, can }: { back: () => void; can: (p: string) => boolean }) {
  const [products, setProducts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [sel, setSel] = useState<any | null>(null);
  const [lots, setLots] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const [{ data: p }, { data: sum }] = await Promise.all([
      supabase.from('seed_products').select('*').order('crop'),
      supabase.rpc('admin_inventory_summary'),
    ]);
    setProducts((p as any[]) ?? []); setSummary(sum);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openItem = async (p: any) => {
    setSel(p);
    const { data } = await supabase.from('seed_lots').select('*')
      .eq('seed_product_id', p.id).order('created_at', { ascending: false });
    setLots((data as any[]) ?? []);
  };

  const lotAction = (lot: any, kind: 'adjust' | 'move' | 'quarantine') => {
    if (kind === 'adjust') {
      Alert.prompt?.('Adjust packets', `${lot.internal_lot_number}: current ${lot.current_qty}. Enter +/- change`, async (v) => {
        const delta = Number(v);
        if (!Number.isFinite(delta) || delta === 0) return;
        const { error } = await supabase.rpc('admin_adjust_lot', { p_lot: lot.id, p_delta: delta, p_reason: 'manual count from Gnome Admin' });
        if (error) Alert.alert('Failed', error.message); else void openItem(sel);
      });
    } else if (kind === 'move') {
      Alert.prompt?.('Move lot', 'New bin / storage location', async (v) => {
        if (!v) return;
        const { error } = await supabase.rpc('admin_move_lot', { p_lot: lot.id, p_storage: v });
        if (error) Alert.alert('Failed', error.message); else void openItem(sel);
      });
    } else {
      const to = lot.status === 'quarantined' ? 'active' : 'quarantined';
      Alert.alert(to === 'quarantined' ? 'Quarantine lot?' : 'Release from quarantine?', lot.internal_lot_number, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: async () => {
          const { error } = await supabase.rpc('admin_set_lot_status', { p_lot: lot.id, p_status: to, p_reason: 'from Gnome Admin' });
          if (error) Alert.alert('Failed', error.message); else void openItem(sel);
        } },
      ]);
    }
  };

  const archiveItem = async (archive: boolean) => {
    const { error } = await supabase.rpc('admin_upsert_seed_product', { p_id: sel.id, p_crop: null, p_variety: null, p_category: null, p_archived: archive });
    if (error) Alert.alert('Failed', error.message);
    else { setSel({ ...sel, archived: archive }); void load(); }
  };
  const deleteItem = () => {
    Alert.alert('Delete this item?', 'Only possible if it has never been received or shipped.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('admin_delete_seed_product', { p_id: sel.id });
        if (error) {
          Alert.alert(error.message.includes('HAS_HISTORY')
            ? 'This item has fulfillment history and can’t be permanently deleted. Archive it instead.'
            : error.message);
        } else { setSel(null); void load(); }
      } },
    ]);
  };

  if (adding) return <InventoryForm back={() => { setAdding(false); void load(); }} />;
  if (receiving && sel) return <ReceiveForm product={sel} back={() => { setReceiving(false); void openItem(sel); }} />;

  if (sel) {
    const available = lots.filter((l) => ['fresh', 'active'].includes(l.status)).reduce((t, l) => t + Number(l.current_qty), 0);
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <BackRow label="← Inventory" onPress={() => setSel(null)} />
        <Card>
          <Text style={s.cardBig}>{sel.crop}{sel.variety ? ` — ${sel.variety}` : ''}{sel.archived ? '  🗄' : ''}</Text>
          <Text style={s.cardSub}>{sel.category} · {sel.sku ?? 'no SKU'} · {sel.packet_size ?? ''} {sel.supplier ? `· ${sel.supplier}` : ''}</Text>
          <Text style={s.cardText}>{available} packets available · reorder at {sel.reorder_threshold ?? 5}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {can('inventory.receive') && <SmallBtn label="＋ Receive stock" onPress={() => setReceiving(true)} />}
            {can('inventory.archive') && <SmallBtn label={sel.archived ? 'Reactivate' : 'Archive'} onPress={() => void archiveItem(!sel.archived)} />}
            {can('inventory.delete_unused') || can('*') ? <SmallBtn label="Delete" danger onPress={deleteItem} /> : null}
          </View>
        </Card>
        <Text style={s.h3}>Lots</Text>
        {lots.length === 0 && <Card><Text style={s.cardSub}>No stock received yet.</Text></Card>}
        {lots.map((l) => (
          <Card key={l.id}>
            <Text style={s.cardTitle}>{l.internal_lot_number} · {l.current_qty}/{l.original_qty} packets</Text>
            <Text style={s.cardSub}>bin {l.storage_location ?? '—'} · {l.status}{l.germination_pct ? ` · germ ${l.germination_pct}%` : ''}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {can('inventory.adjust') && <SmallBtn label="Adjust" onPress={() => lotAction(l, 'adjust')} />}
              {can('inventory.move') && <SmallBtn label="Move" onPress={() => lotAction(l, 'move')} />}
              {can('inventory.quarantine') && <SmallBtn label={l.status === 'quarantined' ? 'Release' : 'Quarantine'} danger={l.status !== 'quarantined'} onPress={() => lotAction(l, 'quarantine')} />}
            </View>
          </Card>
        ))}
      </ScrollView>
    );
  }

  const list = products
    .filter((p) => showArchived || !p.archived)
    .filter((p) => !q || `${p.crop} ${p.variety ?? ''} ${p.sku ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const low = (summary?.low_stock_items as any[]) ?? [];
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <BackRow label="← More" onPress={back} />
      {summary && (
        <Card>
          <Text style={s.cardSub}>
            {summary.skus} items · {low.length} low stock · {summary.quarantined} quarantined · {summary.needs_retest ?? 0} need retest
          </Text>
        </Card>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[s.input, { flex: 1, minWidth: 0 }]} placeholder="Search crop, variety, SKU…" value={q} onChangeText={setQ} placeholderTextColor={C.muted} autoCapitalize="none" />
        {can('inventory.create') && (
          <Pressable style={[s.btn, { marginTop: 0 }]} onPress={() => setAdding(true)}><Text style={s.btnText}>＋</Text></Pressable>
        )}
      </View>
      <Pressable onPress={() => setShowArchived((v) => !v)}>
        <Text style={[s.cardSub, { marginBottom: 8 }]}>{showArchived ? '☑' : '☐'} show archived</Text>
      </Pressable>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => void openItem(item)}>
            <Card>
              <Text style={s.cardTitle}>{item.crop}{item.variety ? ` — ${item.variety}` : ''}{item.archived ? '  🗄' : ''}</Text>
              <Text style={s.cardSub}>{item.category}{item.sku ? ` · ${item.sku}` : ''}{low.some((l) => l.crop === item.crop && l.variety === item.variety) ? '  ⚠️ low' : ''}</Text>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={<Card><Text style={s.cardSub}>No items yet — add your first seed product.</Text></Card>}
      />
    </View>
  );
}

function InventoryForm({ back }: { back: () => void }) {
  const [f, setF] = useState({ crop: '', variety: '', category: 'vegetable', sku: '', supplier: '', packet_size: '', reorder: '' });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.crop.trim()) { Alert.alert('Crop is required'); return; }
    const { error } = await supabase.rpc('admin_upsert_seed_product', {
      p_id: null, p_crop: f.crop.trim(), p_variety: f.variety.trim() || null, p_category: f.category,
      p_sku: f.sku.trim() || null, p_supplier: f.supplier.trim() || null,
      p_packet_size: f.packet_size.trim() || null,
      p_reorder_threshold: f.reorder ? Number(f.reorder) : null,
    });
    if (error) Alert.alert('Failed', error.message); else back();
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <BackRow label="← Inventory" onPress={back} />
      <Text style={s.h2}>New item</Text>
      <TextInput style={s.input} placeholder="Crop (e.g. Tomato)" value={f.crop} onChangeText={(v) => set('crop', v)} placeholderTextColor={C.muted} />
      <TextInput style={s.input} placeholder="Variety (e.g. Cherokee Purple)" value={f.variety} onChangeText={(v) => set('variety', v)} placeholderTextColor={C.muted} />
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {['vegetable', 'herb', 'flower', 'pollinator', 'salad', 'fruit'].map((c) => (
          <Pressable key={c} style={[s.lane, f.category === c && s.laneActive]} onPress={() => set('category', c)}>
            <Text style={[s.laneText, f.category === c && s.laneTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={s.input} placeholder="SKU (optional)" value={f.sku} onChangeText={(v) => set('sku', v)} placeholderTextColor={C.muted} autoCapitalize="characters" />
      <TextInput style={s.input} placeholder="Supplier (optional)" value={f.supplier} onChangeText={(v) => set('supplier', v)} placeholderTextColor={C.muted} />
      <TextInput style={s.input} placeholder="Packet size (e.g. 25 seeds)" value={f.packet_size} onChangeText={(v) => set('packet_size', v)} placeholderTextColor={C.muted} />
      <TextInput style={s.input} placeholder="Reorder threshold (default 5)" value={f.reorder} onChangeText={(v) => set('reorder', v)} keyboardType="number-pad" placeholderTextColor={C.muted} />
      <Pressable style={s.btn} onPress={() => void save()}><Text style={s.btnText}>Create item</Text></Pressable>
    </ScrollView>
  );
}

function ReceiveForm({ product, back }: { product: any; back: () => void }) {
  const [f, setF] = useState({ qty: '', lot: '', supplier: product.supplier ?? '', supplierLot: '', bin: '', germ: '' });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const qty = Number(f.qty);
    if (!Number.isFinite(qty) || qty <= 0) { Alert.alert('Enter packet count'); return; }
    if (!f.lot.trim()) { Alert.alert('Internal lot number required', 'e.g. TOM-CP-2026A'); return; }
    const { error } = await supabase.rpc('admin_receive_lot', {
      p_product: product.id, p_qty: qty, p_internal_lot: f.lot.trim(),
      p_supplier: f.supplier.trim() || null, p_supplier_lot: f.supplierLot.trim() || null,
      p_storage: f.bin.trim() || null, p_germination: f.germ ? Number(f.germ) : null,
    });
    if (error) Alert.alert('Failed', error.message); else back();
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <BackRow label="← Item" onPress={back} />
      <Text style={s.h2}>Receive · {product.crop}{product.variety ? ` — ${product.variety}` : ''}</Text>
      <TextInput style={s.input} placeholder="Packets received" value={f.qty} onChangeText={(v) => set('qty', v)} keyboardType="number-pad" placeholderTextColor={C.muted} />
      <TextInput style={s.input} placeholder="Internal lot # (e.g. TOM-CP-2026A)" value={f.lot} onChangeText={(v) => set('lot', v)} autoCapitalize="characters" placeholderTextColor={C.muted} />
      <TextInput style={s.input} placeholder="Bin / storage (e.g. Shelf A2)" value={f.bin} onChangeText={(v) => set('bin', v)} placeholderTextColor={C.muted} />
      <TextInput style={s.input} placeholder="Supplier" value={f.supplier} onChangeText={(v) => set('supplier', v)} placeholderTextColor={C.muted} />
      <TextInput style={s.input} placeholder="Supplier lot # (optional)" value={f.supplierLot} onChangeText={(v) => set('supplierLot', v)} placeholderTextColor={C.muted} />
      <TextInput style={s.input} placeholder="Germination % (optional)" value={f.germ} onChangeText={(v) => set('germ', v)} keyboardType="number-pad" placeholderTextColor={C.muted} />
      <Pressable style={s.btn} onPress={() => void save()}><Text style={s.btnText}>Receive into stock</Text></Pressable>
    </ScrollView>
  );
}

// ---------------------------------------------------------------- Commercial (Revenue & Promotions)
function Commercial({ back, can }: { back: () => void; can: (p: string) => boolean }) {
  const [ov, setOv] = useState<any | null>(null);
  const [promos, setPromos] = useState<any[]>([]);
  const [econ, setEcon] = useState<any | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickPerHr, setPickPerHr] = useState('20');
  const [packPerHr, setPackPerHr] = useState('15');
  const [hours, setHours] = useState('6');
  const [orders, setOrders] = useState('200');

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: o }, { data: p }, { data: e }] = await Promise.all([
      supabase.rpc('admin_commercial_overview'),
      supabase.from('listing_promotions')
        .select('*, market:markets(name), listing:listings(title)')
        .order('created_at', { ascending: false }).limit(25),
      supabase.rpc('admin_seed_economics'),
    ]);
    setOv(o as any); setPromos((p as any[]) ?? []); setEcon(e as any);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const endPromo = (id: string) => {
    Alert.alert('End this promotion?', 'Optionally restore the credit if Gnome invalidated it by mistake.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End only', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('admin_end_promotion', { p_promo: id, p_reason: 'Ended from Gnome Admin' });
        if (error) Alert.alert('Failed', error.message); else void load();
      } },
      ...(can('promotions.refund_credit') ? [{ text: 'End + restore credit', onPress: async () => {
        const { error } = await supabase.rpc('admin_end_promotion', { p_promo: id, p_reason: 'Invalidated — credit restored', p_restore_credit: true });
        if (error) Alert.alert('Failed', error.message); else void load();
      } }] : []),
    ]);
  };

  const n = (k: string) => Number(ov?.[k] ?? 0);
  const mix = (k: string) => Object.entries((ov?.[k] as Record<string, number>) ?? {}).map(([a, b]) => `${a}: ${b}`).join(' · ') || '—';
  const ec = (k: string) => econ?.[k] == null ? '—' : money(Number(econ[k]));
  const cap = (() => {
    const o = Number(orders) || 0; const pk = Number(pickPerHr) || 1; const pc = Number(packPerHr) || 1; const h = Number(hours) || 0;
    const need = o / pk + o / pc;
    return { need: need.toFixed(1), ok: need <= h };
  })();

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <BackRow label="← More" onPress={back} />
      <Text style={s.h2}>Plans & revenue</Text>
      <Card>
        <Text style={s.cardSub}>Effective plan mix</Text><Text style={s.cardText}>{mix('plan_mix')}</Text>
        <Text style={[s.cardSub, { marginTop: 6 }]}>Entitlement sources</Text><Text style={s.cardText}>{mix('source_mix')}</Text>
      </Card>
      <Row2 items={[['MRR (live)', n('mrr_cents') / 100], ['Comp grants', n('active_comp_grants')], ['Pickup add-ons', n('pickup_addons')]]} money0 />
      <Row2 items={[['Seed subs', n('seed_subscribers_active')], ['Seed rev 90d (live)', Math.round(n('seed_revenue_cents_90d') / 100)], ['Growers near cap', n('growers_near_cap')]]} />
      {ov?.test && (
        <Card>
          <Text style={s.cardSub}>
            🧪 Test mode (excluded from revenue above): {ov.test.plan_subs} plan sub{ov.test.plan_subs === 1 ? '' : 's'} · {money(Number(ov.test.seed_revenue_cents ?? 0))} seed · {ov.test.promo_purchases} promo purchase{ov.test.promo_purchases === 1 ? '' : 's'}
          </Text>
        </Card>
      )}

      <Text style={s.h2}>Promotions</Text>
      <Row2 items={[['Active', n('promotions_active')], ['Last 30d', n('promotions_30d')], ['Sales 30d $', Math.round(n('promo_purchases_cents_30d') / 100)]]} />
      {promos.map((p) => (
        <Card key={p.id}>
          <Text style={s.cardTitle}>{p.listing?.title ?? p.listing_id.slice(0, 8)} · {p.status}</Text>
          <Text style={s.cardSub}>
            {p.market?.name ?? ''} · {p.source} · {String(p.starts_at ?? p.created_at).slice(0, 10)} → {String(p.ends_at ?? '').slice(0, 10)}
          </Text>
          {p.status === 'active' && can('promotions.manage') && (
            <SmallBtn label="End promotion" danger onPress={() => endPromo(p.id)} />
          )}
        </Card>
      ))}
      {promos.length === 0 && <Card><Text style={s.cardSub}>No promotions yet.</Text></Card>}

      <Text style={s.h2}>Seed Drop economics (all-time)</Text>
      <Card>
        <Text style={s.cardText}>
          Orders {econ?.orders ?? '—'} · shipped {econ?.shipped ?? '—'} · revenue {ec('revenue_cents')}
        </Text>
        <Text style={s.cardText}>
          Packet COGS {ec('packet_cogs_cents')} · postage {ec('postage_cents')} · packaging {ec('packaging_cents')}
        </Text>
        <Text style={s.cardText}>
          Gross profit {ec('gross_profit_cents')}
          {econ?.revenue_cents > 0 ? ` · margin ${Math.round((econ.gross_profit_cents / econ.revenue_cents) * 100)}%` : ''}
        </Text>
        <Text style={s.cardSub}>Costs recorded on {econ?.costs_recorded_orders ?? 0} orders — missing costs stay blank, never invented.</Text>
      </Card>

      <Text style={s.h2}>Fulfillment capacity</Text>
      <Card>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['Orders', orders, setOrders], ['Pick/hr', pickPerHr, setPickPerHr], ['Pack/hr', packPerHr, setPackPerHr], ['Hours', hours, setHours]] as [string, string, (v: string) => void][]).map(([label, v, set]) => (
            <View key={label} style={{ flex: 1 }}>
              <Text style={s.cardSub}>{label}</Text>
              <TextInput style={[s.input, { minWidth: 0, marginBottom: 0, paddingVertical: 8 }]} value={v} onChangeText={set} keyboardType="number-pad" />
            </View>
          ))}
        </View>
        <Text style={[s.cardText, { marginTop: 8 }]}>
          Needs ~{cap.need}h of pick+pack → {cap.ok ? '✅ fits' : '⚠️ does NOT fit'} in {hours}h.
        </Text>
      </Card>
    </ScrollView>
  );
}

// ---------------------------------------------------------------- Seed Drop Seasons
function Seasons({ back, can }: { back: () => void; can: (p: string) => boolean }) {
  const [windows, setWindows] = useState<any[]>([]);
  const [preview, setPreview] = useState<Record<string, any>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.from('seed_season_windows')
      .select('*').eq('active', true).order('generation_date');
    setWindows((data as any[]) ?? []);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const doPreview = async (id: string) => {
    const { data, error } = await supabase.rpc('admin_seed_wave_preview', { p_window: id });
    if (error) Alert.alert('Failed', error.message);
    else setPreview((p) => ({ ...p, [id]: data }));
  };
  const doGenerate = (w: any) => {
    const f = preview[w.id]?.demand_forecast;
    Alert.alert(
      `Generate ${w.season_code} ${w.year} wave?`,
      `${f?.eligible_count ?? '?'} eligible subscriber(s). Orders are created as pending_payment — the seasonal charge step still needs Stripe config. Inventory reserves at generation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Generate', onPress: async () => {
          const { data, error } = await supabase.rpc('admin_seed_wave_generate', { p_window: w.id });
          if (error) Alert.alert('Failed', error.message);
          else Alert.alert('Wave generated', `Created ${data?.created ?? 0} · skipped ${data?.skipped ?? 0}`, [{ text: 'OK' }]);
        } },
      ]);
  };

  const today = new Date().toISOString().slice(0, 10);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <BackRow label="← More" onPress={back} />
      <Text style={s.h2}>Seasonal calendar</Text>
      <Card><Text style={s.cardSub}>One personalized Drop per season, up to 4/year. Join after a window’s cutoff → first Drop moves to the next season. $24.99/season (Stripe charge step pending owner config).</Text></Card>
      {windows.map((w) => {
        const pv = preview[w.id];
        const f = pv?.demand_forecast;
        const past = w.join_cutoff < today;
        return (
          <Card key={w.id}>
            <Text style={s.cardTitle}>{w.season_code} {w.year} · zones {w.zone_min}–{w.zone_max}</Text>
            <Text style={s.cardSub}>
              Window {String(w.window_start).slice(5)} → cutoff {String(w.join_cutoff).slice(5)} · generate {String(w.generation_date).slice(5)} · ship {String(w.ship_start).slice(5)}–{String(w.ship_end).slice(5)}
              {past ? ' · PAST CUTOFF' : ''}
            </Text>
            {f && (
              <Text style={s.cardText}>
                {f.eligible_count} eligible · packets {f.packets_expected_min}–{f.packets_expected_max} expected · {f.packets_available_total} in stock
                {f.packets_available_total < f.packets_expected_min ? ' · ⚠️ SHORT' : ' · ✅'}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SmallBtn label="Preview wave" onPress={() => void doPreview(w.id)} />
              {can('seed_drop.generate') && pv && (f?.eligible_count ?? 0) > 0 && (
                <SmallBtn label="Generate wave" onPress={() => doGenerate(w)} />
              )}
            </View>
          </Card>
        );
      })}
      {windows.length === 0 && <Card><Text style={s.cardSub}>No active season windows configured.</Text></Card>}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- Moderation queue
// Listings the screening trigger held for review. Everything here is decided
// server-side: the queue RPC is itself permission-checked, `can()` only hides
// chrome. The matched keyword (screening_term) is deliberately never rendered —
// it is the detection rule, not a fact about the seller. The class LABEL is.
type ScreeningClass = {
  compliance_class: string; label: string; rule_version: number;
  active: boolean; requires_clearance: boolean;
};

function Moderation({ back, can, isOwner }: {
  back: () => void; can: (p: string) => boolean; isOwner: boolean;
}) {
  const [counts, setCounts] = useState<any | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<ServerError | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Filters. Every one of these is a parameter on the queue RPC — the server
  // narrows the queue, so a moderator never holds rows they filtered away.
  const [fClass, setFClass] = useState<string | null>(null);
  const [fState, setFState] = useState('');
  const [fStateOn, setFStateOn] = useState<string | null>(null);
  const [fDays, setFDays] = useState<number | null>(null);
  const [fSeller, setFSeller] = useState<{ id: string; name: string } | null>(null);
  const [cfgReason, setCfgReason] = useState('');
  const [cfgLimit, setCfgLimit] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    const [c, q, st] = await Promise.all([
      supabase.rpc('admin_screening_counts'),
      supabase.rpc('admin_screening_queue', {
        p_class: fClass,
        p_state: fStateOn,
        p_seller: fSeller?.id ?? null,
        p_since: fDays == null ? null : new Date(Date.now() - fDays * 864e5).toISOString(),
      }),
      supabase.rpc('admin_screening_settings'),
    ]);
    const failed = q.error ?? c.error ?? st.error;
    setErr(failed ? serverError(failed) : null);
    setCounts(Array.isArray(c.data) ? c.data[0] : c.data);
    setRows((q.data as any[]) ?? []);
    setSettings((st.data as any) ?? null);
    setLoaded(true); setRefreshing(false);
  }, [fClass, fStateOn, fSeller, fDays]);
  useEffect(() => { void load(); }, [load]);

  const classes = ((settings?.classes as ScreeningClass[]) ?? []);
  useEffect(() => {
    if (settings?.max_listings_per_hour != null) setCfgLimit(String(settings.max_listings_per_hour));
  }, [settings?.max_listings_per_hour]);

  if (open) {
    return <ModerationDetail listing={open} classes={classes} can={can}
      back={() => { setOpen(null); void load(); }} />;
  }

  const saveConfig = async (enabled: boolean | null, perHour: number | null) => {
    const { error } = await supabase.rpc('admin_set_screening_config',
      { p_enabled: enabled, p_max_per_hour: perHour, p_reason: cfgReason.trim() || null });
    if (error) alertServerError(error);
    else { setCfgReason(''); void load(); }
  };
  const toggleScreening = (v: boolean) => {
    if (!v && !cfgReason.trim()) {
      Alert.alert('Reason first', 'Write why screening is going off. It is stored with the switch and it is the first thing the next person sees.');
      return;
    }
    Alert.alert(
      v ? 'Turn screening back on?' : 'Turn screening OFF?',
      v ? 'New listings are checked again from the next post onward.'
        : 'Every new listing publishes with no prohibited-item check until you turn this back on. Owner action, audited.',
      [{ text: 'Cancel', style: 'cancel' },
       { text: v ? 'Turn on' : 'Turn OFF', style: v ? 'default' : 'destructive',
         onPress: () => void saveConfig(v, null) }]);
  };
  const saveLimit = () => {
    const n = Number(cfgLimit);
    if (!Number.isFinite(n) || n <= 0) { Alert.alert('Enter a number', 'How many new listings one seller may post in an hour.'); return; }
    void saveConfig(null, Math.round(n));
  };

  const enabled = settings?.screening_enabled !== false;
  const num = (k: string) => Number(counts?.[k] ?? 0);
  const classLabel = (key?: string | null) =>
    classes.find((c) => c.compliance_class === key)?.label ?? 'Held for review';
  const filtered = fClass != null || fStateOn != null || fDays != null || fSeller != null;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.green} />}>
      <BackRow label="← More" onPress={back} />
      {err && <ErrorCard e={err} />}

      <Row2 items={[['Waiting', num('pending')], ['Held today', num('held_today')], ['Resolved today', num('resolved_today')]]} />

      <Card>
        <Text style={s.cardBig}>{enabled ? 'Screening ON' : 'Screening OFF 🔴'}</Text>
        <Text style={s.cardSub}>
          {enabled
            ? 'Every new listing is checked before it can go public. Regulated classes are held here until someone decides.'
            : 'New listings publish with no prohibited-item check until this is switched back on.'}
        </Text>
        {settings?.disabled_reason
          ? <Text style={[s.cardSub, { color: C.red }]}>Turned off because: {settings.disabled_reason}</Text> : null}
        <Text style={s.cardSub}>
          Rate limit: {settings?.max_listings_per_hour ?? '—'} new listings per seller per hour
          {settings?.updated_at ? ` · changed ${String(settings.updated_at).slice(0, 16).replace('T', ' ')}` : ''}
        </Text>
        {isOwner ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <Text style={s.cardTitle}>Screening enabled</Text>
              {settings != null && (
                <Switch value={enabled} onValueChange={toggleScreening} trackColor={{ true: C.green }} />
              )}
            </View>
            <TextInput style={[s.input, { marginTop: 8, marginBottom: 8 }]} value={cfgReason} onChangeText={setCfgReason}
              placeholder="Reason (required to turn screening off)" placeholderTextColor={C.muted} />
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput style={[s.input, { flex: 1, minWidth: 0, marginBottom: 0 }]} value={cfgLimit} onChangeText={setCfgLimit}
                keyboardType="number-pad" placeholder="Listings per seller per hour" placeholderTextColor={C.muted} />
              <SmallBtn label="Save limit" onPress={saveLimit} />
            </View>
          </>
        ) : (
          <Text style={s.cardSub}>Only the Gnome owner can turn screening off or change the rate limit.</Text>
        )}
      </Card>

      <Text style={s.h2}>Queue ({rows.length}{filtered ? ' shown' : ''})</Text>
      <Text style={s.h3}>Product class</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        <Pressable onPress={() => setFClass(null)} style={[s.chip, fClass === null && s.chipActive]}>
          <Text style={[s.chipText, fClass === null && s.chipTextActive]}>All</Text>
        </Pressable>
        {classes.map((c) => (
          <Pressable key={c.compliance_class} onPress={() => setFClass(c.compliance_class)}
            style={[s.chip, fClass === c.compliance_class && s.chipActive]}>
            <Text style={[s.chipText, fClass === c.compliance_class && s.chipTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.h3}>Held since</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        {([['Any time', null], ['24 hours', 1], ['7 days', 7], ['30 days', 30]] as [string, number | null][]).map(([label, d]) => (
          <Pressable key={label} onPress={() => setFDays(d)} style={[s.chip, fDays === d && s.chipActive]}>
            <Text style={[s.chipText, fDays === d && s.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.h3}>State</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <TextInput style={[s.input, { flex: 1, minWidth: 0, marginBottom: 0 }]} value={fState} onChangeText={setFState}
          onSubmitEditing={() => setFStateOn(fState.trim().toUpperCase() || null)} returnKeyType="search"
          autoCapitalize="characters" placeholder="NC" placeholderTextColor={C.muted} />
        <SmallBtn label="Filter" onPress={() => setFStateOn(fState.trim().toUpperCase() || null)} />
      </View>
      {(fSeller || fStateOn) && (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {fStateOn && (
            <Pressable onPress={() => { setFStateOn(null); setFState(''); }} style={[s.chip, s.chipActive]}>
              <Text style={[s.chipText, s.chipTextActive]}>State {fStateOn}  ✕</Text>
            </Pressable>
          )}
          {fSeller && (
            <Pressable onPress={() => setFSeller(null)} style={[s.chip, s.chipActive]}>
              <Text style={[s.chipText, s.chipTextActive]}>{fSeller.name}  ✕</Text>
            </Pressable>
          )}
        </View>
      )}

      {!loaded && <Card><Text style={s.cardSub}>Loading the queue…</Text></Card>}
      {loaded && rows.length === 0 && (
        <Card>
          <Text style={s.cardBig}>Nothing waiting 🌱</Text>
          <Text style={s.cardSub}>
            {filtered ? 'No held listing matches these filters.' : 'No listing is held for review right now.'}
          </Text>
        </Card>
      )}
      {rows.map((r) => (
        <Pressable key={r.listing_id} onPress={() => setOpen(r.listing_id)}>
          <Card>
            <Text style={s.cardTitle}>{r.title}</Text>
            <Text style={s.cardSub}>
              {r.seller_name ?? 'Unknown seller'}{r.seller_suspended ? '  ⛔ suspended' : ''} · {[r.city, r.state].filter(Boolean).join(', ') || 'no location'}
              {' · '}held {String(r.screened_at ?? r.created_at).slice(0, 10)}
            </Text>
            <Text style={s.cardSub}>{classLabel(r.matched_category)} · listing is {r.listing_status}</Text>
            {r.reason ? <Text style={s.cardText} numberOfLines={2}>{r.reason}</Text> : null}
            {!fSeller && r.seller_id && (
              <SmallBtn label="Only this seller" onPress={() => setFSeller({ id: r.seller_id, name: r.seller_name ?? 'This seller' })} />
            )}
          </Card>
        </Pressable>
      ))}

      <Text style={s.h2}>Class rules</Text>
      {classes.map((c) => (
        <Card key={c.compliance_class}>
          <Text style={s.cardTitle}>{c.label} · rule v{c.rule_version}</Text>
          <Text style={s.cardSub}>
            {!c.active
              ? 'Inactive — nothing is held for this class.'
              : c.requires_clearance
                ? 'Held for review until the seller is cleared for their own state.'
                : 'Publishes without a clearance.'}
          </Text>
        </Card>
      ))}
      {classes.length === 0 && <Card><Text style={s.cardSub}>No classes configured.</Text></Card>}
    </ScrollView>
  );
}

function ModerationDetail({ listing, back, can, classes }: {
  listing: string; back: () => void; can: (p: string) => boolean; classes: ScreeningClass[];
}) {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState<ServerError | null>(null);
  const [reason, setReason] = useState('');
  const [credential, setCredential] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_moderation_detail', { p_listing: listing });
    if (error) { setErr(serverError(error)); setD(null); } else { setErr(null); setD(data as any); }
  }, [listing]);
  useEffect(() => { void load(); }, [load]);

  if (err && !d) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <BackRow label="← Queue" onPress={back} />
        <ErrorCard e={err} />
      </ScrollView>
    );
  }
  if (!d) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <BackRow label="← Queue" onPress={back} />
        <Card><Text style={s.cardSub}>Loading this listing…</Text></Card>
      </ScrollView>
    );
  }

  const l = d.listing ?? {};
  const seller = d.seller ?? {};
  const cls = d.class ?? null;
  const creds = (d.credentials as any[]) ?? [];
  const clearances = (d.clearances as any[]) ?? [];
  const history = (d.history as any[]) ?? [];
  const who = seller.name ?? 'this seller';
  const st: string | null = l.state ?? seller.state ?? null;
  // The class label is public vocabulary; the matched keyword never leaves the
  // database, so nothing here reads screening_term.
  const label = cls?.label
    ?? classes.find((c) => c.compliance_class === l.screening_category)?.label
    ?? 'this product';
  // The seller was shown the class's customer message — that is the sentence to
  // hold the decision against, not an internal rationale.
  const shown = cls?.customer_message ?? l.screening_reason ?? null;
  const photos = ((l.photos as any[]) ?? []).filter((u) => typeof u === 'string' && u.startsWith('http')) as string[];
  const credId = (c: any): string | null => c?.id ?? c?.credential_id ?? null;
  const chosen = creds.find((c) => credId(c) === credential) ?? null;
  const canResolve = can('listings.moderate');
  const canGrant = can('listings.moderate') || can('compliance.rules_manage');
  const canRevoke = can('compliance.rules_manage');
  const needReason = !reason.trim();

  const scope = cls
    ? `This clears ${who} to sell ${label} in ${st ?? 'their state'} only`
      + (chosen ? `, while their ${chosen.credential_type} credential is valid.` : ', under the current rule.')
      + ' It does not clear other regulated products, and it does not clear other states.'
    : '';

  const resolve = async (approve: boolean, suspend: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc('admin_resolve_screening', {
      p_listing: listing, p_approve: approve,
      p_reason: reason.trim() || null, p_suspend_seller: suspend,
    });
    setBusy(false);
    if (error) { setErr(serverError(error)); void load(); } else back();
  };
  const suspendSeller = () => {
    Alert.alert(
      `Reject and suspend ${who}?`,
      `${who} is signed out of selling on Gnome and their listings stop being public. The listing is rejected at the same time. Audited, and reversible from Users.`,
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Reject & suspend', style: 'destructive', onPress: () => void resolve(false, true) }]);
  };
  const grant = () => {
    if (!cls || !st) return;
    Alert.alert('Clear this seller?', scope, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Grant clearance', onPress: async () => {
        setBusy(true);
        const { error } = await supabase.rpc('admin_grant_compliance_clearance', {
          p_seller: seller.id, p_class: cls.compliance_class, p_state: st,
          p_reason: reason.trim(), p_credential: credential, p_listing: listing,
        });
        setBusy(false);
        if (error) setErr(serverError(error)); else setErr(null);
        void load();
      } },
    ]);
  };
  const revoke = (c: any) => {
    Alert.alert('Revoke this clearance?',
      `${who} goes back to review for ${classes.find((k) => k.compliance_class === c.compliance_class)?.label ?? 'this class'} in ${c.state}. Listings already approved stay up.`,
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Revoke', style: 'destructive', onPress: async () => {
         setBusy(true);
         const { error } = await supabase.rpc('admin_revoke_compliance_clearance',
           { p_clearance: c.id, p_reason: reason.trim() });
         setBusy(false);
         if (error) setErr(serverError(error)); else setErr(null);
         void load();
       } }]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <BackRow label="← Queue" onPress={back} />
      {err && <ErrorCard e={err} />}

      <Card>
        <Text style={s.cardBig}>{l.title}</Text>
        <Text style={s.cardSub}>
          {[l.city, l.state].filter(Boolean).join(', ') || 'no location'} · posted {String(l.created_at ?? '').slice(0, 10)} · listing is {l.status}
        </Text>
        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {photos.map((u) => <Image key={u} source={{ uri: u }} style={s.modPhoto} />)}
          </ScrollView>
        )}
        {l.description ? <Text style={s.cardText}>{l.description}</Text> : null}
      </Card>

      <Card>
        <Text style={s.cardTitle}>Held as {label}</Text>
        {shown ? <Text style={s.cardText}>What {who} was shown: “{shown}”</Text> : null}
        <Text style={s.cardSub}>
          Screening status {l.screening_status ?? '—'}
          {cls ? ` · rule v${cls.rule_version}${cls.requires_clearance ? ' · needs a clearance' : ' · no clearance needed'}` : ''}
        </Text>
      </Card>

      <Text style={s.h2}>Seller</Text>
      <Card>
        <Text style={s.cardBig}>{who}</Text>
        <Text style={s.cardSub}>{seller.state ?? 'no state on file'}</Text>
        {seller.suspended && <Text style={[s.cardSub, { color: C.red }]}>ALREADY SUSPENDED</Text>}
        <Text style={s.h3}>Approved credentials</Text>
        {creds.length === 0 && <Text style={s.cardSub}>None on file. A clearance can still be granted, but nothing will expire it.</Text>}
        {creds.map((c, i) => {
          const id = credId(c);
          const expired = c.expiration_date ? new Date(c.expiration_date) < new Date() : false;
          const picked = id != null && id === credential;
          return (
            <Pressable key={id ?? i} disabled={id == null || expired}
              onPress={() => setCredential(picked ? null : id)}>
              <View style={{ marginTop: 6 }}>
                <Text style={s.cardText}>
                  {id != null && !expired ? (picked ? '☑ ' : '☐ ') : ''}{c.credential_type} · {c.state ?? '—'} · {c.status}
                  {c.expiration_date ? ` · ${expired ? 'EXPIRED' : 'valid to'} ${String(c.expiration_date).slice(0, 10)}` : ' · no expiry'}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {creds.length > 0 && creds.every((c) => credId(c) == null) && (
          <Text style={s.cardSub}>These are shown for the record. Attaching one to a clearance needs the credential’s id, which this view doesn’t carry yet.</Text>
        )}
      </Card>

      <Text style={s.h2}>Decision</Text>
      <Card>
        <TextInput style={s.input} value={reason} onChangeText={setReason} multiline
          placeholder="Reason — required to reject, to suspend, or to clear a seller"
          placeholderTextColor={C.muted} />
        {canResolve ? (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <SmallBtn label="Approve listing" disabled={busy} onPress={() => void resolve(true, false)} />
            <SmallBtn label="Reject listing" danger disabled={busy || needReason} onPress={() => void resolve(false, false)} />
            <SmallBtn label="Reject & suspend seller" danger disabled={busy || needReason} onPress={suspendSeller} />
          </View>
        ) : (
          <Text style={s.cardSub}>Your role can read this queue but not decide on it.</Text>
        )}
        {needReason && canResolve && (
          <Text style={s.cardSub}>Approving may go without a note. Rejecting or suspending needs one — it is what the seller and the audit log get.</Text>
        )}
      </Card>

      {cls && canGrant && (
        <>
          <Text style={s.h2}>Clearance</Text>
          <Card>
            <Text style={s.cardTitle}>Clear {who} for {label} in {st ?? '—'}</Text>
            <View style={s.scopeBox}>
              <Text style={s.cardText}>{scope}</Text>
            </View>
            <Text style={s.h3}>What ends it</Text>
            <Text style={s.cardText}>
              · {chosen
                ? `Their ${chosen.credential_type} credential expiring or ceasing to be approved${chosen.expiration_date ? ` (currently valid to ${String(chosen.expiration_date).slice(0, 10)})` : ''}.`
                : 'No credential attached, so nothing expires it on a date. Attach one when the state requires a permit.'}
            </Text>
            <Text style={s.cardText}>· {who} listing from a different state — a clearance answers one state’s rule only.</Text>
            <Text style={s.cardText}>· The {label} rule version moving past v{cls.rule_version} — changing the rule re-opens every decision made under the old one.</Text>
            {!st && <Text style={[s.cardSub, { color: C.red }]}>No state on this listing or on the seller, and a clearance is per state. Fix the seller’s state first.</Text>}
            <SmallBtn label={`Grant clearance · ${label} · ${st ?? '—'}`}
              disabled={busy || needReason || !st} onPress={grant} />
            {needReason && <Text style={s.cardSub}>Write the reason above first — the server stores it on the clearance.</Text>}
          </Card>
        </>
      )}

      {clearances.length > 0 && (
        <>
          <Text style={s.h2}>Clearances on file</Text>
          {clearances.map((c) => {
            const k = classes.find((x) => x.compliance_class === c.compliance_class);
            const stale = k != null && c.rule_version !== k.rule_version;
            return (
              <Card key={c.id}>
                <Text style={s.cardTitle}>{k?.label ?? 'Clearance'} · {c.state} · rule v{c.rule_version}</Text>
                <Text style={s.cardSub}>
                  {c.status} · granted {String(c.granted_at ?? '').slice(0, 10)}
                  {c.credential_expiration ? ` · credential valid to ${String(c.credential_expiration).slice(0, 10)}` : ' · no credential attached'}
                </Text>
                {stale && (
                  <Text style={[s.cardSub, { color: C.gold }]}>
                    Granted under rule v{c.rule_version}; the rule is now v{k?.rule_version}. It no longer clears anything.
                  </Text>
                )}
                {c.status === 'ACTIVE' && canRevoke && (
                  <SmallBtn label="Revoke clearance" danger disabled={busy || needReason} onPress={() => revoke(c)} />
                )}
              </Card>
            );
          })}
        </>
      )}

      <Text style={s.h2}>Decision history</Text>
      {history.length === 0 && <Card><Text style={s.cardSub}>Nothing decided on this listing yet.</Text></Card>}
      {history.map((h, i) => (
        <Card key={i}>
          <Text style={s.cardTitle}>{h.action}</Text>
          <Text style={s.cardSub}>{h.actor_type} · {String(h.at ?? '').slice(0, 16).replace('T', ' ')}</Text>
          {h.reason ? <Text style={s.cardText}>“{h.reason}”</Text> : null}
        </Card>
      ))}
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
function SmallBtn({ label, onPress, danger, disabled }: {
  label: string; onPress: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable style={[s.smallBtn, danger && { backgroundColor: C.red }, disabled && { opacity: 0.4 }]}
      onPress={onPress} disabled={disabled}>
      <Text style={s.smallBtnText}>{label}</Text>
    </Pressable>
  );
}
function ErrorCard({ e }: { e: ServerError }) {
  return (
    <View style={s.errBox}>
      <Text style={s.errTitle}>{e.title}</Text>
      <Text style={s.cardText}>{e.body}</Text>
    </View>
  );
}

// A server raise arrives as 'CODE' or 'CODE: a sentence already written for the
// person reading it'. That sentence is the server's copy and is passed through
// untouched — this picks the title and supplies a line for the codes that raise
// bare. Anything unrecognized shows its own message rather than being swallowed.
type ServerError = { title: string; body: string };
const SERVER_ERRORS: Record<string, [string, string]> = {
  PROHIBITED_ITEM: ['Gnome can’t carry this', 'This one falls under something Gnome doesn’t allow.'],
  PROHIBITED_CATEGORY: ['Gnome can’t carry this', 'Gnome can’t carry items in that category.'],
  RATE_LIMITED: ['Too many at once', 'That’s a lot at once. Try again in a little while.'],
  COMPLIANCE_BLOCKED: ['Not cleared yet', 'This seller isn’t cleared for that product in that state.'],
  PLAN_LIMIT_REACHED: ['Plan limit reached', 'This Market is at the limit its plan allows.'],
  NOT_AUTHORIZED: ['Not something your role can do', 'Your admin role doesn’t include this action. Ask an owner.'],
  LAST_OWNER: ['Gnome needs an owner', 'This is the last owner. Make someone else an owner first, then try again.'],
  ONLY_OWNER_CAN_INVITE_OWNER: ['Owner only', 'Only an owner can invite another owner.'],
  ONLY_OWNER_CAN_PROMOTE_OWNER: ['Owner only', 'Only an owner can move someone to owner.'],
  INVITE_EXPIRED: ['That invitation expired', 'Send a fresh invitation instead.'],
  NO_PENDING_INVITE: ['No invitation waiting', 'There’s no pending invitation for that account.'],
  INVALID_ROLE: ['Unknown role', 'That role isn’t one Gnome recognizes. Pull to refresh and pick again.'],
  INVALID_EMAIL: ['Check that email', 'That doesn’t look like an email address.'],
  REASON_REQUIRED: ['Reason required', 'Write the reason for this decision — it is stored with it.'],
  OWNER_ONLY: ['Owner only', 'Only the Gnome owner can change this.'],
  UNKNOWN_STATE: ['State not recognized', 'Use the two-letter state code, e.g. NC.'],
  UNKNOWN_CLASS: ['Class not recognized', 'That product class no longer exists. Pull to refresh.'],
  NOT_FOUND: ['Already gone', 'That record no longer exists. Pull to refresh.'],
};
function serverError(e: { message?: string } | null | undefined): ServerError {
  const raw = (e?.message ?? '').trim();
  const cut = raw.indexOf(':');
  const code = (cut === -1 ? raw : raw.slice(0, cut)).trim();
  const rest = cut === -1 ? '' : raw.slice(cut + 1).trim();
  const known = SERVER_ERRORS[code];
  if (!known) return { title: 'That didn’t go through', body: raw || 'Something went wrong. Pull to refresh and try again.' };
  return { title: known[0], body: rest || known[1] };
}
function alertServerError(e: { message?: string } | null | undefined) {
  const { title, body } = serverError(e);
  Alert.alert(title, body);
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
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 13, fontWeight: '700', color: C.muted },
  chipTextActive: { color: '#fff' },
  signTitle: { fontSize: 26, fontWeight: '800', color: C.green },
  lane: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  laneActive: { backgroundColor: C.green, borderColor: C.green },
  laneText: { fontSize: 12.5, fontWeight: '700', color: C.muted },
  laneTextActive: { color: '#fff' },
  bubble: { borderRadius: 14, padding: 12, marginBottom: 8, maxWidth: '92%' },
  bubbleMe: { backgroundColor: C.green, alignSelf: 'flex-end' },
  bubbleAgent: { backgroundColor: C.surface, alignSelf: 'flex-start', borderWidth: 1, borderColor: C.border },
  bubbleSys: { backgroundColor: 'transparent', alignSelf: 'center' },
  bubbleWho: { fontSize: 11, fontWeight: '800', color: C.gold, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.4 },
  bubbleText: { fontSize: 14, color: C.green, lineHeight: 20 },
  bubbleTextMe: { fontSize: 14, color: '#fff', lineHeight: 20 },
  pickCard: { backgroundColor: C.surface, borderRadius: 16, padding: 18, marginBottom: 10, borderWidth: 2, borderColor: C.green },
  pickBin: { fontSize: 30, fontWeight: '900', color: C.gold },
  pickName: { fontSize: 22, fontWeight: '800', color: C.green, marginTop: 4 },
  pickLot: { fontSize: 15, color: C.muted, marginTop: 2 },
  pickTap: { fontSize: 13, fontWeight: '800', color: C.mid, marginTop: 10, letterSpacing: 0.6 },
  errBox: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: C.red },
  errTitle: { fontSize: 15, fontWeight: '800', color: C.red },
  scopeBox: { backgroundColor: C.bg, borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: C.border },
  modPhoto: { width: 96, height: 96, borderRadius: 10, marginRight: 8, backgroundColor: C.bg },
  deniedEmoji: { fontSize: 40 },
  deniedTitle: { fontSize: 18, fontWeight: '800', color: C.green, textAlign: 'center' },
  deniedSub: { fontSize: 13.5, color: C.muted, textAlign: 'center', lineHeight: 19 },
});
