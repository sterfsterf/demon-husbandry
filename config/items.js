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
    durability: { maxUses: 20, baseDamageChance: 0.22, rageThreshold: 55 },
    // sprite: 'assets/items/fuzzy_ball.png', // optional if added later
  },
  {
    id: 'crystal_comb',
    label: 'Crystal Comb',
    emoji: '🪮',
    category: 'grooming',
    useType: 'groom',
    effects: { cleanliness: 26, happiness: 4 },
    defaultCount: 4,
    durability: { maxUses: 30, baseDamageChance: 0.1, rageThreshold: 65 },
    // sprite: 'assets/items/crystal_comb.png', // optional if added later
  },
  {
    id: 'sponge',
    label: 'Sponge',
    emoji: '🧽',
    category: 'grooming',
    useType: 'groom',
    effects: { cleanliness: 16, happiness: 2 },
    defaultCount: 2,
    durability: { maxUses: 8, baseDamageChance: 0.28, rageThreshold: 45 },
    sprite: 'assets/pets/sponge.png',
  },
  {
    id: 'mysterious_egg',
    label: 'Mysterious Egg',
    emoji: '🥚',
    category: 'egg',
    eggData: {
      petTypeId: 'growler',
      hatchTimeMinutes: 2, // base ~2 minutes
      hatchJitterMin: 0.7, // 70% of base
      hatchJitterMax: 1.6, // 160% of base
      twitchIntervalBase: 2500
    },
    defaultCount: 0,
    sprite: 'assets/pets/egg.png',
  },
];

export const getItemById = (id) => ITEMS.find((i) => i.id === id); 