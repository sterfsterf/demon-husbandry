export const STATUS_THRESHOLDS = {
  hunger: [
    { min: 0, max: 10, label: 'Full' },
    { min: 11, max: 25, label: 'Satisfied' },
    { min: 75, max: 89, label: 'Hungry' },
    { min: 90, max: 100, label: 'Starving' },
  ],
  dirtiness: [
    { min: 0, max: 10, label: 'Pristine' },
    { min: 11, max: 25, label: 'Clean' },
    { min: 75, max: 89, label: 'Dirty' },
    { min: 90, max: 100, label: 'Filthy' },
  ],
  energy: [
    { min: 0, max: 10, label: 'Exhausted' },
    { min: 11, max: 25, label: 'Tired' },
    { min: 75, max: 89, label: 'Energetic' },
    { min: 90, max: 100, label: 'Hyper' },
  ],
  rage: [
    { min: 0, max: 10, label: 'Calm' },
    { min: 50, max: 74, label: 'Annoyed' },
    { min: 75, max: 89, label: 'Angry' },
    { min: 90, max: 100, label: 'Furious' },
  ],
};

// Legacy labels (kept for compatibility)
export const STATUS_LABELS = {
  hungry: 'Hungry',
  full: 'Full',
  dirty: 'Dirty',
  pristine: 'Pristine',
  tired: 'Tired',
}; 