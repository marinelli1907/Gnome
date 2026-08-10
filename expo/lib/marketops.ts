// Market operating tools: payment handles, pickup availability, and pickup
// orders. Thin hooks over the 0048 backend — every order mutation is a
// SECURITY DEFINER RPC; the client never writes order tables directly.
import { useEffect } from 'react';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from './supabase';
import { logEvent } from './db';

// ---------------------------------------------------------------------------
// Types
export type PaymentMethodKind = 'venmo' | 'paypal' | 'cashapp' | 'zelle' | 'cash' | 'other';

export interface MarketPaymentMethod {
  id: string;
  market_id: string;
  method: PaymentMethodKind;
  enabled: boolean;
  handle: string | null;
  label: string | null;
  instructions: string | null;
}

export interface PickupSettings {
  market_id: string;
  timezone: string;
  slot_minutes: 15 | 30 | 60;
  lead_time_minutes: number;
  max_orders_per_slot: number | null;
  location_type: 'PRIVATE_RESIDENCE' | 'PUBLIC_BUSINESS' | 'CUSTOM_PICKUP_POINT';
  public_address: string | null;
}

export interface PickupHours {
  id: string;
  market_id: string;
  weekday: number; // 0 = Sunday
  start_minute: number;
  end_minute: number;
}

export interface PickupException {
  id: string;
  market_id: string;
  date: string; // YYYY-MM-DD
  closed: boolean;
  start_minute: number | null;
  end_minute: number | null;
  note: string | null;
}

export interface PickupPrivate {
  market_id: string;
  pickup_address: string | null;
  pickup_instructions: string | null;
  instructions_public: boolean;
}

export interface PickupSlot {
  slot_start: string;
  slot_end: string;
  remaining: number | null;
}

export type MarketOrderStatus =
  | 'REQUESTED' | 'CONFIRMED' | 'TIME_PROPOSED' | 'DECLINED'
  | 'READY' | 'COMPLETED' | 'CANCELLED';

export interface MarketOrderItem {
  id: string;
  order_id: string;
  listing_id: string | null;
  title: string;
  unit: string | null;
  quantity: number;
  unit_price_cents: number;
  item_total_cents: number;
}

export interface MarketOrder {
  id: string;
  market_id: string;
  buyer_id: string;
  status: MarketOrderStatus;
  requested_start: string;
  requested_end: string;
  confirmed_start: string | null;
  confirmed_end: string | null;
  proposed_start: string | null;
  proposed_end: string | null;
  timezone: string;
  subtotal_cents: number;
  buyer_note: string | null;
  decline_reason: string | null;
  created_at: string;
  items?: MarketOrderItem[];
  market?: { name: string } | null;
  buyer?: { name: string } | null;
}

export interface CartLine {
  listingId: string;
  title: string;
  unit: string | null;
  priceCents: number;
  quantity: number;
  inventory: number | null;
}

// ---------------------------------------------------------------------------
// Payment handles
export function useMarketPaymentMethods(marketId?: string) {
  return useQuery({
    queryKey: ['payMethods', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<MarketPaymentMethod[]> => {
      const { data, error } = await supabase
        .from('market_payment_methods')
        .select('*')
        .eq('market_id', marketId as string)
        .order('method');
      if (error) throw error;
      return (data ?? []) as MarketPaymentMethod[];
    },
  });
}

export function useSavePaymentMethod(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      method: PaymentMethodKind;
      enabled: boolean;
      handle?: string | null;
      label?: string | null;
      instructions?: string | null;
    }): Promise<void> => {
      const { error } = await supabase.from('market_payment_methods').upsert(
        {
          market_id: marketId,
          method: input.method,
          enabled: input.enabled,
          handle: input.handle?.trim() || null,
          label: input.label?.trim() || null,
          instructions: input.instructions?.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'market_id,method' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payMethods', marketId] }),
  });
}

/**
 * External payment routing. Opening an app/URL NEVER marks anything paid —
 * the seller confirms payment separately (Sales Notebook / Complete Order).
 */
