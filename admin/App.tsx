// GNOME ADMIN — the internal operating app. Same Supabase backend and auth
// identities as consumer Gnome; a normal user who signs in here hits the
// admin_me() gate and sees "You don't have access" — no privileged data ever
// loads client-side because every read/mutation below is RLS/permission-
// checked server-side (admin_has_perm / audited RPCs). No service keys here.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable,
  RefreshControl, SafeAreaView, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';
import {
  Activity, ArrowLeft, Bot, CalendarDays, Check, ChevronRight, ClipboardCheck,
  Gift, Home as HomeIcon, ImagePlus, LockKeyhole, Mail, Menu, MessageCircle, PackageCheck, Play,
  RotateCcw, Send, Share2, ShieldCheck, Sparkles, Sprout, Store, UsersRound, X, type LucideIcon,
} from 'lucide-react-native';

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true } },
);

const ZORDY = require('./assets/zordy-avatar.png');

// Mirrors expo/constants/colors.ts. Admin stays dense and work-focused while
// sharing the same white canvas, charcoal type, and semantic Gnome colors.
const C = {
  bg: '#FFFFFF', surface: '#FFFFFF', surfaceMuted: '#F1F5F9',
  primary: '#6B2FB9', primaryDark: '#542394', primarySoft: '#F4EDFB',
  green: '#328736', greenBrand: '#43B649', blue: '#075A9A',
  orange: '#C2410C', orangeBrand: '#F4700A', red: '#C62828', yellow: '#FFC107',
  text: '#222222', mid: '#374151', muted: '#6B7280', border: '#E5E7EB',
  gold: '#B45309',
};
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

type Me = { user_id: string; role: string; permissions: string[]; is_owner: boolean };
type Tab = 'home' | 'concierge' | 'fulfill' | 'ai' | 'more';

const TABS: { id: Tab; label: string; icon: LucideIcon; color: string }[] = [
  { id: 'home', label: 'Brief', icon: HomeIcon, color: C.primary },
  { id: 'concierge', label: 'Sellers', icon: Store, color: C.orange },
  { id: 'fulfill', label: 'Fulfill', icon: PackageCheck, color: C.orange },
  { id: 'ai', label: 'Zordy', icon: Sparkles, color: C.primary },
  { id: 'more', label: 'More', icon: Menu, color: C.blue },
];

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
    return <Centered><ActivityIndicator color={C.primary} size="large" /></Centered>;
  }
  if (me === 'denied') {
    return (
      <Centered>
        <View style={s.deniedIcon}><LockKeyhole size={26} color={C.red} /></View>
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
        <View style={s.headerBrand}>
          <Image source={ZORDY} style={s.headerAvatar} accessibilityLabel="Zordy" />
          <View>
            <Text style={s.brand}>Zordy Ops</Text>
            <Text style={s.brandSub}>GNOME ADMIN</Text>
          </View>
        </View>
        <View style={s.roleBadge}><Text style={s.role}>{admin.role}</Text></View>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <Home />}
        {tab === 'concierge' && <SellerConcierge can={can} isOwner={admin.is_owner} />}
        {tab === 'fulfill' && <Fulfill can={can} />}
        {tab === 'ai' && <AiHQ can={can} />}
        {tab === 'more' && <More can={can} isOwner={admin.is_owner} />}
      </View>
      <View style={s.tabbar}>
        {TABS.map(({ id, label, icon: Icon, color }) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}
            style={[s.tabBtn, tab === id && { borderTopColor: color }]} onPress={() => setTab(id)}>
            <Icon size={21} strokeWidth={tab === id ? 2.5 : 2} color={tab === id ? color : C.muted} />
            <Text style={[s.tabText, tab === id && { color, fontWeight: '800' }]}>{label}</Text>
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
        <Image source={ZORDY} style={s.signAvatar} accessibilityLabel="Zordy" />
        <Text style={s.signTitle}>Zordy Operations</Text>
        <Text style={s.deniedSub}>Private command center for the Gnome team.</Text>
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
  const [execDash, setExecDash] = useState<any | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data }, { data: executive }] = await Promise.all([
      supabase.rpc('admin_daily_brief'),
      supabase.rpc('admin_executive_dashboard'),
    ]);
    setBrief(data as Record<string, unknown>);
    setExecDash(executive ?? null);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!brief) return <Centered><ActivityIndicator color={C.primary} /></Centered>;
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
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
      {execDash && (
        <>
          <Text style={s.h2}>President's brief</Text>
          <Card>
            <View style={s.rowBetween}>
              <View>
                <Text style={s.cardBig}>{Number(execDash.health_score ?? 0)}/100</Text>
                <Text style={s.cardSub}>Gnome health</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.cardBig}>{Number(execDash.attention_count ?? 0)}</Text>
                <Text style={s.cardSub}>attention items</Text>
              </View>
            </View>
          </Card>
          {((execDash.findings ?? []) as any[]).slice(0, 3).map((f) => (
            <Card key={f.id}>
              <View style={s.rowBetween}>
                <Text style={[s.riskBadge, ['URGENT', 'CRITICAL'].includes(f.severity) && { color: C.red, backgroundColor: '#FEF2F2' }]}>{f.severity}</Text>
                <Text style={s.cardSub}>{f.agent_name ?? f.agent_id}</Text>
              </View>
              <Text style={[s.cardTitle, { marginTop: 8 }]}>{f.title}</Text>
              <Text style={s.cardSub}>{f.summary}</Text>
            </Card>
          ))}
        </>
      )}
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

// ---------------------------------------------------------------- Zordy Ops
const AGENT_PRESENTATION: Record<string, { label: string; role: string; color: string; icon: LucideIcon }> = {
  gnome_hq: { label: 'Zordy', role: 'President of Gnome', color: C.primary, icon: Sparkles },
  boon: { label: 'Boon', role: 'Chief Marketplace Officer', color: C.orange, icon: Store },
  buddy: { label: 'Buddy', role: 'Chief Grower & Horticulture Officer', color: C.green, icon: Sprout },
  enzo: { label: 'Enzo', role: 'Chief Community Officer', color: C.blue, icon: UsersRound },
  gemma: { label: 'Gemma', role: 'Chief Growth & Rewards Officer', color: C.orange, icon: Gift },
  reddy: { label: 'Reddy', role: 'Chief Marketing & Creative Officer', color: C.red, icon: Sparkles },
  senior: { label: 'Senior', role: 'Chief Security Officer', color: C.blue, icon: ShieldCheck },
  junior: { label: 'Junior', role: 'Chief Technology Officer', color: C.primary, icon: Bot },
  debb: { label: 'Debb', role: 'Chief Compliance & Risk Officer', color: C.red, icon: ClipboardCheck },
  gee: { label: 'Gee', role: 'Chief Financial Officer', color: C.green, icon: Activity },
  kay: { label: 'Kay', role: 'Chief Customer Experience & Trust/Safety Officer', color: C.blue, icon: MessageCircle },
  marty: { label: 'Marty', role: 'Chief Data & Intelligence Officer', color: C.blue, icon: Activity },
  operations: { label: 'Operations', role: 'Orders and fulfillment', color: C.orange, icon: ClipboardCheck },
  inventory: { label: 'Inventory', role: 'Stock, lots and reorders', color: C.green, icon: Sprout },
  seeds: { label: 'Seed Drop', role: 'Seed orders and seasons', color: C.green, icon: PackageCheck },
  compliance: { label: 'Compliance', role: 'Credentials and policy gates', color: C.red, icon: ShieldCheck },
  security: { label: 'Security', role: 'Access, anomalies and safety', color: C.blue, icon: LockKeyhole },
  marketplace: { label: 'Marketplace', role: 'Listings and seller quality', color: C.orange, icon: Activity },
  support: { label: 'Support', role: 'Reports and member care', color: C.blue, icon: MessageCircle },
  finance: { label: 'Finance', role: 'Revenue, plans and costs', color: C.green, icon: Activity },
  growth: { label: 'Growth', role: 'Activation and expansion', color: C.orange, icon: Sprout },
};

const agentDisplay = (agent: any) => AGENT_PRESENTATION[agent?.id] ?? {
  label: agent?.name ?? 'Specialist', role: agent?.charter ?? 'Gnome operations', color: C.primary, icon: Bot,
};

