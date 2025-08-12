import { PETS, getPetById } from './config/pets.js';
import { TRAITS, getTraitById } from './config/traits.js';
import { ITEMS, getItemById } from './config/items.js';
import { STATUS_THRESHOLDS, STATUS_LABELS } from './config/status.js';

// Optional: bootstrap minimal store for future refactor
import { createStore } from './src/store.js';
import { rootReducer, ActionTypes } from './src/reducer.js';

const USE_STORE = false; // temporarily disable until UI is fully migrated
let store = null;
// Store will be initialized after state is loaded below

const STORAGE_KEY = 'demon-husbandry.save.v1';
const LEGACY_STORAGE_KEYS = ['petto.save.v8'];
const SAVE_VERSION = 2; // schema v2: no top-level stat mirrors; slot 0 is source of truth

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

// Helpers to access main pet safely
function getMainPet(stateObj = null) {
  const s = stateObj || state;
  const p = s.pets?.[0];
  if (p && p.type === 'pet') return p;
  // Fallback stub if missing
  return {
    type: 'pet',
    petTypeId: s.petTypeId || PETS[0].id,
    traitIds: s.traitIds || [TRAITS[0].id],
    name: s.name || 'Demon',
    hunger: s.hunger ?? 50,
    happiness: s.happiness ?? 70,
    dirtiness: s.dirtiness ?? 30,
    energy: s.energy ?? 70,
    rage: s.rage ?? 0,
    lifetimeHappinessGained: s.lifetimeHappinessGained || 0,
  };
}

function setMainPet(mutator) {
  if (!state.pets) state.pets = {};
  if (!state.pets[0] || state.pets[0].type !== 'pet') {
    const p = getMainPet();
    state.pets[0] = { ...p };
  }
  state.pets[0] = mutator({ ...state.pets[0] });
  // Mirror to legacy fields for current UI
  syncMainFromSlot0();
}

const defaultState = (petTypeId = PETS[0].id, traitIds = [TRAITS[0].id]) => {
  const cfg = getPetById(petTypeId);
  const s = cfg.startingStats;
  const inventory = Object.fromEntries(ITEMS.map((i) => [i.id, i.defaultCount || 0]));
  // Initialize durability tracking for items that have durability
  const itemDurability = {};
  for (const item of ITEMS) {
    if (item.durability) {
      itemDurability[item.id] = {};
    }
  }
  const main = {
    type: 'pet',
    petTypeId,
    traitIds,
    name: 'Demon',
    hunger: 100 - s.fullness, // migrate to hunger scale
    happiness: s.happiness,
    dirtiness: 100 - s.cleanliness,
    energy: s.energy,
    rage: 0,
    lifetimeHappinessGained: 0,
  };
  return {
    version: SAVE_VERSION,
    activePetId: 0,
    // Legacy mirrors (will be removed after full UI refactor)
        petTypeId,
        traitIds,
    name: main.name,
    hunger: main.hunger,
    happiness: main.happiness,
    dirtiness: main.dirtiness,
    energy: main.energy,
    rage: main.rage,
    tick: 0,
    lifetimeHappinessGained: main.lifetimeHappinessGained,
    // Multi-pet system
    pets: { 0: main },
    // Incubation tracking
    incubatingEggs: {},
    inventory,
    itemDurability,
    starterGranted: false,
  };
};

let lastArtSrc = '';

const toys = [
  { id: 'ball', label: 'Ball', happinessGain: 12, energyDelta: -10 },
  { id: 'laser', label: 'Laser Pointer', happinessGain: 16, energyDelta: -14 },
  { id: 'yarn', label: 'Yarn', happinessGain: 10, energyDelta: -8 },
  { id: 'feather', label: 'Feather Wand', happinessGain: 14, energyDelta: -12 },
];

// Migration to v2 single-source-of-truth
function migrateStateV2(parsed) {
  const migrated = { ...parsed };
  // Ensure containers
  migrated.pets = migrated.pets || {};
  // Backfill hunger/dirtiness from legacy keys
  if (migrated.fullness != null && migrated.hunger == null) { migrated.hunger = 100 - migrated.fullness; delete migrated.fullness; }
  if (migrated.cleanliness != null && migrated.dirtiness == null) { migrated.dirtiness = 100 - migrated.cleanliness; delete migrated.cleanliness; }
  // Ensure slot 0 exists and holds legacy mirrors
  if (!migrated.pets[0] || migrated.pets[0].type !== 'pet') {
    migrated.pets[0] = {
      type: 'pet',
      petTypeId: migrated.petTypeId || PETS[0].id,
      traitIds: Array.isArray(migrated.traitIds) && migrated.traitIds.length ? migrated.traitIds : [TRAITS[0].id],
      name: migrated.name || 'Demon',
      hunger: migrated.hunger ?? 50,
      happiness: migrated.happiness ?? 70,
      dirtiness: migrated.dirtiness ?? 30,
      energy: migrated.energy ?? 70,
      rage: migrated.rage ?? 0,
      lifetimeHappinessGained: migrated.lifetimeHappinessGained || 0,
    };
  }
  // Normalize basics
  migrated.activePetId = 0;
  migrated.version = SAVE_VERSION;
  return migrated;
}

let state = load() || defaultState();

// Initialize store after state exists
try {
  if (USE_STORE) {
    store = createStore(rootReducer, state);
    store.subscribe(() => {
      state = store.getState();
      render();
      save();
    });
  }
} catch (_) {}

// Force debug init in case previous render bailed
initDebug();

function load() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacyRaw = localStorage.getItem(legacyKey);
        if (legacyRaw) {
          raw = legacyRaw;
          // Migrate to new key and clear legacy
          try { localStorage.setItem(STORAGE_KEY, legacyRaw); } catch {}
          try { localStorage.removeItem(legacyKey); } catch {}
          break;
        }
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const petId = parsed.petTypeId && getPetById(parsed.petTypeId) ? parsed.petTypeId : PETS[0].id;
    const traitIds = Array.isArray(parsed.traitIds) && parsed.traitIds.length
      ? parsed.traitIds.filter((id) => getTraitById(id)).slice(0, 3)
      : [TRAITS[0].id];
    const defaults = Object.fromEntries(ITEMS.map((i) => [i.id, i.defaultCount || 0]));
    const inventory = { ...defaults, ...(parsed.inventory || {}) };
    // Initialize durability tracking for items that have durability
    const itemDurability = {};
    for (const item of ITEMS) {
      if (item.durability) {
        itemDurability[item.id] = parsed.itemDurability?.[item.id] || {};
      }
    }
    let base = { ...parsed, petTypeId: petId, traitIds, inventory, itemDurability };
    // Legacy field migrations
    if (base.fullness != null && base.hunger == null) { base.hunger = 100 - base.fullness; delete base.fullness; }
    if (base.cleanliness != null && base.dirtiness == null) { base.dirtiness = 100 - base.cleanliness; delete base.cleanliness; }
    // Schema migration
    if (!base.version || base.version < SAVE_VERSION) {
      base = migrateStateV2(base);
    }
    // Overlay on defaults to ensure new keys exist
    const d = defaultState(petId, traitIds);
    return { ...d, ...base };
  } catch (e) { return null; }
}

