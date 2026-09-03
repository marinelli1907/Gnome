import React from 'react';
import { Gift, Leaf, Snowflake, Sprout, Sun, Wheat } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { SeasonalIconKey } from '@/lib/seasonal';

const ICONS: Record<SeasonalIconKey, LucideIcon> = {
  leaf: Leaf,
  sprout: Sprout,
  sun: Sun,
  snowflake: Snowflake,
  gift: Gift,
  harvest: Wheat,
};

export default function SeasonalIcon({
  iconKey,
  size = 22,
  color,
}: {
  iconKey: SeasonalIconKey;
  size?: number;
  color: string;
}) {
  const Icon = ICONS[iconKey];
  return <Icon size={size} color={color} strokeWidth={2.2} />;
}