function AiHQ({ can }: { can: (p: string) => boolean }) {
  const [reqs, setReqs] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [reads, setReads] = useState<boolean | null>(null);
  const [usageToday, setUsageToday] = useState<{ cents: number; actualCents: number; fails: number } | null>(null);
  const [providers, setProviders] = useState<{ stats: any; health: any } | null>(null);
  const [execDash, setExecDash] = useState<any | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [room, setRoom] = useState<any | null>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [{ data: r }, { data: a }, { data: st }, { data: rm }, { data: usage }, { data: pstats }, { data: executive }, health] = await Promise.all([
      supabase.from('ai_action_requests').select('*').order('requested_at', { ascending: false }).limit(30),
      supabase.from('ai_agents').select('*').order('id'),
      supabase.from('ai_settings').select('writes_paused, reads_enabled, allow_paid_fallback').limit(1).maybeSingle(),
      supabase.from('ai_rooms').select('*').eq('status', 'active').order('updated_at', { ascending: false }).limit(12),
      supabase.from('ai_usage_log').select('estimated_cost_cents, actual_cost_cents, success').gte('created_at', since.toISOString()).limit(400),
      supabase.rpc('admin_ai_provider_stats'),
      supabase.rpc('admin_executive_dashboard'),
      supabase.functions.invoke('ai-health', { body: {} }).then((x) => x.data).catch(() => null),
    ]);
    setReqs(r ?? []); setAgents(a ?? []);
    setPaused(st?.writes_paused ?? null); setReads(st?.reads_enabled ?? null);
    setRooms(rm ?? []);
    setExecDash(executive ?? null);
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
  const confirmReview = (request: any, approve: boolean) => Alert.alert(
    approve ? 'Approve this proposal?' : 'Reject this proposal?',
    `${request.human_summary}\n\n${request.requested_action} · risk ${request.risk_level}`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: approve ? 'Approve' : 'Reject', style: approve ? 'default' : 'destructive', onPress: () => void review(request.id, approve) },
    ],
  );
  const execute = async (id: string) => {
    const { error } = await supabase.rpc('admin_execute_ai_action', { p_request: id });
    if (error) Alert.alert('Failed', error.message); else void load();
  };
  const confirmExecute = (request: any) => Alert.alert(
    'Execute approved action?',
    `${request.human_summary}\n\nThis writes to production and will be added to the audit log.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Execute', onPress: () => void execute(request.id) },
    ],
  );
  const togglePause = async (v: boolean) => {
    const { error } = await supabase.rpc('admin_set_ai_paused', { p_paused: v });
    if (error) Alert.alert('Failed', error.message); else setPaused(v);
  };
  const toggleReads = async (v: boolean) => {
    const { error } = await supabase.rpc('admin_set_ai_reads', { p_enabled: v });
    if (error) Alert.alert('Failed', error.message); else setReads(v);
  };
  const disablePaidFallback = async () => {
    const { error } = await supabase.rpc('admin_set_paid_fallback', { p_allow: false });
    if (error) Alert.alert('Failed', error.message); else void load();
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
  const specialists = enabledAgents.filter((a) => a.id !== 'gnome_hq');
  const paidFallback = providers?.health?.settings?.allow_paid_fallback === true;
  const execAgent = (id: string) => ((execDash?.agents ?? []) as any[]).find((a) => a.id === id);
  const findingSummary = (id: string) => {
    const f = execAgent(id)?.open_findings;
    if (!f) return 'No findings data';
    const parts = [
      Number(f.critical ?? 0) ? `${f.critical} Critical` : '',
      Number(f.urgent ?? 0) ? `${f.urgent} Urgent` : '',
      Number(f.important ?? 0) ? `${f.important} Important` : '',
      Number(f.watch ?? 0) ? `${f.watch} Watch` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'No open findings';
  };
  const agentTiming = (id: string) => {
    const a = execAgent(id);
    if (!a) return '';
    const last = a.last_analysis_at ? `Last ${new Date(a.last_analysis_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not analyzed';
    const next = a.next_check_at ? `Next ${new Date(a.next_check_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'No schedule';
    return `${last} · ${next}`;
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
      <View style={s.zordyHero}>
        <Image source={ZORDY} style={s.zordyHeroAvatar} accessibilityLabel="Zordy" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.zordyEyebrow}>CHIEF OPERATOR</Text>
          <Text style={s.zordyTitle}>Ask Zordy</Text>
          <Text style={s.zordySub}>Business, operations, security, compliance, and the next move.</Text>
          <Pressable style={s.zordyButton} onPress={() => void openChat('gnome_hq', 'Zordy Operations')}>
            <MessageCircle size={17} color="#FFFFFF" />
            <Text style={s.zordyButtonText}>Open operations chat</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.statusStrip}>
        <View style={[s.statusDot, { backgroundColor: reads === false ? C.red : C.green }]} />
        <Text style={s.statusText}>{reads === false ? 'AI paused' : 'Gemini free path active'}</Text>
        <Text style={s.statusDivider}>·</Text>
        <Text style={[s.statusText, paidFallback && { color: C.red }]}>{paidFallback ? 'Paid fallback on' : '$0 fallback policy'}</Text>
      </View>

      <Text style={s.h2}>Specialists</Text>
      <View style={s.agentGrid}>
        {specialists.map((a) => {
          const meta = agentDisplay(a);
          const Icon = meta.icon;
          return (
            <Pressable key={a.id} style={s.agentCard} onPress={() => void openChat(a.id, meta.label)}>
              <View style={[s.agentIcon, { backgroundColor: `${meta.color}14` }]}><Icon size={20} color={meta.color} /></View>
              <Text style={s.agentName}>{meta.label}</Text>
              <Text style={s.agentRole}>{a.charter || meta.role}</Text>
              <Text style={s.agentRole}>{findingSummary(a.id)}</Text>
              {!!agentTiming(a.id) && <Text style={s.cardSub}>{agentTiming(a.id)}</Text>}
              <View style={s.agentChatRow}><MessageCircle size={14} color={meta.color} /><Text style={[s.agentChatText, { color: meta.color }]}>Chat</Text></View>
            </Pressable>
          );
        })}
      </View>

      <View style={s.sectionRow}>
        <Text style={s.h2}>Boardrooms</Text>
        <Pressable style={s.iconCommand} onPress={() => setComposing(true)} accessibilityLabel="New boardroom">
          <UsersRound size={19} color={C.primary} /><Text style={s.iconCommandText}>New</Text>
        </Pressable>
      </View>
      {rooms.length === 0 && <Card><Text style={s.cardSub}>No saved conversations yet.</Text></Card>}
      {rooms.map((r) => (
        <Pressable key={r.id} onPress={() => setRoom(r)}>
          <Card>
            <View style={s.rowBetween}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.cardTitle}>{r.title}</Text>
                <Text style={s.cardSub}>{(r.agent_ids ?? []).map((id: string) => AGENT_PRESENTATION[id]?.label ?? id).join(' · ')}</Text>
              </View>
              <ChevronRight size={19} color={C.muted} />
            </View>
          </Card>
        </Pressable>
      ))}

      <Text style={s.h2}>Control plane</Text>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{paused ? 'Actions paused' : 'Approved actions enabled'}</Text>
            <Text style={s.cardSub}>Server-enforced write kill switch</Text>
          </View>
          {can('ai.pause_actions') && paused != null && (
            <Switch value={!paused} onValueChange={(v) => void togglePause(!v)} trackColor={{ true: C.primary }} />
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{reads === false ? 'Conversations paused' : 'Conversations enabled'}</Text>
            <Text style={s.cardSub}>Zordy, specialists, and listing assistance</Text>
          </View>
          {can('ai.kill_switch') && reads != null && (
            <Switch value={reads !== false} onValueChange={(v) => void toggleReads(v)} trackColor={{ true: C.primary }} />
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
                  <Text style={s.cardSub}>{line('Gemini free tier', 'gemini')}</Text>
                  {hq && <Text style={s.cardSub}>Zordy model: {hq.provider}/{hq.model}</Text>}
                  <Text style={s.cardSub}>
                    Paid fallback {paidFallback ? 'ON' : 'OFF'}
                    {usageToday ? ` · today actual ${money(usageToday.actualCents)} · paid-equivalent ${money(usageToday.cents)}` : ''}
                  </Text>
                  {paidFallback && can('ai.pause_actions') && (
                    <SmallBtn label="Disable paid fallback" icon={X} danger onPress={() => void disablePaidFallback()} />
                  )}
                </>
              );
            })()}
          </View>
        )}
      </Card>

      <Text style={s.h2}>Approval queue · {pending.length}</Text>
      {pending.length === 0 && <Card><Text style={s.cardSub}>No proposals waiting.</Text></Card>}
      {pending.map((r) => (
        <Card key={r.id}>
          <View style={s.rowBetween}>
            <Text style={[s.riskBadge, r.risk_level >= 3 && { color: C.red, backgroundColor: '#FEF2F2' }]}>RISK {r.risk_level}</Text>
            <Text style={s.cardSub}>{AGENT_PRESENTATION[r.agent_id]?.label ?? r.agent_id}</Text>
          </View>
          <Text style={[s.cardTitle, { marginTop: 8 }]}>{r.human_summary}</Text>
          <Text style={s.cardSub}>{r.requested_action}{r.reason ? ` · ${r.reason}` : ''}</Text>
          <Text style={s.mono}>{JSON.stringify(r.parameters)}</Text>
          {can('ai.approve_actions') && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <SmallBtn label="Approve" icon={Check} onPress={() => confirmReview(r, true)} />
              <SmallBtn label="Reject" icon={X} danger onPress={() => confirmReview(r, false)} />
            </View>
          )}
        </Card>
      ))}

      {approved.length > 0 && <Text style={s.h2}>Approved — ready to execute</Text>}
      {approved.map((r) => (
        <Card key={r.id}>
          <Text style={s.cardTitle}>{r.human_summary}</Text>
          <Text style={s.cardSub}>Approved and ready for a separate execution decision.</Text>
          {can('ai.approve_actions') && <SmallBtn label="Execute now" icon={Play} onPress={() => confirmExecute(r)} />}
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


// ---------------------------------------------------------------- Seller Concierge
function SellerConcierge({ can, isOwner }: { can: (p: string) => boolean; isOwner: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [funnel, setFunnel] = useState<any | null>(null);
  const [sel, setSel] = useState<any | null>(null);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [preparedAccess, setPreparedAccess] = useState<any | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [room, setRoom] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [business, setBusiness] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [email, setEmail] = useState('');
  const [acquisitionSource, setAcquisitionSource] = useState('SELLER_CONCIERGE');
  const [referralCode, setReferralCode] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [accessPlan, setAccessPlan] = useState<GrantPlan>('grower');
  const [accessDays, setAccessDays] = useState<number | null>(90);
  const [accessReason, setAccessReason] = useState('FOUNDING_SELLER');
  const [accessExplanation, setAccessExplanation] = useState('');
  const [accessNote, setAccessNote] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: cases, error }, { data: f }, { data: a }] = await Promise.all([
      supabase.rpc('admin_concierge_cases'),
      supabase.rpc('admin_seller_concierge_funnel'),
      supabase.from('ai_agents').select('*').in('id', ['boon', 'gnome_hq']),
    ]);
    if (error) alertServerError(error);
    setRows((cases as any[]) ?? []);
    setFunnel(f ?? null);
    setAgents((a as any[]) ?? []);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = async (item: any) => {
    setSel(item);
    const [{ data: d }, { data: src }, { data: access }] = await Promise.all([
      supabase.from('seller_concierge_drafts').select('*').eq('case_id', item.id).order('candidate_index'),
      supabase.from('seller_concierge_sources').select('*').eq('case_id', item.id).order('created_at', { ascending: false }),
      supabase.from('seller_concierge_prepared_entitlements').select('*').eq('case_id', item.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    setDrafts((d as any[]) ?? []);
    setSources((src as any[]) ?? []);
    setPreparedAccess(access ?? null);
  };

  const create = async () => {
    const newBusiness = business.trim();
    const newEmail = email.trim();
    if (newBusiness.length < 2) { Alert.alert('Business name required'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_create_concierge_case', {
      p_business_name: newBusiness,
      p_email: newEmail || null,
      p_seller_name: sellerName.trim() || null,
      p_market_profile: {},
    });
    if (error) { setBusy(false); alertServerError(error); return; }
    const acquisition = await supabase.rpc('admin_set_concierge_acquisition', {
      p_case: data, p_source: acquisitionSource, p_referral_code: referralCode.trim() || null,
    });
    setBusy(false);
    if (acquisition.error) { alertServerError(acquisition.error); return; }
    setBusiness(''); setSellerName(''); setEmail(''); setReferralCode(''); setAcquisitionSource('SELLER_CONCIERGE'); setCreating(false);
    await load();
    await open({ id: data, business_name: newBusiness, invited_email: newEmail, status: 'PREPARED' });
  };

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4,
      quality: 0.85, base64: true,
    });
    if (!result.canceled) setImages(result.assets.filter((a) => Boolean(a.base64)).slice(0, 4));
  };

  const extract = async () => {
    if (!sel || (!sourceText.trim() && images.length === 0)) {
      Alert.alert('Add seller material', 'Choose screenshots or paste inventory text first.'); return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('market-import', {
      body: {
        text: sourceText.trim() || undefined,
        images: images.map((a) => ({ image_base64: a.base64, media_type: a.mimeType ?? 'image/jpeg' })),
      },
    });
    if (error || data?.error || !data?.extraction) {
      setBusy(false);
      Alert.alert('Boon could not read that source', data?.message ?? error?.message ?? 'Try a clearer screenshot or pasted text.');
      return;
    }
    const saved = await supabase.rpc('admin_save_concierge_extraction', {
      p_case: sel.id,
      p_request: data.request_id,
      p_source_type: images.length ? 'FACEBOOK_SCREENSHOT' : 'ADMIN_ENTERED',
      p_source_label: images.length ? `${images.length} seller screenshot${images.length === 1 ? '' : 's'}` : 'Pasted seller inventory',
      p_source_url: null,
      p_extraction: data.extraction,
    });
    setBusy(false);
    if (saved.error) { alertServerError(saved.error); return; }
    setImages([]); setSourceText('');
    await load();
    const nextStatus = Number(saved.data?.needs_compliance) > 0 ? 'NEEDS_COMPLIANCE'
      : Number(saved.data?.needs_info) > 0 ? 'NEEDS_INFO' : 'READY';
    await open({ ...sel, status: nextStatus });
    Alert.alert('Private draft set prepared', `${saved.data?.total ?? 0} product candidates are ready for seller review. Nothing was published.`);
  };

  const sendInvite = async () => {
    const inviteEmail = String(sel?.invited_email ?? '').trim();
    if (!inviteEmail) { Alert.alert('Seller email required', 'Create the case with the seller’s email before sending an invitation.'); return; }
    Alert.alert('Send secure claim invitation?', `Gnome will email ${inviteEmail}. You will never see or set the seller’s password.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setBusy(true);
        const { data, error } = await supabase.functions.invoke('seller-concierge', {
          body: { action: 'send_invite', case_id: sel.id, email: inviteEmail },
        });
        setBusy(false);
        if (error || data?.error) { Alert.alert('Invitation not sent', data?.message ?? error?.message ?? 'Try again.'); return; }
        Alert.alert('Invitation sent', 'The seller must verify the invited email, complete account readiness, and review the private drafts before publishing.');
        await load();
        setSel({ ...sel, status: 'INVITED', invited_at: new Date().toISOString() });
      } },
    ]);
  };

  const prepareAccess = () => {
    if (!sel?.invited_email) { Alert.alert('Seller email required', 'Add the invited email before preparing complimentary access.'); return; }
    if (accessPlan === 'farm' && !isOwner) { Alert.alert('Owner approval required', 'Only the Gnome owner can prepare complimentary Farm access.'); return; }
    if (accessReason === 'OTHER' && !accessExplanation.trim()) { Alert.alert('Explain the reason', 'A short explanation is required when Other is selected.'); return; }
    const planLabel = accessPlan === 'grower' ? 'Pro' : 'Farm';
    const durationLabel = accessDays == null ? 'no expiration' : `${accessDays} days beginning when the seller claims`;
    Alert.alert(`Prepare complimentary ${planLabel}?`, `${durationLabel}. This remains inactive until the verified invited seller claims this Market. Stripe is not changed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Prepare', onPress: async () => {
        setBusy(true);
        const { error } = await supabase.rpc('admin_prepare_concierge_entitlement', {
          p_case: sel.id, p_plan: accessPlan, p_duration_days: accessDays,
          p_reason_code: accessReason, p_reason_explanation: accessExplanation.trim() || null,
          p_note: accessNote.trim() || null, p_approval_reference: null, p_source: 'ADMIN',
        });
        setBusy(false);
        if (error) { alertServerError(error); return; }
        setAccessExplanation(''); setAccessNote('');
        await open(sel);
        Alert.alert('Complimentary access prepared', `${planLabel} will activate only after the correct verified seller claims this invitation. No subscription was created.`);
      } },
    ]);
  };

  const cancelPreparedAccess = () => {
    if (!preparedAccess || preparedAccess.status !== 'APPROVED') return;
    Alert.alert('Cancel prepared access?', 'The seller can still claim their Market, but this complimentary access will not activate.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel access', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('admin_cancel_concierge_entitlement', {
          p_prepared: preparedAccess.id, p_reason: 'Cancelled from Seller Concierge',
        });
        if (error) alertServerError(error); else await open(sel);
      } },
    ]);
  };

  const chatWithBoon = async () => {
    const title = sel ? `Boon · ${sel.business_name}` : 'Boon · Seller Concierge';
    const { data: existing } = await supabase.from('ai_rooms').select('*')
      .eq('title', title).eq('status', 'active').contains('agent_ids', ['boon']).limit(1).maybeSingle();
    if (existing) {
      if (sel && existing.context?.concierge_case_id !== sel.id) {
        const { data: refreshed } = await supabase.from('ai_rooms')
          .update({ context: { concierge_case_id: sel.id } }).eq('id', existing.id).select('*').single();
        setRoom(refreshed ?? existing);
      } else setRoom(existing);
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('ai_rooms').insert({
      title, agent_ids: ['boon'], created_by: auth.user?.id,
      context: sel ? { concierge_case_id: sel.id } : {},
    }).select('*').single();
    if (error) Alert.alert('Could not open Boon', error.message); else setRoom(data);
  };

  if (!can('markets.view')) {
    return <Centered><Text style={s.deniedTitle}>Seller Concierge access is not enabled for your role.</Text></Centered>;
  }
  if (room) return <RoomView room={room} back={() => setRoom(null)} agents={agents} />;

  if (sel) {
    const missing = drafts.filter((d) => d.status === 'NEEDS_INFO');
    const regulated = drafts.filter((d) => d.status === 'NEEDS_COMPLIANCE');
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <BackRow label="← Sellers" onPress={() => setSel(null)} />
        <View style={s.conciergeHero}>
          <View style={s.boonMark}><Store size={25} color="#FFFFFF" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardBig}>{sel.business_name}</Text>
            <Text style={s.cardSub}>Boon prepares · seller reviews · compliance decides · seller publishes</Text>
          </View>
          <Text style={s.riskBadge}>{sel.is_qa ? 'QA · ' : ''}{sel.status}</Text>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 }}>
          <SmallBtn icon={MessageCircle} label="Chat with Boon" onPress={() => void chatWithBoon()} />
          {can('markets.edit') && !sel.claimed_at && <SmallBtn icon={Mail} label={busy ? 'Working…' : sel.invited_at ? 'Resend invitation' : 'Send invitation'} disabled={busy} onPress={() => void sendInvite()} />}
        </View>

        <Card>
          <Text style={s.cardTitle}>Seller claim</Text>
          <Text style={s.cardSub}>{sel.seller_name || 'Seller name not provided'} · {sel.invited_email || 'Email not provided'}</Text>
          <Text style={s.cardSub}>
            {sel.claimed_at ? `Claimed ${String(sel.claimed_at).slice(0, 10)}` : sel.invited_at ? `Invited ${String(sel.invited_at).slice(0, 10)}` : 'Not invited'}
            {' · '}{sel.market_model ?? 'RESERVATION'} · {sel.location_mode ?? 'APPROXIMATE'}
          </Text>
          <Text style={s.cardSub}>No Market or listing becomes public through this workspace.</Text>
        </Card>

        {!sel.claimed_at && can('subscriptions.grant_complimentary') && (
          <Card>
            <Text style={s.cardTitle}>Prepared complimentary access</Text>
            {preparedAccess ? (
              <>
                <Text style={s.cardText}>{promoPlanLabel(String(preparedAccess.plan))} · {preparedAccess.duration_days == null ? 'no expiration' : `${preparedAccess.duration_days} days from claim`}</Text>
                <Text style={s.cardSub}>{String(preparedAccess.reason_code).replaceAll('_', ' ')} · {preparedAccess.status}</Text>
                <Text style={s.cardSub}>{preparedAccess.invite_id ? 'Bound to the current secure invitation' : 'Will bind when the invitation is sent'} · Stripe untouched</Text>
                {preparedAccess.status === 'APPROVED' && <SmallBtn icon={X} label="Cancel prepared access" danger onPress={cancelPreparedAccess} />}
              </>
            ) : (
              <Text style={s.cardSub}>Prepare access now; it stays inactive until this exact invited email claims the Market.</Text>
            )}
            {(!preparedAccess || preparedAccess.status !== 'APPROVED') && (
              <>
                <Text style={s.h3}>Plan</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {GRANT_PLANS.map((p) => (
                    <Pressable key={p.id} onPress={() => setAccessPlan(p.id)} disabled={p.id === 'farm' && !isOwner}
                      style={[s.durationChoice, accessPlan === p.id && s.durationChoiceActive, p.id === 'farm' && !isOwner && { opacity: 0.45 }]}>
                      <Text style={[s.durationText, accessPlan === p.id && s.durationTextActive]}>{p.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.h3}>Begins at claim</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {GRANT_DURATIONS.map((d) => (
                    <Pressable key={d.label} onPress={() => setAccessDays(d.days)}
                      style={[s.durationChoice, accessDays === d.days && s.durationChoiceActive]}>
                      <Text style={[s.durationText, accessDays === d.days && s.durationTextActive]}>{d.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.h3}>Reason</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {GRANT_REASONS.map((r) => (
                    <Pressable key={r.id} onPress={() => setAccessReason(r.id)}
                      style={[s.durationChoice, accessReason === r.id && s.durationChoiceActive]}>
                      <Text style={[s.durationText, accessReason === r.id && s.durationTextActive]}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {accessReason === 'OTHER' && <TextInput style={s.input} value={accessExplanation} onChangeText={setAccessExplanation} placeholder="Required explanation" placeholderTextColor={C.muted} />}
                <TextInput style={s.input} value={accessNote} onChangeText={setAccessNote} placeholder="Internal note (optional)" placeholderTextColor={C.muted} />
                <SmallBtn icon={Gift} label={busy ? 'Preparing…' : 'Prepare complimentary access'} disabled={busy || !sel.invited_email} onPress={prepareAccess} />
              </>
            )}
          </Card>
        )}

        {!sel.claimed_at && can('markets.edit') && (
          <Card>
            <Text style={s.cardTitle}>Add seller material</Text>
            <Text style={s.cardSub}>Screenshots are analyzed in memory. Only the structured extraction, provenance, and missing fields are retained.</Text>
            <TextInput style={[s.input, { minHeight: 100, marginTop: 10 }]} multiline
              placeholder="Paste inventory, prices, pickup details, or seller notes…" value={sourceText}
              onChangeText={setSourceText} placeholderTextColor={C.muted} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <SmallBtn icon={ImagePlus} label={images.length ? `${images.length} selected` : 'Choose screenshots'} onPress={() => void pickImages()} />
              <SmallBtn icon={Sparkles} label={busy ? 'Boon is reading…' : 'Prepare private drafts'} disabled={busy || (!sourceText.trim() && images.length === 0)} onPress={() => void extract()} />
            </View>
          </Card>
        )}

        <Text style={s.h2}>Prepared products ({drafts.length})</Text>
        {drafts.length === 0 && <Card><Text style={s.cardSub}>Add seller material to prepare the first private draft set.</Text></Card>}
        {drafts.map((d) => (
          <Card key={d.id}>
            <View style={s.rowBetween}>
              <Text style={[s.cardTitle, { flex: 1 }]}>{d.candidate?.product_name ?? 'Product'}</Text>
              <Text style={[s.riskBadge, { color: d.status === 'READY' ? C.green : C.gold }]}>{String(d.status).replaceAll('_', ' ')}</Text>
            </View>
            <Text style={s.cardSub}>
              {d.candidate?.price_cents != null ? money(Number(d.candidate.price_cents)) : 'Price missing'}
              {d.candidate?.unit ? ` / ${d.candidate.unit}` : ' · unit missing'} · source: {d.source_attribution}
            </Text>
            {d.candidate?.evidence ? <Text style={s.cardText}>Evidence: {d.candidate.evidence}</Text> : null}
            {(d.missing_information ?? []).slice(0, 3).map((m: string) => <Text key={m} style={s.cardSub}>Needs seller: {m}</Text>)}
          </Card>
        ))}
        {(missing.length > 0 || regulated.length > 0) && (
          <Card><Text style={s.cardSub}>{missing.length} need seller information · {regulated.length} require compliance review. Neither can bypass normal publication gates.</Text></Card>
        )}
        {sources.length > 0 && <Text style={s.stamp}>{sources.length} source record{sources.length === 1 ? '' : 's'} retained with fingerprints and attribution.</Text>}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.orange} />}>
      <View style={s.conciergeHero}>
        <View style={s.boonMark}><Store size={27} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}><Text style={s.cardBig}>Seller Concierge</Text><Text style={s.cardSub}>Boon runs seller acquisition under Zordy’s operating controls.</Text></View>
        <Pressable style={s.iconCommand} onPress={() => void chatWithBoon()}><MessageCircle size={20} color={C.orange} /></Pressable>
      </View>
      {funnel && (
        <View style={s.statusStrip}>
          {Object.entries(funnel).filter(([, v]) => typeof v === 'number').slice(0, 6).map(([k, v]) => (
            <Text key={k} style={s.statusText}>{String(k).replaceAll('_', ' ')} {String(v)}</Text>
          ))}
        </View>
      )}
      {can('markets.edit') && (
        <>
          <SmallBtn icon={Store} label={creating ? 'Close new seller' : 'Prepare a seller'} onPress={() => setCreating((v) => !v)} />
          {creating && (
            <Card>
              <TextInput style={s.input} placeholder="Business or stand name" value={business} onChangeText={setBusiness} placeholderTextColor={C.muted} />
              <TextInput style={s.input} placeholder="Seller name (optional)" value={sellerName} onChangeText={setSellerName} placeholderTextColor={C.muted} />
              <TextInput style={s.input} placeholder="Seller email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor={C.muted} />
              <TextInput style={s.input} placeholder="Acquisition source (for example MARKET_QR)" value={acquisitionSource} onChangeText={(v) => setAcquisitionSource(v.toUpperCase())} autoCapitalize="characters" placeholderTextColor={C.muted} />
              <TextInput style={s.input} placeholder="Referral code (optional)" value={referralCode} onChangeText={(v) => setReferralCode(v.toUpperCase())} autoCapitalize="characters" placeholderTextColor={C.muted} />
              <SmallBtn label={busy ? 'Preparing…' : 'Create private preparation'} disabled={busy || business.trim().length < 2} onPress={() => void create()} />
            </Card>
          )}
        </>
      )}
      <Text style={s.h2}>Seller pipeline</Text>
      {rows.map((r) => (
        <Pressable key={r.id} onPress={() => void open(r)}>
          <Card>
            <View style={s.rowBetween}><Text style={[s.cardTitle, { flex: 1 }]}>{r.business_name}</Text><Text style={s.riskBadge}>{r.is_qa ? 'QA · ' : ''}{r.status}</Text></View>
            <Text style={s.cardSub}>{r.total_drafts} products · {r.ready} ready · {r.needs_info} need info · {r.needs_compliance} compliance</Text>
            <Text style={s.cardSub}>{r.invited_email || 'No seller email yet'}</Text>
          </Card>
        </Pressable>
      ))}
      {rows.length === 0 && <Card><Text style={s.cardSub}>No seller preparations yet.</Text></Card>}
    </ScrollView>
  );
}

// NULL from the allowance RPC means unlimited. It is never a number, and must never be coerced
// into one — `allow.publishes_allowed ?? 0` would turn Farm's unlimited into a hard zero.
const cap = (v: number | null | undefined) => (v === null || v === undefined ? 'Unlimited' : String(v));
// ---------------------------------------------------------------- More (Users / Entitlements / Team / Audit)
type MoreView = 'menu' | 'users' | 'team' | 'audit' | 'inventory' | 'commercial' | 'seasons' | 'listings' | 'markets' | 'moderation' | 'support' | 'stripe' | 'promos' | 'growth' | 'executives';
function More({ can, isOwner }: { can: (p: string) => boolean; isOwner: boolean }) {
  const [view, setView] = useState<MoreView>('menu');
  if (view === 'users') return <Users back={() => setView('menu')} can={can} isOwner={isOwner} />;
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
  if (view === 'promos') return <PromoCampaigns back={() => setView('menu')} />;
  if (view === 'growth') return <GrowthOperations back={() => setView('menu')} />;
  if (view === 'executives') return <ExecutiveSystem back={() => setView('menu')} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {can('ai.view') && <MenuRow label="🧭 Executive System" onPress={() => setView('executives')} />}
      {can('subscriptions.view') && <MenuRow label="💰 Revenue & Promotions" onPress={() => setView('commercial')} />}
      {can('seed_drop.view') && <MenuRow label="🌦 Seed Drop Seasons" onPress={() => setView('seasons')} />}
      {can('inventory.view') && <MenuRow label="🌱 Inventory" onPress={() => setView('inventory')} />}
      {can('listings.view') && <MenuRow label="🏷 Listings" onPress={() => setView('listings')} />}
      {can('listings.moderate') && <MenuRow label="⚖️ Moderation Queue" onPress={() => setView('moderation')} />}
      {can('markets.view') && <MenuRow label="🏡 Markets" onPress={() => setView('markets')} />}
      {can('support.view') && <MenuRow label="🚩 Support & Reports" onPress={() => setView('support')} />}
      {can('users.view') && <MenuRow label="👥 Users & Entitlements" onPress={() => setView('users')} />}
      {can('subscriptions.view') && <MenuRow label="💳 Billing Health" onPress={() => setView('stripe')} />}
      {can('subscriptions.view') && <MenuRow label="🎟 Promo Codes" onPress={() => setView('promos')} />}
      {(can('marketing.view') || isOwner) && <MenuRow label="↗ Growth & Referrals" onPress={() => setView('growth')} />}
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

function ExecutiveSystem({ back }: { back: () => void }) {
  const [dash, setDash] = useState<any | null>(null);
  const [intel, setIntel] = useState<any | null>(null);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: d }, { data: i }, { data: a }, { data: h }] = await Promise.all([
      supabase.rpc('admin_executive_dashboard'),
      supabase.rpc('admin_company_intelligence'),
      supabase.from('ai_action_requests').select('*').in('status', ['PENDING', 'APPROVED']).order('requested_at', { ascending: false }).limit(20),
      supabase.from('admin_audit_log').select('action, actor_type, resource_type, resource_id, created_at').order('created_at', { ascending: false }).limit(20),
    ]);
    setDash(d ?? null);
    setIntel(i ?? null);
    setApprovals((a as any[]) ?? []);
    setHistory((h as any[]) ?? []);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
      <BackRow label="← More" onPress={back} />
      <Text style={s.h2}>Executive System</Text>
      {!dash && <Card><Text style={s.cardSub}>Executive dashboard data is unavailable until the migration is deployed.</Text></Card>}
      {dash && (
        <>
          <Row2 items={[['Health', Number(dash.health_score ?? 0)], ['Attention', Number(dash.attention_count ?? 0)], ['Approvals', Number(dash.pending_approvals ?? 0)]]} />
          <Text style={s.h2}>Agents</Text>
          {((dash.agents ?? []) as any[]).map((a) => {
            const meta = AGENT_PRESENTATION[a.id] ?? { label: a.name, role: a.title, color: C.primary, icon: Bot };
            const counts = a.open_findings ?? {};
            const open = Number(counts.critical ?? 0) + Number(counts.urgent ?? 0) + Number(counts.important ?? 0) + Number(counts.watch ?? 0);
            return (
              <Card key={a.id}>
                <View style={s.rowBetween}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.cardTitle}>{meta.label}</Text>
                    <Text style={s.cardSub}>{a.title} · {a.authority_level} · {a.data_classification}</Text>
                  </View>
                  <Text style={[s.riskBadge, open > 0 && { color: C.gold }]}>{open ? `${open} OPEN` : 'HEALTHY'}</Text>
                </View>
                <Text style={s.cardSub}>
                  Last {a.last_analysis_at ? new Date(a.last_analysis_at).toLocaleString() : 'not analyzed'} · Next {a.next_check_at ? new Date(a.next_check_at).toLocaleString() : 'not scheduled'}
                </Text>
              </Card>
            );
          })}
          <Text style={s.h2}>Findings</Text>
          {((dash.findings ?? []) as any[]).length === 0 && <Card><Text style={s.cardSub}>No open findings.</Text></Card>}
          {((dash.findings ?? []) as any[]).slice(0, 12).map((f) => (
            <Card key={f.id}>
              <View style={s.rowBetween}><Text style={s.riskBadge}>{f.severity}</Text><Text style={s.cardSub}>{f.agent_name}</Text></View>
              <Text style={[s.cardTitle, { marginTop: 8 }]}>{f.title}</Text>
              <Text style={s.cardSub}>{f.summary}</Text>
            </Card>
          ))}
          <Text style={s.h2}>Schedules</Text>
          {((dash.heartbeats ?? []) as any[]).length === 0 && <Card><Text style={s.cardSub}>No heartbeat runs recorded yet.</Text></Card>}
          {((dash.heartbeats ?? []) as any[]).map((h) => (
            <Card key={`${h.agent_id}-${h.created_at}`}><Text style={s.cardTitle}>{AGENT_PRESENTATION[h.agent_id]?.label ?? h.agent_id}</Text><Text style={s.cardSub}>{h.status} · {new Date(h.created_at).toLocaleString()}</Text></Card>
          ))}
        </>
      )}
      <Text style={s.h2}>Analytics</Text>
      {intel ? (
        <Card>
          <Text style={s.cardSub}>Sample size: claims {intel.sample_size?.claims ?? 0} · orders {intel.sample_size?.market_orders ?? 0} · views {intel.sample_size?.listing_views_30d ?? 0}</Text>
          <Text style={s.cardSub}>Confidence: {intel.confidence ?? 'DATA UNAVAILABLE'}</Text>
          <Text style={s.cardSub}>Zero-result searches: {intel.search_demand?.zero_results_30d ?? 'NOT CURRENTLY TRACKED'}</Text>
          <Text style={s.cardSub}>Seller GMV 30d: {money(Number(intel.finance?.seller_recorded_gmv?.gross_cents_30d ?? 0))}</Text>
          <Text style={s.cardSub}>Gnome MRR: {money(Number(intel.finance?.gnome_revenue?.mrr_cents ?? 0))}</Text>
        </Card>
      ) : <Card><Text style={s.cardSub}>Company intelligence data unavailable.</Text></Card>}
      <Text style={s.h2}>Approvals</Text>
      {approvals.length === 0 && <Card><Text style={s.cardSub}>No yellow actions waiting.</Text></Card>}
      {approvals.map((a) => <Card key={a.id}><Text style={s.cardTitle}>{a.human_summary}</Text><Text style={s.cardSub}>{a.agent_id} · {a.requested_action} · {a.status}</Text></Card>)}
      <Text style={s.h2}>Action history</Text>
      {history.map((h, i) => <Card key={`${h.created_at}-${i}`}><Text style={s.cardSub}>{h.action} · {h.actor_type} · {h.resource_type ?? 'system'} · {String(h.created_at).slice(0, 16).replace('T', ' ')}</Text></Card>)}
    </ScrollView>
  );
}

function GrowthOperations({ back }: { back: () => void }) {
  const [summary, setSummary] = useState<any | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true); setError(null);
    const [s1, s2] = await Promise.all([
      supabase.rpc('admin_referral_growth_summary'),
      supabase.rpc('admin_referral_growth_rows'),
    ]);
    if (s1.error || s2.error) {
      setError(s1.error?.message ?? s2.error?.message ?? 'Growth data unavailable.');
      setSummary(null); setRows([]);
    } else {
      setSummary(s1.data); setRows((s2.data as any[]) ?? []);
    }
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
      <BackRow label="← More" onPress={back} />
      <Text style={s.h2}>Growth & referrals</Text>
      {error ? <Card><Text style={[s.cardSub, { color: C.red }]}>{error}</Text></Card> : null}
      {!summary && !error ? <Card><ActivityIndicator color={C.primary} /></Card> : null}
      {summary ? (
        <>
          <Row2 items={[
            ['Attributed', Number(summary.attributed ?? 0)],
            ['Qualified sellers', Number(summary.qualified ?? 0)],
            ['Qualification %', Number(summary.qualification_rate ?? 0)],
          ]} />
          <Row2 items={[
            ['Listing credits', Number(summary.listing_credits_issued ?? 0)],
            ['Pro days', Number(summary.pro_days_issued ?? 0)],
            ['Market boosts', Number(summary.market_boosts_issued ?? 0)],
          ]} />
          <Card>
            <Text style={s.cardTitle}>Launch controls</Text>
            <Text style={s.cardSub}>Buyer rewards deferred: {summary.buyer_rewards_deferred ?? 0}</Text>
            <Text style={s.cardSub}>25 / 50 milestones tracked: {summary.milestone_25 ?? 0} / {summary.milestone_50 ?? 0}</Text>
            <Text style={[s.cardSub, { color: summary.payments_live_enabled ? C.red : C.green }]}>Payments live: {summary.payments_live_enabled ? 'YES' : 'NO'}</Text>
          </Card>
        </>
      ) : null}
      <Text style={s.h2}>Referrers</Text>
      {rows.map((r) => (
        <Card key={r.referrer_id}>
          <Text style={s.cardTitle}>{r.referrer_name ?? 'Gnome member'}</Text>
          <Text style={s.cardSub}>{r.qualified_sellers} qualified · {r.pending_referrals} pending · {r.rewards_issued} rewards</Text>
          {Number(r.deferred_rewards) > 0 ? <Text style={s.cardSub}>{r.deferred_rewards} buyer reward deferred until seller activation</Text> : null}
        </Card>
      ))}
      {summary && rows.length === 0 ? <Card><Text style={s.cardSub}>No real referral activity yet.</Text></Card> : null}
      <Card>
        <Text style={s.cardTitle}>Ask the growth team</Text>
        <Text style={s.cardSub}>Open Zordy and start a room with Gemma for operations or Marty for effectiveness analysis. Their data excludes QA and contains no fake metrics.</Text>
      </Card>
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
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
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
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
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
  const [providers, setProviders] = useState<any | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stripeIdentity, setStripeIdentity] = useState<any | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [refundLoadError, setRefundLoadError] = useState<string | null>(null);
  const [refundBusy, setRefundBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRefreshing(true);
    const [health, providerHealth, identity, recent] = await Promise.all([
      supabase.rpc('admin_billing_health'),
      supabase.rpc('admin_subscription_health'),
      supabase.functions.invoke('billing-admin', { body: { action: 'identity' } }),
      supabase.functions.invoke('billing-admin', { body: { action: 'recent_payments' } }),
    ]);
    setH(health.data as any);
    setProviders(providerHealth.error ? null : providerHealth.data as any);
    setStripeIdentity(identity.error ? null : identity.data);
    const recentBody = recent.data as any;
    if (recent.error || recentBody?.error) {
      setPayments([]);
      setRefundLoadError(recentBody?.message ?? recentBody?.detail ?? 'Could not load Stripe payments.');
    } else {
      setPayments(Array.isArray(recentBody?.payments) ? recentBody.payments : []);
      setRefundLoadError(null);
    }
    setRefreshing(false);
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

  const refundPayment = (payment: any) => {
    if (!stripeIdentity?.account_id) {
      Alert.alert('Stripe account unavailable', 'Zordy could not verify the connected Stripe TEST account. No refund was attempted.');
      return;
    }
    const amount = money(Number(payment.amount_total ?? 0));
    const subscription = payment.mode === 'subscription' && !!payment.subscription_id;
    const who = payment.customer_email ?? payment.customer_name ?? 'this customer';
    Alert.alert(
      `Refund ${amount}?`,
      `${who}\n${String(payment.product_key ?? 'Gnome payment')}\n\nThe money returns to the original payment method.${subscription ? ' The TEST subscription will also be cancelled to prevent another renewal.' : ''}`,
      [
        { text: 'Keep payment', style: 'cancel' },
        { text: 'Issue refund', style: 'destructive', onPress: async () => {
          setRefundBusy(payment.session_id);
          const { data, error } = await supabase.functions.invoke('billing-admin', {
            body: {
              action: 'refund_payment',
              session_id: payment.session_id,
              cancel_subscription: subscription,
              confirm_account_id: stripeIdentity.account_id,
            },
          });
          setRefundBusy(null);
          const result = data as any;
          if (error || result?.error || result?.ok !== true) {
            Alert.alert('Refund failed', result?.message ?? result?.detail ?? 'Stripe did not issue a refund.');
            return;
          }
          Alert.alert(
            result.subscription_cancel_error ? 'Refund issued; cancellation needs attention' : 'Refund submitted',
            `${money(Number(result.amount ?? payment.amount_total ?? 0))} is returning to the original payment method.${result.subscription_cancelled ? ' The subscription was cancelled.' : ''}${result.subscription_cancel_error ? ' Stripe could not cancel the subscription, so review it before the next renewal.' : ''}`,
          );
          void load();
        } },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
      <BackRow label="← More" onPress={back} />
      <Card>
        <Text style={s.cardBig}>{live ? 'LIVE payments ON 🔴' : 'Test mode 🧪'}</Text>
        <Text style={s.cardSub}>
          {live ? 'Gnome is creating real Stripe charges.' : 'Gnome creates Stripe TEST charges only — no real money moves. Live payments stay OFF until you enable them.'}
        </Text>
        {isOwner && h?.payments_live_enabled != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={s.cardTitle}>Payments Live</Text>
            <Switch value={live} onValueChange={toggleLive} disabled={!live} trackColor={{ true: C.red }} />
          </View>
        )}
        {!live ? <Text style={s.cardSub}>Activation is locked here until Apple sandbox, Google license testing, Stripe reconciliation, and owner approval are all recorded.</Text> : null}
      </Card>

      <Text style={s.h2}>Subscriptions by provider</Text>
      <Card>
        <Text style={s.cardTitle}>Verified entitlement ledger</Text>
        <Text style={s.cardSub}>Production paying: Apple {providers?.counts_by_source?.APPLE ?? 0} · Google Play {providers?.counts_by_source?.GOOGLE_PLAY ?? 0} · Website {providers?.counts_by_source?.STRIPE ?? 0}</Text>
        <Text style={s.cardSub}>Production trials {providers?.active_trial_total ?? 0} · Sandbox/test subscriptions {providers?.test_subscription_total ?? 0}</Text>
        <Text style={s.cardSub}>Pro {providers?.counts_by_plan?.grower ?? 0} · Farm {providers?.counts_by_plan?.farm ?? 0} · Complimentary {providers?.complimentary_active ?? 0}</Text>
        <Text style={s.cardSub}>Estimated gross monthly subscription value: {money(Number(providers?.estimated_gross_mrr_cents ?? 0))}. Store fees, taxes, refunds, and settlement timing are not netted here.</Text>
      </Card>
      {(providers?.subscriptions ?? []).map((sub:any,index:number)=>(
        <Card key={`${sub.source}-${sub.user_id}-${index}`}>
          <Text style={s.cardTitle}>{sub.user} · {promoPlanLabel(String(sub.plan))}</Text>
          <Text style={s.cardSub}>{sub.source==='APPLE'?'Apple':sub.source==='GOOGLE_PLAY'?'Google Play':'Stripe website'} · {sub.status} · {sub.environment}</Text>
          <Text style={s.cardSub}>Renewal/end: {sub.renewal?String(sub.renewal).slice(0,10):'not reported'} · verified {sub.last_verified?String(sub.last_verified).slice(0,16).replace('T',' '):'unverified'}</Text>
          {sub.source!=='STRIPE'?<Text style={s.cardSub}>Refunds and cancellations are managed by {sub.source==='APPLE'?'Apple':'Google Play'}, not Stripe.</Text>:null}
        </Card>
      ))}

      <Text style={s.h2}>Refunds</Text>
      <Card>
        <View style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Recent Stripe payments</Text>
            <Text style={s.cardSub}>Owner-confirmed TEST refunds only. Card details never enter Gnome Admin.</Text>
          </View>
          <RotateCcw size={20} color={C.primary} />
        </View>
        {refundLoadError ? <Text style={[s.cardSub, { color: C.red, marginTop: 8 }]}>{refundLoadError}</Text> : null}
      </Card>
      {payments.slice(0, 10).map((p) => (
        <Card key={p.session_id}>
          <View style={s.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{p.customer_email ?? p.customer_name ?? 'Stripe customer'}</Text>
              <Text style={s.cardSub}>
                {p.product_key ?? 'Gnome payment'} · {p.mode === 'subscription' ? 'subscription' : 'one-time'}
              </Text>
              <Text style={s.cardSub}>{money(Number(p.amount_total ?? 0))} · {new Date(Number(p.created ?? 0) * 1000).toLocaleDateString()}</Text>
            </View>
            {p.refunded ? <Text style={s.refundedBadge}>REFUNDED</Text> : null}
          </View>
          <SmallBtn icon={RotateCcw}
            label={p.refunded ? 'Refunded' : refundBusy === p.session_id ? 'Refunding...' : 'Review refund'}
            danger={!p.refunded} disabled={p.refunded || refundBusy !== null}
            onPress={() => refundPayment(p)} />
        </Card>
      ))}
      {!refundLoadError && payments.length === 0 ? (
        <Card><Text style={s.cardSub}>No paid TEST sessions are available to refund.</Text></Card>
      ) : null}

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

type GrantPlan = 'grower' | 'farm';
const GRANT_PLANS: { id: GrantPlan; label: string; detail: string }[] = [
  { id: 'grower', label: 'Pro', detail: 'Higher limits and seller tools' },
  { id: 'farm', label: 'Farm', detail: 'Top sellable plan with unlimited listings' },
];
const GRANT_DURATIONS: { days: number | null; label: string }[] = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: null, label: 'No expiry' },
];
const GRANT_REASONS: { id: string; label: string }[] = [
  { id: 'FOUNDING_SELLER', label: 'Founding seller' },
  { id: 'SUPPORT_RESOLUTION', label: 'Support resolution' },
  { id: 'INTERNAL_QA', label: 'Internal QA' },
  { id: 'PARTNER', label: 'Partner' },
  { id: 'PROMOTION', label: 'Promotion' },
  { id: 'INFLUENCER_CREATOR', label: 'Creator' },
  { id: 'COMMUNITY_PARTNER', label: 'Community partner' },
  { id: 'OTHER', label: 'Other' },
];

function Users({ back, can, isOwner }: { back: () => void; can: (p: string) => boolean; isOwner: boolean }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [ent, setEnt] = useState<any | null>(null);
  const [mkt, setMkt] = useState<any | null>(null);
  const [promo, setPromo] = useState<any | null>(null);
  // 'loading' | 'ok' | 'none' | 'error' are kept apart deliberately: a seller with no activity and
  // an RPC that failed must never look the same. Rendering 0s on error would tell an admin the
  // seller had published nothing, which is a worse answer than admitting we do not know.
  const [allow, setAllow] = useState<any | null>(null);
  const [allowState, setAllowState] = useState<'loading' | 'ok' | 'none' | 'error'>('loading');
  const [wanted, setWanted] = useState<any | null>(null);
  const [wantedState, setWantedState] = useState<'loading' | 'ok' | 'none' | 'error'>('loading');
  const [qrInfo, setQr] = useState<any | null>(null);
  const [qrState, setQrState] = useState<'loading' | 'ok' | 'none' | 'error'>('loading');
  const [grantPlan, setGrantPlan] = useState<GrantPlan>('grower');
  const [grantDays, setGrantDays] = useState<number | null>(30);
  const [grantReason, setGrantReason] = useState('FOUNDING_SELLER');
  const [grantExplanation, setGrantExplanation] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const [billingMode, setBillingMode] = useState<'loading' | 'test' | 'live' | 'unknown'>('loading');

  const search = async () => {
    const { data } = await supabase.from('profiles')
      .select('id,name,city,state,user_type,suspended,created_at')
      .ilike('name', `%${q}%`).limit(20);
    setRows(data ?? []); setSel(null);
  };
  const open = async (p: any) => {
    setSel(p); setEnt(null); setMkt(null); setPromo(null); setAllow(null); setAllowState('loading');
    setWanted(null); setWantedState('loading'); setQr(null); setQrState('loading');
    setBillingMode(can('subscriptions.view') ? 'loading' : 'unknown');
    if (can('subscriptions.view')) {
      void supabase.rpc('admin_billing_health').then(({ data, error }) => {
        if (error) setBillingMode('unknown');
        else setBillingMode((data as any)?.payments_live_enabled === true ? 'live' : 'test');
      });
    }
    const { data: m } = await supabase.from('markets').select('id,name,plan').eq('owner_id', p.id).limit(1).maybeSingle();
    setMkt(m);
    if (m) {
      const [{ data: e }, { data: ps }, au] = await Promise.all([
        supabase.rpc('admin_market_entitlements_v2', { p_market: m.id }),
        supabase.rpc('market_promotion_status', { p_market: m.id }),
        // admin_market_allowance, NOT market_allowance_usage: the latter is revoked from
        // authenticated on purpose, because it takes a market id and would let any seller read any
        // other seller. The wrapper re-checks is_admin() server-side.
        supabase.rpc('admin_market_allowance', { p_market: m.id }),
      ]);
      setEnt(e); setPromo(ps as any);
      const effectivePlan = String((e as any)?.effective?.plan ?? m.plan);
      setGrantPlan(effectivePlan === 'free' ? 'grower' : 'farm');
      setGrantDays(30);
      const arow = Array.isArray(au.data) ? au.data[0] : au.data;
      if (au.error) { setAllow(null); setAllowState('error'); }
      else if (!arow) { setAllow(null); setAllowState('none'); }
      else { setAllow(arow); setAllowState('ok'); }
      const qq = await supabase.rpc('admin_market_qr', { p_market: m.id });
      const qrow = Array.isArray(qq.data) ? qq.data[0] : qq.data;
      if (qq.error) { setQr(null); setQrState('error'); }
      else if (!qrow) { setQr(null); setQrState('none'); }
      else { setQr(qrow); setQrState('ok'); }
      // Wanted usage hangs off the USER, not the market — introductions are claims by claimer_id.
      const wq = await supabase.rpc('admin_wanted_usage', { p_user: p.id });
      const wrow = Array.isArray(wq.data) ? wq.data[0] : wq.data;
      if (wq.error) { setWanted(null); setWantedState('error'); }
      else if (!wrow) { setWanted(null); setWantedState('none'); }
      else { setWanted(wrow); setWantedState('ok'); }
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
  const grant = (plan: GrantPlan, days: number | null, overlap = 'CANCEL_NEW') => {
    if (!mkt) return;
    if (plan === 'farm' && !isOwner) { Alert.alert('Owner approval required', 'Only the Gnome owner can grant complimentary Farm access.'); return; }
    if (grantReason === 'OTHER' && !grantExplanation.trim()) { Alert.alert('Explain the reason', 'A short explanation is required when Other is selected.'); return; }
    const label = plan === 'grower' ? 'Pro' : 'Farm';
    const duration = days ? `${days} days` : 'no expiration';
    const expires = days ? new Date(Date.now() + days * 864e5).toISOString() : null;
    const execute = async () => {
      setGrantBusy(true);
      const { data, error } = await supabase.rpc('admin_grant_plan_v2', {
        p_market: mkt.id, p_plan: plan, p_expires: expires,
        p_reason_code: grantReason, p_reason_explanation: grantExplanation.trim() || null,
        p_note: grantNote.trim() || null, p_approval_reference: null,
        p_source: 'ADMIN', p_overlap_action: overlap,
      });
      setGrantBusy(false);
      if (error) { alertServerError(error); return; }
      if (data?.outcome === 'OVERLAP') {
        const existing = `${promoPlanLabel(String(data.existing_plan))}${data.existing_expires_at ? ` until ${String(data.existing_expires_at).slice(0, 10)}` : ' with no expiration'}`;
        Alert.alert('Complimentary access already exists', `${existing}. Choose exactly how to handle it.`, [
          { text: 'Cancel', style: 'cancel' },
          ...(data.existing_plan === plan && data.existing_expires_at
            ? [{ text: 'Extend current', onPress: () => grant(plan, days, 'EXTEND_CURRENT') }]
            : []),
          { text: 'Replace current', style: 'destructive', onPress: () => grant(plan, days, 'REPLACE_CURRENT') },
        ]);
        return;
      }
      Alert.alert(`${label} access ${String(data?.outcome ?? 'granted').toLowerCase()}`, `${sel.name}'s paid subscription was not changed or charged.`);
      setGrantNote(''); setGrantExplanation('');
      void open(sel);
    };
    Alert.alert(`Grant complimentary ${label}?`, `${duration}. Reason: ${GRANT_REASONS.find((r) => r.id === grantReason)?.label}. This changes access but never creates or alters a Stripe subscription.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Grant', onPress: () => void execute() },
    ]);
  };
  const shareUpgrade = async () => {
    await Share.share({
      title: 'Gnome seller plans',
      message: 'Choose the Gnome plan that fits your Market. Sign in with your Gnome account to continue securely: https://gnomefarmersmarket.com/pricing',
    });
  };
  const revoke = (gid: string) => {
    Alert.alert('Revoke this grant?', 'The Market falls back to its next valid entitlement.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('admin_revoke_grant_v2', { p_grant: gid, p_reason: 'Revoked from Gnome Admin' });
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
    const grants = (ent?.history ?? []) as any[];
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
            <Text style={s.cardSub}>
              Paid access: {promoPlanLabel(String(ent?.paid?.plan ?? mkt.plan))} · {ent?.paid?.status ?? 'unknown'}
              {ent?.paid?.livemode === false ? ' · Stripe TEST' : ''}
            </Text>
            {ent?.complimentary && (
              <Text style={s.cardSub}>
                Complimentary: {promoPlanLabel(String(ent.complimentary.plan))} · {ent.complimentary.reason}
                {ent.complimentary.expires_at ? ` · until ${String(ent.complimentary.expires_at).slice(0, 10)}` : ' · no expiration'}
              </Text>
            )}
            {/* Sell allowance. Every figure is a field from admin_market_allowance — nothing here
                adds, subtracts or derives one. In particular `actual` is NOT used+paid: that holds
                on metered plans and is wrong on Farm, where all activity is funded='unlimited', so
                included used is legitimately 0 while actual is 47. */}
            {allowState === 'loading' && <Text style={s.cardSub}>Sell allowance: loading…</Text>}
            {allowState === 'error' && (
              <Text style={[s.cardSub, { color: C.red }]}>
                Sell allowance: unable to load. The allowance RPCs (0104–0108) may not be applied in
                this environment. This is NOT zero usage.
              </Text>
            )}
            {allowState === 'none' && (
              <Text style={s.cardSub}>Sell allowance: no allowance record for this Market.</Text>
            )}
            {allowState === 'ok' && allow && (
              <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 }}>
                <Text style={s.cardSub}>
                  {/* Customer-facing name leads; the internal enum is secondary and admin-only. */}
                  Plan: {allow.display_name}  ·  internal: {allow.plan}
                </Text>
                <Text style={s.cardSub}>
                  Period: {String(allow.period_start).slice(0, 10)} → {String(allow.period_end).slice(0, 10)}
                  {'  ·  resets '}{String(allow.period_end).slice(0, 10)}  ·  {allow.period_source}
                </Text>

                <Text style={[s.cardSub, { marginTop: 6, fontWeight: '600' }]}>LISTINGS (Sell only)</Text>
                <Text style={s.cardSub}>
                  Allowed: {cap(allow.publishes_allowed)}  ·  included used: {allow.publishes_used}
                  {'  ·  actual published: '}{allow.publishes_actual}
                </Text>
                <Text style={s.cardSub}>
                  Paid overages this period: {allow.paid_publishes_period}
                  {'  ·  remaining: '}{cap(allow.publishes_remaining)}
                </Text>

                <Text style={[s.cardSub, { marginTop: 6, fontWeight: '600' }]}>RENEWALS</Text>
                <Text style={s.cardSub}>
                  Allowed: {cap(allow.renewals_allowed)}  ·  included used: {allow.renewals_used}
                  {'  ·  actual renewed: '}{allow.renewals_actual}
                </Text>
                <Text style={s.cardSub}>
                  Paid renewals this period: {allow.paid_renewals_period}
                  {'  ·  remaining: '}{cap(allow.renewals_remaining)}
                </Text>

                <Text style={[s.cardSub, { marginTop: 6, fontWeight: '600' }]}>LIFETIME OVERAGE</Text>
                <Text style={s.cardSub}>
                  Paid publishes: {allow.paid_publishes_lifetime}  ·  paid renewals: {allow.paid_renewals_lifetime}
                  {'  ·  spend: '}{money(allow.paid_cents_lifetime)}  (this period {money(allow.paid_cents_period)})
                </Text>
                <Text style={s.cardSub}>
                  Sell listings: {allow.active_listings} active · {allow.expired_listings} expired
                </Text>
              </View>
            )}
            {wantedState === 'error' && (
              <Text style={[s.cardSub, { color: C.red }]}>
                Wanted usage: unable to load (0110 may not be applied). This is NOT zero usage.
              </Text>
            )}
            {wantedState === 'ok' && wanted && (
              <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 }}>
                <Text style={[s.cardSub, { fontWeight: '600' }]}>WANTED INTRODUCTIONS (daily)</Text>
                <Text style={s.cardSub}>
                  Allowed: {cap(wanted.allowed)}  ·  used today: {wanted.used_today}
                  {'  ·  remaining: '}{cap(wanted.remaining)}
                  {wanted.hit_limit_today ? '  ·  AT LIMIT' : ''}
                </Text>
                <Text style={s.cardSub}>Lifetime introductions: {wanted.lifetime_intros}</Text>
                {(wanted.recent ?? []).slice(0, 5).map((r: any, i: number) => (
                  <Text key={`${r.created_at}-${i}`} style={s.cardSub}>
                    · “{r.title}” — {String(r.created_at).slice(0, 10)} ({r.status})
                  </Text>
                ))}
              </View>
            )}
            {qrState === 'error' && (
              <Text style={[s.cardSub, { color: C.red }]}>
                Market QR: unable to load (0111 may not be applied). Not the same as no QR.
              </Text>
            )}
            {qrState === 'ok' && qrInfo && (
              <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 }}>
                <Text style={[s.cardSub, { fontWeight: '600' }]}>MARKET QR</Text>
                <Text style={s.cardSub}>
                  Public URL: gnomefarmersmarket.com/market/{qrInfo.market_slug ?? '—'}
                </Text>
                <Text style={s.cardSub}>
                  {qrInfo.code
                    ? `QR: /q/${qrInfo.code} · issued ${String(qrInfo.created_at).slice(0, 10)} · scans ${qrInfo.scans_total} (30d: ${qrInfo.scans_30d})`
                    : 'QR: not issued'}
                  {'  ·  tools: '}{qrInfo.entitled ? 'entitled' : 'locked'}
                </Text>
                {/* Recovery = re-render the asset from this same durable code, on web or mobile.
                    There is deliberately no rotate-code control here or anywhere. */}
              </View>
            )}
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
            {(can('subscriptions.grant_complimentary') || can('subscriptions.view')) && (
              <View style={s.planManager}>
                <View style={s.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.h3}>Manage plan</Text>
                    <Text style={s.cardSub}>Help this seller upgrade without handling their payment details.</Text>
                  </View>
                  <Sparkles size={20} color={C.primary} />
                </View>

                {can('subscriptions.grant_complimentary') && (
                  <>
                    <View style={s.planSectionTitle}>
                      <Gift size={15} color={C.primary} />
                      <Text style={s.planSectionText}>Complimentary access</Text>
                    </View>
                    <View style={s.planChoiceRow}>
                      {GRANT_PLANS.filter((p) => {
                        const current = String(ent?.effective?.plan ?? mkt.plan);
                        return current === 'free' || current === p.id || p.id === 'farm';
                      }).map((p) => (
                        <Pressable key={p.id} onPress={() => setGrantPlan(p.id)} disabled={p.id === 'farm' && !isOwner}
                          style={[s.planChoice, grantPlan === p.id && s.planChoiceActive, p.id === 'farm' && !isOwner && { opacity: 0.45 }]}>
                          <Text style={[s.planChoiceName, grantPlan === p.id && s.planChoiceNameActive]}>{p.label}</Text>
                          <Text style={[s.planChoiceDetail, grantPlan === p.id && s.planChoiceDetailActive]}>{p.detail}{p.id === 'farm' && !isOwner ? ' · owner only' : ''}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={s.planSectionTitle}>
                      <CalendarDays size={15} color={C.primary} />
                      <Text style={s.planSectionText}>Duration</Text>
                    </View>
                    <View style={s.durationRow}>
                      {GRANT_DURATIONS.map((d) => (
                        <Pressable key={d.label} onPress={() => setGrantDays(d.days)}
                          style={[s.durationChoice, grantDays === d.days && s.durationChoiceActive]}>
                          <Text style={[s.durationText, grantDays === d.days && s.durationTextActive]}>{d.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={s.planSectionTitle}>
                      <ClipboardCheck size={15} color={C.primary} />
                      <Text style={s.planSectionText}>Reason</Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                      {GRANT_REASONS.map((r) => (
                        <Pressable key={r.id} onPress={() => setGrantReason(r.id)}
                          style={[s.durationChoice, grantReason === r.id && s.durationChoiceActive]}>
                          <Text style={[s.durationText, grantReason === r.id && s.durationTextActive]}>{r.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {grantReason === 'OTHER' && (
                      <TextInput style={[s.input, { marginTop: 8 }]} placeholder="Required explanation" value={grantExplanation}
                        onChangeText={setGrantExplanation} placeholderTextColor={C.muted} />
                    )}
                    <TextInput style={[s.input, { marginTop: 8 }]} placeholder="Internal note (optional)" value={grantNote}
                      onChangeText={setGrantNote} placeholderTextColor={C.muted} />
                    <SmallBtn icon={Gift} label={grantBusy ? 'Granting access...' : `Grant complimentary ${grantPlan === 'grower' ? 'Pro' : 'Farm'}`}
                      disabled={grantBusy || (grantPlan === 'farm' && !isOwner) || (grantReason === 'OTHER' && !grantExplanation.trim())}
                      onPress={() => grant(grantPlan, grantDays)} />
                  </>
                )}

                {can('subscriptions.view') && (
                  <View style={s.selfServePlan}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.planSectionText}>Customer-paid subscription</Text>
                      <Text style={s.cardSub}>
                        {billingMode === 'live'
                          ? 'Share the secure plan page. The customer signs in and controls checkout.'
                          : billingMode === 'test'
                            ? 'Payments are in TEST mode. Share for plan review only; no real subscription will be created.'
                            : billingMode === 'loading' ? 'Checking the current billing mode...'
                              : 'Billing mode could not be verified. Share for plan review only.'}
                      </Text>
                    </View>
                    <SmallBtn icon={Share2} label={billingMode === 'live' ? 'Share signup link' : 'Share plan page'}
                      onPress={() => void shareUpgrade()} disabled={billingMode === 'loading'} />
                  </View>
                )}
              </View>
            )}
            {activeGrants.length > 0 && (
              <>
                <Text style={s.h3}>Active comps</Text>
                {activeGrants.map((g) => (
                  <View key={g.id} style={{ marginTop: 6 }}>
                    <Text style={s.cardText}>
                      {promoPlanLabel(String(g.plan))} · {g.reason} · {g.expires_at ? `until ${String(g.expires_at).slice(0, 10)}` : 'no expiration'}
                    </Text>
                    <Text style={s.cardSub}>Source: {g.source ?? 'ADMIN'} · granted by {g.granted_by ?? 'Gnome admin'}</Text>
                    {can('subscriptions.revoke_complimentary') && (
                      <SmallBtn label="Revoke" danger disabled={g.plan === 'farm' && !isOwner} onPress={() => revoke(g.id)} />
                    )}
                  </View>
                ))}
              </>
            )}
            {grants.length > 0 && (
              <>
                <Text style={s.h3}>Complimentary history</Text>
                {grants.slice(0, 8).map((g) => (
                  <Text key={`history-${g.id}`} style={s.cardSub}>
                    {String(g.created_at).slice(0, 10)} · {promoPlanLabel(String(g.plan))} · {g.status} · {g.reason_code ?? g.reason}
                    {g.revoked_at ? ` · revoked ${String(g.revoked_at).slice(0, 10)}` : ''}
                  </Text>
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

// ---------------------------------------------------------------- Promo campaigns
// Console over the 0106 campaign tables. Bookkeeping, NOT the boundary: promo_validate inside
// billing-checkout decides whether a code is actually redeemable, so nothing rendered or saved
// here can make FOUNDING3 valid for Max or Farm — the DB suite re-asserts that after every write
// this screen can perform. Validation below is convenience; the server's answer is the answer.
const PLAN_CHOICES: [string, string][] = [['grower', 'Pro'], ['farm', 'Farm']];
const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  grower: 'Pro',
  farm: 'Farm',
  sponsor: 'Legacy Farm',
};
const promoPlanLabel = (p: string) => PLAN_LABELS[p] ?? p;
const promoDiscountLabel = (c: any) =>
  `${c.discount_type === 'percent' ? `${Number(c.discount_percent)}% off` : `${money(c.discount_amount_cents ?? 0)} off`} · ${
    c.duration === 'repeating' ? `${c.duration_in_months} months` : c.duration}`;

// The upsert RPC replaces every column from the payload, so a toggle must resend the whole
// campaign — a partial {id, active} payload nulls the discount and the server refuses it
// (promo_discount_coherent). Pinned by the suite; do not "simplify" this into a patch.
const campaignPayload = (c: any, over: Record<string, unknown> = {}) => ({
  id: c.id, code: c.code, campaign_name: c.campaign_name, active: c.active,
  applicable_plans: c.applicable_plans ?? [],
  discount_type: c.discount_type, discount_percent: c.discount_percent,
  discount_amount_cents: c.discount_amount_cents,
  duration: c.duration, duration_in_months: c.duration_in_months,
  starts_at: c.starts_at, expires_at: c.expires_at,
  max_redemptions: c.max_redemptions, max_redemptions_per_user: c.max_redemptions_per_user,
  new_customers_only: c.new_customers_only, internal_notes: c.internal_notes,
  ...over,
});

function PromoCampaigns({ back }: { back: () => void }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reds, setReds] = useState<any[] | 'loading' | 'error'>('loading');
  const [wiring, setWiring] = useState(false);

  const load = useCallback(async () => {
    const [{ data, error }, { data: summary }] = await Promise.all([
      supabase.rpc('admin_promo_campaigns'),
      supabase.rpc('admin_promo_campaigns_v2'),
    ]);
    // An RPC failure is NOT zero campaigns. FOUNDING3 exists; rendering an empty list on error
    // would invite an admin to recreate it.
    if (error) { setState('error'); return; }
    const byId = new Map(((summary as any[]) ?? []).map((r) => [r.id, r]));
    setRows(((data as any[]) ?? []).map((r) => ({ ...r, ...(byId.get(r.id) ?? {}) })));
    setState('ok');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = async (c: any) => {
    setSel(c); setEditing(false); setReds('loading');
    const { data, error } = await supabase.rpc('admin_promo_redemptions', { p_campaign: c.id });
    setReds(error ? 'error' : ((data as any[]) ?? []));
  };

  const toggleActive = (c: any) => {
    Alert.alert(c.active ? 'Deactivate this code?' : 'Reactivate this code?',
      c.active
        ? 'New redemptions stop immediately. History is kept, and anyone already subscribed keeps their discount.'
        : 'The code becomes redeemable again, subject to its dates and limits.', [
      { text: 'Cancel', style: 'cancel' },
      { text: c.active ? 'Deactivate' : 'Reactivate', style: c.active ? 'destructive' : 'default',
        onPress: async () => {
          const { error } = await supabase.rpc('admin_upsert_promo_campaign',
            { p_payload: campaignPayload(c, { active: !c.active }) });
          if (error) { Alert.alert('Server refused', error.message); return; }
          await load(); setSel(null);
        } },
    ]);
  };

  const wireStripe = async (c: any) => {
    setWiring(true);
    const identity = await supabase.functions.invoke('billing-admin', { body: { action: 'identity' } });
    setWiring(false);
    const info = (identity.data ?? {}) as any;
    if (identity.error || info.error) {
      Alert.alert('Stripe check failed', info.message ?? 'Could not confirm the Stripe TEST account.');
      return;
    }
    if (!info.configured) {
      Alert.alert('Stripe TEST is not configured', info.message ?? 'Set STRIPE_SECRET_KEY_TEST first.');
      return;
    }
    Alert.alert(
      'Wire Stripe TEST code?',
      `${c.code} will be created or refreshed in Stripe TEST for ${info.business_name ?? 'this account'} (${info.account_id}). Existing subscribers keep any old discount; new checkouts use the refreshed code.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Wire test code', onPress: async () => {
          setWiring(true);
          const { data, error } = await supabase.functions.invoke('billing-admin', {
            body: {
              action: 'ensure_promo_campaign',
              campaign_id: c.id,
              confirm_account_id: info.account_id,
            },
          });
          setWiring(false);
          const res = (data ?? {}) as any;
          if (error || res.error) {
            Alert.alert('Stripe refused', res.message ?? res.detail ?? res.error ?? 'The promotion code was not wired.');
            return;
          }
          Alert.alert('Promo code wired', `${c.code} is ready for subscription checkout in TEST mode.`);
          await load();
          setSel(null);
        } },
      ],
    );
  };

  if (sel && !editing) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <BackRow label="← Promo Codes" onPress={() => setSel(null)} />
        <ScrollView>
          <Card>
            <Text style={s.cardTitle}>🎟 {sel.code}{sel.active ? '' : '  (inactive)'}</Text>
            <Text style={s.cardSub}>{sel.campaign_name}</Text>
            <Text style={s.cardSub}>
              {(sel.applicable_plans?.length ?? 0) === 0 ? 'All plans'
                : sel.applicable_plans.map((p: string) => promoPlanLabel(p)).join(', ')}
              {(sel.applicable_plans?.length ?? 0) > 0 && ` · internal: ${sel.applicable_plans.join(', ')}`}
            </Text>
            <Text style={s.cardSub}>{promoDiscountLabel(sel)}</Text>
            <Text style={s.cardSub}>
              {sel.starts_at ? `From ${String(sel.starts_at).slice(0, 10)}` : 'No start date'}
              {' · '}{sel.expires_at ? `until ${String(sel.expires_at).slice(0, 10)}` : 'no end date'}
            </Text>
            <Text style={s.cardSub}>
              Limits: {sel.max_redemptions ?? 'no total cap'} total · {sel.max_redemptions_per_user} per user
              {sel.new_customers_only ? ' · new customers only' : ''}
            </Text>
            <Text style={s.cardSub}>
              Remaining: {sel.remaining ?? 'uncapped'} · eligibility: {sel.eligibility ?? (sel.new_customers_only ? 'New customers only' : 'Eligible signed-in accounts')}
            </Text>
            <Text style={s.cardSub}>Created by {sel.created_by ?? 'Gnome admin'} · {String(sel.created_at).slice(0, 10)}</Text>
            <Text style={s.cardSub}>
              Redeemed {sel.redeemed} · converted {sel.converted} · cancelled {sel.cancelled}
              {sel.revenue_after_promo_cents > 0 ? ` · ${money(Number(sel.revenue_after_promo_cents))} post-promo` : ''}
            </Text>
            {!sel.configured && (
              <Text style={[s.cardSub, { color: C.gold }]}>
                ⚠️ No Stripe TEST promotion code wired — checkout refuses this code (NOT_CONFIGURED)
                until you wire it here.
              </Text>
            )}
            {sel.internal_notes ? <Text style={s.cardSub}>📝 {sel.internal_notes}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <SmallBtn label="Edit" onPress={() => setEditing(true)} />
              <SmallBtn label={wiring ? 'Wiring…' : sel.configured ? 'Refresh Stripe test code' : 'Wire Stripe test code'}
                onPress={() => { if (!wiring) void wireStripe(sel); }} disabled={wiring} />
              <SmallBtn label={sel.active ? 'Deactivate' : 'Reactivate'} danger={sel.active}
                onPress={() => toggleActive(sel)} />
            </View>
          </Card>
          <Text style={[s.cardTitle, { marginTop: 12 }]}>Redemptions</Text>
          {reds === 'loading' && <Text style={s.cardSub}>Loading redemptions…</Text>}
          {reds === 'error' && (
            <Text style={[s.cardSub, { color: C.red }]}>Unable to load redemptions — this is not an empty history.</Text>
          )}
          {Array.isArray(reds) && reds.length === 0 && <Text style={s.cardSub}>No redemptions yet.</Text>}
          {Array.isArray(reds) && reds.map((r) => (
            <Card key={`${r.user_id}-${r.redeemed_at}`}>
              <Text style={s.cardTitle}>{r.email ?? r.user_id}</Text>
              <Text style={s.cardSub}>
                {promoPlanLabel(String(r.plan ?? ''))} · {r.status} · {String(r.redeemed_at).slice(0, 10)}
                {r.amount_discounted_cents != null ? ` · ${money(r.amount_discounted_cents)} discounted` : ''}
                {r.converted_at ? ` · converted ${String(r.converted_at).slice(0, 10)}` : ''}
                {r.cancelled_at ? ` · cancelled ${String(r.cancelled_at).slice(0, 10)}` : ''}
              </Text>
            </Card>
          ))}
        </ScrollView>
      </View>
    );
  }

  if ((sel && editing) || creating) {
    return (
      <PromoForm campaign={creating ? null : sel} back={() => { setEditing(false); setCreating(false); }}
        onSaved={async () => { setEditing(false); setCreating(false); setSel(null); await load(); }} />
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <BackRow label="← More" onPress={back} />
      {state === 'loading' && <Text style={s.cardSub}>Loading campaigns…</Text>}
      {state === 'error' && (
        <Card>
          <Text style={[s.cardSub, { color: C.red }]}>
            Unable to load campaigns. The promo RPCs (0106/0109) may not be applied in this
            environment. This is NOT an empty campaign list.
          </Text>
        </Card>
      )}
      {state === 'ok' && (
        <ScrollView>
          <SmallBtn label="+ New campaign" onPress={() => setCreating(true)} />
          {rows.length === 0 && <Text style={[s.cardSub, { marginTop: 8 }]}>No campaigns yet.</Text>}
          {rows.map((c) => (
            <Pressable key={c.id} onPress={() => void open(c)}>
              <Card>
                <Text style={s.cardTitle}>
                  🎟 {c.code}{c.active ? '' : '  (inactive)'}{c.configured ? '' : '  ⚠️'}
                </Text>
                <Text style={s.cardSub}>
                  {(c.applicable_plans?.length ?? 0) === 0 ? 'All plans'
                    : c.applicable_plans.map((p: string) => promoPlanLabel(p)).join(', ')}
                  {' · '}{c.benefit ?? promoDiscountLabel(c)} · {c.used ?? c.redeemed} used · {c.remaining ?? 'uncapped'} remaining
                </Text>
                <Text style={s.cardSub}>{c.eligibility ?? 'Eligible signed-in accounts'} · created by {c.created_by ?? 'Gnome admin'}</Text>
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// Create and edit share one form; edit prefills. Everything is convenience validation — the same
// rules exist as CHECK constraints, and a payload that slips past this form is refused there.
function PromoForm({ campaign, back, onSaved }: { campaign: any | null; back: () => void; onSaved: () => Promise<void> }) {
  const [code, setCode] = useState<string>(campaign?.code ?? '');
  const [name, setName] = useState<string>(campaign?.campaign_name ?? '');
  const [plans, setPlans] = useState<string[]>(campaign?.applicable_plans ?? []);
  const [dtype, setDtype] = useState<'percent' | 'amount'>(campaign?.discount_type ?? 'percent');
  const [dval, setDval] = useState<string>(
    campaign ? String(campaign.discount_type === 'percent' ? campaign.discount_percent : (campaign.discount_amount_cents ?? '') ) : '');
  const [duration, setDuration] = useState<'once' | 'repeating' | 'forever'>(campaign?.duration ?? 'repeating');
  const [months, setMonths] = useState<string>(campaign?.duration_in_months ? String(campaign.duration_in_months) : '');
  const [startsAt, setStartsAt] = useState<string>(campaign?.starts_at ? String(campaign.starts_at).slice(0, 10) : '');
  const [expiresAt, setExpiresAt] = useState<string>(campaign?.expires_at ? String(campaign.expires_at).slice(0, 10) : '');
  const [maxTotal, setMaxTotal] = useState<string>(campaign?.max_redemptions ? String(campaign.max_redemptions) : '');
  const [maxPerUser, setMaxPerUser] = useState<string>(String(campaign?.max_redemptions_per_user ?? 1));
  const [newOnly, setNewOnly] = useState<boolean>(campaign?.new_customers_only ?? false);
  const [notes, setNotes] = useState<string>(campaign?.internal_notes ?? '');
  const [saving, setSaving] = useState(false);

  const togglePlan = (p: string) =>
    setPlans((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const save = async () => {
    const v = Number(dval);
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(code.trim())) { Alert.alert('Check the code', 'Letters, digits, - and _ only (3–40 chars). It will be stored upper-case.'); return; }
    if (!name.trim()) { Alert.alert('Name the campaign', 'The internal campaign name is required.'); return; }
    if (dtype === 'percent' && (!Number.isFinite(v) || v <= 0 || v > 100)) { Alert.alert('Check the discount', 'Percent must be between 1 and 100.'); return; }
    if (dtype === 'amount' && (!Number.isInteger(v) || v <= 0)) { Alert.alert('Check the discount', 'Amount must be a positive number of cents.'); return; }
    if (duration === 'repeating' && (!Number.isInteger(Number(months)) || Number(months) <= 0)) { Alert.alert('Check the duration', 'Repeating campaigns need a month count.'); return; }
    if (startsAt && expiresAt && expiresAt <= startsAt) { Alert.alert('Check the dates', 'The end date must come after the start date.'); return; }
    if (maxTotal && (!Number.isInteger(Number(maxTotal)) || Number(maxTotal) <= 0)) { Alert.alert('Check the limits', 'Total redemptions must be a positive whole number, or blank for no cap.'); return; }
    if (!Number.isInteger(Number(maxPerUser)) || Number(maxPerUser) <= 0) { Alert.alert('Check the limits', 'Per-user limit must be at least 1.'); return; }

    setSaving(true);
    const { error } = await supabase.rpc('admin_upsert_promo_campaign', { p_payload: {
      ...(campaign ? { id: campaign.id } : {}),
      code: code.trim(), campaign_name: name.trim(),
      active: campaign ? campaign.active : true,
      applicable_plans: plans,
      discount_type: dtype,
      discount_percent: dtype === 'percent' ? v : null,
      discount_amount_cents: dtype === 'amount' ? v : null,
      duration,
      duration_in_months: duration === 'repeating' ? Number(months) : null,
      starts_at: startsAt || null, expires_at: expiresAt || null,
      max_redemptions: maxTotal ? Number(maxTotal) : null,
      max_redemptions_per_user: Number(maxPerUser),
      new_customers_only: newOnly,
      internal_notes: notes.trim() || null,
    } });
    setSaving(false);
    // Never claim success the server did not grant: the row is only re-shown after a reload.
    if (error) { Alert.alert('Server refused', error.message); return; }
    await onSaved();
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <BackRow label={campaign ? `← ${campaign.code}` : '← Promo Codes'} onPress={back} />
      <ScrollView>
        <Card>
          <Text style={s.cardTitle}>{campaign ? `Edit ${campaign.code}` : 'New campaign'}</Text>
          <TextInput style={s.input} placeholder="Code (e.g. FOUNDING3)" value={code} onChangeText={setCode}
            autoCapitalize="characters" autoCorrect={false} placeholderTextColor={C.muted} editable={!campaign} />
          <TextInput style={s.input} placeholder="Internal campaign name" value={name} onChangeText={setName}
            placeholderTextColor={C.muted} />
          <Text style={s.cardSub}>Applies to (none selected = all plans):</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 }}>
            {PLAN_CHOICES.map(([val, label]) => (
              <SmallBtn key={val} label={`${plans.includes(val) ? '✓ ' : ''}${label} (${val})`}
                onPress={() => togglePlan(val)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
            <SmallBtn label={`${dtype === 'percent' ? '✓ ' : ''}Percent`} onPress={() => setDtype('percent')} />
            <SmallBtn label={`${dtype === 'amount' ? '✓ ' : ''}Fixed cents`} onPress={() => setDtype('amount')} />
          </View>
          <TextInput style={s.input} placeholder={dtype === 'percent' ? 'Percent off (1–100)' : 'Cents off (e.g. 500)'}
            value={dval} onChangeText={setDval} keyboardType="number-pad" placeholderTextColor={C.muted} />
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
            {(['once', 'repeating', 'forever'] as const).map((d) => (
              <SmallBtn key={d} label={`${duration === d ? '✓ ' : ''}${d}`} onPress={() => setDuration(d)} />
            ))}
          </View>
          {duration === 'repeating' && (
            <TextInput style={s.input} placeholder="Months (e.g. 3)" value={months} onChangeText={setMonths}
              keyboardType="number-pad" placeholderTextColor={C.muted} />
          )}
          <TextInput style={s.input} placeholder="Start date YYYY-MM-DD (optional)" value={startsAt}
            onChangeText={setStartsAt} autoCapitalize="none" placeholderTextColor={C.muted} />
          <TextInput style={s.input} placeholder="End date YYYY-MM-DD (optional)" value={expiresAt}
            onChangeText={setExpiresAt} autoCapitalize="none" placeholderTextColor={C.muted} />
          <TextInput style={s.input} placeholder="Total redemption cap (blank = none)" value={maxTotal}
            onChangeText={setMaxTotal} keyboardType="number-pad" placeholderTextColor={C.muted} />
          <TextInput style={s.input} placeholder="Per-user limit" value={maxPerUser}
            onChangeText={setMaxPerUser} keyboardType="number-pad" placeholderTextColor={C.muted} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 }}>
            <Switch value={newOnly} onValueChange={setNewOnly} trackColor={{ true: C.primary }} />
            <Text style={s.cardSub}>New customers only</Text>
          </View>
          <TextInput style={s.input} placeholder="Internal notes (optional)" value={notes} onChangeText={setNotes}
            placeholderTextColor={C.muted} />
          <SmallBtn label={saving ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}
            onPress={() => { if (!saving) void save(); }} disabled={saving} />
          <Text style={[s.cardSub, { marginTop: 6 }]}>
            Save the Gnome rules first, then wire the Stripe TEST code from the campaign detail
            screen. Gnome still enforces plan, date, total-use, and per-account limits at checkout.
          </Text>
        </Card>
      </ScrollView>
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
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
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
  { title: 'Morning President Brief', agents: ['gnome_hq', 'boon', 'gemma', 'marty', 'senior'] },
  { title: 'Launch Readiness', agents: ['gnome_hq', 'junior', 'senior', 'debb', 'kay'] },
  { title: 'Marketplace Health', agents: ['gnome_hq', 'boon', 'enzo', 'gemma', 'marty'] },
  { title: 'Trust Review', agents: ['gnome_hq', 'kay', 'debb', 'senior', 'junior'] },
  { title: 'Growth Campaign', agents: ['gnome_hq', 'gemma', 'reddy', 'gee', 'marty'] },
];

function splitTechnicalDetails(content: string) {
  const match = content.match(/^TECHNICAL DETAILS\s*$/im);
  if (!match || match.index === undefined) return { simple: content, technical: '' };
  return {
    simple: content.slice(0, match.index).trim(),
    technical: content.slice(match.index + match[0].length).trim(),
  };
}

function BoardroomMessageText({ content, mine }: { content: string; mine: boolean }) {
  const textStyle = mine ? s.bubbleTextMe : s.bubbleText;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return (
    <View>
      {lines.map((raw, idx) => {
        const line = raw.trimEnd();
        const key = `${idx}-${line}`;
        if (!line.trim()) return <View key={key} style={s.messageBreak} />;
        const heading = line.match(/^\*\*(.+?)\*\*:?$/);
        if (heading) return <Text key={key} style={[textStyle, s.messageHeading]}>{heading[1]}</Text>;
        const bullet = line.match(/^[-*]\s+(.+)$/);
        if (bullet) return <Text key={key} style={[textStyle, s.messageLine]}>{'\u2022'} {stripInlineMarkdown(bullet[1])}</Text>;
        const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (numbered) return <Text key={key} style={[textStyle, s.messageLine]}>{numbered[1]}. {stripInlineMarkdown(numbered[2])}</Text>;
        return <Text key={key} style={[textStyle, s.messageLine]}>{stripInlineMarkdown(line)}</Text>;
      })}
    </View>
  );
}

function stripInlineMarkdown(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

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
      <Text style={s.cardSub}>Choose up to five specialists. Zordy synthesizes the room without expanding anyone’s authority.</Text>
      {ROOM_PRESETS.map((p) => (
        <Pressable key={p.title} onPress={() => void create(p.title, p.agents.filter((id) => agents.some((a) => a.id === id)))}>
          <Card>
            <View style={s.rowBetween}>
              <View style={{ flex: 1 }}><Text style={s.cardTitle}>{p.title}</Text><Text style={s.cardSub}>{p.agents.map((id) => AGENT_PRESENTATION[id]?.label ?? id).join(' · ')}</Text></View>
              <ChevronRight size={19} color={C.muted} />
            </View>
          </Card>
        </Pressable>
      ))}
      <Text style={s.h3}>Or build your own</Text>
      <TextInput style={s.input} placeholder="Room name (optional)" value={title} onChangeText={setTitle} placeholderTextColor={C.muted} />
      {agents.map((a) => (
        <Pressable key={a.id} onPress={() => toggle(a.id)}>
          <Card>
            <View style={s.rowBetween}>
              <View><Text style={s.cardTitle}>{agentDisplay(a).label}</Text><Text style={s.cardSub}>{agentDisplay(a).role}</Text></View>
              <View style={[s.checkBox, picked.includes(a.id) && s.checkBoxActive]}>
                {picked.includes(a.id) && <Check size={14} color="#FFFFFF" />}
              </View>
            </View>
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
  const listRef = useRef<FlatList<any>>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [detailMode, setDetailMode] = useState<'simple' | 'technical'>('simple');
  const agentName = (id?: string | null) => {
    if (id === 'gnome_hq') return 'Zordy';
    const agent = agents.find((a) => a.id === id);
    return agent ? agentDisplay(agent).label : id ?? 'Zordy';
  };

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

  const suggestions = [
    'Give me the operational brief.',
    'What needs my attention today?',
    'Review launch security and compliance.',
    'What would you change next?',
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={{ flex: 1, padding: 16 }}>
        <View style={s.chatHeader}>
          <Pressable style={s.backIcon} onPress={back} accessibilityLabel="Back to Zordy Ops"><ArrowLeft size={21} color={C.text} /></Pressable>
          <Image source={ZORDY} style={s.chatAvatar} accessibilityLabel="Zordy" />
          <View style={{ flex: 1, minWidth: 0 }}><Text style={s.chatTitle}>{room.title}</Text><Text style={s.chatStatus}>Simple by default · details available</Text></View>
          <View style={s.modeToggle}>
            {(['simple', 'technical'] as const).map((mode) => (
              <Pressable key={mode} style={[s.modeChoice, detailMode === mode && s.modeChoiceActive]}
                onPress={() => setDetailMode(mode)} accessibilityLabel={`${mode} boardroom mode`}>
                <Text style={[s.modeChoiceText, detailMode === mode && s.modeChoiceTextActive]}>{mode === 'simple' ? 'Simple' : 'Technical'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={(m, i) => String(m.id ?? i)}
          contentContainerStyle={s.messageList}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const split = splitTechnicalDetails(String(item.content ?? ''));
            const hasTechnical = Boolean(split.technical);
            const content = detailMode === 'technical' || !hasTechnical ? String(item.content ?? '') : split.simple;
            return (
              <View style={[s.messageRow, item.sender_type === 'admin' && { justifyContent: 'flex-end' }]}>
                {item.sender_type === 'agent' && item.sender_agent_id === 'gnome_hq' && <Image source={ZORDY} style={s.messageAvatar} />}
	                <View style={[s.bubble, item.sender_type === 'admin' ? s.bubbleMe : item.sender_type === 'system' ? s.bubbleSys : s.bubbleAgent]}>
	                  {item.sender_type === 'agent' && <Text style={s.bubbleWho}>{agentName(item.sender_agent_id)}</Text>}
	                  <BoardroomMessageText content={content} mine={item.sender_type === 'admin'} />
                  {hasTechnical && detailMode === 'simple' && (
                    <Pressable style={s.techDetailsButton} onPress={() => setDetailMode('technical')} accessibilityLabel="Show technical details">
                      <Text style={s.techDetailsButtonText}>SHOW TECHNICAL DETAILS</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={(
            <View style={s.emptyChat}>
              <Image source={ZORDY} style={s.emptyChatAvatar} />
              <Text style={s.emptyChatTitle}>What are we working on?</Text>
              <Text style={s.emptyChatSub}>Ask for a read, a recommendation, or an approved operational action.</Text>
              {suggestions.map((prompt) => <Pressable key={prompt} style={s.promptChip} onPress={() => setDraft(prompt)}><Text style={s.promptChipText}>{prompt}</Text></Pressable>)}
            </View>
          )}
        />
        {sending && <Text style={s.thinkingText}>Zordy is coordinating the room…</Text>}
        <View style={s.composer}>
          <TextInput style={[s.input, { flex: 1, marginBottom: 0, minWidth: 0 }]} placeholder="Message the room…"
            value={draft} onChangeText={setDraft} multiline placeholderTextColor={C.muted} />
          <Pressable style={[s.sendButton, sending && { opacity: 0.5 }]} onPress={() => void send()} disabled={sending} accessibilityLabel="Send message">
            <Send size={19} color="#FFFFFF" />
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
      <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshOrder(order.id)} tintColor={C.primary} />}>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}
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
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
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
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
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
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.primary} />}>
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
                <Switch value={enabled} onValueChange={toggleScreening} trackColor={{ true: C.primary }} />
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
function SmallBtn({ label, onPress, danger, disabled, icon: Icon }: {
  label: string; onPress: () => void; danger?: boolean; disabled?: boolean; icon?: LucideIcon;
}) {
  return (
    <Pressable style={[s.smallBtn, danger && { backgroundColor: C.red }, disabled && { opacity: 0.4 }]}
      onPress={onPress} disabled={disabled}>
      {Icon && <Icon size={14} color="#FFFFFF" />}
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
      <Text style={s.menuText}>{label}</Text><ChevronRight size={19} color={C.muted} />
    </Pressable>
  );
}
function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={s.backRow}><ArrowLeft size={19} color={C.primary} /><Text style={s.backText}>{label.replace(/^←\s*/, '')}</Text></Pressable>;
}

const s = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 28, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1, borderColor: C.border },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: C.primarySoft },
  brand: { fontSize: 17, fontWeight: '800', color: C.text },
  brandSub: { fontSize: 9.5, fontWeight: '800', color: C.primary, letterSpacing: 0 },
  roleBadge: { backgroundColor: C.primarySoft, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  role: { fontSize: 10, fontWeight: '800', color: C.primary, letterSpacing: 0 },
  tabbar: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  tabBtn: { flex: 1, alignItems: 'center', gap: 3, paddingTop: 8, paddingBottom: 7, borderTopWidth: 2, borderTopColor: 'transparent' },
  tabText: { fontSize: 11.5, fontWeight: '600', color: C.muted },
  h2: { fontSize: 13, fontWeight: '800', color: C.text, marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0 },
  h3: { fontSize: 13, fontWeight: '800', color: C.mid, marginTop: 12, marginBottom: 6 },
  card: { backgroundColor: C.surface, borderRadius: 8, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  cardBig: { fontSize: 22, fontWeight: '800', color: C.text },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  cardSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  cardText: { fontSize: 13.5, color: C.mid, marginTop: 4 },
  mono: { fontSize: 11, color: C.muted, marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  stamp: { fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 14 },
  input: {
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.muted, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text, width: '100%', marginBottom: 10, minWidth: 260,
  },
  btn: { backgroundColor: C.primary, borderRadius: 8, paddingVertical: 13, paddingHorizontal: 28, marginTop: 6 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  smallBtn: { backgroundColor: C.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  menuRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 8, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: C.border,
  },
  menuText: { fontSize: 15, fontWeight: '700', color: C.text },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: C.muted },
  chipTextActive: { color: '#fff' },
  signAvatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: C.primarySoft, marginBottom: 4 },
  signTitle: { fontSize: 26, fontWeight: '800', color: C.primary },
  lane: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  laneActive: { backgroundColor: C.primary, borderColor: C.primary },
  laneText: { fontSize: 12.5, fontWeight: '700', color: C.muted },
  laneTextActive: { color: '#fff' },
  bubble: { borderRadius: 8, padding: 12, marginBottom: 8, maxWidth: '92%', flexShrink: 1 },
  bubbleMe: { backgroundColor: C.primary, alignSelf: 'flex-end' },
  bubbleAgent: { backgroundColor: C.surfaceMuted, alignSelf: 'flex-start' },
  bubbleSys: { backgroundColor: 'transparent', alignSelf: 'center' },
  bubbleWho: { fontSize: 11, fontWeight: '800', color: C.primary, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0 },
  bubbleText: { fontSize: 14, color: C.text, lineHeight: 20 },
  bubbleTextMe: { fontSize: 14, color: '#fff', lineHeight: 20 },
  messageList: { paddingTop: 10, paddingBottom: 18 },
  messageLine: { flexShrink: 1 },
  messageHeading: { fontWeight: '800', marginTop: 4, marginBottom: 2 },
  messageBreak: { height: 8 },
  pickCard: { backgroundColor: C.surface, borderRadius: 8, padding: 18, marginBottom: 10, borderWidth: 2, borderColor: C.orange },
  pickBin: { fontSize: 30, fontWeight: '900', color: C.gold },
  pickName: { fontSize: 22, fontWeight: '800', color: C.text, marginTop: 4 },
  pickLot: { fontSize: 15, color: C.muted, marginTop: 2 },
  pickTap: { fontSize: 13, fontWeight: '800', color: C.mid, marginTop: 10, letterSpacing: 0 },
  errBox: { backgroundColor: '#FEF2F2', borderRadius: 8, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: C.red },
  errTitle: { fontSize: 15, fontWeight: '800', color: C.red },
  scopeBox: { backgroundColor: C.surfaceMuted, borderRadius: 8, padding: 12, marginTop: 8, borderWidth: 1, borderColor: C.border },
  modPhoto: { width: 96, height: 96, borderRadius: 8, marginRight: 8, backgroundColor: C.bg },
  deniedIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2' },
  deniedTitle: { fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'center' },
  deniedSub: { fontSize: 13.5, color: C.muted, textAlign: 'center', lineHeight: 19 },

  zordyHero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.primarySoft, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#E6D7F5' },
  zordyHeroAvatar: { width: 84, height: 84, borderRadius: 8 },
  zordyEyebrow: { fontSize: 10, fontWeight: '800', color: C.primary, letterSpacing: 0 },
  zordyTitle: { fontSize: 24, fontWeight: '900', color: C.text, marginTop: 1 },
  zordySub: { fontSize: 12.5, color: C.muted, lineHeight: 17, marginTop: 2 },
  zordyButton: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginTop: 10 },
  zordyButtonText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
  conciergeHero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF7ED', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#FED7AA' },
  boonMark: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange },
  statusStrip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11.5, color: C.muted, fontWeight: '700' },
  statusDivider: { color: C.border },
  agentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  agentCard: { width: '48.8%', minHeight: 148, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, backgroundColor: C.surface },
  agentIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  agentName: { fontSize: 14, fontWeight: '800', color: C.text },
  agentRole: { fontSize: 11.5, color: C.muted, lineHeight: 16, marginTop: 3, flex: 1 },
  agentChatRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  agentChatText: { fontSize: 11.5, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  iconCommand: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 6 },
  iconCommandText: { color: C.primary, fontSize: 12.5, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  riskBadge: { fontSize: 10, fontWeight: '900', color: C.gold, backgroundColor: '#FFF7ED', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  refundedBadge: { fontSize: 10, fontWeight: '900', color: C.green, backgroundColor: '#ECFDF3', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  planManager: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderColor: C.border },
  planSectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 7 },
  planSectionText: { fontSize: 13, fontWeight: '800', color: C.text },
  planChoiceRow: { flexDirection: 'row', gap: 8 },
  planChoice: { flex: 1, minHeight: 76, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 11, backgroundColor: C.surface },
  planChoiceActive: { borderWidth: 2, borderColor: C.primary, backgroundColor: C.primarySoft, padding: 10 },
  planChoiceName: { fontSize: 15, fontWeight: '800', color: C.text },
  planChoiceNameActive: { color: C.primary },
  planChoiceDetail: { fontSize: 11.5, color: C.muted, lineHeight: 15, marginTop: 3 },
  planChoiceDetailActive: { color: C.primaryDark },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  durationChoice: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: C.surface },
  durationChoiceActive: { borderColor: C.primary, backgroundColor: C.primary },
  durationText: { fontSize: 11.5, fontWeight: '700', color: C.muted },
  durationTextActive: { color: '#FFFFFF' },
  selfServePlan: { marginTop: 15, paddingTop: 14, borderTopWidth: 1, borderColor: C.border },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  checkBoxActive: { backgroundColor: C.primary, borderColor: C.primary },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, alignSelf: 'flex-start' },
  backText: { color: C.primary, fontWeight: '700', fontSize: 15 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 10, borderBottomWidth: 1, borderColor: C.border },
  backIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chatAvatar: { width: 40, height: 40, borderRadius: 20 },
  chatTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  chatStatus: { fontSize: 11, color: C.muted, marginTop: 2 },
  modeToggle: { flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 8, overflow: 'hidden' },
  modeChoice: { paddingHorizontal: 8, paddingVertical: 7, backgroundColor: C.surface },
  modeChoiceActive: { backgroundColor: C.primary },
  modeChoiceText: { fontSize: 11, fontWeight: '800', color: C.muted },
  modeChoiceTextActive: { color: '#FFFFFF' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, marginBottom: 8 },
  messageAvatar: { width: 28, height: 28, borderRadius: 14, marginBottom: 8 },
  emptyChat: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 12 },
  emptyChatAvatar: { width: 72, height: 72, borderRadius: 36 },
  emptyChatTitle: { fontSize: 18, fontWeight: '800', color: C.text, marginTop: 10 },
  emptyChatSub: { fontSize: 12.5, color: C.muted, textAlign: 'center', lineHeight: 18, marginTop: 4, marginBottom: 12 },
  promptChip: { width: '100%', borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6, backgroundColor: C.surface },
  promptChipText: { fontSize: 12.5, fontWeight: '700', color: C.text },
  thinkingText: { fontSize: 11.5, color: C.primary, fontWeight: '700', marginBottom: 6 },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingTop: 10, borderTopWidth: 1, borderColor: C.border },
  sendButton: { width: 46, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary },
  techDetailsButton: { alignSelf: 'flex-start', marginTop: 9, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  techDetailsButtonText: { fontSize: 10.5, fontWeight: '900', color: C.primary, letterSpacing: 0 },
});
