import { clamp } from './util.js';

export const ActionTypes = {
  TICK: 'TICK',
  RENAME: 'RENAME',
  APPLY_DELTAS: 'APPLY_DELTAS',
  MODIFY_INVENTORY: 'MODIFY_INVENTORY',
  START_INCUBATION: 'START_INCUBATION',
  HATCH_EGG: 'HATCH_EGG',
  CREATE_ITEM_INSTANCE: 'CREATE_ITEM_INSTANCE',
  DAMAGE_ITEM_INSTANCE: 'DAMAGE_ITEM_INSTANCE',
};

export function rootReducer(state, action) {
  switch (action.type) {
    case ActionTypes.RENAME: {
      const name = (action.payload?.name || 'Demon').slice(0, 20);
      const pets = { ...(state.pets || {}) };
      if (!pets[0]) return state;
      pets[0] = { ...pets[0], name };
      return { ...state, pets, name }; // keep legacy mirror until UI migrated
    }
    case ActionTypes.MODIFY_INVENTORY: {
      const itemId = action.payload?.itemId;
      const delta = Number(action.payload?.delta || 0);
      if (!itemId || delta === 0) return state;
      const inv = { ...(state.inventory || {}) };
      const next = Math.max(0, Number(inv[itemId] || 0) + delta);
      inv[itemId] = next;
      return { ...state, inventory: inv };
    }
    case ActionTypes.CREATE_ITEM_INSTANCE: {
      const itemId = action.payload?.itemId;
      const instanceId = action.payload?.instanceId;
      if (!itemId || !instanceId) return state;
      const map = { ...(state.itemDurability || {}) };
      const sub = { ...(map[itemId] || {}) };
      if (sub[instanceId] == null) sub[instanceId] = 0;
      map[itemId] = sub;
      return { ...state, itemDurability: map };
    }
    case ActionTypes.DAMAGE_ITEM_INSTANCE: {
      const itemId = action.payload?.itemId;
      const instanceId = action.payload?.instanceId;
      const maxUses = Number(action.payload?.maxUses || 0);
      if (!itemId || !instanceId || !maxUses) return state;
      const map = { ...(state.itemDurability || {}) };
      const sub = { ...(map[itemId] || {}) };
      if (sub[instanceId] == null) sub[instanceId] = 0;
      sub[instanceId] = Number(sub[instanceId]) + 1;
      let inventory = state.inventory;
      // Break check
      if (sub[instanceId] >= maxUses) {
        delete sub[instanceId];
        const inv = { ...(state.inventory || {}) };
        inv[itemId] = Math.max(0, Number(inv[itemId] || 0) - 1);
        inventory = inv;
      }
      map[itemId] = sub;
      return { ...state, itemDurability: map, inventory };
    }
    case ActionTypes.START_INCUBATION: {
      const slot = Number(action.payload?.slotId);
      const eggItemId = action.payload?.eggItemId;
      const hatchTime = Number(action.payload?.hatchTime);
      const genetics = action.payload?.genetics || null;
      if (!Number.isInteger(slot) || !eggItemId || !hatchTime) return state;
      const incubating = { ...(state.incubatingEggs || {}) };
      incubating[slot] = {
        eggItemId,
        startTime: Date.now(),
        hatchTime,
        lastTwitchTime: Date.now(),
        nextTwitchInterval: action.payload?.twitchIntervalBase || 2500,
        nextTwitchAt: Date.now() + (action.payload?.twitchIntervalBase || 2500),
        jitterFactor: action.payload?.jitterFactor || 1,
        genetics,
      };
      const pets = { ...(state.pets || {}) };
      pets[slot] = { type: 'incubating', eggItemId, name: action.payload?.label || 'Incubating' };
      return { ...state, incubatingEggs: incubating, pets };
    }
    case ActionTypes.HATCH_EGG: {
      const slot = Number(action.payload?.slotId);
      const pet = action.payload?.pet;
      if (!Number.isInteger(slot) || !pet) return state;
      const incubating = { ...(state.incubatingEggs || {}) };
      delete incubating[slot];
      const pets = { ...(state.pets || {}) };
      pets[slot] = { type: 'pet', ...pet };
      const next = { ...state, incubatingEggs: incubating, pets };
      if (slot === 0) {
        Object.assign(next, {
          petTypeId: pet.petTypeId,
          traitIds: pet.traitIds,
          name: pet.name,
          hunger: pet.hunger,
          happiness: pet.happiness,
          dirtiness: pet.dirtiness,
          energy: pet.energy,
          rage: pet.rage,
          lifetimeHappinessGained: pet.lifetimeHappinessGained || 0,
        });
      }
      return next;
    }
    case ActionTypes.APPLY_DELTAS: {
      const slotId = Number(action.payload?.slotId ?? 0);
      const deltas = action.payload?.deltas || {};
      const pets = { ...(state.pets || {}) };
      const pet = pets[slotId];
      if (!pet || pet.type !== 'pet') return state;
      const nextPet = {
        ...pet,
        hunger: clamp((pet.hunger || 0) + (deltas.hunger || 0)),
        dirtiness: clamp((pet.dirtiness || 0) + (deltas.dirtiness || 0)),
        energy: clamp((pet.energy || 0) + (deltas.energy || 0)),
        happiness: clamp((pet.happiness || 0) + (deltas.happiness || 0)),
        rage: clamp((pet.rage || 0) + (deltas.rage || 0)),
        lifetimeHappinessGained: (pet.lifetimeHappinessGained || 0) + Math.max(0, Math.round(deltas.happiness || 0)),
      };
      pets[slotId] = nextPet;
      const next = { ...state, pets };
      // legacy mirror slot 0
      if (slotId === 0) Object.assign(next, {
        petTypeId: nextPet.petTypeId,
        traitIds: nextPet.traitIds,
        name: nextPet.name,
        hunger: nextPet.hunger,
        happiness: nextPet.happiness,
        dirtiness: nextPet.dirtiness,
        energy: nextPet.energy,
        rage: nextPet.rage,
        lifetimeHappinessGained: nextPet.lifetimeHappinessGained || 0,
      });
      return next;
    }
    case ActionTypes.TICK: {
      const deltaMs = Math.max(0, Number(action.payload?.deltaMs) || 2000);
      const pets = { ...(state.pets || {}) };
      for (const [slot, pet] of Object.entries(pets)) {
        if (!pet || pet.type !== 'pet') continue;
        const d = action.payload?.decays?.[pet.petTypeId] || {
          fullnessPerTick: 1.2,
          cleanlinessPerTick: 1.0,
          happinessBaseDecay: 0.4,
          happinessHungryPenalty: 0.7,
          happinessDirtyPenalty: 0.6,
          energyRegenWhenHappy: 0.5,
          energyDecayOtherwise: 0,
        };
        const scale = deltaMs / 2000; // normalize to old 2s step
        let hunger = clamp((pet.hunger || 0) + d.fullnessPerTick * scale);
        let dirt = clamp((pet.dirtiness || 0) + d.cleanlinessPerTick * scale);
        let hap = pet.happiness || 0;
        let decay = d.happinessBaseDecay * scale;
        if (hunger > 70) decay += d.happinessHungryPenalty * scale;
        if (dirt > 70) decay += d.happinessDirtyPenalty * scale;
        hap = clamp(hap - decay);
        const happyEnough = hap >= 50;
        const cleanEnough = dirt <= 40;
        const fedEnough = hunger < 60;
        const regen = (happyEnough && cleanEnough && fedEnough) ? (d.energyRegenWhenHappy || 0.5) : (d.energyDecayOtherwise ? 0 : 0.2);
        let energy = clamp((pet.energy || 0) + regen * scale);
        pets[slot] = { ...pet, hunger, dirtiness: dirt, happiness: hap, energy };
      }
      const next = { ...state, pets, tick: (state.tick || 0) + 1 };
      // legacy mirror slot 0
      const p0 = pets[0];
      if (p0) Object.assign(next, {
        petTypeId: p0.petTypeId,
        traitIds: p0.traitIds,
        name: p0.name,
        hunger: p0.hunger,
        happiness: p0.happiness,
        dirtiness: p0.dirtiness,
        energy: p0.energy,
        rage: p0.rage,
        lifetimeHappinessGained: p0.lifetimeHappinessGained || 0,
      });
      return next;
    }
    default:
      return state;
  }
} 