export function paymentLink(m: MarketPaymentMethod, amountCents?: number | null): string | null {
  const amt = amountCents != null ? (amountCents / 100).toFixed(2) : null;
  const h = (m.handle ?? '').replace(/^[@$]/, '').trim();
  if (!h && m.method !== 'cash' && m.method !== 'other') return null;
  switch (m.method) {
    case 'venmo':
      return `https://venmo.com/${encodeURIComponent(h)}${amt ? `?txn=pay&amount=${amt}` : ''}`;
    case 'paypal':
      return `https://paypal.me/${encodeURIComponent(h)}${amt ? `/${amt}` : ''}`;
    case 'cashapp':
      return `https://cash.app/$${encodeURIComponent(h)}${amt ? `/${amt}` : ''}`;
    case 'zelle':
    case 'cash':
    case 'other':
    default:
      return null; // no universal deep link — show the handle/instructions instead
  }
}

export async function openPaymentLink(m: MarketPaymentMethod, amountCents?: number | null): Promise<boolean> {
  const url = paymentLink(m, amountCents);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    void logEvent('payment_link_opened', { metadata: { method: m.method } });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pickup availability (seller config + public slot browsing)
export function usePickupSettings(marketId?: string) {
  return useQuery({
    queryKey: ['pickupSettings', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<PickupSettings | null> => {
      const { data, error } = await supabase
        .from('market_pickup_settings')
        .select('*')
        .eq('market_id', marketId as string)
        .maybeSingle();
      if (error) throw error;
      return data as PickupSettings | null;
    },
  });
}

export function useSavePickupSettings(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PickupSettings>): Promise<void> => {
      const { error } = await supabase.from('market_pickup_settings').upsert(
        { market_id: marketId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'market_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickupSettings', marketId] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

export function usePickupHours(marketId?: string) {
  return useQuery({
    queryKey: ['pickupHours', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<PickupHours[]> => {
      const { data, error } = await supabase
        .from('market_pickup_hours')
        .select('*')
        .eq('market_id', marketId as string)
        .order('weekday')
        .order('start_minute');
      if (error) throw error;
      return (data ?? []) as PickupHours[];
    },
  });
}

export function useAddPickupWindow(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (w: { weekday: number; start_minute: number; end_minute: number }) => {
      const { error } = await supabase
        .from('market_pickup_hours')
        .insert({ market_id: marketId, ...w });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickupHours', marketId] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

export function useRemovePickupWindow(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('market_pickup_hours').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickupHours', marketId] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

export function usePickupExceptions(marketId?: string) {
  return useQuery({
    queryKey: ['pickupExceptions', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<PickupException[]> => {
      const { data, error } = await supabase
        .from('market_pickup_exceptions')
        .select('*')
        .eq('market_id', marketId as string)
        .gte('date', new Date().toISOString().slice(0, 10))
        .order('date');
      if (error) throw error;
      return (data ?? []) as PickupException[];
    },
  });
}

export function useSaveException(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: {
      date: string; closed: boolean;
      start_minute?: number | null; end_minute?: number | null; note?: string | null;
    }) => {
      const { error } = await supabase
        .from('market_pickup_exceptions')
        .insert({ market_id: marketId, ...e });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickupExceptions', marketId] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

export function useRemoveException(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('market_pickup_exceptions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickupExceptions', marketId] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

/** Private address/instructions — OWNER ONLY (RLS). Buyers get them per-order
 *  through useOrderPickupDetails after confirmation. */
export function usePickupPrivate(marketId?: string, isOwner?: boolean) {
  return useQuery({
    queryKey: ['pickupPrivate', marketId],
    enabled: isSupabaseConfigured && !!marketId && !!isOwner,
    queryFn: async (): Promise<PickupPrivate | null> => {
      const { data, error } = await supabase
        .from('market_pickup_private')
        .select('*')
        .eq('market_id', marketId as string)
        .maybeSingle();
      if (error) throw error;
      return data as PickupPrivate | null;
    },
  });
}

export function useSavePickupPrivate(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PickupPrivate>): Promise<void> => {
      const { error } = await supabase.from('market_pickup_private').upsert(
        { market_id: marketId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'market_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pickupPrivate', marketId] }),
  });
}

/** Server-generated slots — the single source of truth for what's bookable. */
export function usePickupSlots(marketId?: string, days = 10) {
  return useQuery({
    queryKey: ['pickupSlots', marketId, days],
    enabled: isSupabaseConfigured && !!marketId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<PickupSlot[]> => {
      const { data, error } = await supabase.rpc('market_available_slots', {
        p_market: marketId, p_days: days,
      });
      if (error) throw error;
      return (data ?? []) as PickupSlot[];
    },
  });
}

// ---------------------------------------------------------------------------
// Orders
const ORDER_SELECT = '*, items:market_order_items(*), market:markets(name)';

export function useMyOrders(uid?: string) {
  return useQuery({
    queryKey: ['myOrders', uid],
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<MarketOrder[]> => {
      const { data, error } = await supabase
        .from('market_orders')
        .select(ORDER_SELECT)
        .eq('buyer_id', uid as string)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as MarketOrder[];
    },
  });
}

export function useMarketOrders(marketId?: string) {
  return useQuery({
    queryKey: ['marketOrders', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<MarketOrder[]> => {
      const { data, error } = await supabase
        .from('market_orders')
        .select('*, items:market_order_items(*), buyer:profiles!market_orders_buyer_id_fkey(name)')
        .eq('market_id', marketId as string)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as MarketOrder[];
    },
  });
}

export function useOrder(orderId?: string) {
  return useQuery({
    queryKey: ['order', orderId],
    enabled: isSupabaseConfigured && !!orderId,
    queryFn: async (): Promise<MarketOrder | null> => {
      const { data, error } = await supabase
        .from('market_orders')
        .select(ORDER_SELECT)
        .eq('id', orderId as string)
        .maybeSingle();
      if (error) throw error;
      return data as MarketOrder | null;
    },
  });
}

function invalidateOrders(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['myOrders'] });
  qc.invalidateQueries({ queryKey: ['marketOrders'] });
  qc.invalidateQueries({ queryKey: ['order'] });
  qc.invalidateQueries({ queryKey: ['pickupSlots'] });
}

export function useCreateOrder(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      marketId: string;
      lines: CartLine[];
      slot: PickupSlot;
      note?: string | null;
    }): Promise<string> => {
      if (!uid) throw new Error('Sign in to order.');
      const { data, error } = await supabase.rpc('create_market_order', {
        p_market: input.marketId,
        p_items: input.lines.map((l) => ({ listing_id: l.listingId, quantity: l.quantity })),
        p_start: input.slot.slot_start,
        p_end: input.slot.slot_end,
        p_note: input.note ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (orderId, input) => {
      void logEvent('market_order_requested', {
        userId: uid, metadata: { market_id: input.marketId, items: input.lines.length },
      });
      void notifyOrderEvent('pickup_request', orderId);
      invalidateOrders(qc);
    },
  });
}

export type OrderAction =
  | { kind: 'confirm' }
  | { kind: 'propose'; start: string; end: string }
  | { kind: 'respond'; accept: boolean; newStart?: string; newEnd?: string }
  | { kind: 'decline'; reason: string }
  | { kind: 'cancel'; reason?: string }
  | { kind: 'ready' }
  | { kind: 'complete'; recordPayment: boolean; method?: string; amountCents?: number };

export function useOrderAction(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orderId: string; action: OrderAction }): Promise<string | null> => {
      const { orderId, action } = input;
      let rpc: string; let args: Record<string, unknown>;
      switch (action.kind) {
        case 'confirm': rpc = 'confirm_market_order'; args = { p_order: orderId }; break;
        case 'propose': rpc = 'propose_order_time'; args = { p_order: orderId, p_start: action.start, p_end: action.end }; break;
        case 'respond': rpc = 'respond_order_proposal'; args = { p_order: orderId, p_accept: action.accept, p_new_start: action.newStart ?? null, p_new_end: action.newEnd ?? null }; break;
        case 'decline': rpc = 'decline_market_order'; args = { p_order: orderId, p_reason: action.reason }; break;
        case 'cancel': rpc = 'cancel_market_order'; args = { p_order: orderId, p_reason: action.reason ?? null }; break;
        case 'ready': rpc = 'mark_order_ready'; args = { p_order: orderId }; break;
        case 'complete': rpc = 'complete_market_order'; args = { p_order: orderId, p_record_payment: action.recordPayment, p_method: action.method ?? 'cash', p_amount_cents: action.amountCents ?? null }; break;
      }
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) throw error;
      return (data as string) ?? null;
    },
    onSuccess: (_d, input) => {
      const evt: Record<OrderAction['kind'], string | null> = {
        confirm: 'pickup_confirmed',
        propose: 'pickup_time_proposed',
        respond: input.action.kind === 'respond' && (input.action as any).accept ? 'pickup_confirmed' : 'pickup_request',
        decline: 'pickup_cancelled',
        cancel: 'pickup_cancelled',
        ready: 'pickup_ready',
        complete: null,
      };
      const e = evt[input.action.kind];
      if (e) void notifyOrderEvent(e, input.orderId);
      void logEvent(`market_order_${input.action.kind}`, { userId: uid, metadata: { order_id: input.orderId } });
      invalidateOrders(qc);
    },
  });
}

/** Address + instructions, released by the backend only post-confirmation. */
export function useOrderPickupDetails(orderId?: string, status?: MarketOrderStatus) {
  const unlocked = status === 'CONFIRMED' || status === 'READY' || status === 'COMPLETED';
  return useQuery({
    queryKey: ['orderPickup', orderId, unlocked],
    enabled: isSupabaseConfigured && !!orderId && unlocked,
    queryFn: async (): Promise<{ address: string | null; instructions: string | null; location_type: string } | null> => {
      const { data, error } = await supabase.rpc('order_pickup_details', { p_order: orderId });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      return rows[0] ?? null;
    },
  });
}

// ---------------------------------------------------------------------------
// Push events (best-effort; the notify fn re-verifies party membership)
export async function notifyOrderEvent(
  event: string, orderId: string, extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    if (!isSupabaseConfigured) return;
    await supabase.functions.invoke('notify', { body: { event, orderId, ...extra } });
  } catch {
    // push is never required for the loop to work
  }
}

