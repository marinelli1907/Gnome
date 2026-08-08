// Hard-coded v1 categories (no admin panel). Order is intentional.
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
  { id: 'supplies', label: 'Supplies', emoji: '🛠️' },
  { id: 'decor', label: 'Decor', emoji: '🍄' },
  { id: 'wood', label: 'Wood', emoji: '🪵' },
  { id: 'meat', label: 'Meat', emoji: '🥩' },
  { id: 'pet_treats', label: 'Pet Treats', emoji: '🦴' },
  { id: 'other', label: 'Other', emoji: '🧺' },
];

const BY_ID: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

export function categoryFor(id: string): Category {
  return BY_ID[id] ?? { id, label: id, emoji: '🧺' };
}
