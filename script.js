import { PETS, getPetById } from './config/pets.js';
import { TRAITS, getTraitById } from './config/traits.js';
import { ITEMS, getItemById } from './config/items.js';
import { STATUS_THRESHOLDS, STATUS_LABELS } from './config/status.js';

const STORAGE_KEY = 'petto.save.v8';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

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
  return {
    // Main pet (slot 0)
    petTypeId,
    traitIds,
    name: 'Petto',
    hunger: 100 - s.fullness, // migrate to hunger scale
    happiness: s.happiness,
    dirtiness: 100 - s.cleanliness,
    energy: s.energy,
    rage: 0,
    tick: 0,
    lifetimeHappinessGained: 0,
    
    // Multi-pet system
    pets: {
      0: { // Main pet slot
        petTypeId,
        traitIds,
        name: 'Petto',
        hunger: 100 - s.fullness,
        happiness: s.happiness,
        dirtiness: 100 - s.cleanliness,
        energy: s.energy,
        rage: 0,
        lifetimeHappinessGained: 0,
        type: 'pet'
      }
      // Slots 1-7 will be empty initially
    },
    
    // Incubation tracking
    incubatingEggs: {},
    
    inventory,
    itemDurability,
    starterGranted: false,
  };
};

let lastArtSrc = '';

const HEART_BASE = 300;
function heartsForTotal(total) { let hearts = 0; let cost = HEART_BASE; let remaining = total; while (remaining >= cost) { remaining -= cost; hearts += 1; cost *= 2; } return { hearts, progress: remaining / cost }; }
function addHappinessGain(delta) { if (delta > 0) state.lifetimeHappinessGained += delta; }

const toys = [
  { id: 'ball', label: 'Ball', happinessGain: 12, energyDelta: -10 },
  { id: 'laser', label: 'Laser Pointer', happinessGain: 16, energyDelta: -14 },
  { id: 'yarn', label: 'Yarn', happinessGain: 10, energyDelta: -8 },
  { id: 'feather', label: 'Feather Wand', happinessGain: 14, energyDelta: -12 },
];

const getMood = (s) => {
  if (s.rage >= 80) return 'Furious';
  if (s.hunger > 90 || s.dirtiness > 90) return 'Miserable';
  if (s.energy < 10) return 'Exhausted';
  if (s.happiness > 80 && s.hunger < 40 && s.dirtiness < 40) return 'Thriving';
  if (s.happiness > 60) return 'Content';
  if (s.hunger > 75) return 'Hungry';
  if (s.dirtiness > 75) return 'Dirty';
  if (s.energy < 25) return 'Tired';
  return "Chillin'";
};

const emojiByType = { growler: '🐶', harpie: '🧚‍♀️' };
const getEmoji = (s) => emojiByType[s.petTypeId] || '😺';

let state = load() || defaultState();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    
    const migrated = { ...parsed };
    if (migrated.fullness != null && migrated.hunger == null) { migrated.hunger = 100 - migrated.fullness; delete migrated.fullness; }
    if (migrated.cleanliness != null && migrated.dirtiness == null) { migrated.dirtiness = 100 - migrated.cleanliness; delete migrated.cleanliness; }
    return { ...defaultState(petId, traitIds), ...migrated, petTypeId: petId, traitIds, inventory, itemDurability };
  } catch (e) { return null; }
}

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function resetAll() { state = defaultState(state.petTypeId, state.traitIds); localStorage.removeItem(STORAGE_KEY); render(); }

const $ = (sel) => document.querySelector(sel);

// adjust element refs to optional for type/trait controls
const el = {
  petEmoji: $('#petEmoji'),
  petImage: $('#petImage'),
  petMood: $('#petMood'),
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
  petName: $('#petName') || null,
  saveNameBtn: $('#saveNameBtn') || null,
  petTypeSelect: document.getElementById('petTypeSelect') || null,
  traitSelect: document.getElementById('traitSelect') || null,
  heartsCount: $('#heartsCount'),
  heartsProgress: $('#heartsProgress'),
  inventoryGrid: $('#inventoryGrid'),
};