/** "I'm on my way" / "I'm here" — a button press, never live GPS. */
export async function sendArrivalNotice(orderId: string, arrived: boolean): Promise<void> {
  await notifyOrderEvent(arrived ? 'buyer_arrived' : 'buyer_on_the_way', orderId);
}

/**
 * Local 1-hour-before pickup reminder on THIS device (no server infra, no
 * spam): scheduled when the buyer sees their order confirmed.
 */
export async function scheduleLocalPickupReminder(order: MarketOrder, marketName: string): Promise<void> {
  try {
    const startIso = order.confirmed_start ?? order.requested_start;
    const fireAt = new Date(new Date(startIso).getTime() - 60 * 60 * 1000);
    if (fireAt.getTime() <= Date.now()) return;
    const key = `pickup-reminder-${order.id}`;
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    if (existing.some((n) => n.identifier === key)) return;
    await Notifications.scheduleNotificationAsync({
      identifier: key,
      content: {
        title: 'Pickup soon 🧺',
        body: `Your pickup at ${marketName} is at ${new Date(startIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
        data: { orderId: order.id, event: 'pickup_reminder' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
  } catch {
    // reminders are best-effort
  }
}

/** Convenience: schedule the reminder whenever a confirmed order is on screen. */
export function useLocalPickupReminder(order?: MarketOrder | null, marketName?: string) {
  useEffect(() => {
    if (!order || !marketName) return;
    if (order.status === 'CONFIRMED' || order.status === 'READY') {
      void scheduleLocalPickupReminder(order, marketName);
    }
  }, [order?.id, order?.status, order?.confirmed_start, marketName]);
}

export const METHOD_LABEL: Record<PaymentMethodKind, string> = {
  venmo: 'Venmo', paypal: 'PayPal', cashapp: 'Cash App',
  zelle: 'Zelle', cash: 'Cash', other: 'Other',
};

export function fmtWindow(startIso: string, endIso: string): string {
  const s = new Date(startIso); const e = new Date(endIso);
  const t = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${t(s)}–${t(e)}`;
}

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;
