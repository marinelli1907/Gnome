export const OTHER_SALE_UNIT = '__other__';

export type SaleUnitOption = {
  value: string;
  label: string;
  singular: string;
  plural: string;
};

export const SALE_UNIT_OPTIONS: readonly SaleUnitOption[] = [
  { value: 'each', label: 'Each / item', singular: 'item', plural: 'items' },
  { value: 'dozen', label: 'Dozen', singular: 'dozen', plural: 'dozens' },
  { value: 'half-dozen', label: 'Half-dozen', singular: 'half-dozen', plural: 'half-dozens' },
  { value: 'lb', label: 'Pound (lb)', singular: 'pound', plural: 'pounds' },
  { value: 'oz', label: 'Ounce (oz)', singular: 'ounce', plural: 'ounces' },
  { value: 'pint', label: 'Pint', singular: 'pint', plural: 'pints' },
  { value: 'quart', label: 'Quart', singular: 'quart', plural: 'quarts' },
  { value: 'cup', label: 'Cup', singular: 'cup', plural: 'cups' },
  { value: 'bunch', label: 'Bunch', singular: 'bunch', plural: 'bunches' },
  { value: 'basket', label: 'Basket', singular: 'basket', plural: 'baskets' },
  { value: 'bag', label: 'Bag', singular: 'bag', plural: 'bags' },
  { value: 'box', label: 'Box', singular: 'box', plural: 'boxes' },
  { value: 'jar', label: 'Jar', singular: 'jar', plural: 'jars' },
  { value: 'bundle', label: 'Bundle', singular: 'bundle', plural: 'bundles' },
  { value: 'tray', label: 'Tray', singular: 'tray', plural: 'trays' },
  { value: 'flat', label: 'Flat', singular: 'flat', plural: 'flats' },
];

const UNIT_ALIASES: Record<string, string> = {
  item: 'each',
  items: 'each',
  ea: 'each',
  dozens: 'dozen',
  'half dozen': 'half-dozen',
  'half dozens': 'half-dozen',
  pound: 'lb',
  pounds: 'lb',
  lbs: 'lb',
  ounce: 'oz',
  ounces: 'oz',
  pint: 'pint',
  pints: 'pint',
  quart: 'quart',
  quarts: 'quart',
  cup: 'cup',
  cups: 'cup',
  bunches: 'bunch',
  baskets: 'basket',
  bags: 'bag',
  boxes: 'box',
  jars: 'jar',
  bundles: 'bundle',
  trays: 'tray',
  flats: 'flat',
};

export function resolveSaleUnit(raw?: string | null): { value: string; custom: boolean } {
  const original = raw?.trim().slice(0, 40) ?? '';
  if (!original) return { value: 'each', custom: false };
  const normalized = original.toLowerCase().replace(/\s+/g, ' ');
  const canonical = UNIT_ALIASES[normalized] ?? normalized;
  if (SALE_UNIT_OPTIONS.some((option) => option.value === canonical)) {
    return { value: canonical, custom: false };
  }
  return { value: original, custom: true };
}

export function saleUnitOption(value: string): SaleUnitOption | undefined {
  return SALE_UNIT_OPTIONS.find((option) => option.value === value);
}

export function saleUnitSingular(value: string): string {
  return saleUnitOption(value)?.singular ?? (value.trim() || 'unit');
}

export function saleUnitPlural(value: string): string {
  const option = saleUnitOption(value);
  if (option) return option.plural;
  const custom = value.trim();
  if (!custom) return 'units';
  return custom.endsWith('s') ? custom : `${custom}s`;
}
