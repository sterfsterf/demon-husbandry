export const TRAITS = [
  {
    id: 'playful',
    label: 'Playful',
    description: 'Loves games; play gives extra happiness but costs a bit more energy.',
    modifiers: {
      playHappinessMultiplier: 1.25,
      playEnergyMultiplier: 1.1,
    },
  },
  {
    id: 'stubborn',
    label: 'Stubborn',
    description: 'Hard to impress; petting and grooming are less effective.',
    modifiers: {
      petHappinessGainMultiplier: 0.7,
      groomCleanlinessGainMultiplier: 0.8,
      happinessBaseDecayMultiplier: 1.05,
      // Grooming makes them cranky
      groomHappinessGainMultiplier: -0.5,
    },
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    description: 'Big moods; suffers more when hungry or dirty, but enjoys attention.',
    modifiers: {
      happinessHungryPenaltyMultiplier: 1.3,
      happinessDirtyPenaltyMultiplier: 1.3,
      petHappinessGainMultiplier: 1.15,
      // Grooming drains energy
      groomEnergyDelta: -6,
    },
  },
  {
    id: 'prissy',
    label: 'Prissy',
    description: 'Hates mess; gets dirty faster but grooming helps more.',
    modifiers: {
      cleanlinessDecayMultiplier: 1.25,
      groomCleanlinessGainMultiplier: 1.35,
      happinessDirtyPenaltyMultiplier: 1.25,
      // Loves grooming
      groomHappinessGainMultiplier: 1.5,
    },
  },
  {
    id: 'silly',
    label: 'Silly',
    description: 'Easily amused; pets and play are extra fun.',
    modifiers: {
      petHappinessGainMultiplier: 1.2,
      playHappinessMultiplier: 1.1,
    },
  },
  {
    id: 'piggy',
    label: 'Piggy',
    description: 'Always hungry; gets hungry fast but enjoys big meals.',
    modifiers: {
      fullnessDecayMultiplier: 1.35,
      feedFullnessGainMultiplier: 1.25,
      feedHappinessGainMultiplier: 1.2,
    },
  },
];

export const getTraitById = (id) => TRAITS.find((t) => t.id === id); 