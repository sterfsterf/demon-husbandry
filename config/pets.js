export const PETS = [
  {
    id: 'growler',
    label: 'Growler',
    startingStats: { fullness: 70, happiness: 75, cleanliness: 65, energy: 85 },
    decay: {
      fullnessPerTick: 1.3,
      cleanlinessPerTick: 1.0,
      happinessBaseDecay: 0.45,
      happinessHungryPenalty: 0.8,
      happinessDirtyPenalty: 0.6,
      energyRegenWhenHappy: 0.5,
      energyDecayOtherwise: 0.7,
    },
    actions: {
      feedFullnessGain: 26,
      feedEnergyGain: 8,
      feedHappinessGain: 3,
      petHappinessGain: 10,
      groomCleanlinessGain: 22,
      groomHappinessGain: 3,
      playCleanlinessCost: 6,
      playHappinessMultiplier: 1.05,
      playEnergyMultiplier: 1.2,
    },
    itemDamage: {
      damageMultiplier: 1.4, // growlers are rough on items
      rageBonus: 0.3, // extra damage chance per 10 rage above threshold
    },
  },
  {
    id: 'harpie',
    label: 'Harpie',
    startingStats: { fullness: 75, happiness: 85, cleanliness: 80, energy: 80 },
    decay: {
      fullnessPerTick: 1.1,
      cleanlinessPerTick: 0.9,
      happinessBaseDecay: 0.35,
      happinessHungryPenalty: 0.6,
      happinessDirtyPenalty: 0.7,
      energyRegenWhenHappy: 0.55,
      energyDecayOtherwise: 0.6,
    },
    actions: {
      feedFullnessGain: 22,
      feedEnergyGain: 6,
      feedHappinessGain: 4,
      petHappinessGain: 16,
      groomCleanlinessGain: 28,
      groomHappinessGain: 6,
      playCleanlinessCost: 5,
      playHappinessMultiplier: 1.1,
      playEnergyMultiplier: 1.0,
    },
    itemDamage: {
      damageMultiplier: 0.8, // harpies are more careful
      rageBonus: 0.4, // but get more destructive when angry
    },
  },
];

export const getPetById = (id) => PETS.find((p) => p.id === id) || PETS[0]; 