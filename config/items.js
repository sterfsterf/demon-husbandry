export const ITEMS = [
  {
    id: 'apple',
    label: 'Apple',
    emoji: '🍎',
    category: 'snack',
    useType: 'feed',
    effects: { fullness: 16, energy: 4, happiness: 2 },
    defaultCount: 3,
  },
  {
    id: 'fuzzy_ball',
    label: 'Fuzzy Ball',
    emoji: '🎾',
    category: 'toy',
    useType: 'play',
    effects: { happiness: 14, energy: -10, cleanliness: -4 },
    defaultCount: 2,
  },
  {
    id: 'crystal_comb',
    label: 'Crystal Comb',
    emoji: '🪮',
    category: 'grooming',
    useType: 'groom',
    effects: { cleanliness: 26, happiness: 4 },
    defaultCount: 4,
  },
  {
    id: 'sponge',
    label: 'Sponge',
    emoji: '🧽',
    category: 'grooming',
    useType: 'groom',
    effects: { cleanliness: 16, happiness: 2 },
    defaultCount: 2,
  },
];

export const getItemById = (id) => ITEMS.find((i) => i.id === id); 