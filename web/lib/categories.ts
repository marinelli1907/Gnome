// Mirror of expo/constants/categories.ts. Kept as a local copy so the web build
// stays hermetic (no cross-package imports / React Native resolution). Keep in
// sync with the app if categories change.
export interface Category {
  id: string;
  label: string;
  emoji: string;
}

export const CATEGORIES: Category[] = [
  { id: 'vegetables', label: 'Vegetables', emoji: '🥕' },
  { id: 'fruit', label: 'Fruit', emoji: '🍎' },
  { id: 'herbs', label: 'Herbs', emoji: '🌿' },
  { id: 'eggs', label: 'Eggs', emoji: '🥚' },
  { id: 'seeds', label: 'Seeds', emoji: '🌰' },
  { id: 'plants', label: 'Plants', emoji: '🪴' },
  { id: 'flowers', label: 'Flowers', emoji: '💐' },
  { id: 'compost', label: 'Compost', emoji: '🪱' },
  { id: 'honey', label: 'Honey', emoji: '🍯' },
  { id: 'farm_fresh', label: 'Farm Fresh', emoji: '🥛' },
  { id: 'supplies', label: 'Garden Supplies', emoji: '🛠️' },
  { id: 'decor', label: 'Garden Decor', emoji: '🍄' },
  { id: 'other', label: 'Other', emoji: '🧺' },
];

const BY_ID: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

export function categoryFor(id: string): Category {
  return BY_ID[id] ?? { id, label: id, emoji: '🧺' };
}