function activePetConfig() { return getPetById(state.petTypeId); }
function activeTraits() { return (state.traitIds || []).map((id) => getTraitById(id)).filter(Boolean); }

function maybeGrantStarterPack() {
  try {
    const counts = Object.values(state.inventory || {});
    const total = counts.reduce((a, b) => a + (Number(b) || 0), 0);
    if (total === 0 && !state.starterGranted) {
      for (const it of ITEMS) state.inventory[it.id] = it.defaultCount || 1;
      state.starterGranted = true; save();
    }
    // backfill any missing items added later
    for (const it of ITEMS) if (state.inventory[it.id] == null) state.inventory[it.id] = it.defaultCount || 0;
  } catch (_) {}
}

function initDebug() {
  const toggle = document.getElementById('debugToggle');
  const panel = document.getElementById('debugPanel');
  const itemSel = document.getElementById('debugItemSelect');
  const qtyInp = document.getElementById('debugItemQty');
  const addBtn = document.getElementById('debugAddBtn');
  const add5Btn = document.getElementById('debugAdd5Btn');
  const grantAllBtn = document.getElementById('debugGrantAllBtn');
  if (!toggle || !panel) return;
  if (itemSel && !itemSel.children.length) {
    for (const it of ITEMS) { const opt = document.createElement('option'); opt.value = it.id; opt.textContent = `${it.emoji} ${it.label}`; itemSel.appendChild(opt); }
  }
  toggle.onclick = () => panel.classList.toggle('hidden');
  const addQty = (q) => { const id = itemSel?.value || ITEMS[0]?.id; if (!id) return; state.inventory[id] = (state.inventory[id] || 0) + q; save(); render(); };
  addBtn && (addBtn.onclick = () => addQty(Math.max(1, Number(qtyInp?.value || 1))));
  add5Btn && (add5Btn.onclick = () => addQty(5));
  grantAllBtn && (grantAllBtn.onclick = () => { for (const it of ITEMS) state.inventory[it.id] = (state.inventory[it.id] || 0) + 5; save(); render(); });
}

// define init last
function init() { initPetTypes(); initTraits(); initToys(); bindEvents(); maybeGrantStarterPack(); initDebug(); initRenameModal(); render(); startTicking(); }

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
  if (el.saveNameBtn) el.saveNameBtn.addEventListener('click', onRename);
  if (el.petName) el.petName.value = state.name || '';
  if (el.petTypeSelect) el.petTypeSelect.addEventListener('change', onChangePetType);
  if (el.traitSelect) el.traitSelect.addEventListener('change', onChangeTraits);
}

function onChangePetType() { const nextId = el.petTypeSelect.value; if (!getPetById(nextId)) return; const keepName = state.name; const keepTraits = state.traitIds; const keepInv = state.inventory; state = defaultState(nextId, keepTraits); state.name = keepName; state.inventory = keepInv; render(); save(); }
function onChangeTraits() { const selected = Array.from(el.traitSelect.selectedOptions).map((o) => o.value); const filtered = selected.filter((id) => getTraitById(id)).slice(0, 3); state.traitIds = filtered; save(); }
function onRename() { const name = (el.petName.value || '').trim().slice(0, 20); state.name = name || 'Petto'; render(); }

function multFromTraits(key) { return activeTraits().reduce((acc, t) => acc * (t?.modifiers?.[key] ?? 1), 1); }

function adjustRage(delta) { state.rage = clamp((state.rage || 0) + delta); }

