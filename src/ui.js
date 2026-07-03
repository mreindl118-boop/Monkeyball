// DOM-based menus & HUD. main.js wires the callbacks.
import { CHARACTERS } from './characters.js';
import { AIR_SKILLS } from './flight.js';
import { LEVELS, WORLDS } from './levels.js';
import { getSave, save, spendBananas, unlockChar, resetSave } from './save.js';
import { sfx, refreshMusic } from './audio.js';
import { BUILD } from './updater.js';

const screens = document.getElementById('screens');
const hud = document.getElementById('hud');

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export const UI = {
  callbacks: {},
  on(name, cb) { this.callbacks[name] = cb; },
  emit(name, ...args) { this.callbacks[name] && this.callbacks[name](...args); },

  clear() {
    screens.innerHTML = '';
    if (this._startKey) { window.removeEventListener('keydown', this._startKey); this._startKey = null; }
  },

  hudVisible(v) {
    hud.classList.toggle('hidden', !v);
    document.body.classList.toggle('playing', v);   // touch buttons only in-game
  },

  updateHUD({ time, bananas, lives, score, speed, abilityReady, abilityName, timerFrozen }) {
    const timer = $('hud-timer');
    timer.textContent = time.toFixed(2);
    timer.classList.toggle('danger', time < 10 && !timerFrozen);
    if (timerFrozen) timer.style.color = '#7ec8ff'; else timer.style.color = '';
    $('hud-bananas').textContent = bananas;
    $('hud-lives').textContent = lives;
    $('hud-score').textContent = score;
    $('hud-speed').textContent = Math.round(speed * 3.6) + ' km/h';
    const ab = $('hud-ability');
    ab.textContent = abilityReady ? `⚡ ${abilityName} READY` : `⏳ ${abilityName}`;
    ab.style.opacity = abilityReady ? 1 : 0.45;
  },

  setExtra(text) {
    const e = $('hud-extra-text');
    if (e && e.textContent !== text) e.textContent = text || '';
  },

  flashMessage(text, ms = 1200) {
    const m = $('hud-msg');
    m.textContent = text;
    m.style.opacity = 1;
    clearTimeout(this._msgT);
    if (ms > 0) this._msgT = setTimeout(() => { m.style.opacity = 0; m.textContent = ''; }, ms);
  },

  // ---------------- INTRO / TITLE ----------------
  showTitle() {
    this.clear();
    this.hudVisible(false);
    this.emit('previewChar', null);
    const s = el('div', 'screen menu-bg');
    // banana rain (clipped layer — doesn't affect scroll size)
    const rain = el('div', 'rain-wrap');
    for (let i = 0; i < 8; i++) {
      const b = el('div', 'banana-rain', '🍌');
      b.style.left = (4 + i * 12.5) + '%';
      b.style.animationDuration = (5 + (i % 4) * 1.7) + 's';
      b.style.animationDelay = (i * 0.8) + 's';
      rain.appendChild(b);
    }
    s.appendChild(rain);
    // letter-by-letter bouncing logo
    const logo = el('div', 'intro-logo');
    [..."ROLLIN' RASCALS"].forEach((ch, i) => {
      const sp = el('span', ch === ' ' ? 'space' : '', ch === ' ' ? '&nbsp;' : ch);
      sp.style.animationDelay = (0.06 * i) + 's';
      logo.appendChild(sp);
    });
    s.appendChild(logo);
    s.appendChild(el('div', 'subtitle', 'A totally-not-suspicious ball-rolling adventure 🍌'));
    const ps = el('div', '', ('ontouchstart' in window) ? 'TAP TO START' : 'PRESS START');
    ps.id = 'press-start';
    s.appendChild(ps);
    const sv = getSave();
    s.appendChild(el('div', 'footnote', `Bank 🍌 ${sv.bananaBank} · Total Score ⭐ ${sv.totalScore} · Build ${BUILD || 'dev'}`));
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      sfx.goal();   // fanfare!
      // defer a tick so this tap's click can't fall through onto the next screen
      setTimeout(() => this.emit('start'), 30);
    };
    s.addEventListener('click', go);
    this._startKey = (e) => { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyS') go(); };
    window.addEventListener('keydown', this._startKey);
    screens.appendChild(s);
  },

  actionBar(...buttons) {
    const bar = el('div', 'action-bar');
    for (const b of buttons) bar.appendChild(b);
    screens.appendChild(bar);
  },

  // ---------------- MODE SELECT ----------------
  showModeSelect() {
    this.clear();
    const sv = getSave();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', 'GAME MODES'));
    const row = el('div');
    row.id = 'mode-row';
    const modes = [
      {
        id: 'adventure', emoji: '🌴', name: 'Adventure',
        desc: '15 stages across 3 worlds. Beat the clock, grab bananas, reach the goal gate.',
        best: `Total score: ⭐ ${sv.totalScore}`
      },
      {
        id: 'target', emoji: '🎯', name: 'Sky Target',
        desc: 'Launch off a mega-ramp, split your ball into wings, and glide onto floating dartboards. 3 flights, ride the wind!',
        best: `Best: ⭐ ${sv.targetBest || 0}`
      },
      {
        id: 'rush', emoji: '🍌', name: 'Banana Rush',
        desc: '60 seconds, endless bananas. Golden bunches, combos, power-ups — solo or 2-player duels (local & online)!',
        best: `Best haul: 🍌 ${sv.rushBest || 0} · ⚔️ multiplayer`
      }
    ];
    modes.forEach((m, i) => {
      const card = el('div', 'mode-card pop');
      card.style.animationDelay = (i * 0.07) + 's';
      card.appendChild(el('div', 'emoji', m.emoji));
      card.appendChild(el('h3', '', m.name));
      card.appendChild(el('p', '', m.desc));
      card.appendChild(el('div', 'best', m.best));
      card.onclick = () => { sfx.select(); this.emit('modeChosen', m.id); };
      row.appendChild(card);
    });
    this.emit('previewChar', null);
    s.appendChild(row);
    const extras = el('div');
    extras.style.marginTop = '18px';
    const shop = el('button', 'btn secondary', '🍌 SHOP');
    shop.onclick = () => { sfx.menu(); this.emit('shop'); };
    const settings = el('button', 'btn secondary', '⚙ SETTINGS');
    settings.onclick = () => { sfx.menu(); this.showSettings(); };
    extras.appendChild(shop); extras.appendChild(settings);
    s.appendChild(extras);
    s.appendChild(el('div', 'subtitle', `Bank: <span class="banana-count">🍌 ${sv.bananaBank}</span>`));
    screens.appendChild(s);
    const back = el('button', 'btn secondary', '◀ TITLE');
    back.onclick = () => { sfx.menu(); this.showTitle(); };
    this.actionBar(back);
  },

  // ---------------- CHARACTER SELECT ----------------
  showCharSelect(mode = 'adventure') {
    this.clear();
    const sv = getSave();
    const s = el('div', 'screen menu-bg');
    const heading = mode === 'duel-p1' ? '🔴 PLAYER 1 — PICK!'
      : mode === 'duel-p2' ? '🔵 PLAYER 2 — PICK!'
      : 'PICK YOUR RASCAL';
    s.appendChild(el('h1', 'title', heading));
    const row = el('div', '', '');
    row.id = 'char-row';
    const detail = el('div', '', '');
    detail.id = 'char-detail';

    const renderDetail = (c) => {
      if (mode === 'target') {
        const air = AIR_SKILLS[c.ability.id];
        detail.innerHTML = `<b>${c.name}</b> — ${c.bio}<br><b>✈ ${air.name}:</b> ${air.desc}`;
      } else {
        detail.innerHTML = `<b>${c.name}</b> — ${c.bio}<br><b>${c.ability.name}:</b> ${c.ability.desc}`;
      }
    };

    CHARACTERS.forEach((c, ci) => {
      const locked = !sv.unlockedChars.includes(c.id);
      const card = el('div', 'char-card pop' + (sv.selectedChar === c.id ? ' selected' : '') + (locked ? ' locked' : ''));
      card.style.animationDelay = (ci * 0.05) + 's';
      const sw = el('div', 'char-swatch');
      sw.style.background = '#' + c.ballColor.toString(16).padStart(6, '0');
      card.appendChild(sw);
      card.appendChild(el('h3', '', locked ? '???' : c.name));
      card.appendChild(el('div', 'tagline', locked ? `Unlock in shop: 🍌${c.unlockCost}` : c.tagline));
      for (const [k, label] of [['speed', 'SPD'], ['traction', 'GRIP'], ['weight', 'WGT'], ['jump', 'JMP']]) {
        card.appendChild(el('div', 'stat-label', label));
        const bar = el('div', 'statbar');
        const fill = el('div');
        fill.style.width = (c.stats[k] * 10) + '%';
        bar.appendChild(fill);
        card.appendChild(bar);
      }
      card.onclick = () => {
        if (locked) { sfx.denied(); this.flashDetailMsg(detail, `Unlock ${c.name} in the Banana Shop for 🍌${c.unlockCost}!`); return; }
        sfx.menu();
        sv.selectedChar = c.id; save();
        row.querySelectorAll('.char-card').forEach(x => x.classList.remove('selected'));
        card.classList.add('selected');
        renderDetail(c);
        this.emit('previewChar', c.id);   // spotlight them on the podium
      };
      row.appendChild(card);
    });
    s.appendChild(row);
    s.appendChild(detail);
    renderDetail(CHARACTERS.find(c => c.id === sv.selectedChar) || CHARACTERS[0]);
    this.emit('previewChar', sv.selectedChar);

    const goLabel = {
      adventure: 'CHOOSE LEVEL ▶', target: 'TAKE FLIGHT ▶', rush: 'START RUSH ▶',
      'duel-p1': 'NEXT: PLAYER 2 ▶', 'duel-p2': 'FIGHT! ▶',
      'duel-host': 'CREATE ROOM ▶', 'duel-join': 'JOIN BATTLE ▶'
    }[mode] || 'GO ▶';
    screens.appendChild(s);
    const go = el('button', 'btn', goLabel);
    go.onclick = () => { sfx.select(); this.emit('charChosen', mode); };
    const back = el('button', 'btn secondary', '◀ BACK');
    back.onclick = () => {
      sfx.menu();
      if (mode === 'duel-p2') this.showCharSelect('duel-p1');
      else if (mode.startsWith('duel')) this.showPlayers('rush');
      else this.showPlayers(mode);
    };
    this.actionBar(back, go);
  },

  flashDetailMsg(node, msg) {
    node.innerHTML = `<b>${msg}</b>`;
  },

  // ---------------- LEVEL SELECT ----------------
  showLevelSelect() {
    this.clear();
    const sv = getSave();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', 'STAGE SELECT'));
    const grid = el('div');
    grid.id = 'level-grid';
    LEVELS.forEach((lv, i) => {
      const locked = i >= sv.unlockedLevels;
      const tile = el('button', 'level-tile' + (locked ? ' locked' : ''));
      const world = WORLDS[lv.world];
      tile.appendChild(el('div', 'world', world.name));
      tile.appendChild(el('div', 'num', locked ? '🔒' : String(i + 1)));
      const stars = sv.stars[i] || 0;
      tile.appendChild(el('div', 'stars', locked ? '' : '★'.repeat(stars) + '☆'.repeat(3 - stars)));
      if (!locked) tile.onclick = () => { sfx.select(); this.emit('startLevel', i); };
      else tile.onclick = () => sfx.denied();
      grid.appendChild(tile);
    });
    s.appendChild(grid);
    this.emit('previewChar', null);
    screens.appendChild(s);
    const back = el('button', 'btn secondary', '◀ CHARACTERS');
    back.onclick = () => { sfx.menu(); this.showCharSelect('adventure'); };
    this.actionBar(back);
  },

  // ---------------- PLAYERS ----------------
  showPlayers(mode) {
    this.clear();
    this.emit('previewChar', null);
    const sv = getSave();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', 'PLAYERS'));
    const col = el('div', 'scroll-col');

    const mkRow = (title, desc, btnLabel, cb, secondary = false) => {
      const item = el('div', 'shop-item pop');
      item.appendChild(el('div', 'info', `<h3>${title}</h3><p>${desc}</p>`));
      const btn = el('button', 'btn' + (secondary ? ' secondary' : ''), btnLabel);
      btn.style.padding = '8px 20px';
      btn.style.fontSize = '15px';
      btn.onclick = cb;
      item.appendChild(btn);
      col.appendChild(item);
      return item;
    };

    mkRow('👤 1 Player', 'Solo — chase the high score.', 'GO ▶', () => { sfx.select(); this.emit('players1', mode); });

    if (mode === 'rush') {
      const isTouch = document.body.classList.contains('touch');
      mkRow('👥 2 Players — Same Device', 'One arena, real bumping! P1: WASD+Space/Shift · P2: Arrows+Enter/RShift, or two gamepads.' + (isTouch ? ' <b>Needs a keyboard or 2 gamepads.</b>' : ''),
        'GO ▶', () => { sfx.select(); this.emit('duelLocal'); });
      mkRow('🌐 2 Players — Host Online', 'Create a room and share the 4-letter code with a friend.',
        'HOST', () => { sfx.select(); this.emit('duelHost'); }, true);
      // join row with inline code input
      const joinItem = el('div', 'shop-item pop');
      joinItem.appendChild(el('div', 'info', `<h3>🔑 2 Players — Join Online</h3><p>Enter your friend's room code.</p>`));
      const codeInput = el('input');
      codeInput.maxLength = 4;
      codeInput.placeholder = 'CODE';
      codeInput.style.cssText = 'width:84px;text-align:center;font-size:19px;font-weight:900;text-transform:uppercase;border-radius:10px;border:2px solid #7ec8ff;background:rgba(255,255,255,.1);color:#fff;padding:8px;pointer-events:auto;';
      const joinBtn = el('button', 'btn secondary', 'JOIN');
      joinBtn.style.padding = '8px 18px';
      joinBtn.style.fontSize = '15px';
      joinBtn.onclick = () => {
        const code = codeInput.value.trim().toUpperCase();
        if (code.length !== 4) { sfx.denied(); codeInput.focus(); return; }
        sfx.select();
        this.emit('duelJoin', code);
      };
      joinItem.appendChild(codeInput);
      joinItem.appendChild(joinBtn);
      col.appendChild(joinItem);
      // relay server (advanced)
      const relayItem = el('div', 'shop-item pop');
      relayItem.appendChild(el('div', 'info', `<h3>📡 Relay Server</h3><p>Empty = this page's own server (works with <b>npm run host</b>), or paste a ws:// URL.</p>`));
      const relayInput = el('input');
      relayInput.placeholder = 'same origin /ws';
      relayInput.value = sv.settings.relayUrl || '';
      relayInput.style.cssText = 'width:180px;font-size:12px;border-radius:10px;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;padding:8px;pointer-events:auto;';
      relayInput.onchange = () => { sv.settings.relayUrl = relayInput.value.trim(); save(); };
      relayItem.appendChild(relayInput);
      col.appendChild(relayItem);
    } else {
      col.appendChild(el('div', 'subtitle', '⚔️ 2-player duels live in <b>Banana Rush</b>!'));
    }

    s.appendChild(col);
    screens.appendChild(s);
    const back = el('button', 'btn secondary', '◀ BACK');
    back.onclick = () => { sfx.menu(); this.showModeSelect(); };
    this.actionBar(back);
  },

  // legacy alias (used after online duels end)
  showDuelMenu() { this.showPlayers('rush'); },

  _oldDuelMenu() {
    this.clear();
    this.emit('previewChar', null);
    const sv = getSave();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', '⚔️ DUEL'));
    const col = el('div', 'scroll-col');

    const mkRow = (title, desc, btnLabel, cb) => {
      const item = el('div', 'shop-item');
      item.appendChild(el('div', 'info', `<h3>${title}</h3><p>${desc}</p>`));
      const btn = el('button', 'btn', btnLabel);
      btn.style.padding = '8px 20px';
      btn.style.fontSize = '15px';
      btn.onclick = cb;
      item.appendChild(btn);
      col.appendChild(item);
      return item;
    };

    mkRow('🎮 Local Duel', 'Two players, one device, one arena. P1: WASD + Space/Shift · P2: Arrows + Enter/RShift (gamepads work too).',
      'PLAY', () => { sfx.select(); this.emit('duelLocal'); });
    if (document.body.classList.contains('touch')) {
      col.lastChild.querySelector('p').innerHTML += ' <b>On touch devices, plug in a keyboard or two gamepads.</b>';
    }

    mkRow('🌐 Host Online', 'Create a room and share the 4-letter code with a friend.',
      'HOST', () => { sfx.select(); this.emit('duelHost'); });

    // join row with inline code input
    const joinItem = el('div', 'shop-item');
    joinItem.appendChild(el('div', 'info', `<h3>🔑 Join Online</h3><p>Enter your friend's room code.</p>`));
    const codeInput = el('input');
    codeInput.maxLength = 4;
    codeInput.placeholder = 'CODE';
    codeInput.style.cssText = 'width:90px;text-align:center;font-size:20px;font-weight:900;text-transform:uppercase;border-radius:10px;border:2px solid #7ec8ff;background:rgba(255,255,255,.1);color:#fff;padding:8px;pointer-events:auto;';
    const joinBtn = el('button', 'btn secondary', 'JOIN');
    joinBtn.style.padding = '8px 20px';
    joinBtn.style.fontSize = '15px';
    joinBtn.onclick = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length !== 4) { sfx.denied(); codeInput.focus(); return; }
      sfx.select();
      this.emit('duelJoin', code);
    };
    joinItem.appendChild(codeInput);
    joinItem.appendChild(joinBtn);
    col.appendChild(joinItem);

    // relay server (advanced)
    const relayItem = el('div', 'shop-item');
    relayItem.appendChild(el('div', 'info', `<h3>📡 Relay Server</h3><p>Leave empty to use this page's own server (works with <b>npm run host</b>). Or paste a ws:// URL.</p>`));
    const relayInput = el('input');
    relayInput.placeholder = 'same origin /ws';
    relayInput.value = sv.settings.relayUrl || '';
    relayInput.style.cssText = 'width:200px;font-size:13px;border-radius:10px;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;padding:8px;pointer-events:auto;';
    relayInput.onchange = () => { sv.settings.relayUrl = relayInput.value.trim(); save(); };
    relayItem.appendChild(relayInput);
    col.appendChild(relayItem);

    s.appendChild(col);
    const back = el('button', 'btn secondary', '◀ BACK');
    back.onclick = () => { sfx.menu(); this.showModeSelect(); };
    s.appendChild(back);
    screens.appendChild(s);
  },

  showConnecting(text) {
    this.clear();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', '📡'));
    s.appendChild(el('div', 'subtitle', text));
    const cancel = el('button', 'btn secondary', 'CANCEL');
    cancel.onclick = () => { sfx.menu(); this.emit('quit'); };
    s.appendChild(cancel);
    screens.appendChild(s);
  },

  showHostWait(code) {
    this.clear();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', code));
    s.appendChild(el('div', 'subtitle', 'Share this room code with your rival.<br>The duel starts the moment they join!'));
    const cancel = el('button', 'btn secondary', 'CANCEL');
    cancel.onclick = () => { sfx.menu(); this.emit('quit'); };
    s.appendChild(cancel);
    screens.appendChild(s);
  },

  showNetError(reason) {
    this.clear();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', '📡❌'));
    s.appendChild(el('div', 'subtitle', reason || 'Connection problem'));
    const back = el('button', 'btn', 'BACK TO DUEL MENU');
    back.onclick = () => { sfx.menu(); this.showDuelMenu(); };
    const menu = el('button', 'btn secondary', 'MAIN MENU');
    menu.onclick = () => { sfx.menu(); this.emit('quit'); };
    s.appendChild(back); s.appendChild(menu);
    screens.appendChild(s);
  },

  // ---------------- SHOP ----------------
  showShop() {
    this.clear();
    this.emit('previewChar', null);
    const sv = getSave();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', 'BANANA SHOP'));
    const bank = el('div', 'subtitle', `Bank: <span class="banana-count">🍌 ${sv.bananaBank}</span>`);
    s.appendChild(bank);
    const col = el('div', 'scroll-col');

    const UPGRADES = [
      { id: 'accel', name: 'Hot Wheels', desc: '+8% acceleration per level', base: 25 },
      { id: 'traction', name: 'Sticky Paws', desc: '+8% grip per level', base: 25 },
      { id: 'jump', name: 'Spring Legs', desc: '+7% jump power per level', base: 30 },
      { id: 'time', name: 'Bonus Clock', desc: '+3 seconds on every stage per level', base: 35 },
    ];
    const refresh = () => { this.showShop(); };

    for (const u of UPGRADES) {
      const lvl = sv.upgrades[u.id];
      const cost = Math.round(u.base * Math.pow(1.7, lvl));
      const item = el('div', 'shop-item');
      const info = el('div', 'info', `<h3>${u.name} <span class="lvl">Lv ${lvl}/5</span></h3><p>${u.desc}</p>`);
      const btn = el('button', 'btn', lvl >= 5 ? 'MAX' : `🍌 ${cost}`);
      btn.disabled = lvl >= 5 || sv.bananaBank < cost;
      btn.style.padding = '8px 20px';
      btn.style.fontSize = '16px';
      btn.onclick = () => {
        if (lvl >= 5) return;
        if (spendBananas(cost)) { sv.upgrades[u.id]++; save(); sfx.buy(); refresh(); }
        else sfx.denied();
      };
      item.appendChild(info); item.appendChild(btn);
      col.appendChild(item);
    }

    for (const c of CHARACTERS.filter(c => c.unlockCost > 0)) {
      const owned = sv.unlockedChars.includes(c.id);
      const item = el('div', 'shop-item');
      const info = el('div', 'info', `<h3>${owned ? c.name : 'Recruit ' + c.name}</h3><p>${c.tagline} — ${c.ability.name}</p>`);
      const btn = el('button', 'btn secondary', owned ? 'OWNED' : `🍌 ${c.unlockCost}`);
      btn.disabled = owned || sv.bananaBank < c.unlockCost;
      btn.style.padding = '8px 20px';
      btn.style.fontSize = '16px';
      btn.onclick = () => {
        if (owned) return;
        if (spendBananas(c.unlockCost)) { unlockChar(c.id); sfx.buy(); refresh(); }
        else sfx.denied();
      };
      item.appendChild(info); item.appendChild(btn);
      col.appendChild(item);
    }

    s.appendChild(col);
    screens.appendChild(s);
    const back = el('button', 'btn secondary', '◀ BACK');
    back.onclick = () => { sfx.menu(); this.showModeSelect(); };
    this.actionBar(back);
  },

  // ---------------- SETTINGS ----------------
  showSettings() {
    this.clear();
    this.emit('previewChar', null);
    const sv = getSave();
    const s = el('div', 'screen menu-bg');
    s.appendChild(el('h1', 'title', 'SETTINGS'));
    const col = el('div', 'scroll-col');
    const mk = (label, key, onToggle) => {
      const item = el('div', 'shop-item');
      item.appendChild(el('div', 'info', `<h3>${label}</h3>`));
      const btn = el('button', 'btn' + (sv.settings[key] ? '' : ' secondary'), sv.settings[key] ? 'ON' : 'OFF');
      btn.style.padding = '8px 26px'; btn.style.fontSize = '16px';
      btn.onclick = () => {
        sv.settings[key] = !sv.settings[key]; save(); sfx.menu();
        if (onToggle) onToggle();
        this.showSettings();
      };
      item.appendChild(btn);
      col.appendChild(item);
    };
    mk('Music', 'music', refreshMusic);
    mk('Sound Effects', 'sfx');
    mk('Tilt Controls (mobile)', 'tilt', () => this.emit('tiltToggled'));
    mk('Camera Assist (auto-follow)', 'camAssist');
    mk('Invert Flight Pitch', 'invertPitch');
    const reset = el('button', 'btn secondary', '⚠ RESET SAVE');
    reset.onclick = () => { if (confirm('Wipe all progress?')) { resetSave(); sfx.denied(); this.showTitle(); } };
    col.appendChild(reset);
    s.appendChild(col);
    screens.appendChild(s);
    const back = el('button', 'btn secondary', '◀ BACK');
    back.onclick = () => { sfx.menu(); this.showModeSelect(); };
    this.actionBar(back);
  },

  // ---------------- UPDATE PROMPT ----------------
  showUpdatePrompt({ latest, current, install }) {
    // non-blocking banner over whatever screen is showing
    const old = document.getElementById('update-banner');
    if (old) old.remove();
    const bar = el('div', 'pop');
    bar.id = 'update-banner';
    bar.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);z-index:60;background:rgba(10,8,30,.92);border:2px solid #ffe14d;border-radius:14px;padding:10px 14px;display:flex;align-items:center;gap:10px;color:#fff;font-size:13px;max-width:94vw;pointer-events:auto;box-shadow:0 8px 24px rgba(0,0,0,.5);';
    bar.appendChild(el('div', '', `🚀 <b style="color:#ffe14d">Update available!</b> Build ${latest} (you have ${current})<br><span style="font-size:11px;color:#9ab">If Android says "App not installed", uninstall the old app once — updates flow normally after that.</span>`));
    const go = el('button', 'btn', 'UPDATE');
    go.style.cssText = 'padding:6px 14px;font-size:13px;margin:0;';
    go.onclick = () => { sfx.select(); install(); };
    const later = el('button', 'btn secondary', '✕');
    later.style.cssText = 'padding:6px 10px;font-size:13px;margin:0;';
    later.onclick = () => { sfx.menu(); bar.remove(); };
    bar.appendChild(go);
    bar.appendChild(later);
    document.body.appendChild(bar);
  },

  // ---------------- PAUSE ----------------
  showPause() {
    this.clear();
    const s = el('div', 'screen');
    s.style.background = 'rgba(5,5,20,.72)';
    s.appendChild(el('h1', 'title', 'PAUSED'));
    const resume = el('button', 'btn', '▶ RESUME');
    resume.onclick = () => { sfx.select(); this.clear(); this.emit('resume'); };
    const retry = el('button', 'btn secondary', '↻ RETRY STAGE');
    retry.onclick = () => { sfx.menu(); this.clear(); this.emit('retry'); };
    const quit = el('button', 'btn secondary', '✕ QUIT TO MENU');
    quit.onclick = () => { sfx.menu(); this.emit('quit'); };
    s.appendChild(resume); s.appendChild(retry); s.appendChild(quit);
    screens.appendChild(s);
  },

  // ---------------- MODE RESULTS (target / rush) ----------------
  showModeResults({ title, subtitle, lines, newBest }) {
    this.clear();
    const s = el('div', 'screen');
    s.style.background = 'rgba(5,5,20,.78)';
    const t = el('div', '', title);
    t.id = 'result-title';
    s.appendChild(t);
    if (newBest) s.appendChild(el('div', 'subtitle', '🏆 NEW RECORD! 🏆'));
    if (subtitle) s.appendChild(el('div', 'subtitle', subtitle));
    for (const [label, val] of lines) {
      s.appendChild(el('div', 'result-line', `<span>${label}</span><b>${val}</b>`));
    }
    const btnRow = el('div');
    btnRow.style.marginTop = '22px';
    const again = el('button', 'btn', '↻ PLAY AGAIN');
    again.onclick = () => { sfx.select(); this.emit('retry'); };
    const quit = el('button', 'btn secondary', 'MENU');
    quit.onclick = () => { sfx.menu(); this.emit('quit'); };
    btnRow.appendChild(again); btnRow.appendChild(quit);
    s.appendChild(btnRow);
    screens.appendChild(s);
  },

  // ---------------- RESULTS ----------------
  showResults({ cleared, levelName, score, bananas, timeLeft, stars, bonus, isLastLevel, gameOver }) {
    this.clear();
    const s = el('div', 'screen');
    s.style.background = 'rgba(5,5,20,.78)';
    const title = el('div', '', gameOver ? 'GAME OVER' : (cleared ? 'GOAL!' : 'FALL OUT!'));
    title.id = 'result-title';
    if (!cleared) title.style.color = '#ff5252';
    s.appendChild(title);
    s.appendChild(el('div', 'subtitle', levelName));
    if (cleared) {
      s.appendChild(el('div', 'result-line', `<span>Stars</span><b>${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</b>`));
      s.appendChild(el('div', 'result-line', `<span>Time Left</span><b>${timeLeft.toFixed(2)}s</b>`));
      s.appendChild(el('div', 'result-line', `<span>Time Bonus</span><b>+${bonus}</b>`));
    }
    s.appendChild(el('div', 'result-line', `<span>Bananas</span><b>🍌 ${bananas}</b>`));
    s.appendChild(el('div', 'result-line', `<span>Stage Score</span><b>⭐ ${score}</b>`));
    const btnRow = el('div');
    btnRow.style.marginTop = '22px';
    if (cleared && !isLastLevel) {
      const next = el('button', 'btn', 'NEXT STAGE ▶');
      next.onclick = () => { sfx.select(); this.emit('next'); };
      btnRow.appendChild(next);
    }
    if (cleared && isLastLevel) {
      s.appendChild(el('div', 'subtitle', '🏆 YOU CONQUERED ALL WORLDS! Absolute legend. 🏆'));
    }
    const retry = el('button', 'btn secondary', '↻ RETRY');
    retry.onclick = () => { sfx.menu(); this.emit('retry'); };
    const quit = el('button', 'btn secondary', 'MENU');
    quit.onclick = () => { sfx.menu(); this.emit('quit'); };
    btnRow.appendChild(retry); btnRow.appendChild(quit);
    s.appendChild(btnRow);
    screens.appendChild(s);
  }
};
