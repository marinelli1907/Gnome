// Shared order-status presentation: one source of truth for the label and
// color of each MarketOrderStatus, plus the "which window matters right now"
// helper used by the order detail, buyer list, and seller pickups screens.
import React from 'react';
import Colors from '@/constants/colors';
import { Badge } from '@/components/ui';
import type { MarketOrder, MarketOrderStatus } from '@/lib/marketops';

export const STATUS_META: Record<MarketOrderStatus, { label: string; color: string }> = {
  REQUESTED: { label: 'Requested', color: Colors.info },
  TIME_PROPOSED: { label: 'New time suggested', color: Colors.warning },
  CONFIRMED: { label: 'Confirmed', color: Colors.primary },
  READY: { label: 'Ready for pickup', color: Colors.success },
  COMPLETED: { label: 'Completed', color: Colors.textTertiary },
  DECLINED: { label: 'Declined', color: Colors.error },
  CANCELLED: { label: 'Cancelled', color: Colors.textTertiary },
};

export function OrderStatusBadge({ status }: { status: MarketOrderStatus }) {
  const meta = STATUS_META[status];
  return <Badge label={meta.label} color={meta.color} />;
}

/** The window that matters for this order right now. */
export function orderWindow(o: MarketOrder): {
  start: string;
  end: string;
  kind: 'confirmed' | 'proposed' | 'requested';
} {
  if (o.confirmed_start && o.confirmed_end) {
    return { start: o.confirmed_start, end: o.confirmed_end, kind: 'confirmed' };
  }
  if (o.status === 'TIME_PROPOSED' && o.proposed_start && o.proposed_end) {
    return { start: o.proposed_start, end: o.proposed_end, kind: 'proposed' };
  }
  return { start: o.requested_start, end: o.requested_end, kind: 'requested' };
}