// Calculate damage chance for an item based on pet stats, type, and traits
function calculateItemDamageChance(item) {
  if (!item.durability) return 0;
  
  const durability = item.durability;
  let damageChance = durability.baseDamageChance;
  
  console.log(`Calculating damage for ${item.label}: base=${durability.baseDamageChance}`);
  
  // Rage increases damage chance
  if (state.rage > durability.rageThreshold) {
    const excessRage = state.rage - durability.rageThreshold;
    const petConfig = activePetConfig();
    const rageBonus = (petConfig.itemDamage?.rageBonus || 0.2) * (excessRage / 10);
    console.log(`Rage bonus: excess=${excessRage}, rageBonus=${rageBonus}`);
    damageChance += rageBonus;
  }
  
  // Pet type modifier
  const petDamageMultiplier = activePetConfig().itemDamage?.damageMultiplier || 1;
  console.log(`Pet damage multiplier: ${petDamageMultiplier}`);
  damageChance *= petDamageMultiplier;
  
  // Trait modifiers
  const traitDamageMultiplier = multFromTraits('itemDamageMultiplier');
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

function onFeed() { const before = { ...state }; const cfg = activePetConfig(); const fullnessGain = cfg.actions.feedFullnessGain * multFromTraits('feedFullnessGainMultiplier'); const energyGain = cfg.actions.feedEnergyGain; const happinessGain = cfg.actions.feedHappinessGain * multFromTraits('feedHappinessGainMultiplier'); state.hunger = clamp(state.hunger - fullnessGain); state.energy = clamp(state.energy + energyGain); state.happiness = clamp(state.happiness + happinessGain); addHappinessGain(Math.round(happinessGain)); adjustRage(-6); render(); startParticleEffects(); }
function onPet() { const cfg = activePetConfig(); const petHappinessGain = cfg.actions.petHappinessGain * multFromTraits('petHappinessGainMultiplier'); state.happiness = clamp(state.happiness + petHappinessGain); addHappinessGain(Math.round(petHappinessGain)); adjustRage(-8); render(); startParticleEffects(); }
function onGroom() { const cfg = activePetConfig(); const cleanGain = cfg.actions.groomCleanlinessGain * multFromTraits('groomCleanlinessGainMultiplier'); const happyBase = cfg.actions.groomHappinessGain; const happyGain = happyBase * multFromTraits('groomHappinessGainMultiplier'); const energyDelta = activeTraits().reduce((sum, t) => sum + (t?.modifiers?.groomEnergyDelta || 0), 0); state.cleanliness = clamp(state.cleanliness + cleanGain); state.happiness = clamp(state.happiness + happyGain); addHappinessGain(Math.round(Math.max(0, happyGain))); if (energyDelta !== 0) state.energy = clamp(state.energy + energyDelta); adjustRage(-5); render(); startParticleEffects(); }
function onPlay() { const cfg = activePetConfig(); const toy = toys.find((t) => t.id === el.toySelect.value) || toys[0]; const energyMultiplier = cfg.actions.playEnergyMultiplier * multFromTraits('playEnergyMultiplier'); const happinessMultiplier = cfg.actions.playHappinessMultiplier * multFromTraits('playHappinessMultiplier'); const energyDelta = toy.energyDelta * energyMultiplier; if (state.energy + energyDelta < 0) return; const happyGain = toy.happinessGain * happinessMultiplier; state.happiness = clamp(state.happiness + happyGain); addHappinessGain(Math.round(happyGain)); state.energy = clamp(state.energy + energyDelta); state.cleanliness = clamp(state.cleanliness - cfg.actions.playCleanlinessCost); adjustRage(-8); render(); startParticleEffects(); }

function startTicking() { setInterval(() => { tick(); render(); }, 2000); setInterval(() => save(), 30000); }

function setEmojiVisibility() { if (!el.petEmoji) return; const showImg = !!el.petImage && el.petImage.classList.contains('show'); el.petEmoji.style.display = showImg ? 'none' : 'block'; }
function setPetArt() { 
  const type = state.petTypeId; 
  const src = `assets/pets/${type}_happy.png`; 
  if (!el.petImage) return; 
  if (src === lastArtSrc) { setEmojiVisibility(); applyRageAnimation(); return; } 
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
  
  const rage = state.rage || 0;
  
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

function tick() {
  state.tick += 1; const d = activePetConfig().decay;
  const hungerRise = d.fullnessPerTick * multFromTraits('fullnessDecayMultiplier');
  const dirtinessRise = d.cleanlinessPerTick * multFromTraits('cleanlinessDecayMultiplier');
  const baseHappinessDecay = d.happinessBaseDecay * multFromTraits('happinessBaseDecayMultiplier');
  const hungryPenalty = d.happinessHungryPenalty * multFromTraits('happinessHungryPenaltyMultiplier');
  const dirtyPenalty = d.happinessDirtyPenalty * multFromTraits('happinessDirtyPenaltyMultiplier');
  state.hunger = clamp(state.hunger + hungerRise);
  state.dirtiness = clamp(state.dirtiness + dirtinessRise);
  let happinessDecay = baseHappinessDecay; if (state.hunger > 70) happinessDecay += hungryPenalty; if (state.dirtiness > 70) happinessDecay += dirtyPenalty; state.happiness = clamp(state.happiness - happinessDecay);
  // rage dynamics
  let rageDelta = 0; 
  if (state.hunger > 75) rageDelta += 3; 
  if (state.hunger > 90) rageDelta += 2; 
  if (state.dirtiness > 70) rageDelta += 2; 
  if (state.happiness < 30) rageDelta += 3; 
  if (state.energy < 20) rageDelta += 2; 
  
  // tiredness calms rage over time
  if (state.energy <= 25) rageDelta -= 3; 
  if (state.energy <= 15) rageDelta -= 3; 
  if (state.energy <= 10) rageDelta -= 4; 
  
  // bonus calm when needs are satisfied
  if (state.dirtiness <= 25 && state.hunger < 40) rageDelta -= 2; 
  
  adjustRage(rageDelta - 1);
  updateEggIncubation();
  startParticleEffects();
}

function renderHearts() {
  const wrap = document.getElementById('heartsRow');
  if (!wrap) return;
  const { hearts } = heartsForTotal(state.lifetimeHappinessGained || 0);
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
  if (!el.inventoryGrid) return; 
  el.inventoryGrid.innerHTML = ''; 
  for (const it of ITEMS) { 
    const count = state.inventory?.[it.id] ?? 0; 
    const card = document.createElement('div'); 
    card.className = 'inventory-card'; 
    card.setAttribute('data-item-id', it.id); 
    
    // Calculate what to show in the bar
    let barPercent = 0;
    let showBar = false;
    
    if (it.durability && count > 0) {
      // Durable items: show remaining durability
      const durabilityMap = state.itemDurability?.[it.id] || {};
      let currentUses = 0;
      
      // Find instance with highest uses (the "top" item being damaged)
      for (const [instanceId, uses] of Object.entries(durabilityMap)) {
        if (uses < it.durability.maxUses && uses > currentUses) {
          currentUses = uses;
        }
      }
      
      // Bar shows remaining durability (full = not broken)
      const remainingUses = it.durability.maxUses - currentUses;
      barPercent = (remainingUses / it.durability.maxUses) * 100;
      showBar = true;
    }
    // Non-durable items (food, etc.) never show bars
    
    card.innerHTML = `
      <div class="top">
        <span class="emoji">${it.emoji}</span>
        <span class="count">x${count}</span>
      </div>
      <div class="title">${it.label}</div>
      <div class="muted">${it.category}</div>
      ${showBar ? `<div class="bar mini"><div class="fill" style="width:${barPercent}%"></div></div>` : ''}
      <button class="btn use-btn" ${count <= 0 ? 'disabled' : ''}>Use</button>
    `; 
    
    const useBtn = card.querySelector('.use-btn'); 
    useBtn.addEventListener('click', () => onUseItem(it.id)); 
    el.inventoryGrid.appendChild(card); 
  } 
  enableDragAndDrop(); 
}
function onUseItem(itemId) { 
  const item = getItemById(itemId); 
  if (!item) return; 
  const count = state.inventory?.[itemId] ?? 0; 
  if (count <= 0) return; 
  
  // For items without durability, just reduce count
  if (!item.durability) {
    state.inventory[itemId] = count - 1; 
    applyItemEffects(item); 
    render(); 
    save(); 
    return;
  }
  
  // For items with durability, handle wear
  const instanceId = getItemInstance(itemId);
  if (!instanceId) return; // Shouldn't happen
  
  applyItemEffects(item);
  
  // Roll for damage
  const damageChance = calculateItemDamageChance(item);
  const roll = Math.random();
  
  console.log(`Using ${item.label}: rage=${state.rage}, damageChance=${damageChance.toFixed(3)}, roll=${roll.toFixed(3)}`);
  
  if (roll < damageChance) {
    const broke = damageItemInstance(itemId, instanceId);
    if (broke) {
      // TODO: Show message that item broke
      console.log(`${item.label} broke!`);
    } else {
      // TODO: Show message that item was damaged
      console.log(`${item.label} was damaged`);
    }
  } else {
    console.log(`${item.label} survived this use`);
  }
  
  render(); 
  save(); 
  startParticleEffects(); // Update particles immediately after stat changes
}

function applyItemEffects(item) { 
  const effects = item.effects || {}; 
  let hunger = effects.hunger || 0; 
  let cleanliness = effects.cleanliness || 0; 
  let energy = effects.energy || 0; 
  let happiness = effects.happiness || 0; 
  let rage = effects.rage || 0;
  
  if (item.useType === 'feed') { 
    hunger *= multFromTraits('feedFullnessGainMultiplier'); 
    happiness *= multFromTraits('feedHappinessGainMultiplier'); 
    adjustRage(-8); 
  } 
  if (item.useType === 'groom') { 
    cleanliness *= multFromTraits('groomCleanlinessGainMultiplier'); 
    happiness *= multFromTraits('groomHappinessGainMultiplier'); 
    energy += activeTraits().reduce((sum, t) => sum + (t?.modifiers?.groomEnergyDelta || 0), 0); 
    // Don't reduce rage for grooming - items now set rage directly
  } 
  if (item.useType === 'play') { 
    happiness *= multFromTraits('playHappinessMultiplier'); 
    energy *= multFromTraits('playEnergyMultiplier'); 
    adjustRage(-5); 
  } 
  
  state.hunger = clamp(state.hunger + hunger); 
  state.cleanliness = clamp(state.cleanliness + cleanliness); 
  state.energy = clamp(state.energy + energy); 
  state.happiness = clamp(state.happiness + happiness); 
  if (rage !== 0) adjustRage(rage);
  addHappinessGain(Math.round(Math.max(0, happiness))); 
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
  const statusData = computeStatusTags(state);
  el.statusTags.innerHTML = '';
  
  for (const status of statusData) {
    const tag = document.createElement('div');
    tag.className = 'status-tag';
    tag.innerHTML = `
      <div class="status-fill" style="width: ${status.fillPercent}%"></div>
      <span class="status-label">${status.label}</span>
    `;
    el.statusTags.appendChild(tag);
  }
}

let particleIntervals = {};

function startParticleEffects() {
  stopParticleEffects(); // Clear existing intervals
  
  const cleanliness = state.cleanliness || 0;
  const rage = state.rage || 0;
  console.log(`Cleanliness: ${cleanliness}, Rage: ${rage}, checking particle effects`);
  
  // Rage particles (when furious)
  if (rage >= 90) {
    console.log('Starting furious rage particles');
    particleIntervals.rage = setInterval(() => createRageParticle(), 150); // Much faster spawn
  }
  
  // Cleanliness particles (can run alongside rage particles)
  if (cleanliness <= 15) {
    // Filthy - fast sweat particles
    console.log('Starting filthy sweat particles');
    particleIntervals.sweat = setInterval(() => createSweatParticle(), 400);
  } else if (cleanliness <= 30) {
    // Dirty - slow sweat particles
    console.log('Starting dirty sweat particles');
    particleIntervals.sweat = setInterval(() => createSweatParticle(), 1200);
  } else if (cleanliness >= 85) {
    // Pristine - sparkle particles
    console.log('Starting pristine sparkles');
    particleIntervals.sparkle = setInterval(() => createSparkleParticle(), 800);
  }
  
  if (!particleIntervals.rage && !particleIntervals.sweat && !particleIntervals.sparkle) {
    console.log('No particles for current stats - Cleanliness:', cleanliness, 'Rage:', rage);
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
  
  const particle = document.createElement('div');
  const isFilthy = (state.cleanliness || 0) <= 15;
  particle.className = isFilthy ? 'sweat-particle animate chaotic' : 'sweat-particle animate';
  
  // Start from center area of sprite, moved up 20px
  particle.style.left = Math.random() * 40 + 30 + '%';
  particle.style.top = Math.random() * 40 + 10 + '%'; // was 30%, now 10%
  
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
  
  const particle = document.createElement('div');
  particle.className = 'sparkle-particle animate';
  
  // Random position around the sprite area, moved up 20px
  particle.style.left = Math.random() * 80 + 10 + '%';
  particle.style.top = Math.random() * 60 + 10 + '%'; // was 10% + 80%, now 10% + 60%
  
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
  
  const particle = document.createElement('div');
  particle.className = 'rage-particle animate';
  
  // Start from center area of sprite, moved up 20px
  particle.style.left = Math.random() * 40 + 30 + '%';
  particle.style.top = Math.random() * 40 + 10 + '%'; // was 30%, now 10%
  
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
    
    if (!petData) {
      // Empty slot
      petCard.classList.remove('incubating');
      petCard.classList.add('empty');
      continue;
    }
    
    if (petData.type === 'incubating') {
      // Incubating egg
      petCard.classList.add('incubating');
      petCard.classList.remove('empty');
      
      const eggItem = getItemById(petData.eggItemId);
      const emojiEl = petCard.querySelector('.pet-emoji');
      if (emojiEl) {
        emojiEl.textContent = eggItem ? eggItem.emoji : '🥚';
      }
      
      const nameEl = petCard.querySelector('.pet-name-display');
      if (nameEl) {
        nameEl.style.display = 'none';
      }
      
      // Hide status tags and hearts for incubating eggs
      const statusEl = petCard.querySelector('.status-tags');
      const heartsEl = petCard.querySelector('.hearts-row');
      if (statusEl) statusEl.style.display = 'none';
      if (heartsEl) heartsEl.style.display = 'none';
      
    } else if (petData.type === 'pet') {
      // Active pet - for now only render main pet (slot 0)
      if (slotId === 0) {
        petCard.classList.remove('incubating', 'empty');
        // Main pet rendering is handled by existing render() function
      }
    }
  }
}

function render() {
  el.petEmoji.textContent = getEmoji(state);
  setPetArt();
  setBar(el.barFullness, el.numFullness, 100 - state.hunger); // show "fullness"
  setBar(el.barCleanliness, el.numCleanliness, 100 - state.dirtiness); // show cleanliness
  setBar(el.barEnergy, el.numEnergy, state.energy);
  if (el.barRage) setBar(el.barRage, el.numRage, state.rage);
  renderStatusTags();
  renderHearts();
  renderInventory();
  renderAllPets();
  startParticleEffects();
  const nameBtn = document.getElementById('petNameDisplay');
  if (nameBtn) nameBtn.textContent = state.name || 'Petto';
  el.tickInfo.textContent = `Tick: ${state.tick}`;
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
    const count = Number((card.querySelector('.count')?.textContent || '0').replace(/\D/g, ''));
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
        }, { passive: true });
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
        // Handle regular items (only on main pet for now)
        if (petSlot === 0) {
          onUseItem(itemId);
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
  
  // Consume the egg from inventory
  state.inventory[eggItemId] = count - 1;
  
  // Start incubation
  if (startEggIncubation(eggItemId, petSlot)) {
    console.log(`Successfully started incubating ${eggItemId} in slot ${petSlot}`);
    render();
    save();
  }
}

// Render trait tags on the card
function renderTraitTags() {
  const wrap = document.getElementById('traitTags');
  if (!wrap) return;
  wrap.innerHTML = '';
  const traits = activeTraits();
  for (const t of traits) {
    const span = document.createElement('span');
    span.className = 'trait-tag';
    span.textContent = t.label;
    wrap.appendChild(span);
  }
}

// Rename modal behavior
function initRenameModal() {
  const openBtn = document.getElementById('petNameDisplay');
  const modal = document.getElementById('renameModal');
  const input = document.getElementById('renameInput');
  const saveBtn = document.getElementById('renameSave');
  const cancelBtn = document.getElementById('renameCancel');
  if (!openBtn || !modal || !input) return;
  const open = () => {
    input.value = state.name || '';
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 0);
  };
  const close = () => modal.classList.add('hidden');
  const doSave = () => {
    const name = (input.value || '').trim().slice(0, 20);
    state.name = name || 'Petto';
    save();
    render();
    close();
  };
  openBtn.addEventListener('click', open);
  cancelBtn?.addEventListener('click', close);
  saveBtn?.addEventListener('click', doSave);
  // keyboard
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') doSave();
  });
}