function save() { state.version = SAVE_VERSION; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function resetAll() { state = defaultState(state.petTypeId, state.traitIds); localStorage.removeItem(STORAGE_KEY); for (const k of LEGACY_STORAGE_KEYS) try { localStorage.removeItem(k); } catch {} render(); }

const $ = (sel) => document.querySelector(sel);

// adjust element refs to optional for type/trait controls
const el = {
  petEmoji: $('#petEmoji'),
  petImage: $('#petImage'),
  // petMood removed from UI
  barFullness: $('#barFullness'),
  barCleanliness: $('#barCleanliness'),
  barEnergy: $('#barEnergy'),
  barRage: $('#barRage'),
  numFullness: $('#numFullness'),
  numCleanliness: $('#numCleanliness'),
  numEnergy: $('#numEnergy'),
  numRage: $('#numRage'),
  statusTags: document.querySelector('#statusTags'),
  // optional controls (may be absent)
  feedBtn: $('#feedBtn') || null,
  petBtn: $('#petBtn') || null,
  groomBtn: $('#groomBtn') || null,
  toySelect: $('#toySelect') || null,
  playBtn: $('#playBtn') || null,
  saveBtn: $('#saveBtn'),
  resetBtn: $('#resetBtn'),
  tickInfo: $('#tickInfo'),
  petTypeSelect: document.getElementById('petTypeSelect') || null,
  traitSelect: document.getElementById('traitSelect') || null,
  heartsCount: $('#heartsCount'),
  heartsProgress: $('#heartsProgress'),
  inventoryGrid: $('#inventoryGrid'),
};

function multFromTraits(key, petData = null) { 
  // Use specific pet's traits or fall back to main pet
  const targetPet = petData || state;
  const traits = (targetPet.traitIds || []).map((id) => getTraitById(id)).filter(Boolean);
  return traits.reduce((acc, t) => acc * (t?.modifiers?.[key] ?? 1), 1); 
}

function activeTraits(petData = null) { 
  const targetPet = petData || state;
  return (targetPet.traitIds || []).map((id) => getTraitById(id)).filter(Boolean); 
}

function activePetConfig(petData = null) { 
  const targetPet = petData || state;
  return getPetById(targetPet.petTypeId); 
}

function adjustRage(delta, petData = null) { 
  const targetPet = petData || state;
  if (petData) {
    petData.rage = clamp((petData.rage || 0) + delta);
  } else {
    // Fallback for legacy paths (unused once fully migrated)
    if (state.pets?.[0]) state.pets[0].rage = clamp((state.pets[0].rage || 0) + delta);
  }
}

// Calculate damage chance for an item based on pet stats, type, and traits
function calculateItemDamageChance(item, targetPet = null) {
  if (!item.durability) return 0;
  
  const pet = targetPet || state;
  const durability = item.durability;
  let damageChance = durability.baseDamageChance;
  
  console.log(`Calculating damage for ${item.label}: base=${durability.baseDamageChance}`);
  
  // Rage increases damage chance
  if ((pet.rage || 0) > durability.rageThreshold) {
    const excessRage = (pet.rage || 0) - durability.rageThreshold;
    const petConfig = activePetConfig(pet);
    const rageBonus = (petConfig.itemDamage?.rageBonus || 0.2) * (excessRage / 10);
    console.log(`Rage bonus: excess=${excessRage}, rageBonus=${rageBonus}`);
    damageChance += rageBonus;
  }
  
  // Pet type modifier
  const petDamageMultiplier = activePetConfig(pet).itemDamage?.damageMultiplier || 1;
  console.log(`Pet damage multiplier: ${petDamageMultiplier}`);
  damageChance *= petDamageMultiplier;
  
  // Trait modifiers
  const traitDamageMultiplier = multFromTraits('itemDamageMultiplier', pet);
  console.log(`Trait damage multiplier: ${traitDamageMultiplier}`);
  damageChance *= traitDamageMultiplier;
  
  console.log(`Final damage chance: ${damageChance}`);
  
  return Math.min(1, Math.max(0, damageChance)); // clamp between 0 and 1
}

// Get next available item instance or create new one
function getItemInstance(itemId) {
  if (!state.itemDurability[itemId]) state.itemDurability[itemId] = {};
  
  const durabilityMap = state.itemDurability[itemId];
  const item = getItemById(itemId);
  
  if (!item.durability) return null; // Item doesn't have durability
  
  console.log(`Looking for instance of ${itemId}. Current instances:`, durabilityMap);
  
  // Find existing instance with most uses (but not broken) - the "top" item
  let bestInstanceId = null;
  let highestUses = -1;
  
  for (const [instanceId, uses] of Object.entries(durabilityMap)) {
    if (uses < item.durability.maxUses && uses > highestUses) {
      highestUses = uses;
      bestInstanceId = instanceId;
    }
  }
  
  if (bestInstanceId) {
    console.log(`Found existing instance: ${bestInstanceId} with ${highestUses} uses`);
    return bestInstanceId;
  }
  
  // Create new instance if no existing ones
  const newInstanceId = `${itemId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  durabilityMap[newInstanceId] = 0;
  console.log(`Created new instance: ${newInstanceId}`);
  return newInstanceId;
}

// Damage an item instance
function damageItemInstance(itemId, instanceId) {
  const item = getItemById(itemId);
  if (!item.durability) {
    console.log(`Cannot damage ${itemId}: item has no durability`);
    return false;
  }
  
  if (!state.itemDurability[itemId]) {
    console.log(`Cannot damage ${itemId}: no durability map for item`);
    return false;
  }
  
  if (state.itemDurability[itemId][instanceId] === undefined) {
    console.log(`Cannot damage ${itemId}: instance ${instanceId} not found in durability map`);
    console.log(`Available instances:`, Object.keys(state.itemDurability[itemId]));
    return false;
  }
  
  console.log(`Before damage: ${itemId} instance ${instanceId} has ${state.itemDurability[itemId][instanceId]} uses`);
  
  state.itemDurability[itemId][instanceId]++;
  
  console.log(`After damage: ${itemId} instance ${instanceId} now has ${state.itemDurability[itemId][instanceId]} uses (max: ${item.durability.maxUses})`);
  
  // Check if item is broken
  if (state.itemDurability[itemId][instanceId] >= item.durability.maxUses) {
    console.log(`Item broke! Removing instance and reducing inventory count`);
    delete state.itemDurability[itemId][instanceId];
    // Reduce inventory count
    const oldCount = state.inventory[itemId] || 0;
    state.inventory[itemId] = Math.max(0, oldCount - 1);
    console.log(`Inventory count reduced from ${oldCount} to ${state.inventory[itemId]}`);
    return true; // Item broke
  }
  
  return false; // Item damaged but not broken
}

function syncMainFromSlot0() {
  const p0 = state.pets?.[0];
  if (!p0) return;
  state.petTypeId = p0.petTypeId;
  state.traitIds = p0.traitIds;
  state.name = p0.name;
  state.hunger = p0.hunger;
  state.happiness = p0.happiness;
  state.dirtiness = p0.dirtiness;
  state.energy = p0.energy;
  state.rage = p0.rage;
  state.lifetimeHappinessGained = p0.lifetimeHappinessGained || 0;
}

// Update header action handlers to target main pet (slot 0) and correct cleanliness mapping
function onFeed() { 
  const pet = state.pets?.[0]; if (!pet) return;
  const cfg = activePetConfig(pet); 
  const fullnessGain = cfg.actions.feedFullnessGain * multFromTraits('feedFullnessGainMultiplier', pet); 
  const energyGain = cfg.actions.feedEnergyGain; 
  const happinessGain = cfg.actions.feedHappinessGain * multFromTraits('feedHappinessGainMultiplier', pet); 
  if (USE_STORE && store) {
    store.dispatch({ type: ActionTypes.APPLY_DELTAS, payload: { slotId: 0, deltas: { hunger: -fullnessGain, energy: energyGain, happiness: happinessGain, rage: -6 } } });
  } else {
    pet.hunger = clamp((pet.hunger || 0) - fullnessGain); 
    pet.energy = clamp((pet.energy || 0) + energyGain); 
    pet.happiness = clamp((pet.happiness || 0) + happinessGain); 
    if (happinessGain > 0) pet.lifetimeHappinessGained = (pet.lifetimeHappinessGained || 0) + Math.round(happinessGain);
    adjustRage(-6, pet); 
    syncMainFromSlot0(); render(); startParticleEffects(); 
  }
}
function onPet() { 
  const pet = state.pets?.[0]; if (!pet) return;
  const cfg = activePetConfig(pet); 
  const petHappinessGain = cfg.actions.petHappinessGain * multFromTraits('petHappinessGainMultiplier', pet); 
  if (USE_STORE && store) {
    store.dispatch({ type: ActionTypes.APPLY_DELTAS, payload: { slotId: 0, deltas: { happiness: petHappinessGain, rage: -8 } } });
  } else {
    pet.happiness = clamp((pet.happiness || 0) + petHappinessGain); 
    if (petHappinessGain > 0) pet.lifetimeHappinessGained = (pet.lifetimeHappinessGained || 0) + Math.round(petHappinessGain);
    adjustRage(-8, pet); 
    syncMainFromSlot0(); render(); startParticleEffects(); 
  }
}
function onGroom() { 
  const pet = state.pets?.[0]; if (!pet) return;
  const cfg = activePetConfig(pet); 
  const cleanGain = cfg.actions.groomCleanlinessGain * multFromTraits('groomCleanlinessGainMultiplier', pet); 
  const happyBase = cfg.actions.groomHappinessGain; 
  const happyGain = happyBase * multFromTraits('groomHappinessGainMultiplier', pet); 
  const energyDelta = activeTraits(pet).reduce((sum, t) => sum + (t?.modifiers?.groomEnergyDelta || 0), 0); 
  if (USE_STORE && store) {
    store.dispatch({ type: ActionTypes.APPLY_DELTAS, payload: { slotId: 0, deltas: { dirtiness: -cleanGain, happiness: happyGain, energy: energyDelta } } });
  } else {
    pet.dirtiness = clamp((pet.dirtiness || 0) - cleanGain); 
    pet.happiness = clamp((pet.happiness || 0) + happyGain); 
    if (happyGain > 0) pet.lifetimeHappinessGained = (pet.lifetimeHappinessGained || 0) + Math.round(Math.max(0, happyGain)); 
    if (energyDelta !== 0) pet.energy = clamp((pet.energy || 0) + energyDelta); 
    adjustRage(-5, pet); 
    syncMainFromSlot0(); render(); startParticleEffects(); 
  }
}
function onPlay() { 
  const pet = state.pets?.[0]; if (!pet) return;
  const cfg = activePetConfig(pet); 
  const toy = toys.find((t) => t.id === el.toySelect?.value) || toys[0]; 
  const energyMultiplier = cfg.actions.playEnergyMultiplier * multFromTraits('playEnergyMultiplier', pet); 
  const happinessMultiplier = cfg.actions.playHappinessMultiplier * multFromTraits('playHappinessMultiplier', pet); 
  const energyDelta = toy.energyDelta * energyMultiplier; 
  if ((pet.energy || 0) + energyDelta < 0) return; 
  const happyGain = toy.happinessGain * happinessMultiplier; 
  if (USE_STORE && store) {
    store.dispatch({ type: ActionTypes.APPLY_DELTAS, payload: { slotId: 0, deltas: { happiness: happyGain, energy: energyDelta, dirtiness: cfg.actions.playCleanlinessCost } } });
  } else {
    pet.happiness = clamp((pet.happiness || 0) + happyGain); 
    if (happyGain > 0) pet.lifetimeHappinessGained = (pet.lifetimeHappinessGained || 0) + Math.round(happyGain); 
    pet.energy = clamp((pet.energy || 0) + energyDelta); 
    pet.dirtiness = clamp((pet.dirtiness || 0) + cfg.actions.playCleanlinessCost); 
    adjustRage(-8, pet); 
    syncMainFromSlot0(); render(); startParticleEffects(); 
  }
}

// Replace startTicking to dispatch through store when available
let __tickTimer = null;
function startTicking() {
  const step = () => {
    try {
      if (store) {
        // store is disabled currently (USE_STORE=false)
        store.dispatch({ type: ActionTypes.TICK, payload: { deltaMs: 2000 } });
      } else {
        tick();
        render();
      }
    } catch (e) {
      console.error('[DH] tick error', e);
    }
  };
  if (__tickTimer) clearInterval(__tickTimer);
  console.log('[DH] ticking start');
  step(); // run once immediately
  __tickTimer = setInterval(step, 2000);
  setInterval(() => save(), 30000);
}

function setEmojiVisibility() { if (!el.petEmoji) return; const showImg = !!el.petImage && el.petImage.classList.contains('show'); el.petEmoji.style.display = showImg ? 'none' : 'block'; }
function setPetArt() { 
  const main = getMainPet();
  const type = main.petTypeId; 
  const src = `assets/pets/${type}_happy.png`; 
  if (!el.petImage) return; 
  // Always set src to ensure reload (some browsers skip onload when cached)
  lastArtSrc = src; 
  el.petImage.classList.remove('show'); 
  setEmojiVisibility(); 
  el.petImage.src = src; 
  el.petImage.onload = () => { el.petImage.classList.add('show'); setEmojiVisibility(); applyRageAnimation(); }; 
  el.petImage.onerror = () => { el.petImage.classList.remove('show'); setEmojiVisibility(); }; 
}

function applyRageAnimation() {
  if (!el.petImage) return;
  
  // Remove existing rage classes
  el.petImage.classList.remove('rage-furious', 'rage-angry', 'rage-annoyed', 'rage-calm');
  
  const rage = getMainPet().rage || 0;
  
  if (rage >= 90) {
    el.petImage.classList.add('rage-furious');
  } else if (rage >= 75) {
    el.petImage.classList.add('rage-angry');
  } else if (rage >= 50) {
    el.petImage.classList.add('rage-annoyed');
  } else if (rage <= 20) {
    el.petImage.classList.add('rage-calm');
  }
  // No animation for neutral range (21-49)
}

function applyRageAnimationToPet(imageEl, petData) {
  if (!imageEl || !petData) return;
  
  // Remove existing rage classes
  imageEl.classList.remove('rage-furious', 'rage-angry', 'rage-annoyed', 'rage-calm');
  
  const rage = petData.rage || 0;
  
  if (rage >= 90) {
    imageEl.classList.add('rage-furious');
  } else if (rage >= 75) {
    imageEl.classList.add('rage-angry');
  } else if (rage >= 50) {
    imageEl.classList.add('rage-annoyed');
  } else if (rage <= 20) {
    imageEl.classList.add('rage-calm');
  }
  // No animation for neutral range (21-49)
}

// Ticking now updates every pet independently and keeps slot 0 mirrored to legacy fields
function tick() {
  state.tick += 1;
  
  for (const [slotId, pet] of Object.entries(state.pets || {})) {
    if (!pet || pet.type !== 'pet') continue;
    const d = getPetById(pet.petTypeId).decay;
    const hungerRise = d.fullnessPerTick * multFromTraits('fullnessDecayMultiplier', pet);
    const dirtinessRise = d.cleanlinessPerTick * multFromTraits('cleanlinessDecayMultiplier', pet);
    const baseHappinessDecay = d.happinessBaseDecay * multFromTraits('happinessBaseDecayMultiplier', pet);
    const hungryPenalty = d.happinessHungryPenalty * multFromTraits('happinessHungryPenaltyMultiplier', pet);
    const dirtyPenalty = d.happinessDirtyPenalty * multFromTraits('happinessDirtyPenaltyMultiplier', pet);
    pet.hunger = clamp((pet.hunger || 0) + hungerRise);
    pet.dirtiness = clamp((pet.dirtiness || 0) + dirtinessRise);
    let happinessDecay = baseHappinessDecay; 
    if ((pet.hunger || 0) > 70) happinessDecay += hungryPenalty; 
    if ((pet.dirtiness || 0) > 70) happinessDecay += dirtyPenalty; 
    pet.happiness = clamp((pet.happiness || 0) - happinessDecay);
    
  // rage dynamics
  let rageDelta = 0; 
    if ((pet.hunger || 0) > 75) rageDelta += 3; 
    if ((pet.hunger || 0) > 90) rageDelta += 2; 
    if ((pet.dirtiness || 0) > 70) rageDelta += 2; 
    if ((pet.happiness || 0) < 30) rageDelta += 3; 
    if ((pet.energy || 0) < 20) rageDelta += 2; 
  
  // tiredness calms rage over time
    if ((pet.energy || 0) <= 25) rageDelta -= 3; 
    if ((pet.energy || 0) <= 15) rageDelta -= 3; 
    if ((pet.energy || 0) <= 10) rageDelta -= 4; 
  
  // bonus calm when needs are satisfied
    if ((pet.dirtiness || 0) <= 25 && (pet.hunger || 0) < 40) rageDelta -= 2; 
    
    // gentle energy regeneration
    const happyEnough = (pet.happiness || 0) >= 50;
    const cleanEnough = (pet.dirtiness || 0) <= 40;
    const fedEnough = (pet.hunger || 0) < 60;
    const baseRegen = (happyEnough && cleanEnough && fedEnough) ? (d.energyRegenWhenHappy || 0.5) : (d.energyDecayOtherwise ? 0 : 0.2);
    pet.energy = clamp((pet.energy || 0) + baseRegen);
    
    adjustRage(rageDelta - 1, pet);
  }
  
  // Debug: log main pet stats every few ticks
  if (state.tick % 3 === 0 && state.pets && state.pets[0]) {
    const p = state.pets[0];
    console.log('[DH] tick', state.tick, { hunger: Math.round(p.hunger), dirtiness: Math.round(p.dirtiness), happiness: Math.round(p.happiness), energy: Math.round(p.energy) });
  }
  
  updateEggIncubation();
  startParticleEffects();
}

function renderHearts() {
  const wrap = document.getElementById('heartsRow');
  if (!wrap) return;
  const { hearts } = heartsForTotal(getMainPet().lifetimeHappinessGained || 0);
  const maxHearts = 10; // display up to 10 slots
  wrap.innerHTML = '';
  for (let i = 0; i < maxHearts; i++) {
    const span = document.createElement('span');
    span.className = 'heart';
    span.textContent = i < hearts ? '💜' : '🤍';
    wrap.appendChild(span);
  }
}

function renderInventory() { 
  if (!el.inventoryGrid) { console.warn('[DH] no inventoryGrid'); return; } 
  try {
    const total = Object.values(state.inventory || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    console.log('[DH] renderInventory totals=', total, 'items=', ITEMS.map(i=>[i.id, state.inventory?.[i.id]||0]));
  } catch (e) { console.warn('[DH] renderInventory error', e); }
  el.inventoryGrid.innerHTML = ''; 
  for (const it of ITEMS) { 
    const count = state.inventory?.[it.id] ?? 0; 
    const card = document.createElement('div'); 
    card.className = 'inventory-card'; 
    card.setAttribute('data-item-id', it.id); 
    card.setAttribute('data-count', String(count));
    
    // Calculate what to show in the bar
    let barPercent = 0;
    let showBar = false;
    
    if (it.durability && count > 0) {
      const durabilityMap = state.itemDurability?.[it.id] || {};
      let currentUses = 0;
      for (const [instanceId, uses] of Object.entries(durabilityMap)) {
        if (uses < it.durability.maxUses && uses > currentUses) {
          currentUses = uses;
        }
      }
      const remainingUses = it.durability.maxUses - currentUses;
      barPercent = (remainingUses / it.durability.maxUses) * 100;
      showBar = true;
    }
    
    card.innerHTML = `
      <div class="top" ${it.sprite ? 'style="display:none"' : ''}>
        <span class="emoji">${it.emoji}</span>
        <span class="count">x${count}</span>
      </div>
      <div class="title">${it.label}</div>
      <div class="muted">${it.category}</div>
      ${showBar ? `<div class="bar mini"><div class="fill" style="width:${barPercent}%"></div></div>` : ''}
      <button class="btn use-btn" ${count <= 0 ? 'disabled' : ''}>Use</button>
    `; 
    
    // Drag setup helper
    const bindDrag = (el) => {
      if (!el) return;
      el.setAttribute('draggable', String(count > 0));
      if (count > 0) {
        el.addEventListener('dragstart', (ev) => {
          try {
            ev.dataTransfer.setData('text/plain', it.id);
            ev.dataTransfer.effectAllowed = 'copy';
          } catch (_) {}
        });
      }
    };
    
    // Add sprite layer if provided, else keep big emoji in .top
    if (it.sprite) {
      const layer = document.createElement('div');
      layer.className = 'item-sprite-layer';
      layer.style.position = 'absolute';
      layer.style.left = '50%';
      layer.style.top = '-20px';
      layer.style.transform = 'translate(-50%, 0) scale(0.6)';
      layer.style.width = '80%';
      layer.style.height = '80%';
      layer.style.backgroundImage = `url('${it.sprite}')`;
      layer.style.backgroundRepeat = 'no-repeat';
      layer.style.backgroundPosition = 'center';
      layer.style.backgroundSize = 'contain';
      layer.style.opacity = '0.95';
      layer.style.pointerEvents = 'none';
      card.appendChild(layer);
      // Add count badge in top-right
      const badge = document.createElement('div');
      badge.className = 'item-count-badge';
      badge.textContent = `x${count}`;
      card.appendChild(badge);
      // Create a transparent drag handle over the sprite to initiate drag
      const handle = document.createElement('div');
      handle.style.position = 'absolute';
      handle.style.left = '50%';
      handle.style.top = '-20px';
      handle.style.transform = 'translate(-50%, 0)';
      handle.style.width = '80%';
      handle.style.height = '80%';
      handle.style.background = 'transparent';
      bindDrag(handle);
      card.appendChild(handle);
    } else {
      // Emphasize emoji fallback and bind drag on the top row
      const emojiEl = card.querySelector('.top .emoji');
      if (emojiEl) emojiEl.style.fontSize = '48px';
      bindDrag(card.querySelector('.top'));
    }
    // Also bind drag on the card as a fallback
    bindDrag(card);
    
    const useBtn = card.querySelector('.use-btn'); 
    useBtn.addEventListener('click', () => onUseItem(it.id)); 
    el.inventoryGrid.appendChild(card); 
  } 
  enableDragAndDrop(); 
}

function onUseItem(itemId, targetPetSlot = 0) { 
  const item = getItemById(itemId) || state.breedingEggs?.[itemId];
  if (!item) return; 
  const count = state.inventory?.[itemId] ?? 0; 
  if (count <= 0) return; 
  
  // Get target pet
  const targetPet = state.pets?.[targetPetSlot];
  if (!targetPet || targetPet.type !== 'pet') {
    console.log(`Cannot use item on slot ${targetPetSlot}: not a valid pet`);
    return;
  }
  
  // For items without durability, just reduce count
  if (!item.durability) {
    if (USE_STORE && store) {
      // Map effects to deltas
      const effects = item.effects || {};
      let hunger = 0; 
      if (typeof effects.hunger === 'number') hunger += effects.hunger;
      if (typeof effects.fullness === 'number') hunger -= effects.fullness; 
      let cleanliness = effects.cleanliness || 0; 
      let energy = effects.energy || 0; 
      let happiness = effects.happiness || 0; 
      let rage = effects.rage || 0;
      // Use-type multipliers for slot target
      if (item.useType === 'feed') { 
        hunger *= multFromTraits('feedFullnessGainMultiplier', targetPet); 
        happiness *= multFromTraits('feedHappinessGainMultiplier', targetPet); 
        rage += -8; 
      } 
      if (item.useType === 'groom') { 
        cleanliness *= multFromTraits('groomCleanlinessGainMultiplier', targetPet); 
        happiness *= multFromTraits('groomHappinessGainMultiplier', targetPet); 
        energy += activeTraits(targetPet).reduce((sum, t) => sum + (t?.modifiers?.groomEnergyDelta || 0), 0); 
      } 
      if (item.useType === 'play') { 
        happiness *= multFromTraits('playHappinessMultiplier', targetPet); 
        energy *= multFromTraits('playEnergyMultiplier', targetPet); 
        rage += -5; 
      } 
      // Dispatch inventory decrement and deltas
      store.dispatch({ type: ActionTypes.MODIFY_INVENTORY, payload: { itemId, delta: -1 } });
      store.dispatch({ type: ActionTypes.APPLY_DELTAS, payload: { slotId: targetPetSlot, deltas: { hunger, dirtiness: -cleanliness, energy, happiness, rage } } });
      startParticleEffects();
      return;
    }
    // Fallback imperative path
    state.inventory[itemId] = count - 1; 
    applyItemEffects(item, targetPet); 
    render(); 
    save(); 
    return;
  }
  
  // For items with durability, handle wear (imperative path for now)
  const instanceId = getItemInstance(itemId);
  if (!instanceId) return; // Shouldn't happen
  
  if (USE_STORE && store) {
    // Apply effects
    const effects = item.effects || {};
    let hunger = 0; 
    if (typeof effects.hunger === 'number') hunger += effects.hunger;
    if (typeof effects.fullness === 'number') hunger -= effects.fullness; 
    let cleanliness = effects.cleanliness || 0; 
    let energy = effects.energy || 0; 
    let happiness = effects.happiness || 0; 
    let rage = effects.rage || 0;
    if (item.useType === 'groom') {
      cleanliness *= multFromTraits('groomCleanlinessGainMultiplier', targetPet); 
      happiness *= multFromTraits('groomHappinessGainMultiplier', targetPet); 
      energy += activeTraits(targetPet).reduce((sum, t) => sum + (t?.modifiers?.groomEnergyDelta || 0), 0); 
    }
    if (item.useType === 'play') {
      happiness *= multFromTraits('playHappinessMultiplier', targetPet); 
      energy *= multFromTraits('playEnergyMultiplier', targetPet); 
      rage += -5; 
    }
    if (item.useType === 'feed') {
      hunger *= multFromTraits('feedFullnessGainMultiplier', targetPet); 
      happiness *= multFromTraits('feedHappinessGainMultiplier', targetPet); 
      rage += -8; 
    }
    store.dispatch({ type: ActionTypes.APPLY_DELTAS, payload: { slotId: targetPetSlot, deltas: { hunger, dirtiness: -cleanliness, energy, happiness, rage } } });
    // Damage roll
    const damageChance = calculateItemDamageChance(item, targetPet);
    const roll = Math.random();
    if (roll < damageChance) {
      store.dispatch({ type: ActionTypes.DAMAGE_ITEM_INSTANCE, payload: { itemId, instanceId, maxUses: item.durability.maxUses } });
    } else {
      // Ensure instance exists in durability map
      store.dispatch({ type: ActionTypes.CREATE_ITEM_INSTANCE, payload: { itemId, instanceId } });
    }
    startParticleEffects();
    return;
  }
  
  applyItemEffects(item, targetPet);
  
  // Roll for damage using target pet's stats
  const damageChance = calculateItemDamageChance(item, targetPet);
  const roll = Math.random();
  
  console.log(`Using ${item.label} on ${targetPet.name}: rage=${targetPet.rage}, damageChance=${damageChance.toFixed(3)}, roll=${roll.toFixed(3)}`);
  
  if (roll < damageChance) {
    // Compute current percent BEFORE applying damage
    const currentPct = getDurabilityPercent(itemId);
    const lossFraction = 1 / Math.max(1, item.durability.maxUses);
    const nextPct = Math.max(0, currentPct - lossFraction * 100);
    // Ensure DOM exists for flashing
    renderInventory();
    flashDurabilityLoss(itemId, lossFraction);
    // Apply damage
    const broke = damageItemInstance(itemId, instanceId);
    if (broke) {
      console.log(`${item.label} broke!`);
    } else {
      console.log(`${item.label} was damaged`);
    }
    // Lerp bar after flash begins
    setTimeout(() => { lerpDurabilityBar(itemId, nextPct); }, 120);
  } else {
    console.log(`${item.label} survived this use`);
    // Ensure bar width syncs
    lerpDurabilityBar(itemId, getDurabilityPercent(itemId));
  }
  
  save(); 
  startParticleEffects(); // Update particles immediately after stat changes
}

function applyItemEffects(item, targetPet = null) { 
  // Use target pet or fall back to main state
  const pet = targetPet || state;
  
  const effects = item.effects || {}; 
  // Map legacy keys to new hunger scale (lower hunger is better)
  let hunger = 0; 
  if (typeof effects.hunger === 'number') hunger += effects.hunger;
  if (typeof effects.fullness === 'number') hunger -= effects.fullness; // fullness -> reduce hunger
  
  let cleanliness = effects.cleanliness || 0; 
  let energy = effects.energy || 0; 
  let happiness = effects.happiness || 0; 
  let rage = effects.rage || 0;
  
  if (item.useType === 'feed') { 
    hunger *= multFromTraits('feedFullnessGainMultiplier', pet); 
    happiness *= multFromTraits('feedHappinessGainMultiplier', pet); 
    adjustRage(-8, targetPet); 
  } 
  if (item.useType === 'groom') { 
    cleanliness *= multFromTraits('groomCleanlinessGainMultiplier', pet); 
    happiness *= multFromTraits('groomHappinessGainMultiplier', pet); 
    energy += activeTraits(pet).reduce((sum, t) => sum + (t?.modifiers?.groomEnergyDelta || 0), 0); 
    // Don't reduce rage for grooming - items now set rage directly
  } 
  if (item.useType === 'play') { 
    happiness *= multFromTraits('playHappinessMultiplier', pet); 
    energy *= multFromTraits('playEnergyMultiplier', pet); 
    adjustRage(-5, targetPet); 
  } 
  
  // Apply mapped deltas to target pet
  pet.hunger = clamp((pet.hunger || 0) + hunger); 
  // cleanliness is the inverse of dirtiness in state
  if (cleanliness !== 0) pet.dirtiness = clamp((pet.dirtiness || 0) - cleanliness);
  pet.energy = clamp((pet.energy || 0) + energy); 
  pet.happiness = clamp((pet.happiness || 0) + happiness); 
  if (rage !== 0) adjustRage(rage, targetPet);
  
  // Add happiness gain tracking
  if (happiness > 0) {
    pet.lifetimeHappinessGained = (pet.lifetimeHappinessGained || 0) + Math.round(happiness);
  }
  
  console.log(`Applied item effects to ${pet.name || 'pet'}: hunger=${pet.hunger}, happiness=${pet.happiness}, energy=${pet.energy}, dirtiness=${pet.dirtiness}`);
}

function computeStatusTags(s) {
  const ordered = ['rage','energy','dirtiness','hunger'];
  const statusData = [];
  for (const statName of ordered) {
    const ranges = STATUS_THRESHOLDS[statName];
    if (!ranges) continue;
    const value = statName === 'dirtiness' ? s.dirtiness : statName === 'hunger' ? s.hunger : s[statName];
    if (value == null) continue;
    let currentIndex = -1; let currentRange = null;
    for (let i = 0; i < ranges.length; i++) { const r = ranges[i]; if (value >= r.min && value <= r.max) { currentIndex = i; currentRange = r; break; } }
    if (currentIndex === -1) { let bestIdx = 0, bestDist = Infinity; for (let i = 0; i < ranges.length; i++) { const r = ranges[i]; let dist = value < r.min ? r.min - value : value > r.max ? value - r.max : 0; if (dist < bestDist) { bestDist = dist; bestIdx = i; } } currentIndex = bestIdx; currentRange = ranges[bestIdx]; }
    const fillPercent = Math.min(100, Math.max(0, value));
    statusData.push({ statName, label: currentRange.label, fillPercent: Math.round(fillPercent), value });
  }
  return statusData;
}

function renderStatusTags() {
  if (!el.statusTags) return;
  const statusData = computeStatusTags(getMainPet());
  el.statusTags.innerHTML = '';
  
  for (const status of statusData) {
    const tag = document.createElement('div');
    tag.className = `status-tag ${status.statName}`;
    tag.setAttribute('data-stat', status.statName);
    tag.innerHTML = `
      <div class="status-fill" style="width: ${status.fillPercent}%"></div>
      <span class="status-label">${status.label}</span>
    `;
    el.statusTags.appendChild(tag);
  }
  
  // After render, measure the widest label and set a shared width
  try {
    const labels = el.statusTags.querySelectorAll('.status-label');
    let maxWidth = 0;
    labels.forEach((lbl) => { maxWidth = Math.max(maxWidth, Math.ceil(lbl.scrollWidth)); });
    // Add padding allowance for aesthetics
    const total = Math.max(120, maxWidth + 24);
    el.statusTags.style.setProperty('--status-tag-width', `${total}px`);
  } catch (_) {}
}

let particleIntervals = {};

// Compute the visual center of the sprite within the particle container, offset up 20px
function getSpriteCenterOffset() {
  const container = document.getElementById('petParticles');
  const img = el.petImage;
  if (!container) return { x: 0, y: 0 };
  const cr = container.getBoundingClientRect();
  if (!img) return { x: cr.width / 2, y: Math.max(0, cr.height / 2 - 40) };
  const ir = img.getBoundingClientRect();
  const centerX = (ir.left - cr.left) + (ir.width / 2);
  const centerY = (ir.top - cr.top) + (ir.height / 2) - 40;
  return { x: centerX, y: centerY };
}

// Particle effects now derive from main pet (slot 0) and use dirtiness correctly
function startParticleEffects() {
  stopParticleEffects(); // Clear existing intervals
  
  const mainPet = state.pets?.[0] || state;
  const dirtiness = mainPet.dirtiness || 0;
  const cleanliness = clamp(100 - dirtiness); // derive cleanliness from dirtiness
  const rage = mainPet.rage || 0;
  
  // Rage particles (when furious)
  if (rage >= 90) {
    particleIntervals.rage = setInterval(() => createRageParticle(), 150);
  }
  
  // Cleanliness particles (can run alongside rage particles)
  if (cleanliness <= 15) {
    particleIntervals.sweat = setInterval(() => createSweatParticle(), 400);
  } else if (cleanliness <= 30) {
    particleIntervals.sweat = setInterval(() => createSweatParticle(), 1200);
  } else if (cleanliness >= 85) {
    particleIntervals.sparkle = setInterval(() => createSparkleParticle(), 800);
  }
}

function stopParticleEffects() {
  Object.values(particleIntervals).forEach(interval => clearInterval(interval));
  particleIntervals = {};
}

function createSweatParticle() {
  const container = document.getElementById('petParticles');
  console.log('Creating sweat particle, container found:', !!container);
  if (!container) return;
  
  const origin = getSpriteCenterOffset();
  
  const particle = document.createElement('div');
  const isFilthy = (state.cleanliness || 0) <= 15;
  particle.className = isFilthy ? 'sweat-particle animate chaotic' : 'sweat-particle animate';
  
  // Emit from sprite center with a tiny jitter
  const jitterX = (Math.random() - 0.5) * 12;
  const jitterY = (Math.random() - 0.5) * 8;
  particle.style.left = `${origin.x + jitterX}px`;
  particle.style.top = `${origin.y + jitterY}px`;
  
  // Set random direction and rotation for outward emission
  const angle = Math.random() * Math.PI * 2; // Random angle in radians
  const distance = Math.random() * 30 + 15; // Random distance 15-45px
  const sweatX = Math.cos(angle) * distance;
  const sweatY = Math.sin(angle) * distance * 0.7; // Slightly less vertical spread
  const rotation = (Math.random() - 0.5) * 180; // Random rotation -90 to 90 degrees
  
  particle.style.setProperty('--sweat-x', `${sweatX}px`);
  particle.style.setProperty('--sweat-y', `${sweatY}px`);
  particle.style.setProperty('--sweat-rotation', `${rotation}deg`);
  
  container.appendChild(particle);
  console.log('Sweat particle added to container');
  
  // Remove particle after animation (match animation duration)
  const duration = isFilthy ? 700 : 1200;
  setTimeout(() => {
    if (particle.parentNode) {
      particle.parentNode.removeChild(particle);
    }
  }, duration);
}

function createSparkleParticle() {
  const container = document.getElementById('petParticles');
  console.log('Creating sparkle particle, container found:', !!container);
  if (!container) return;
  
  const origin = getSpriteCenterOffset();
  
  const particle = document.createElement('div');
  particle.className = 'sparkle-particle animate';
  
  // Start near sprite center with tiny jitter
  const jitterX = (Math.random() - 0.5) * 10;
  const jitterY = (Math.random() - 0.5) * 6;
  particle.style.left = `${origin.x + jitterX}px`;
  particle.style.top = `${origin.y + jitterY}px`;
  
  container.appendChild(particle);
  console.log('Sparkle particle added to container');
  
  // Remove particle after animation (shorter duration)
  setTimeout(() => {
    if (particle.parentNode) {
      particle.parentNode.removeChild(particle);
    }
  }, 1000);
}

function createRageParticle() {
  const container = document.getElementById('petParticles');
  console.log('Creating rage particle, container found:', !!container);
  if (!container) return;
  
  const origin = getSpriteCenterOffset();
  
  const particle = document.createElement('div');
  particle.className = 'rage-particle animate';
  
  // Emit from center with tiny jitter
  const jitterX = (Math.random() - 0.5) * 10;
  const jitterY = (Math.random() - 0.5) * 6;
  particle.style.left = `${origin.x + jitterX}px`;
  particle.style.top = `${origin.y + jitterY}px`;
  
  // Add size variation for more chaos
  const sizeMultiplier = 0.8 + Math.random() * 0.6; // 0.8x to 1.4x size
  particle.style.transform = `scale(${sizeMultiplier})`;
  
  // Set random direction and rotation for explosive outward emission
  const angle = Math.random() * Math.PI * 2; // Random angle in radians
  const distance = Math.random() * 60 + 30; // Random distance 30-90px (much more explosive)
  const rageX = Math.cos(angle) * distance;
  const rageY = Math.sin(angle) * distance * 0.6; // Less vertical spread
  const rotation = (Math.random() - 0.5) * 300; // Even more rotation range for chaos
  
  particle.style.setProperty('--rage-x', `${rageX}px`);
  particle.style.setProperty('--rage-y', `${rageY}px`);
  particle.style.setProperty('--rage-rotation', `${rotation}deg`);
  
  container.appendChild(particle);
  console.log('Rage particle added to container');
  
  // Remove particle after animation
  setTimeout(() => {
    if (particle.parentNode) {
      particle.parentNode.removeChild(particle);
    }
  }, 600);
}

function renderAllPets() {
  // Render all pet slots
  const petCards = document.querySelectorAll('.pet-card[data-pet-slot]');
  
  for (const petCard of petCards) {
    const slotId = parseInt(petCard.getAttribute('data-pet-slot'));
    const petData = state.pets?.[slotId];
    
    const emojiEl = petCard.querySelector('.pet-emoji');
    const imageEl = petCard.querySelector('.pet-image');
    const nameEl = petCard.querySelector('.pet-name-display, #petNameDisplay');
    const heartsEl = petCard.querySelector('.hearts-row');
    const statusEl = petCard.querySelector('.status-tags');
    const infoBtn = petCard.querySelector('.info-btn');
    let hintEl = petCard.querySelector('.empty-hint');
    const miniWrap = petCard.querySelector('.mini-meters') || (() => { const d = document.createElement('div'); d.className = 'mini-meters'; petCard.appendChild(d); return d; })();
    
    if (!petData) {
      // Empty slot
      petCard.classList.remove('incubating');
      petCard.classList.add('empty');
      miniWrap.innerHTML = '';
      if (emojiEl) { emojiEl.classList.remove('egg-state'); emojiEl.style.backgroundImage = ''; emojiEl.textContent = ''; emojiEl.style.display = 'none'; }
      if (imageEl) { imageEl.classList.remove('show'); imageEl.src = ''; }
      if (nameEl) { nameEl.textContent = ''; nameEl.style.display = 'none'; }
      if (heartsEl) { heartsEl.innerHTML = ''; }
      if (statusEl) { statusEl.innerHTML = ''; }
      if (infoBtn) infoBtn.style.display = 'none';
      if (!hintEl) { hintEl = document.createElement('div'); hintEl.className = 'empty-hint'; petCard.appendChild(hintEl); }
      hintEl.textContent = 'drag an egg to incubate';
      continue;
    }
    
    // Non-empty: ensure hint hidden and info visible
    if (hintEl) hintEl.remove();
    if (infoBtn) infoBtn.style.display = '';
    
    if (petData.type === 'incubating') {
      // Incubating egg
      petCard.classList.add('incubating');
      petCard.classList.remove('empty');
      // Show egg sprite
      if (emojiEl) {
        emojiEl.classList.add('egg-state');
        emojiEl.style.backgroundImage = "url('assets/pets/egg.png')";
        emojiEl.textContent = '';
        emojiEl.style.display = 'block';
      }
      if (imageEl) { imageEl.classList.remove('show'); }
      if (nameEl) { nameEl.textContent = ''; nameEl.style.display = 'none'; }
      if (heartsEl) { heartsEl.innerHTML = ''; }
      if (statusEl) { statusEl.innerHTML = ''; }
      miniWrap.innerHTML = '';
      continue;
    }
    
    if (petData.type === 'pet') {
      petCard.classList.remove('incubating', 'empty');
      
      // Ensure any egg classes are removed from emoji
      if (emojiEl) {
        emojiEl.classList.remove('egg-state', 'egg-twitch');
        emojiEl.style.backgroundImage = '';
        emojiEl.textContent = '';
      }
      
      // Set pet sprite (force refresh if src mismatch or image not shown)
      if (imageEl) {
        const src = `assets/pets/${petData.petTypeId}_happy.png`;
        const needsReload = !imageEl.classList.contains('show') || !imageEl.src.includes(`${petData.petTypeId}_happy.png`);
        if (needsReload) {
          imageEl.classList.remove('show');
          imageEl.src = src;
        }
        imageEl.onload = () => {
          imageEl.classList.add('show');
          applyRageAnimationToPet(imageEl, petData); // Apply animations when sprite loads
          setEmojiVisibilityForCard(emojiEl, imageEl);
          centerNameHeartsForCard(petCard);
        };
        imageEl.onerror = () => { imageEl.classList.remove('show'); setEmojiVisibilityForCard(emojiEl, imageEl); };
        // If already shown, just update animation
        if (imageEl.classList.contains('show')) {
          // Sprite already loaded, just update animation
          applyRageAnimationToPet(imageEl, petData);
          setEmojiVisibilityForCard(emojiEl, imageEl);
          centerNameHeartsForCard(petCard);
        }
      }
      
      // Set pet name
      if (nameEl) {
        nameEl.textContent = petData.name || 'Unnamed Pet'; 
        nameEl.style.display = 'block';
        autoshrinkNameButton(nameEl);
      }
      
      // Render hearts
      if (heartsEl) {
        const { hearts } = heartsForTotal(petData.lifetimeHappinessGained || 0);
        const maxHearts = 10;
        heartsEl.innerHTML = '';
        for (let i = 0; i < maxHearts; i++) {
          const span = document.createElement('span');
          span.className = 'heart';
          span.textContent = i < hearts ? '💜' : '🤍';
          heartsEl.appendChild(span);
        }
      }
      
      // Render status tags
      if (statusEl) {
        const statusData = computeStatusTags(petData);
        statusEl.innerHTML = '';
        
        for (const status of statusData) {
          const tag = document.createElement('div');
          tag.className = `status-tag ${status.statName}`;
          tag.setAttribute('data-stat', status.statName);
          tag.innerHTML = `
            <div class="status-fill" style="width: ${status.fillPercent}%"></div>
            <span class="status-label">${status.label}</span>
          `;
          statusEl.appendChild(tag);
        }
      }
      
      // Still render mini meters for slot 0 compatibility
      const fullness = clamp(100 - (petData.hunger ?? 50));
      const cleanliness = clamp(100 - (petData.dirtiness ?? 50));
      const energy = clamp(petData.energy ?? 0);
      
      miniWrap.innerHTML = `
        <div class=\"bar mini fullness\" aria-label=\"Fullness\"><div class=\"fill\" style=\"width:${fullness}%\"></div><span class=\"value\">${Math.round(fullness)}</span></div>
        <div class=\"bar mini cleanliness\" aria-label=\"Cleanliness\"><div class=\"fill\" style=\"width:${cleanliness}%\"></div><span class=\"value\">${Math.round(cleanliness)}</span></div>
        <div class=\"bar mini energy\" aria-label=\"Energy\"><div class=\"fill\" style=\"width:${energy}%\"></div><span class=\"value\">${Math.round(energy)}</span></div>
      `;
    }
  }
  // pass 2: ensure centering after all images might have loaded
  for (const petCard of document.querySelectorAll('.pet-card[data-pet-slot]')) centerNameHeartsForCard(petCard);
}

function render() {
  ensureMainPetExists();
  if (el.petEmoji) el.petEmoji.textContent = getEmoji(getMainPet());
  setPetArt();
  const main = getMainPet();
  if (el.barFullness && el.numFullness) setBar(el.barFullness, el.numFullness, 100 - (main.hunger || 0)); // show "fullness"
  if (el.barCleanliness && el.numCleanliness) setBar(el.barCleanliness, el.numCleanliness, 100 - (main.dirtiness || 0)); // show cleanliness
  if (el.barEnergy && el.numEnergy) setBar(el.barEnergy, el.numEnergy, main.energy || 0);
  if (el.barRage && el.numRage) setBar(el.barRage, el.numRage, main.rage || 0);
  renderStatusTags();
  renderHearts();
  renderInventory();
  renderAllPets();
  startParticleEffects();
  const nameBtn = document.getElementById('petNameDisplay');
  if (nameBtn) {
    nameBtn.textContent = getMainPet().name || 'Demon';
    // autoshrink to fit hearts width
    autoshrinkNameButton(nameBtn);
  }
  if (el.tickInfo) el.tickInfo.textContent = `Tick: ${state.tick}`;
}

function setBar(barEl, numEl, value) { const pct = clamp(value); barEl.style.width = `${pct}%`; numEl.textContent = Math.round(pct); }
function log(message) { const feed = document.querySelector('#logFeed'); if (!feed) return; const time = new Date().toLocaleTimeString(); const entry = document.createElement('div'); entry.className = 'entry'; entry.innerHTML = `<span class="time">${time}</span>${escapeHtml(message)}`; feed.prepend(entry); }
function logDelta(prefix, before, after) { const d = (k) => Math.round(after[k] - before[k]); const parts = []; for (const k of ['fullness','happiness','cleanliness','energy','rage']) { const delta = d(k); if (delta !== 0) parts.push(`${k}: ${delta > 0 ? '+' : ''}${delta}`); } log(`${prefix}. ${parts.join(' ')}`); }
function escapeHtml(s) { return s.replace(/[&<>"]+/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// DnD setup
function enableDragAndDrop() {
  if (!el.inventoryGrid) return;
  // assign draggable and dragstart per card after render
  for (const card of el.inventoryGrid.querySelectorAll('.inventory-card')) {
    const itemId = card.getAttribute('data-item-id');
    const countAttr = card.getAttribute('data-count');
    const parsedCount = countAttr != null ? Number(countAttr) : Number((card.querySelector('.count')?.textContent || '0').replace(/\D/g, ''));
    const count = isNaN(parsedCount) ? 0 : parsedCount;
    const canDrag = count > 0;
    card.style.pointerEvents = 'auto';
    if (canDrag) {
      card.setAttribute('draggable', 'true');
      // Remove any disabled nested button interference
      const btn = card.querySelector('.use-btn');
      if (btn) btn.style.pointerEvents = 'none';
      card.__dragBound = false; // force rebind after each render
      if (!card.__dragBound) {
        card.addEventListener('dragstart', (ev) => {
          console.log(`Started dragging ${itemId}`);
          ev.dataTransfer.setData('text/plain', itemId);
          ev.dataTransfer.effectAllowed = 'copy';
          const img = document.createElement('canvas');
          img.width = img.height = 32;
          const ctx = img.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.2;
          ctx.fillRect(0,0,32,32);
          try { ev.dataTransfer.setDragImage(img, 16, 16); } catch (_) {}
        });
        card.__dragBound = true;
      }
    } else {
      card.removeAttribute('draggable');
    }
  }
  
  // Set up drop zones for all pet cards
  const petCards = document.querySelectorAll('.pet-card[data-pet-slot]');
  console.log(`Setting up drop zones for ${petCards.length} pet cards`);
  
  for (const petCard of petCards) {
    if (petCard.__dndBound) continue;
    
    petCard.addEventListener('dragover', (ev) => { 
      ev.preventDefault(); 
      ev.dataTransfer.dropEffect = 'copy'; 
      petCard.classList.add('drag-over');
      console.log(`Dragging over pet slot ${petCard.getAttribute('data-pet-slot')}`);
    }, true);
    
    petCard.addEventListener('dragleave', () => {
      petCard.classList.remove('drag-over');
    }, true);
    
    petCard.addEventListener('drop', (ev) => {
      ev.preventDefault(); 
      petCard.classList.remove('drag-over');
      const itemId = ev.dataTransfer.getData('text/plain');
      const petSlot = parseInt(petCard.getAttribute('data-pet-slot'));
      console.log(`Dropped ${itemId} on pet slot ${petSlot}`);
      
      if (!itemId) return;
      
      const item = getItemById(itemId);
      
      // Handle eggs
      if (item && item.category === 'egg') {
        console.log(`Handling egg drop: ${itemId} to slot ${petSlot}`);
        handleEggDrop(itemId, petSlot);
      } else {
        // Handle regular items - now works on any pet!
        const targetPet = state.pets?.[petSlot];
        if (targetPet && targetPet.type === 'pet') {
          onUseItem(itemId, petSlot);
        } else {
          console.log(`Cannot use item on slot ${petSlot}: not a valid pet`);
        }
      }
    }, true);
    
    petCard.__dndBound = true;
  }
}

function handleEggDrop(eggItemId, petSlot) {
  // Check if slot is empty
  if (state.pets && state.pets[petSlot]) {
    console.log(`Pet slot ${petSlot} is already occupied`);
    return;
  }
  
  // Check if we have the egg in inventory
  const count = state.inventory?.[eggItemId] ?? 0;
  if (count <= 0) {
    console.log(`No ${eggItemId} in inventory`);
    return;
  }
  
  if (USE_STORE && store) {
    // Consume egg and start incubation
    const eggItem = getItemById(eggItemId);
    const now = Date.now();
    const baseMinutes = eggItem.eggData.hatchTimeMinutes;
    const jitterMin = eggItem.eggData.hatchJitterMin ?? 0.7;
    const jitterMax = eggItem.eggData.hatchJitterMax ?? 1.5;
    const jitterFactor = jitterMin + Math.random() * (jitterMax - jitterMin);
    const hatchTime = now + Math.round(baseMinutes * 60 * 1000 * jitterFactor);
    const genetics = (() => {
      const mainPet = state.pets?.[0];
      if (mainPet && mainPet.type === 'pet') {
        const wildParent = {
          petTypeId: eggItem.eggData.petTypeId,
          traitIds: [TRAITS[Math.floor(Math.random() * TRAITS.length)].id],
          name: 'Wild ' + getPetById(eggItem.eggData.petTypeId).label
        };
        return generateEggGenetics(mainPet, wildParent);
      }
      return null;
    })();
    store.dispatch({ type: ActionTypes.MODIFY_INVENTORY, payload: { itemId: eggItemId, delta: -1 } });
    store.dispatch({ type: ActionTypes.START_INCUBATION, payload: { slotId: petSlot, eggItemId, hatchTime, genetics, twitchIntervalBase: eggItem.eggData.twitchIntervalBase, jitterFactor, label: getItemById(eggItemId).label } });
    return;
  }
  
  // Imperative fallback
  // Consume the egg from inventory
  state.inventory[eggItemId] = count - 1;
  
  // Start incubation
  if (startEggIncubation(eggItemId, petSlot)) {
    console.log(`Successfully started incubating ${eggItemId} in slot ${petSlot}`);
    render();
    save();
  }
}

function hatchEgg(petSlot) {
  if (USE_STORE && store) {
    const eggData = state.incubatingEggs[petSlot];
    if (!eggData) return;
    const eggItem = getItemById(eggData.eggItemId);
    let petTypeId, traitIds;
    if (eggData.genetics) {
      petTypeId = eggData.genetics.petTypeId;
      traitIds = eggData.genetics.traitIds;
    } else {
      petTypeId = eggItem.eggData.petTypeId;
      const numTraits = Math.floor(Math.random() * 3) + 1;
      const availableTraits = [...TRAITS];
      traitIds = [];
      for (let i = 0; i < numTraits; i++) {
        const randomIndex = Math.floor(Math.random() * availableTraits.length);
        traitIds.push(availableTraits.splice(randomIndex, 1)[0].id);
      }
    }
    const petConfig = getPetById(petTypeId);
    const s = petConfig.startingStats;
    const pet = {
      petTypeId,
      traitIds,
      name: `${petConfig.label}`,
      hunger: 100 - s.fullness,
      happiness: s.happiness,
      dirtiness: 100 - s.cleanliness,
      energy: s.energy,
      rage: 0,
      lifetimeHappinessGained: 0,
      genetics: eggData.genetics,
    };
    store.dispatch({ type: ActionTypes.HATCH_EGG, payload: { slotId: petSlot, pet } });
    return;
  }
  
  // Imperative fallback (existing)
  const eggData = state.incubatingEggs[petSlot];
  if (!eggData) return;
  
  const eggItem = getItemById(eggData.eggItemId);
  
  // Use genetics if available, otherwise fallback to original system
  let petTypeId, traitIds;
  if (eggData.genetics) {
    petTypeId = eggData.genetics.petTypeId;
    traitIds = eggData.genetics.traitIds;
    console.log(`Hatching egg with inherited genetics - Type: ${petTypeId}, Traits: ${traitIds.join(', ')}`);
  } else {
    // Fallback to original random system
    petTypeId = eggItem.eggData.petTypeId;
    const numTraits = Math.floor(Math.random() * 3) + 1;
    const availableTraits = [...TRAITS];
    traitIds = [];
    for (let i = 0; i < numTraits; i++) {
      const randomIndex = Math.floor(Math.random() * availableTraits.length);
      traitIds.push(availableTraits.splice(randomIndex, 1)[0].id);
    }
    console.log(`Hatching egg with random genetics (fallback) - Type: ${petTypeId}, Traits: ${traitIds.join(', ')}`);
  }
  
  const petConfig = getPetById(petTypeId);
  
  // Create hatched pet using determined genetics
  const s = petConfig.startingStats;
  state.pets[petSlot] = {
    type: 'pet',
    petTypeId,
    traitIds,
    name: `${petConfig.label}`,
    hunger: 100 - s.fullness, // Use hunger scale
    happiness: s.happiness,
    dirtiness: 100 - s.cleanliness, // Use dirtiness scale
    energy: s.energy,
    rage: 0,
    lifetimeHappinessGained: 0,
    // Store genetics lineage for future breeding
    genetics: eggData.genetics,
  };
  
  // Clean up incubation data
  delete state.incubatingEggs[petSlot];
  
  console.log(`Egg hatched into ${petConfig.label} in slot ${petSlot}!`);
  render();
}

// Genetics system for egg breeding
function performPunnettSquare(parent1Traits, parent2Traits) {
  // Each parent contributes up to 3 traits
  // For simplicity, we'll treat each trait as having a 50% chance of being passed down
  // This creates a simplified Punnett square where each trait has independent inheritance
  
  const inheritedTraits = new Set();
  const allParentTraits = [...new Set([...parent1Traits, ...parent2Traits])];
  
  // Each trait from either parent has a 50% chance of being inherited
  for (const traitId of allParentTraits) {
    const parent1Has = parent1Traits.includes(traitId);
    const parent2Has = parent2Traits.includes(traitId);
    
    let inheritanceChance = 0;
    if (parent1Has && parent2Has) {
      // Both parents have it: 75% chance (dominant trait)
      inheritanceChance = 0.75;
    } else if (parent1Has || parent2Has) {
      // One parent has it: 50% chance
      inheritanceChance = 0.5;
    }
    
    if (Math.random() < inheritanceChance) {
      inheritedTraits.add(traitId);
    }
  }
  
  // Ensure at least 1 trait, max 3 traits
  const resultTraits = Array.from(inheritedTraits);
  if (resultTraits.length === 0) {
    // If no traits inherited, give one random trait from parents
    const randomParentTrait = allParentTraits[Math.floor(Math.random() * allParentTraits.length)];
    if (randomParentTrait) resultTraits.push(randomParentTrait);
  }
  
  return resultTraits.slice(0, 3); // Max 3 traits
}

function determinePetType(parent1Type, parent2Type) {
  // For now, randomly choose one parent's type
  // Could be enhanced with more complex genetics later
  return Math.random() < 0.5 ? parent1Type : parent2Type;
}

function generateEggGenetics(parent1, parent2) {
  // Determine offspring type and traits using genetics
  const offspringType = determinePetType(parent1.petTypeId, parent2.petTypeId);
  const offspringTraits = performPunnettSquare(parent1.traitIds || [], parent2.traitIds || []);
  
  return {
    petTypeId: offspringType,
    traitIds: offspringTraits,
    parent1: {
      petTypeId: parent1.petTypeId,
      traitIds: parent1.traitIds || [],
      name: parent1.name
    },
    parent2: {
      petTypeId: parent2.petTypeId, 
      traitIds: parent2.traitIds || [],
      name: parent2.name
    }
  };
}

function ensureMainPetExists() {
  if (!state.pets) state.pets = {};
  if (!state.pets[0] || state.pets[0].type !== 'pet') {
    const cfg = activePetConfig(state);
    const s = cfg.startingStats;
    state.pets[0] = {
      type: 'pet',
      petTypeId: state.petTypeId || PETS[0].id,
      traitIds: state.traitIds || [TRAITS[0].id],
      name: state.name || 'Demon',
      hunger: state.hunger ?? (100 - s.fullness),
      happiness: state.happiness ?? s.happiness,
      dirtiness: state.dirtiness ?? (100 - s.cleanliness),
      energy: state.energy ?? s.energy,
      rage: state.rage ?? 0,
      lifetimeHappinessGained: state.lifetimeHappinessGained || 0,
    };
  }
}

// Override maybeGrantStarterPack to always grant when empty regardless of flag
function maybeGrantStarterPack() {
  try {
    const counts = Object.values(state.inventory || {});
    const total = counts.reduce((a, b) => a + (Number(b) || 0), 0);
    console.log('[DH] starter-check total items=', total);
    if (total === 0) {
      for (const it of ITEMS) state.inventory[it.id] = it.defaultCount || 1;
      console.log('[DH] starter-granted', state.inventory);
      state.starterGranted = true; save();
    }
    // backfill any missing items added later
    for (const it of ITEMS) if (state.inventory[it.id] == null) state.inventory[it.id] = it.defaultCount || 0;
  } catch (e) { console.warn('[DH] starter error', e); }
}

function initDebug() {
  const toggle = document.getElementById('debugToggle');
  const panel = document.getElementById('debugPanel');
  const itemSel = document.getElementById('debugItemSelect');
  const qtyInp = document.getElementById('debugItemQty');
  const addBtn = document.getElementById('debugAddBtn');
  const add5Btn = document.getElementById('debugAdd5Btn');
  const grantAllBtn = document.getElementById('debugGrantAllBtn');
  const debugSaveBtn = document.getElementById('debugSaveBtn');
  const debugResetBtn = document.getElementById('debugResetBtn');
  if (!toggle || !panel) return;
  if (itemSel && !itemSel.children.length) {
    for (const it of ITEMS) { const opt = document.createElement('option'); opt.value = it.id; opt.textContent = `${it.emoji} ${it.label}`; itemSel.appendChild(opt); }
  }
  toggle.onclick = () => panel.classList.toggle('hidden');
  const addQty = (q) => { const id = itemSel?.value || ITEMS[0]?.id; if (!id) return; state.inventory[id] = (state.inventory[id] || 0) + q; save(); render(); };
  addBtn && (addBtn.onclick = () => addQty(Math.max(1, Number(qtyInp?.value || 1))));
  add5Btn && (add5Btn.onclick = () => addQty(5));
  grantAllBtn && (grantAllBtn.onclick = () => { for (const it of ITEMS) state.inventory[it.id] = (state.inventory[it.id] || 0) + 5; save(); render(); });
  // New: debug panel Save/Reset
  if (debugSaveBtn) debugSaveBtn.onclick = save;
  if (debugResetBtn) debugResetBtn.onclick = resetAll;
}

// define init last
function init() {
  console.log('[DH] build loaded', { version: SAVE_VERSION, useStore: false, storageKey: STORAGE_KEY, cwd: location.href });
  ensureMainPetExists();
  maybeGrantStarterPack();
  // Start ticking first so stats progress even if UI init has hiccups
  try { startTicking(); } catch (e) { console.error('[DH] failed to start ticking', e); }
  try {
    initPetTypes();
    initTraits();
    initToys();
    bindEvents();
    initDebug();
    initRenameModal();
    render();
  } catch (e) {
    console.error('[DH] init error', e);
  }
}

// guard init functions when controls are absent
function initPetTypes() {
  if (!el.petTypeSelect) return;
  el.petTypeSelect.innerHTML = '';
  for (const p of PETS) { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.label; el.petTypeSelect.appendChild(opt); }
  el.petTypeSelect.value = state.petTypeId;
}

function initTraits() {
  if (!el.traitSelect) return;
  el.traitSelect.innerHTML = '';
  for (const t of TRAITS) { const opt = document.createElement('option'); opt.value = t.id; opt.textContent = t.label; opt.title = t.description; el.traitSelect.appendChild(opt); }
  const set = new Set(state.traitIds || []);
  for (const option of el.traitSelect.options) option.selected = set.has(option.value);
}

function initToys() { if (!el.toySelect) return; el.toySelect.innerHTML = ''; for (const t of toys) { const opt = document.createElement('option'); opt.value = t.id; opt.textContent = t.label; el.toySelect.appendChild(opt); } }

function bindEvents() {
  if (el.feedBtn) el.feedBtn.addEventListener('click', onFeed);
  if (el.petBtn) el.petBtn.addEventListener('click', onPet);
  if (el.groomBtn) el.groomBtn.addEventListener('click', onGroom);
  if (el.playBtn) el.playBtn.addEventListener('click', onPlay);
  el.saveBtn.addEventListener('click', save);
  el.resetBtn.addEventListener('click', resetAll);
  if (el.petTypeSelect) el.petTypeSelect.addEventListener('change', onChangePetType);
  if (el.traitSelect) el.traitSelect.addEventListener('change', onChangeTraits);
  
  // Breeding mode toggle
  const breedingToggle = document.getElementById('breedingToggle');
  if (breedingToggle) {
    breedingToggle.addEventListener('click', toggleBreedingMode);
  }
  
  // Pet card click handlers for breeding
  const petCards = document.querySelectorAll('.pet-card[data-pet-slot]');
  for (const card of petCards) {
    card.addEventListener('click', (e) => {
      // Only handle breeding clicks if not clicking on interactive elements
      if (e.target.closest('#petNameDisplay, .info-btn, .pet-side')) return;
      
      const petSlot = parseInt(card.getAttribute('data-pet-slot'));
      selectPetForBreeding(petSlot);
    });
  }
}

function onChangePetType() { const nextId = el.petTypeSelect.value; if (!getPetById(nextId)) return; const keepName = state.pets?.[0]?.name || 'Demon'; const keepTraits = state.traitIds; const keepInv = state.inventory; state = defaultState(nextId, keepTraits); state.pets[0].name = keepName; state.inventory = keepInv; render(); save(); }
function onChangeTraits() { const selected = Array.from(el.traitSelect.selectedOptions).map((o) => o.value); const filtered = selected.filter((id) => getTraitById(id)).slice(0, 3); state.traitIds = filtered; save(); }

const emojiByType = { growler: '🐶', harpie: '🧚‍♀️', default: '😺' };
function getEmoji(s) { return emojiByType[s?.petTypeId] || emojiByType.default; }

function toggleBreedingMode() { /* temporarily disabled */ }
function selectPetForBreeding() { /* temporarily disabled */ }

const HEART_BASE = 300;
function heartsForTotal(total) {
  let hearts = 0;
  let cost = HEART_BASE;
  let remaining = total || 0;
  while (remaining >= cost) {
    remaining -= cost;
    hearts += 1;
    cost *= 2;
  }
  return { hearts, progress: remaining / cost };
}
function addHappinessGain(delta) {
  const p0 = state.pets?.[0];
  if (delta > 0 && p0) p0.lifetimeHappinessGained = (p0.lifetimeHappinessGained || 0) + delta;
}

function setEmojiVisibilityForCard(emojiEl, imageEl) {
  if (!emojiEl) return;
  const showImg = !!imageEl && imageEl.classList.contains('show');
  emojiEl.style.display = showImg ? 'none' : 'block';
}

function updateEggIncubation() {
  const now = Date.now();
  for (const [slotId, eggData] of Object.entries(state.incubatingEggs || {})) {
    if (!eggData) continue;
    const timeRemaining = eggData.hatchTime - now;
    const totalTime = eggData.hatchTime - eggData.startTime;
    const progress = 1 - (timeRemaining / totalTime);
    if (timeRemaining <= 0) {
      hatchEgg(parseInt(slotId));
      continue;
    }
    // Twitch schedule
    const eggItem = getItemById(eggData.eggItemId);
    const baseInterval = eggItem?.eggData?.twitchIntervalBase || 2500;
    const currentInterval = baseInterval * (0.3 + 0.7 * (1 - progress));
    if (!eggData.nextTwitchAt) eggData.nextTwitchAt = now + Math.round(currentInterval);
    if (now >= eggData.nextTwitchAt) {
      playEggTwitch(parseInt(slotId));
      eggData.lastTwitchTime = now;
      eggData.nextTwitchInterval = currentInterval;
      const jitter = 0.6 + Math.random() * 0.8;
      eggData.nextTwitchAt = now + Math.round(currentInterval * jitter);
    }
  }
}

function initRenameModal() {
  const modal = document.getElementById('renameModal');
  const input = document.getElementById('renameInput');
  const saveBtn = document.getElementById('renameSave');
  const cancelBtn = document.getElementById('renameCancel');
  if (!modal || !input) return;

  let targetSlot = 0;
  const openFor = (slot) => {
    targetSlot = Number(slot) || 0;
    const pet = state.pets?.[targetSlot];
    input.value = (pet?.name || 'Demon').trim();
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 0);
  };
  const close = () => modal.classList.add('hidden');
  const doSave = () => {
    const name = (input.value || '').trim().slice(0, 20) || 'Demon';
    if (!state.pets) state.pets = {};
    if (!state.pets[targetSlot]) return close();
    state.pets[targetSlot].name = name;
    save();
    render();
    close();
  };

  // Click: main name and baby names
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#petNameDisplay, .pet-name-display');
    if (!btn) return;
    const card = btn.closest('[data-pet-slot]');
    const slot = card ? card.getAttribute('data-pet-slot') : 0;
    openFor(slot);
  });

  cancelBtn?.addEventListener('click', close);
  saveBtn?.addEventListener('click', doSave);
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter') doSave(); });
}

function startEggIncubation(eggItemId, petSlot) {
  const eggItem = getItemById(eggItemId);
  if (!eggItem || !eggItem.eggData) return false;
  const now = Date.now();
  const baseMinutes = eggItem.eggData.hatchTimeMinutes;
  const jitterMin = eggItem.eggData.hatchJitterMin ?? 0.7;
  const jitterMax = eggItem.eggData.hatchJitterMax ?? 1.5;
  const jitterFactor = jitterMin + Math.random() * (jitterMax - jitterMin);
  const hatchTime = now + Math.round(baseMinutes * 60 * 1000 * jitterFactor);
  state.incubatingEggs[petSlot] = {
    eggItemId,
    startTime: now,
    hatchTime,
    lastTwitchTime: now,
    nextTwitchInterval: eggItem.eggData.twitchIntervalBase,
    nextTwitchAt: now + Math.round(eggItem.eggData.twitchIntervalBase * (0.6 + Math.random() * 0.8)),
    jitterFactor,
  };
  state.pets[petSlot] = { type: 'incubating', eggItemId, name: eggItem.label };
  console.log(`Started incubating ${eggItem.label} in slot ${petSlot}`);
  return true;
}

function playEggTwitch(petSlot) {
  const eggElement = document.querySelector(`[data-pet-slot="${petSlot}"] .pet-emoji`);
  if (!eggElement) return;
  eggElement.classList.add('egg-twitch');
  setTimeout(() => eggElement.classList.remove('egg-twitch'), 300);
}

function autoshrinkNameButton(nameBtn) {
  if (!nameBtn) return;
  const container = nameBtn.closest('.name-hearts');
  if (!container) return;
  const maxFont = 42; // lowered max font size
  const minFont = 16;
  let font = maxFont;
  nameBtn.style.fontSize = font + 'px';
  nameBtn.style.lineHeight = '1';
  nameBtn.style.whiteSpace = 'nowrap';
  const maxWidth = container.offsetWidth;
  if (maxWidth > 0) {
    while (nameBtn.scrollWidth > maxWidth && font > minFont) {
      font -= 1;
      nameBtn.style.fontSize = font + 'px';
    }
  }
}

function centerNameHeartsForCard(petCard) {
  if (!petCard) return;
  const group = petCard.querySelector('.name-hearts');
  const img = petCard.querySelector('.pet-image');
  if (!group || !img || !img.classList.contains('show')) return;
  const cr = petCard.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const leftEdge = (ir.left - cr.left);
  const spriteWidth = ir.width;
  const shrink = 0; // no container shrink; use smaller name font instead
  group.style.left = `${Math.max(0, leftEdge + shrink / 2)}px`;
  group.style.width = `${Math.max(0, spriteWidth - shrink)}px`;
  group.style.transform = 'none';
}

// Recenter on window resize
window.addEventListener('resize', () => {
  for (const petCard of document.querySelectorAll('.pet-card[data-pet-slot]')) {
    centerNameHeartsForCard(petCard);
  }
});

function flashDurabilityLoss(itemId, lossFraction = 0.05) {
  try {
    const card = document.querySelector(`.inventory-card[data-item-id="${itemId}"]`);
    if (!card) return;
    const bar = card.querySelector('.bar.mini');
    const fill = card.querySelector('.bar.mini .fill');
    if (!bar || !fill) return;
    const currentWidth = parseFloat(fill.style.width || '0');
    const flash = document.createElement('div');
    flash.className = 'durability-flash';
    const lossWidthPct = Math.max(0.5, lossFraction * 100);
    flash.style.right = `${Math.max(0, 100 - currentWidth)}%`;
    flash.style.width = `${lossWidthPct}%`;
    bar.appendChild(flash);

    // Shake the card
    card.classList.add('shake');
    setTimeout(() => card.classList.remove('shake'), 240);

    // Spawn sparks near the end of the bar
    const barRect = bar.getBoundingClientRect();
    const endX = barRect.left + (currentWidth / 100) * barRect.width;
    const endY = barRect.top + barRect.height / 2;
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('div');
      s.className = 'spark';
      s.style.left = `${endX - card.getBoundingClientRect().left}px`;
      s.style.top = `${endY - card.getBoundingClientRect().top}px`;
      const dx = (Math.random() - 0.5) * 20; // -10..10
      const dy = -10 - Math.random() * 10;   // upward
      s.style.setProperty('--dx', `${dx}px`);
      s.style.setProperty('--dy', `${dy}px`);
      card.appendChild(s);
      setTimeout(() => s.remove(), 380);
    }

    setTimeout(() => flash.remove(), 280);
  } catch (_) {}
}

function getDurabilityPercent(itemId) {
  try {
    const item = getItemById(itemId);
    if (!item?.durability) return 0;
    const itMap = state.itemDurability?.[itemId] || {};
    let currentUses = 0;
    for (const uses of Object.values(itMap)) {
      if (uses < item.durability.maxUses && uses > currentUses) currentUses = uses;
    }
    const remaining = item.durability.maxUses - currentUses;
    return (remaining / item.durability.maxUses) * 100;
  } catch (_) { return 0; }
}

function lerpDurabilityBar(itemId, nextPercent) {
  try {
    const card = document.querySelector(`.inventory-card[data-item-id="${itemId}"]`);
    if (!card) return;
    const fill = card.querySelector('.bar.mini .fill');
    if (!fill) return;
    // Set to next percent; CSS handles transition
    fill.style.width = `${Math.max(0, Math.min(100, nextPercent))}%`;
  } catch (_) {}
}

if (document.readyState === 'loading') {
window.addEventListener('DOMContentLoaded', init); 
} else {
  init();
}