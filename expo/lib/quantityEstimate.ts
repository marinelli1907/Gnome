const TOMATO_WORDS = /\b(grape|cherry|tomato|tomatoes)\b/i;

const clean = (value?: string | null) =>
  (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function unitFrom(unit?: string | null, quantityText?: string | null): string {
  const raw = clean(unit);
  if (raw) return raw;
  const quantity = clean(quantityText);
  const hit = quantity.match(/\b(pints?|quarts?|cups?|dozens?|half dozen|half-dozens?|lbs?|pounds?|oz|ounces?|bunches?|baskets?|jars?|pots?|each)\b/);
  return hit?.[1] ?? '';
}

function pluralizeUnit(unit: string, count: number): string {
  if (count === 1) return unit;
  if (unit === 'each') return 'items';
  if (unit.endsWith('s')) return unit;
  return `${unit}s`;
}

function amountLabel(count: number, unit: string): string {
  return `${count} ${pluralizeUnit(unit, count)}`;
}

export function quantityEstimateLabel(input: {
  unit?: string | null;
  quantityText?: string | null;
  title?: string | null;
  count?: number;
}): string | null {
  const count = Math.max(1, Math.round(input.count ?? 1));
  const unit = unitFrom(input.unit, input.quantityText);
  const title = input.title ?? '';
  const tomatoLike = TOMATO_WORDS.test(title);

  if (/^pints?$/.test(unit)) {
    const cups = count * 2;
    if (tomatoLike) {
      return `${amountLabel(count, 'pint')} is about ${cups} cups, roughly ${count * 10}-${count * 12} oz of grape or cherry tomatoes.`;
    }
    return `${amountLabel(count, 'pint')} is about ${cups} cups or ${count * 16} fl oz.`;
  }

  if (/^quarts?$/.test(unit)) {
    const cups = count * 4;
    if (tomatoLike) {
      return `${amountLabel(count, 'quart')} is about ${cups} cups, roughly ${count * 20}-${count * 24} oz of grape or cherry tomatoes.`;
    }
    return `${amountLabel(count, 'quart')} is about ${cups} cups or ${count * 32} fl oz.`;
  }

  if (/^cups?$/.test(unit)) return `${amountLabel(count, 'cup')} is about ${count * 8} fl oz.`;
  if (/^dozens?$/.test(unit)) return `${amountLabel(count, 'dozen')} means about ${count * 12} items.`;
  if (/^half[-\s]?dozens?$/.test(unit)) return `${amountLabel(count, 'half-dozen')} means about ${count * 6} items.`;
  if (/^(lb|lbs|pound|pounds)$/.test(unit)) return `${amountLabel(count, 'lb')} is about ${count * 16} oz by weight.`;
  if (/^(oz|ounce|ounces)$/.test(unit)) return `${amountLabel(count, 'oz')} by weight.`;
  if (/^bunch(es)?$/.test(unit)) return `${amountLabel(count, 'bunch')} usually means ${count === 1 ? 'one seller-tied bundle' : `${count} seller-tied bundles`}; size can vary.`;
  if (/^basket(s)?$/.test(unit)) return `${amountLabel(count, 'basket')} is seller-sized; check the photo and description for the actual amount.`;
  if (/^jar(s)?$/.test(unit)) return `${amountLabel(count, 'jar')} varies by jar size; check the photo or ask the seller.`;
  if (/^pot(s)?$/.test(unit)) return `${amountLabel(count, 'pot')} means ${count === 1 ? 'one potted plant' : `${count} potted plants`}.`;
  if (/^each$/.test(unit)) return `${amountLabel(count, 'each')} means ${count === 1 ? 'one item' : `${count} items`}.`;

  return null;
}