// Egg incubation system
function startEggIncubation(eggItemId, petSlot) {
  const eggItem = getItemById(eggItemId);
  if (!eggItem || !eggItem.eggData) return false;
  
  const now = Date.now();
  const hatchTime = now + (eggItem.eggData.hatchTimeMinutes * 60 * 1000);
  
  // Create incubating egg data
  state.incubatingEggs[petSlot] = {
    eggItemId,
    startTime: now,
    hatchTime,
    lastTwitchTime: now,
    nextTwitchInterval: eggItem.eggData.twitchIntervalBase
  };
  
  // Mark pet slot as incubating
  state.pets[petSlot] = {
    type: 'incubating',
    eggItemId,
    name: `${eggItem.label}`,
  };
  
  console.log(`Started incubating ${eggItem.label} in slot ${petSlot}`);
  return true;
}

function updateEggIncubation() {
  const now = Date.now();
  
  for (const [slotId, eggData] of Object.entries(state.incubatingEggs)) {
    const timeRemaining = eggData.hatchTime - now;
    const totalTime = eggData.hatchTime - eggData.startTime;
    const progress = 1 - (timeRemaining / totalTime);
    
    // Check if ready to hatch
    if (timeRemaining <= 0) {
      hatchEgg(parseInt(slotId));
      continue;
    }
    
    // Calculate twitch interval (gets faster as hatching approaches)
    const eggItem = getItemById(eggData.eggItemId);
    const baseInterval = eggItem.eggData.twitchIntervalBase;
    const currentInterval = baseInterval * (0.3 + 0.7 * (1 - progress)); // 30% to 100% of base interval
    
    // Check if it's time for a twitch
    if (now - eggData.lastTwitchTime >= currentInterval) {
      playEggTwitch(parseInt(slotId));
      eggData.lastTwitchTime = now;
      eggData.nextTwitchInterval = currentInterval;
    }
  }
}

