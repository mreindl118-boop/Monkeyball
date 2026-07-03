// localStorage persistence: unlocks, upgrades, banana bank, best scores.
const KEY = 'rollin-rascals-save-v1';

const DEFAULTS = {
  bananaBank: 0,
  totalScore: 0,
  unlockedLevels: 1,          // number of levels unlocked (sequential)
  unlockedChars: ['marco', 'zippy'],
  selectedChar: 'marco',
  upgrades: { accel: 0, traction: 0, jump: 0, time: 0 }, // levels 0..5
  bestTimes: {},              // levelId -> seconds remaining (higher = better)
  bestScores: {},             // levelId -> score
  stars: {},                  // levelId -> 0..3
  settings: { music: true, sfx: true, tilt: false, camAssist: true }
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...structuredClone(DEFAULTS), ...parsed, upgrades: { ...DEFAULTS.upgrades, ...(parsed.upgrades || {}) }, settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) } };
    }
  } catch (e) { /* corrupted save -> reset */ }
  return structuredClone(DEFAULTS);
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
}

export function getSave() { return state; }

export function resetSave() {
  state = structuredClone(DEFAULTS);
  save();
  return state;
}

export function addBananas(n) { state.bananaBank += n; save(); }

export function spendBananas(n) {
  if (state.bananaBank < n) return false;
  state.bananaBank -= n;
  save();
  return true;
}

export function unlockChar(id) {
  if (!state.unlockedChars.includes(id)) { state.unlockedChars.push(id); save(); }
}

export function recordResult(levelId, { score, timeLeft, stars }) {
  if ((state.bestScores[levelId] || 0) < score) state.bestScores[levelId] = score;
  if ((state.bestTimes[levelId] || 0) < timeLeft) state.bestTimes[levelId] = timeLeft;
  if ((state.stars[levelId] || 0) < stars) state.stars[levelId] = stars;
  state.totalScore += score;
  save();
}

export function unlockNextLevel(justClearedIndex, totalLevels) {
  if (justClearedIndex + 1 >= state.unlockedLevels && state.unlockedLevels < totalLevels) {
    state.unlockedLevels = justClearedIndex + 2;
    save();
  }
}