function playEggTwitch(petSlot) {
  const eggElement = document.querySelector(`[data-pet-slot="${petSlot}"] .pet-emoji`);
  if (!eggElement) return;
  
  // Add twitch animation class
  eggElement.classList.add('egg-twitch');
  setTimeout(() => {
    eggElement.classList.remove('egg-twitch');
  }, 300);
  
  console.log(`Egg in slot ${petSlot} twitched`);
}

function hatchEgg(petSlot) {
  const eggData = state.incubatingEggs[petSlot];
  if (!eggData) return;
  
  const eggItem = getItemById(eggData.eggItemId);
  const petTypeId = eggItem.eggData.petTypeId;
  const petConfig = getPetById(petTypeId);
  
  // Generate random traits (1-3 traits)
  const numTraits = Math.floor(Math.random() * 3) + 1;
  const availableTraits = [...TRAITS];
  const traitIds = [];
  for (let i = 0; i < numTraits; i++) {
    const randomIndex = Math.floor(Math.random() * availableTraits.length);
    traitIds.push(availableTraits.splice(randomIndex, 1)[0].id);
  }
  
  // Create hatched pet
  const s = petConfig.startingStats;
  state.pets[petSlot] = {
    type: 'pet',
    petTypeId,
    traitIds,
    name: `Baby ${petConfig.label}`,
    fullness: s.fullness,
    happiness: s.happiness,
    cleanliness: s.cleanliness,
    energy: s.energy,
    rage: 0,
    lifetimeHappinessGained: 0,
  };
  
  // Clean up incubation data
  delete state.incubatingEggs[petSlot];
  
  console.log(`Egg hatched into ${petConfig.label} in slot ${petSlot}!`);
  render();
}

window.addEventListener('DOMContentLoaded', init); 