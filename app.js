/* Abacus Studio — app.js
   Vanilla JS single-page app:
   - Interactive drag soroban
   - Formula-first pedagogy (tricks + why lines)
   - Question engine (Levels 1-13), 3 modes: Guided / Recall / Mixed
   - TTS dictation
   - Socket.IO real-time (teacher <-> students)
   - Defensive share link, student-mode hiding
*/

// =============== CONFIG ===============
const RENDER_BACKEND_URL = 'https://abacus-studio-backend.onrender.com'; // change if deployed elsewhere
const PLACE_LABELS = ['1','10','100','1k','10k','100k','1M','10M','100M','1B','10B','100B','1T'];

// =============== STATE ===============
const state = {
  rodCount: 7,
  abacusValue: 0,
  beadsState: [],            // per rod: { upper:false, lower:[false,false,false,false] }
  allQuestions: [],
  currentQIndex: 0,
  runningTotal: 0,
  expectedAnswer: 0,
  score: 0,
  streak: 0,
  correctCount: 0,
  wrongCount: 0,
  sessionStart: null,
  timerInterval: null,
  currentTrickId: null,
  currentHint: '',
  currentMode: 'guided',
  isCustom: false,
  trickPanelVisible: true,
  pinnedTrick: null,
  whyLine: '',
  dictationSpeed: 1,
  dictationLang: 'en-IN',
  assistedCount: 0,
  socket: null,
  roomCode: null,
  role: null,
  isInRoom: false,
  suppressRemoteUpdate: false,
  guidedAccuracy: { correct: 0, total: 0 },
  questionTimings: [], // per-question seconds
  qStartTime: 0,
  dictationQueue: [],
  dictationIdx: 0,
  dictationPaused: false,
  studentLocked: true,        // mirrors server room.state.studentLocked
  pushedQuestion: null,        // teacher-pushed free-text question
  rowsPerQuestion: 5,          // total rows per question (1 start + N-1 operands)
  visibility: 'full',          // 'full' | 'fade50' | 'fade20' | 'hidden' (Anzan)
  soundOn: true,               // Web Audio cues
  rowIntervalMs: 2500,         // pause between dictation rows
  audioCtx: null,              // lazy-init Web Audio context
  pointerHideTimer: null,      // auto-fade timer for teacher-pointer overlay
  demoPlaying: false,          // re-entrancy guard for demo playback
  studentName: '',             // optional, used to tag and look up session logs
  activePane: 'library',       // 'library' | 'progress' | 'advanced'
  activeLibraryCat: 'direct',
  teacherToken: null,          // AUTONOMOUS: [ORDER-1] C4
  currentExerciseTitle: '',    // AUTONOMOUS: [ORDER-2] C9 — header badge
  beadHistory: [],             // AUTONOMOUS: [ORDER-2] undo stack of bead snapshots
  // AUTONOMOUS: [ORDER-2] MIRROR MODE — when on, state.beadsState is MY abacus
  // and state.otherBeads is the remote peer's abacus (read-only on my side).
  // When off (default), state.beadsState is the shared single abacus.
  mirrorMode: false,
  otherBeads: [],
  // WHITEBOARD — paste-image side panel synced across the room
  whiteboardOpen: false,
  whiteboardImages: [], // [{ id, src, w, h, addedAt }]
  // LISTENING PRACTICE — when on, future rows are hidden until their audio
  // plays. dictationStep = highest index that has been spoken (-1 = none yet).
  listeningMode: true,
  dictationStep: -1,
  dictationActive: false,
};
const MAX_BEAD_HISTORY = 30;

// =============== EXERCISE LIBRARY ===============
// Pre-built lesson sets. Each maps to one click → loaded into the practice queue.
const EXERCISE_CATEGORIES = [
  { id: 'direct',       name: '➕ Direct',         desc: 'Single-digit add/subtract using lower beads or the heaven bead. Levels 1–2.' },
  { id: 'small_friend', name: '🤝 Small Friend',  desc: '5-complement: when you can\'t add directly, use +5 minus the friend. Levels 3–4.' },
  { id: 'big_friend',   name: '🌟 Big Friend',    desc: '10-complement: for ±6..9, borrow from the next rod. Levels 5–6.' },
  { id: 'mix_friend',   name: '🧠 Mix Friend',    desc: 'Combine 5 and 10-complement in one motion. Level 7.' },
  { id: 'mixed',        name: '🎲 Mixed All',     desc: 'All tricks blended. Levels 8+.' },
  { id: 'speed',        name: '⚡ Speed Drills',  desc: 'Pace-driven drills to build automaticity.' },
  { id: 'anzan',        name: '🧘 Anzan',         desc: 'Beads dimmed or hidden — train mental visualization.' },
  { id: 'dictation',    name: '🎤 Dictation',     desc: 'Listen-and-compute drills with calibrated row pacing.' },
];

const EXERCISES = [
  // -------- Direct --------
  { id: 'd-add-warm',  cat: 'direct', title: 'Direct Add · Warmup',           sub: '5 questions · 3 rows · 3.0s pace',  badge: '🟢 Beginner',
    config: { trick: 'direct_add', count: 5, rows: 3, mode: 'guided', pace: 3000 } },
  { id: 'd-add-5',     cat: 'direct', title: 'Direct Add · 5 rows × 10',       sub: 'Standard L1 set',                    badge: '🟢 Beginner',
    config: { trick: 'direct_add', count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'd-add-10',    cat: 'direct', title: 'Direct Add · 10 rows × 10',      sub: 'Stamina build',                      badge: '🟡 Intermediate',
    config: { trick: 'direct_add', count: 10, rows: 10, mode: 'guided', pace: 2000 } },
  { id: 'd-sub-5',     cat: 'direct', title: 'Direct Subtract · 5 rows × 10',  sub: 'Standard L2 set',                    badge: '🟢 Beginner',
    config: { trick: 'direct_sub', count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'd-sub-10',    cat: 'direct', title: 'Direct Subtract · 10 rows × 10', sub: 'Stamina build',                      badge: '🟡 Intermediate',
    config: { trick: 'direct_sub', count: 10, rows: 10, mode: 'guided', pace: 2000 } },
  { id: 'd-mix-5',     cat: 'direct', title: 'Direct Add+Sub Mix · 5 rows',    sub: 'Both directions',                    badge: '🟢 Beginner',
    config: { tricks: ['direct_add', 'direct_sub'], count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'd-5beads',    cat: 'direct', title: '±5 Heaven-bead Drill',          sub: 'Just the heaven bead',                badge: '🟢 Beginner',
    config: { tricks: ['plus5_direct', 'minus5_direct'], count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'd-recall',    cat: 'direct', title: 'Direct Recall · 5 rows',        sub: 'Sidebar hidden',                      badge: '🟠 Recall',
    config: { tricks: ['direct_add', 'direct_sub'], count: 10, rows: 5, mode: 'recall', pace: 2500 } },

  // -------- Small Friend --------
  { id: 'sf-add-warm', cat: 'small_friend', title: 'Small Friend Add · Warmup',  sub: '5 questions · 3 rows',     badge: '🟢 Beginner',
    config: { trick: 'small_friend_add', count: 5, rows: 3, mode: 'guided', pace: 3000 } },
  { id: 'sf-add-5',    cat: 'small_friend', title: 'Small Friend Add · 5 rows × 10', sub: '+5 minus friend',     badge: '🟢 Beginner',
    config: { trick: 'small_friend_add', count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'sf-sub-5',    cat: 'small_friend', title: 'Small Friend Sub · 5 rows × 10', sub: '−5 plus friend',      badge: '🟢 Beginner',
    config: { trick: 'small_friend_sub', count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'sf-mix-7',    cat: 'small_friend', title: 'Small Friend Mix · 7 rows × 10', sub: 'Add + Sub combined',  badge: '🟡 Intermediate',
    config: { tricks: ['small_friend_add', 'small_friend_sub'], count: 10, rows: 7, mode: 'guided', pace: 2000 } },
  { id: 'sf-recall-5', cat: 'small_friend', title: 'Small Friend Recall',        sub: 'Sidebar hidden',           badge: '🟠 Recall',
    config: { tricks: ['small_friend_add', 'small_friend_sub'], count: 10, rows: 5, mode: 'recall', pace: 2500 } },

  // -------- Big Friend --------
  { id: 'bf-add-warm', cat: 'big_friend', title: 'Big Friend Add · Warmup',     sub: '5 questions · 3 rows',     badge: '🟡 Intermediate',
    config: { trick: 'big_friend_add', count: 5, rows: 3, mode: 'guided', pace: 3000 } },
  { id: 'bf-add-5',    cat: 'big_friend', title: 'Big Friend Add · 5 rows × 10',  sub: '+10 minus friend',       badge: '🟡 Intermediate',
    config: { trick: 'big_friend_add', count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'bf-sub-5',    cat: 'big_friend', title: 'Big Friend Sub · 5 rows × 10',  sub: '−10 plus friend',        badge: '🟡 Intermediate',
    config: { trick: 'big_friend_sub', count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'bf-mix-7',    cat: 'big_friend', title: 'Big Friend Mix · 7 rows × 10',  sub: 'Add + Sub combined',     badge: '🟡 Intermediate',
    config: { tricks: ['big_friend_add', 'big_friend_sub'], count: 10, rows: 7, mode: 'guided', pace: 2000 } },
  { id: 'bf-recall-5', cat: 'big_friend', title: 'Big Friend Recall',             sub: 'Sidebar hidden',          badge: '🟠 Recall',
    config: { tricks: ['big_friend_add', 'big_friend_sub'], count: 10, rows: 5, mode: 'recall', pace: 2500 } },

  // -------- Mix Friend --------
  { id: 'mf-warm',     cat: 'mix_friend', title: 'Mix Friend · Warmup',        sub: '5 questions · 3 rows',     badge: '🟡 Intermediate',
    config: { trick: 'mix_friend', count: 5, rows: 3, mode: 'guided', pace: 3000 } },
  { id: 'mf-5',        cat: 'mix_friend', title: 'Mix Friend · 5 rows × 10',    sub: 'Combined 5+10 complement', badge: '🟡 Intermediate',
    config: { trick: 'mix_friend', count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'mf-10',       cat: 'mix_friend', title: 'Mix Friend · 10 rows × 10',   sub: 'Stamina + speed',          badge: '🟠 Advanced',
    config: { trick: 'mix_friend', count: 10, rows: 10, mode: 'guided', pace: 2000 } },
  { id: 'mf-recall',   cat: 'mix_friend', title: 'Mix Friend Recall',           sub: 'Sidebar hidden',           badge: '🟠 Recall',
    config: { trick: 'mix_friend', count: 10, rows: 7, mode: 'recall', pace: 2000 } },

  // -------- Mixed All --------
  { id: 'all-5',       cat: 'mixed', title: 'All Tricks · 5 rows × 10',          sub: 'Comprehensive mix',        badge: '🟡 Intermediate',
    config: { tricks: ALL_TRICKS_LIST(), count: 10, rows: 5, mode: 'guided', pace: 2500 } },
  { id: 'all-10',      cat: 'mixed', title: 'All Tricks · 10 rows × 10',         sub: 'Comprehensive · stamina',  badge: '🟠 Advanced',
    config: { tricks: ALL_TRICKS_LIST(), count: 10, rows: 10, mode: 'guided', pace: 2000 } },
  { id: 'all-recall',  cat: 'mixed', title: 'All Tricks Recall · 7 rows',        sub: 'Sidebar hidden',           badge: '🔴 Hard',
    config: { tricks: ALL_TRICKS_LIST(), count: 10, rows: 7, mode: 'recall', pace: 2000 } },

  // -------- Speed --------
  { id: 'speed-direct', cat: 'speed', title: 'Speed Direct · 1.0s pace',         sub: 'Build automaticity',       badge: '⚡ Speed',
    config: { tricks: ['direct_add', 'direct_sub'], count: 10, rows: 5, mode: 'guided', pace: 1000 } },
  { id: 'speed-friend', cat: 'speed', title: 'Speed Friend Mix · 1.0s pace',     sub: 'Small + Big',              badge: '⚡ Speed',
    config: { tricks: ['small_friend_add', 'small_friend_sub', 'big_friend_add', 'big_friend_sub'], count: 10, rows: 5, mode: 'guided', pace: 1000 } },
  { id: 'speed-flash',  cat: 'speed', title: 'Flash Direct · 0.7s pace',         sub: 'Recall mode',              badge: '🔥 Flash',
    config: { tricks: ['direct_add', 'direct_sub'], count: 10, rows: 5, mode: 'recall', pace: 700 } },

  // -------- Anzan --------
  { id: 'anzan-fade',  cat: 'anzan', title: 'Anzan Fade · Direct',              sub: 'Beads at 50% opacity',     badge: '🧘 Mental',
    config: { tricks: ['direct_add', 'direct_sub'], count: 10, rows: 5, mode: 'guided', pace: 2500, viz: 'fade50' } },
  { id: 'anzan-ghost', cat: 'anzan', title: 'Anzan Ghost · Friend Mix',         sub: 'Beads at 20% opacity',     badge: '🧘 Mental',
    config: { tricks: ['small_friend_add', 'small_friend_sub', 'big_friend_add', 'big_friend_sub'], count: 10, rows: 5, mode: 'guided', pace: 2500, viz: 'fade20' } },
  { id: 'anzan-hidden', cat: 'anzan', title: 'Anzan Hidden · Direct',           sub: 'Beads invisible',          badge: '🧘 Mental',
    config: { tricks: ['direct_add', 'direct_sub'], count: 10, rows: 5, mode: 'recall', pace: 2000, viz: 'hidden' } },
  { id: 'anzan-flash', cat: 'anzan', title: 'Anzan Flash · 0.7s · Hidden',      sub: 'World-style flash drill',  badge: '🔥 Flash',
    config: { tricks: ['direct_add', 'direct_sub'], count: 10, rows: 5, mode: 'recall', pace: 700, viz: 'hidden' } },

  // -------- Dictation --------
  { id: 'dict-direct-3s', cat: 'dictation', title: 'Dictation · Direct · 3.0s', sub: 'Slow, beginner-friendly',  badge: '🎤 Listen',
    config: { tricks: ['direct_add', 'direct_sub'], count: 10, rows: 5, mode: 'guided', pace: 3000 } },
  { id: 'dict-friend-2s', cat: 'dictation', title: 'Dictation · Friend · 2.0s', sub: 'Standard pace',            badge: '🎤 Listen',
    config: { tricks: ['small_friend_add', 'big_friend_add'], count: 10, rows: 5, mode: 'guided', pace: 2000 } },
  { id: 'dict-mix-1.5s',  cat: 'dictation', title: 'Dictation · Mix · 1.5s',    sub: 'Faster',                   badge: '🎤 Listen',
    config: { tricks: ['mix_friend'], count: 10, rows: 5, mode: 'guided', pace: 1500 } },
];

function ALL_TRICKS_LIST() {
  return ['direct_add', 'direct_sub', 'small_friend_add', 'small_friend_sub', 'big_friend_add', 'big_friend_sub', 'mix_friend'];
}

// =============== TRICKS ===============
const TRICKS = {
  direct_add: {
    id: 'direct_add',
    name: '+1 to +4 Direct',
    why: 'Lower beads are free, so add directly.',
    visual: '+3 → move 3 lower beads up',
    finger: '👍 Thumb pushes lower beads UP toward the bar.',
    level: 1,
  },
  direct_sub: {
    id: 'direct_sub',
    name: '−1 to −4 Direct',
    why: 'Lower beads are on, so minus directly.',
    visual: '−2 → move 2 lower beads down',
    finger: '👆 Index finger pulls lower beads DOWN away from the bar.',
    level: 2,
  },
  plus5_direct: {
    id: 'plus5_direct',
    name: '+5 Use 5-bead',
    why: 'No more lower beads free — use the 5-bead.',
    visual: '+5 → drop heaven bead',
    finger: '👆 Index finger pulls the heaven bead DOWN to the bar.',
    level: 1,
  },
  minus5_direct: {
    id: 'minus5_direct',
    name: '−5 Use 5-bead',
    why: 'Remove the 5-bead only.',
    visual: '−5 → lift heaven bead',
    finger: '👆 Index finger pushes the heaven bead UP away from the bar.',
    level: 2,
  },
  small_friend_add: {
    id: 'small_friend_add',
    name: '+1..+4 Small Friend (5-complement)',
    why: 'No room for lower beads — use +5 then subtract the small friend.',
    visual: '+4 = +5 −1',
    finger: '🤏 Pinch: index drops the heaven bead while index pushes lower beads down — same beat.',
    level: 3,
  },
  small_friend_sub: {
    id: 'small_friend_sub',
    name: '−1..−4 Small Friend',
    why: 'Not enough lower beads — use −5 then add the small friend.',
    visual: '−4 = −5 +1',
    finger: '🤏 Pinch: index lifts the heaven bead while thumb adds lower beads.',
    level: 4,
  },
  big_friend_add: {
    id: 'big_friend_add',
    name: '+6..+9 Big Friend (10-complement)',
    why: 'For +9, do +10 −1 because 9 is near 10.',
    visual: '+9 = +10 −1',
    finger: '👍👆 Thumb adds 1 on the next rod (+10), index removes from this rod.',
    level: 5,
  },
  big_friend_sub: {
    id: 'big_friend_sub',
    name: '−6..−9 Big Friend',
    why: 'For −9, do −10 +1 — borrow from the next rod.',
    visual: '−9 = −10 +1',
    finger: '👆👍 Index removes 1 on the next rod (−10), thumb adds on this rod.',
    level: 6,
  },
  mix_friend: {
    id: 'mix_friend',
    name: 'Mix Friend (combined 5+10 complement)',
    why: 'When small friend fails, combine with 10-complement.',
    visual: '+7 on 4 = +10 −3',
    finger: '👍👆 Thumb adds on next rod, index does small-friend on this rod — one motion.',
    level: 7,
  },
};

const LEVELS = [
  { id: 1, name: 'Level 1 — Direct Addition', tricks: ['direct_add','plus5_direct'] },
  { id: 2, name: 'Level 2 — Direct Subtraction', tricks: ['direct_sub','minus5_direct'] },
  { id: 3, name: 'Level 3 — Small Friend Addition', tricks: ['small_friend_add'] },
  { id: 4, name: 'Level 4 — Small Friend Subtraction', tricks: ['small_friend_sub'] },
  { id: 5, name: 'Level 5 — Big Friend Addition', tricks: ['big_friend_add'] },
  { id: 6, name: 'Level 6 — Big Friend Subtraction', tricks: ['big_friend_sub'] },
  { id: 7, name: 'Level 7 — Mix Friend', tricks: ['mix_friend'] },
  { id: 8, name: 'Level 8 — Mixed Practice', tricks: ['direct_add','direct_sub','small_friend_add','small_friend_sub'] },
  { id: 9, name: 'Level 9 — Multi-digit 2d', tricks: ['big_friend_add','big_friend_sub','mix_friend'] },
  { id: 10, name: 'Level 10 — Multi-digit 3d', tricks: ['mix_friend','big_friend_add'] },
  { id: 11, name: 'Level 11 — Up to 7 digits', tricks: ['mix_friend'] },
  { id: 12, name: 'Level 12 — Multiplication warm-up', tricks: ['direct_add','mix_friend'] },
  { id: 13, name: 'Level 13 — Speed Drills', tricks: ['mix_friend','big_friend_add'] },
];

// =============== ABACUS RENDERING ===============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function initBeadsState(rodCount) {
  state.beadsState = Array.from({length: rodCount}, () => ({
    upper: false, lower: [false,false,false,false]
  }));
}

// AUTONOMOUS: [ORDER-2] mirror-mode refactor — render functions accept an
// opts object so we can render a SECOND read-only abacus next to the main
// one without duplicating the math. opts: { frame, beads, valueEl, rodCount,
// interactive }. Default behavior (no opts) is unchanged.
function renderAbacus(opts) {
  opts = opts || {};
  const frame = opts.frame || $('#abacus-frame');
  // C3 fix preserved: only strip the rods, not the entire frame contents.
  frame.querySelectorAll('.rod').forEach(el => el.remove());
  const count = opts.rodCount || state.rodCount;
  const interactive = opts.interactive !== false;
  for (let r = 0; r < count; r++) {
    const rod = document.createElement('div');
    rod.className = 'rod';
    rod.dataset.rod = r;
    rod.innerHTML = `
      <div class="rod-stick"></div>
      <div class="upper-zone" data-zone="upper"></div>
      <div class="crossbar"></div>
      <div class="lower-zone" data-zone="lower"></div>
      <div class="rod-label">${PLACE_LABELS[count - 1 - r] || ''}</div>
    `;
    const upperZone = rod.querySelector('.upper-zone');
    const lowerZone = rod.querySelector('.lower-zone');

    // Upper bead
    const ub = makeBead(r, 'upper', 0, interactive);
    upperZone.appendChild(ub);

    // Lower beads: index 3 (top) to 0 (bottom) in DOM order so visually stacked bottom-up
    for (let i = 3; i >= 0; i--) {
      lowerZone.appendChild(makeBead(r, 'lower', i, interactive));
    }

    frame.appendChild(rod);
  }
  updateAllBeadPositions(opts);
}

function makeBead(rod, zone, index, interactive) {
  const b = document.createElement('div');
  b.className = 'bead';
  b.dataset.rod = rod;
  b.dataset.zone = zone;
  b.dataset.index = index; // for lower: 0=bottom, 3=top; for upper: 0
  if (interactive !== false) attachBeadPointer(b);
  return b;
}

function updateAllBeadPositions(opts) {
  opts = opts || {};
  const count = opts.rodCount || state.rodCount;
  for (let r = 0; r < count; r++) updateRodVisual(r, opts);
  recomputeValue(opts);
}

// Visual gap each active bead leaves between its surface and the crossbar.
// Combined with the crossbar's own thickness this gives clear "above the line /
// below the line" separation regardless of zone height.
const BEAD_CROSSBAR_GAP = 6;
const CROSSBAR_THICKNESS = 3; // matches .crossbar { height:3px }

function updateRodVisual(r, opts) {
  opts = opts || {};
  const frame = opts.frame || $('#abacus-frame');
  const beads = opts.beads || state.beadsState;
  const rodEl = frame.querySelector(`.rod[data-rod="${r}"]`);
  if (!rodEl) return;
  const s = beads[r];
  if (!s) return; // mirror state may not be seeded yet
  const upperZone = rodEl.querySelector('.upper-zone');
  const lowerZone = rodEl.querySelector('.lower-zone');

  // ---------- Heaven bead (upper) ----------
  // Layout: upper-zone height = 34% of rod, its bottom edge sits exactly on the
  // crossbar's top edge. Default (inactive) bead position: top = zone.padding-top.
  // Active position: bead bottom = zoneH - GAP, so its surface is GAP px above
  // the crossbar's top.
  const ub = upperZone.querySelector('.bead');
  if (ub) {
    ub.classList.toggle('active', s.upper);
    const zoneH = upperZone.clientHeight || 60;
    const beadH = ub.offsetHeight || 22;
    const padTop = parseFloat(getComputedStyle(upperZone).paddingTop) || 0;
    const y = s.upper
      ? (zoneH - beadH - BEAD_CROSSBAR_GAP - padTop)
      : 0;
    ub.style.transform = `translateY(${y}px)`;
  }

  // ---------- Earth beads (lower) ----------
  const beadH = 22; // matches CSS
  const gap = 3;
  const unit = beadH + gap;
  const lowerBeads = lowerZone.querySelectorAll('.bead');
  const activeIndices = [];
  for (let i = 0; i < 4; i++) if (s.lower[i]) activeIndices.push(i);
  // Active stack: highest-index active sits closest to the crossbar (top of zone),
  // each subsequent active bead stacked one `unit` lower.
  const activeSortedDesc = [...activeIndices].sort((a, b) => b - a);
  const posFromTopForActive = {};
  activeSortedDesc.forEach((idx, rank) => { posFromTopForActive[idx] = rank * unit; });

  const zoneH = lowerZone.clientHeight || 180;
  // Read the *actual* CSS padding-bottom — the previous hardcoded 10 was stale
  // and caused active beads to land ~13px too high (overlapping the crossbar).
  const padBottom = parseFloat(getComputedStyle(lowerZone).paddingBottom) || 0;

  lowerBeads.forEach(b => {
    const idx = parseInt(b.dataset.index, 10);
    const isActive = s.lower[idx];
    b.classList.toggle('active', isActive);
    // True flex-rendered top of an inactive bead at index `idx` (justify-content:
    // flex-end + padding-bottom + gap stacking).
    const natTop = zoneH - padBottom - beadH - unit * idx;
    let targetTop;
    if (isActive) {
      // Topmost active bead's TOP sits CROSSBAR_THICKNESS + GAP below the zone
      // top — i.e. cleanly below the bottom edge of the crossbar.
      targetTop = (posFromTopForActive[idx] ?? 0) + CROSSBAR_THICKNESS + BEAD_CROSSBAR_GAP;
    } else {
      targetTop = natTop;
    }
    const deltaFromNat = targetTop - natTop;
    b.style.transform = `translateY(${deltaFromNat}px)`;
  });
}

function recomputeValue(opts) {
  opts = opts || {};
  const beads = opts.beads || state.beadsState;
  const n = opts.rodCount || state.rodCount;
  const valueEl = opts.valueEl || $('#abacus-value');
  let total = 0;
  for (let r = 0; r < n; r++) {
    const s = beads[r];
    if (!s) continue;
    const rodVal = (s.upper ? 5 : 0) + s.lower.filter(Boolean).length;
    const place = Math.pow(10, n - 1 - r);
    total += rodVal * place;
  }
  // Only update the canonical state.abacusValue when rendering the MAIN abacus
  if (!opts.beads) state.abacusValue = total;
  if (valueEl) valueEl.textContent = total.toLocaleString();
  // Whenever we recompute either side, refresh the match indicator
  updateMatchIndicator();
  return total;
}

// Compute the integer value of an arbitrary beadsState (used by the match indicator).
function computeBeadValue(beads, n) {
  let total = 0;
  for (let r = 0; r < n; r++) {
    const s = beads[r];
    if (!s) continue;
    const rodVal = (s.upper ? 5 : 0) + s.lower.filter(Boolean).length;
    total += rodVal * Math.pow(10, n - 1 - r);
  }
  return total;
}

function resetAbacus() {
  // AUTONOMOUS: [ORDER-2] keep one undoable step before clearing
  pushBeadHistory();
  initBeadsState(state.rodCount);
  updateAllBeadPositions();
  emitBeadSync();
}

// Convert a number into rod-by-rod bead positions (digit = upper*5 + lowerCount).
function beadsStateFromNumber(num, rodCount) {
  const n = rodCount;
  const beads = Array.from({length: n}, () => ({ upper: false, lower: [false,false,false,false] }));
  let v = Math.max(0, Math.floor(Number(num) || 0));
  const max = Math.pow(10, n) - 1;
  if (v > max) v = max;
  for (let r = n - 1; r >= 0; r--) {
    const digit = v % 10;
    v = Math.floor(v / 10);
    beads[r].upper = digit >= 5;
    const lowerCount = digit % 5;
    for (let i = 0; i < lowerCount; i++) beads[r].lower[i] = true;
  }
  return beads;
}

function setAbacusValue(num) {
  state.beadsState = beadsStateFromNumber(num, state.rodCount);
  updateAllBeadPositions();
  // Teacher: emit authoritative set-value (forces both sides to sync).
  if (state.isInRoom && state.socket && state.role === 'teacher') {
    state.socket.emit('set-value', {
      rodCount: state.rodCount,
      beadsState: state.beadsState,
      value: state.abacusValue,
    });
  } else {
    emitBeadSync();
  }
}

// =============== FLEXIBLE BEAD CONTROL ===============
// INDIVIDUAL: toggle just one bead
function toggleOneBead(rod, index) {
  const s = state.beadsState[rod];
  s.lower[index] = !s.lower[index];
}

// BOTTOM SWEEP: click bottom bead activates ALL (if any inactive)
function tryBottomSweep(rod) {
  const s = state.beadsState[rod];
  const anyInactive = s.lower.some(v => !v);
  if (anyInactive) {
    for (let j = 0; j <= 3; j++) s.lower[j] = true;
    return true; // did sweep
  }
  return false; // all already active, do normal toggle
}

// RANGE UP: activate from index up to top (inclusive)
function rangeActivateUp(rod, fromIndex) {
  const s = state.beadsState[rod];
  for (let j = fromIndex; j <= 3; j++) s.lower[j] = true;
}

// RANGE DOWN: deactivate from index down to bottom (inclusive)
function rangeDeactivateDown(rod, fromIndex) {
  const s = state.beadsState[rod];
  for (let j = fromIndex; j >= 0; j--) s.lower[j] = false;
}

// =============== BEAD INTERACTION ===============
function isInteractionBlocked() {
  // AUTONOMOUS: [ORDER-2] mirror-mode override — in mirror mode each user
  // owns their own abacus, so the lock is irrelevant.
  if (state.mirrorMode) return false;
  // A student in a room cannot manipulate beads while locked.
  return state.isInRoom && state.role === 'student' && state.studentLocked;
}

// AUTONOMOUS: [ORDER-2] — bead undo stack. Snapshots are deep-cloned so
// later mutations to state.beadsState don't poison the history.
function pushBeadHistory() {
  state.beadHistory.push(JSON.parse(JSON.stringify(state.beadsState)));
  if (state.beadHistory.length > MAX_BEAD_HISTORY) state.beadHistory.shift();
}
function undoBeadMove() {
  if (isInteractionBlocked()) { toast('🔒 Locked — ask teacher to unlock'); return; }
  if (!state.beadHistory.length) { toast('Nothing to undo'); return; }
  const prev = state.beadHistory.pop();
  state.beadsState = prev;
  updateAllBeadPositions();
  emitBeadSync();
  soundBeadClick();
  toast('↶ Undid last move');
}
function clearBeadHistory() { state.beadHistory.length = 0; }

function attachBeadPointer(bead) {
  let startY = 0, startX = 0, dragged = false, pointerId = null;
  const THRESH = 5;

  const onDown = (e) => {
    if (isInteractionBlocked()) {
      toast('🔒 Teacher hasn’t unlocked the abacus yet');
      return;
    }
    e.preventDefault();
    pointerId = e.pointerId;
    bead.setPointerCapture(pointerId);
    startY = e.clientY; startX = e.clientX; dragged = false;
    bead.classList.add('bead-dragging');
    // AUTONOMOUS: [ORDER-2] snapshot pre-move state for Z undo
    pushBeadHistory();
  };
  const onMove = (e) => {
    if (pointerId === null) return;
    const dy = e.clientY - startY;
    const dx = e.clientX - startX;
    if (!dragged && (Math.abs(dy) > THRESH || Math.abs(dx) > THRESH)) {
      dragged = true;
    }
    if (dragged) applyDrag(bead, dy);
  };
  const onUp = (e) => {
    if (pointerId === null) return;
    try { bead.releasePointerCapture(pointerId); } catch(_) {}
    bead.classList.remove('bead-dragging');
    if (!dragged) applyTap(bead);
    pointerId = null;
    soundBeadClick();
    emitBeadSync();
  };

  // Teachers broadcast a "finger" pointer when they touch a bead so the student
  // sees which rod the teacher is interacting with (mimics pointing in person).
  const onEnter = () => {
    if (state.role === 'teacher' && state.isInRoom) {
      emitTeacherPointer(+bead.dataset.rod, bead.dataset.zone);
    }
  };

  bead.addEventListener('pointerdown', onDown);
  bead.addEventListener('pointermove', onMove);
  bead.addEventListener('pointerup', onUp);
  bead.addEventListener('pointercancel', onUp);
  bead.addEventListener('pointerenter', onEnter);
}

function applyTap(bead) {
  const rod = +bead.dataset.rod;
  const zone = bead.dataset.zone;
  const idx = +bead.dataset.index;
  const s = state.beadsState[rod];
  if (zone === 'upper') {
    s.upper = !s.upper;
  } else {
    // LOWER BEADS: flexible control
    // Index 0 = bottom (closest to user), Index 3 = top (nearest crossbar)
    if (idx === 0) {
      // Bottom bead click: if any inactive, sweep ALL up; else toggle just bottom
      const didSweep = tryBottomSweep(rod);
      if (!didSweep) toggleOneBead(rod, idx); // all already up, so toggle bottom down
    } else {
      // Any other bead: toggle individually
      toggleOneBead(rod, idx);
    }
  }
  updateRodVisual(rod);
  recomputeValue();
}

function applyDrag(bead, dy) {
  const rod = +bead.dataset.rod;
  const zone = bead.dataset.zone;
  const idx = +bead.dataset.index;
  const s = state.beadsState[rod];
  if (zone === 'upper') {
    if (dy > 10) s.upper = true;        // drag down → activate
    else if (dy < -10) s.upper = false; // drag up → deactivate
  } else {
    // LOWER BEADS: drag direction selects range
    // Drag UP (negative dy) → pull THIS bead and ALL ABOVE it toward crossbar
    // Drag DOWN (positive dy) → push THIS bead and ALL BELOW it away from crossbar
    if (dy < -10) {
      rangeActivateUp(rod, idx);  // idx, idx+1, ..., 3 all go up
    } else if (dy > 10) {
      rangeDeactivateDown(rod, idx); // idx, idx-1, ..., 0 all go down
    }
  }
  updateRodVisual(rod);
  recomputeValue();
}

// =============== FORMULA SIDEBAR ===============
function renderFormulaSidebar() {
  const list = $('#formula-list');
  list.innerHTML = '';
  Object.values(TRICKS).forEach(t => {
    const card = document.createElement('div');
    card.className = 'formula-card';
    card.dataset.tid = t.id;
    card.innerHTML = `
      <h4>${t.name}</h4>
      <p>${t.why}</p>
      <div class="mini-visual">${t.visual}</div>
      ${t.finger ? `<div class="finger-rule"><span class="finger-icon">✋</span><span>${t.finger}</span></div>` : ''}
    `;
    list.appendChild(card);
  });
}

function highlightTrickCard(tid) {
  $$('.formula-card').forEach(c => c.classList.toggle('highlight', c.dataset.tid === tid));
}

// =============== QUESTION ENGINE ===============
function randInt(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }

// Pad a question's ops with safe single-digit ±ops until it has `targetRows - 1`
// total operands (which means `targetRows` rows including the starting number).
// "Safe" = keeps the running total inside what the abacus can display, never
// goes negative, and uses single-digit operands (1..4 by default, ±5 occasionally).
function safePadOps(q, targetRows) {
  if (!targetRows || q.ops.length + 1 >= targetRows) return q;
  const maxVal = Math.pow(10, state.rodCount) - 1;
  let cur = q.answer;
  let safety = 200;
  while (q.ops.length < targetRows - 1 && safety-- > 0) {
    const op = Math.random() < 0.55 ? '+' : '-';
    const n = randInt(1, 4); // single-digit operand
    const next = op === '+' ? cur + n : cur - n;
    if (next < 0 || next > maxVal) continue; // skip if it'd over/underflow
    q.ops.push({ op, n });
    cur = next;
  }
  q.answer = cur;
  return q;
}

// Generate a single question (sequence of +/- ops) biased to force a target trick.
// `targetRows` (optional) extends the question with safe padding ops to reach the
// requested total row count.
function genQuestion(trickId, targetRows = 0) {
  const ops = [];
  let start = 0;
  let cur = 0;
  const push = (op, n) => { ops.push({op, n}); cur = op === '+' ? cur + n : cur - n; };

  switch (trickId) {
    case 'direct_add': {
      start = randInt(0, 2);
      cur = start;
      const steps = randInt(2, 3);
      for (let i=0;i<steps;i++){
        const n = randInt(1, Math.max(1, 4 - (cur % 5)));
        if ((cur % 5) + n <= 4) push('+', n);
        else push('+', 1);
      }
      break;
    }
    case 'direct_sub': {
      start = randInt(6, 9); cur = start;
      for (let i=0;i<randInt(2,3);i++){
        const n = randInt(1, Math.min(4, cur % 5 || 4));
        if ((cur % 5) - n >= 0) push('-', n);
        else push('-', 1);
      }
      break;
    }
    case 'plus5_direct': {
      start = randInt(0,4); cur = start;
      push('+', 5);
      break;
    }
    case 'minus5_direct': {
      start = randInt(5,9); cur = start;
      push('-', 5);
      break;
    }
    case 'small_friend_add': {
      // need current lower count to block direct: e.g. cur%10 in [1..4], add n where (cur%5)+n > 4 but total <9
      start = randInt(2, 4); cur = start;
      const n = randInt(5 - (cur % 5), 4);
      push('+', Math.max(1, Math.min(4, n)));
      break;
    }
    case 'small_friend_sub': {
      start = randInt(5, 8); cur = start;
      // remove n where (cur%5) < n (so you need to use 5-n)
      const low = cur % 5;
      const n = randInt(low + 1, Math.min(4, 4));
      push('-', Math.max(1, Math.min(4, n || 1)));
      break;
    }
    case 'big_friend_add': {
      start = randInt(1, 4); cur = start;
      push('+', randInt(6, 9));
      break;
    }
    case 'big_friend_sub': {
      start = randInt(10, 14); cur = start;
      push('-', randInt(6, 9));
      break;
    }
    case 'mix_friend': {
      start = randInt(4, 6); cur = start;
      push('+', randInt(6, 9));
      push('-', randInt(1, 4));
      break;
    }
    default:
      start = randInt(1,5); cur = start;
      push('+', randInt(1,4));
  }
  const q = { start, ops, answer: cur, trickId };
  return safePadOps(q, targetRows);
}

function generatePractice() {
  const levelId = +$('#sel-level').value;
  const level = LEVELS.find(l => l.id === levelId);
  const trickSel = $('#sel-trick').value;
  const mode = $('#sel-mode').value;
  const count = Math.max(1, Math.min(50, +$('#inp-qcount').value || 10));
  const rowsPerQ = Math.max(2, Math.min(50, +$('#sel-rows-per-q').value || 5));
  state.rowsPerQuestion = rowsPerQ;
  // AUTONOMOUS: [ORDER-2] C9 — show in the practice header what's loaded
  const trickName = trickSel === 'auto' ? 'Auto' : (TRICKS[trickSel]?.name || trickSel);
  state.currentExerciseTitle = `${level?.name || 'Custom'} · ${trickName} · ${rowsPerQ} rows × ${count}`;
  setNowPracticing(state.currentExerciseTitle);

  const availableTricks = trickSel === 'auto' ? level.tricks : [trickSel];
  const qs = [];
  for (let i = 0; i < count; i++) {
    const tid = availableTricks[Math.floor(Math.random()*availableTricks.length)];
    qs.push(genQuestion(tid, rowsPerQ));
  }
  state.allQuestions = qs;
  state.currentQIndex = 0;
  state.currentMode = mode;
  state.score = 0; state.streak = 0;
  state.correctCount = 0; state.wrongCount = 0;
  state.assistedCount = 0;
  state.questionTimings = [];
  state.sessionStart = Date.now();
  startTimer();
  updatePills();

  // Mode-based panel visibility
  if (mode === 'recall') { setSidebarOpen(false); state.trickPanelVisible = false; }
  else { setSidebarOpen(true); state.trickPanelVisible = true; }

  loadQuestion();
  emitSession();
}

function loadQuestion() {
  const q = state.allQuestions[state.currentQIndex];
  const col = $('#q-column');
  $('#why-line').classList.add('hidden');
  $('#session-summary').classList.add('hidden');
  $('#inp-answer').value = '';

  // Reset dictation step for the new question
  state.dictationStep = -1;
  state.dictationIdx = 0;
  state.dictationPaused = false;
  state.dictationActive = false;

  if (!q) { showSummary(); return; }

  state.currentTrickId = q.trickId;
  state.currentHint = TRICKS[q.trickId]?.why || '';
  state.whyLine = TRICKS[q.trickId]?.why || '';
  state.expectedAnswer = q.answer;
  state.qStartTime = Date.now();

  const lines = [`<div class="q-num">${q.start}</div>`];
  q.ops.forEach(o => {
    const cls = o.op === '+' ? 'op-plus' : 'op-minus';
    lines.push(`<div class="q-num ${cls}">${o.op}${o.n}</div>`);
  });
  col.innerHTML = lines.join('');
  // LISTENING PRACTICE — start with all upcoming numbers hidden so the
  // student can't preview the question. Each row is revealed only when
  // its audio plays (see playDictation / previousStep).
  if (state.listeningMode) hideAllSteps();
  $('#qpos').textContent = `Q ${state.currentQIndex+1} / ${state.allQuestions.length}`;

  const tag = $('#trick-tag');
  if (state.currentMode === 'guided' && state.trickPanelVisible) {
    tag.textContent = TRICKS[q.trickId].name;
    tag.classList.remove('hidden');
    highlightTrickCard(q.trickId);
  } else {
    tag.classList.add('hidden');
  }
  $('#inp-answer').focus();
}

function checkAnswer() {
  const userAns = parseInt($('#inp-answer').value, 10);
  if (Number.isNaN(userAns)) { toast('Enter a number'); return; }

  // If a teacher-pushed question is active, route the answer to the teacher.
  if (state.pushedQuestion && state.role === 'student') {
    const expected = state.pushedQuestion.expected;
    const correct = expected != null ? userAns === expected : null;
    if (state.socket) {
      state.socket.emit('student-answer', {
        questionText: state.pushedQuestion.text,
        value: userAns,
        expected,
        correct,
        at: Date.now(),
      });
    }
    if (correct === true) toast('✓ Correct!');
    else if (correct === false) toast(`✗ Expected ${expected}`);
    else toast('Sent to teacher');
    return;
  }

  const q = state.allQuestions[state.currentQIndex];
  if (!q) return;
  const ok = userAns === state.expectedAnswer;
  const elapsed = (Date.now() - state.qStartTime) / 1000;
  state.questionTimings.push({ q, elapsed, correct: ok });
  if (ok) {
    state.score += 10; state.streak += 1; state.correctCount += 1;
    if (state.currentMode === 'guided') state.guidedAccuracy.correct++;
    confetti();
    soundCorrect();
    toast('✓ Correct!');
  } else {
    state.streak = 0; state.wrongCount += 1;
    soundWrong();
    toast(`✗ Expected ${state.expectedAnswer}`);
  }
  if (state.currentMode === 'guided') state.guidedAccuracy.total++;
  updatePills();
  // Show the "why" line every time
  const wl = $('#why-line');
  wl.textContent = `Why this trick? ${state.whyLine}`;
  wl.classList.remove('hidden');

  // Live progress panel updates
  if (state.activePane === 'progress') refreshProgressPanel();
  updateProgressTabBadge();
  saveLocalSession();

  // Unlock mixed mode at 80% guided accuracy
  if (state.guidedAccuracy.total >= 5 &&
      state.guidedAccuracy.correct / state.guidedAccuracy.total >= 0.8) {
    const opt = $('#sel-mode').querySelector('option[value="mixed"]');
    if (opt && opt.disabled) {
      opt.disabled = false;
      opt.textContent = 'Mixed (unlocked ✨)';
      toast('🎉 Mixed Mode unlocked!');
    }
  }
}

function nextQuestion() {
  // AUTONOMOUS: [ORDER-1] C7 — flush any in-flight dictation so the next
  // question doesn't get spoken with leftover utterances from the previous.
  // Also set dictationPaused so the active play loop bails on its next tick
  // (otherwise it would keep emitting reveals for the new question).
  try { speechSynthesis.cancel(); } catch (_) {}
  state.dictationPaused = true;
  state.dictationActive = false;
  clearDictRowHighlight();
  state.currentQIndex += 1;
  if (state.currentQIndex >= state.allQuestions.length) showSummary();
  else loadQuestion();
  emitSession();
  saveLocalSession();
}

function skipQuestion() {
  state.wrongCount += 1;
  state.streak = 0;
  updatePills();
  nextQuestion();
}

function showSummary() {
  stopTimer();
  // AUTONOMOUS: [ORDER-2] session complete → drop the resume payload so a
  // future reload doesn't offer to "resume" an already-finished run.
  clearLocalSession();
  const total = state.correctCount + state.wrongCount;
  const avg = state.questionTimings.length
    ? (state.questionTimings.reduce((s,t)=>s+t.elapsed,0)/state.questionTimings.length).toFixed(1)
    : '0.0';
  // Weakest trick: lowest accuracy among used tricks
  const byTrick = {};
  state.questionTimings.forEach(t => {
    const tid = t.q.trickId;
    byTrick[tid] = byTrick[tid] || { c: 0, n: 0, longest: 0, longestQ: null };
    byTrick[tid].n++;
    if (t.correct) byTrick[tid].c++;
    if (t.elapsed > byTrick[tid].longest) {
      byTrick[tid].longest = t.elapsed;
      byTrick[tid].longestQ = t.q;
    }
  });
  let weak = null, weakAcc = 2;
  Object.entries(byTrick).forEach(([tid, d]) => {
    const acc = d.c/d.n;
    if (acc < weakAcc) { weakAcc = acc; weak = tid; }
  });
  // Longest question
  let longest = null;
  state.questionTimings.forEach(t => { if (!longest || t.elapsed > longest.elapsed) longest = t; });

  // AUTONOMOUS: [ORDER-2] wrong-answer review — surface a one-click retry
  // of just the questions the student got wrong. Pedagogically the right
  // loop: don't grind the right ones, target what's actually weak.
  const wrongCount = state.questionTimings.filter(t => !t.correct).length;
  const html = `
    <h4>Session Insights</h4>
    <div>✅ Correct: <b>${state.correctCount} / ${total}</b></div>
    <div>⏱ Avg time per question: <b>${avg}s</b></div>
    <div>📈 Final streak: <b>${state.streak}</b></div>
    ${weak ? `<div>⚠ Weak Trick: <b>${escapeHtml(TRICKS[weak].name)}</b> → Practice more</div>` : ''}
    ${state.assistedCount ? `<div>🆘 Assisted: ${state.assistedCount}</div>` : ''}
    ${longest ? `<div style="margin-top:8px">🔬 Deep-dive: longest question took ${longest.elapsed.toFixed(1)}s —
      <i>${escapeHtml(TRICKS[longest.q.trickId].why)}</i></div>` : ''}
    <div class="summary-actions">
      ${wrongCount ? `<button class="btn primary" id="btn-review-wrong">↻ Review ${wrongCount} wrong</button>` : ''}
      <button class="btn" id="btn-replay-same">▶ Replay same set</button>
    </div>
  `;
  const ss = $('#session-summary');
  ss.innerHTML = html; ss.classList.remove('hidden');
  $('#q-column').innerHTML = `<div class="empty-state">🎉 Session complete! See insights below.</div>`;
  // Wire the new buttons after we wrote the HTML
  $('#btn-review-wrong')?.addEventListener('click', reviewWrongAnswers);
  $('#btn-replay-same')?.addEventListener('click', replaySameSet);
}

function reviewWrongAnswers() {
  const wrong = state.questionTimings.filter(t => !t.correct).map(t => t.q);
  if (!wrong.length) { toast('No wrong answers to review'); return; }
  state.allQuestions = wrong;
  state.currentQIndex = 0;
  state.score = 0; state.streak = 0;
  state.correctCount = 0; state.wrongCount = 0;
  state.assistedCount = 0;
  state.questionTimings = [];
  state.sessionStart = Date.now();
  state.currentExerciseTitle = `Review wrong (${wrong.length})`;
  setNowPracticing(state.currentExerciseTitle);
  startTimer();
  updatePills();
  loadQuestion();
  emitSession();
  toast(`▶ Reviewing ${wrong.length} question${wrong.length > 1 ? 's' : ''}`);
}

function replaySameSet() {
  // Re-run the same questions in fresh state
  const sameSet = state.questionTimings.map(t => t.q);
  if (!sameSet.length) { toast('Nothing to replay'); return; }
  state.allQuestions = sameSet;
  state.currentQIndex = 0;
  state.score = 0; state.streak = 0;
  state.correctCount = 0; state.wrongCount = 0;
  state.assistedCount = 0;
  state.questionTimings = [];
  state.sessionStart = Date.now();
  setNowPracticing(state.currentExerciseTitle);
  startTimer();
  updatePills();
  loadQuestion();
  emitSession();
  toast(`▶ Replaying ${sameSet.length} questions`);
}

// =============== TIMER & PILLS ===============
function startTimer() {
  stopTimer();
  state.timerInterval = setInterval(() => {
    const s = Math.floor((Date.now()-state.sessionStart)/1000);
    const mm = String(Math.floor(s/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    $('#pill-timer').textContent = `${mm}:${ss}`;
  }, 500);
}
function stopTimer(){ if(state.timerInterval){clearInterval(state.timerInterval);state.timerInterval=null;} }
function updatePills() {
  $('#pill-score').textContent = state.score;
  $('#pill-streak').textContent = state.streak;
}

// =============== DICTATION ===============
function speakText(text, lang, rate) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || state.dictationLang;
    u.rate = rate || state.dictationSpeed;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

// =============== LISTENING PRACTICE — reveal helpers ===============
// Future rows are hidden (lp-hidden) until their audio is spoken. revealStep(i)
// uncovers row i. revealUpTo(i) uncovers 0..i and re-hides everything after
// (used when going BACK so the student can't see what's coming).
function revealStep(i) {
  if (!state.listeningMode) {
    document.querySelectorAll('#q-column .q-num.lp-hidden').forEach(el => el.classList.remove('lp-hidden'));
    return;
  }
  const rows = document.querySelectorAll('#q-column .q-num');
  if (rows[i]) rows[i].classList.remove('lp-hidden');
}
function revealUpTo(i) {
  const rows = document.querySelectorAll('#q-column .q-num');
  rows.forEach((el, idx) => {
    el.classList.toggle('lp-hidden', state.listeningMode && idx > i);
  });
}
function hideAllSteps() {
  if (!state.listeningMode) return;
  document.querySelectorAll('#q-column .q-num').forEach(el => el.classList.add('lp-hidden'));
}
function emitDictationStep(step) {
  if (!state.isInRoom || !state.socket || state.role !== 'teacher') return;
  state.socket.emit('dictation-step', { step });
}
function currentDictationSeq() {
  const q = state.allQuestions[state.currentQIndex];
  if (!q) return null;
  return [q.start.toString(), ...q.ops.map(o => (o.op === '+' ? 'plus ' : 'minus ') + o.n)];
}

// =============== DICTATION ENGINE (rewritten for listening practice) ===============
// Pressing Play resumes from the last paused step, or starts from 0 after a
// fresh load / completion. Each iteration: reveal row → speak → wait inter-row.
async function playDictation(startIdx = null) {
  const seq = currentDictationSeq();
  if (!seq) return;
  // Cancel any pending utterances first — a second click of Play used to stack
  try { speechSynthesis.cancel(); } catch (_) {}
  // Resolve the starting index
  let i;
  if (startIdx !== null && startIdx !== undefined) {
    i = Math.max(0, Math.min(startIdx, seq.length - 1));
  } else if (state.dictationStep < 0 || state.dictationStep >= seq.length - 1) {
    i = 0; // fresh start (or restart after completion)
  } else {
    i = state.dictationStep + 1; // resume from where pause/prev left off
  }
  // If starting at the very beginning, hide all rows so the reveal happens
  // strictly in sync with audio.
  if (i === 0) hideAllSteps();
  state.dictationPaused = false;
  state.dictationActive = true;
  const interRow = Math.max(0, +state.rowIntervalMs || 0);
  for (; i < seq.length; i++) {
    if (state.dictationPaused) {
      state.dictationStep = i - 1;
      state.dictationIdx = state.dictationStep;
      clearDictRowHighlight();
      state.dictationActive = false;
      return;
    }
    state.dictationStep = i;
    state.dictationIdx = i;
    revealStep(i);
    highlightDictRow(i);
    emitDictationStep(i);
    await speakText(seq[i], state.dictationLang, state.dictationSpeed);
    if (interRow && i < seq.length - 1) await sleep(interRow);
  }
  clearDictRowHighlight();
  state.dictationActive = false;
}

function pauseDictation() {
  state.dictationPaused = true;
  state.dictationActive = false;
  try { speechSynthesis.cancel(); } catch (_) {}
}

// Repeat the CURRENT step (don't advance). Speaks it again, doesn't touch reveals.
function repeatRow() {
  const seq = currentDictationSeq();
  if (!seq) return;
  if (state.dictationStep < 0) {
    // Nothing has played — fall back to a fresh Play
    return playDictation(0);
  }
  // Re-pause to stop any running loop, then speak the current step
  pauseDictation();
  setTimeout(() => {
    state.dictationPaused = true; // stay paused after repeat
    revealStep(state.dictationStep);
    highlightDictRow(state.dictationStep);
    emitDictationStep(state.dictationStep);
    speakText(seq[state.dictationStep], state.dictationLang, state.dictationSpeed);
  }, 30);
}

// "Go Back" — replay the previous spoken step. Hides everything after it so
// the student can't peek at upcoming numbers.
function previousStep() {
  const seq = currentDictationSeq();
  if (!seq) return;
  // Stop whatever is currently running
  pauseDictation();
  // If nothing has been played yet, treat as no-op
  if (state.dictationStep <= 0) {
    if (state.dictationStep === 0) {
      // We're already on step 0 — just replay it
      setTimeout(() => {
        revealUpTo(0);
        highlightDictRow(0);
        emitDictationStep(0);
        speakText(seq[0], state.dictationLang, state.dictationSpeed);
      }, 30);
    } else {
      toast('Nothing played yet');
    }
    return;
  }
  const newStep = state.dictationStep - 1;
  state.dictationStep = newStep;
  state.dictationIdx = newStep;
  setTimeout(() => {
    state.dictationPaused = true;
    revealUpTo(newStep);   // re-hide everything after the new step
    highlightDictRow(newStep);
    emitDictationStep(newStep);
    speakText(seq[newStep], state.dictationLang, state.dictationSpeed);
  }, 30);
}

// User toggled the Listening Mode checkbox
function setListeningMode(on) {
  state.listeningMode = !!on;
  if (!state.listeningMode) {
    // Reveal everything
    document.querySelectorAll('#q-column .q-num.lp-hidden').forEach(el => el.classList.remove('lp-hidden'));
  } else {
    // Re-hide whatever is past the current step
    revealUpTo(state.dictationStep);
  }
}

// =============== CUSTOM SEQUENCE ===============
function parseCustom(str) {
  // e.g. "5+3-2+7"
  str = str.replace(/\s+/g,'');
  const re = /(^-?\d+)|([+\-]\d+)/g;
  const tokens = str.match(re);
  if (!tokens || tokens.length < 2) return null;
  const start = parseInt(tokens[0], 10);
  const ops = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    ops.push({ op: t[0] === '-' ? '-' : '+', n: Math.abs(parseInt(t,10)) });
  }
  let cur = start;
  ops.forEach(o => { cur = o.op === '+' ? cur+o.n : cur-o.n; });
  return { start, ops, answer: cur, trickId: 'direct_add' };
}

// =============== CONFETTI ===============
const confettiCanvas = () => document.getElementById('confetti');
function confetti() {
  const c = confettiCanvas();
  const ctx = c.getContext('2d');
  c.width = window.innerWidth; c.height = window.innerHeight;
  const parts = Array.from({length: 80}, () => ({
    x: Math.random()*c.width, y: -20,
    vx: (Math.random()-0.5)*6, vy: Math.random()*4+3,
    color: ['#6366f1','#eab308','#22c55e','#f472b6','#38bdf8'][Math.floor(Math.random()*5)],
    size: Math.random()*6+3, life: 0
  }));
  let frames = 0;
  const id = setInterval(() => {
    ctx.clearRect(0,0,c.width,c.height);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life++;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    frames++;
    if (frames > 80) { clearInterval(id); ctx.clearRect(0,0,c.width,c.height); }
  }, 16);
}

// =============== TOAST ===============
let toastTimeout = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.add('hidden'), 2200);
}

// =============== SIDEBAR ===============
function setSidebarOpen(open) {
  $('#sidebar').classList.toggle('open', open);
  state.trickPanelVisible = open;
}

// =============== SOUND CUES (Web Audio synth — no asset files) ===============
function ensureAudio() {
  if (state.audioCtx) {
    // AUTONOMOUS: [ORDER-1] C8 — Chrome/Safari suspend AudioContext until a
    // user gesture. If the context is suspended, kick it back on. ensureAudio
    // is called from sound emitters, but those run during user-driven events
    // (clicks, keypresses), so resume() lands inside the gesture.
    if (state.audioCtx.state === 'suspended') {
      try { state.audioCtx.resume(); } catch (_) {}
    }
    return state.audioCtx;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
  } catch (_) { state.audioCtx = null; }
  return state.audioCtx;
}
function playTone({ freq = 880, durMs = 60, type = 'sine', gain = 0.07, glide = 0 } = {}) {
  if (!state.soundOn) return;
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + glide), t0 + durMs / 1000);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}
function soundBeadClick() { playTone({ freq: 1200, durMs: 35, type: 'triangle', gain: 0.05 }); }
function soundCorrect()  { playTone({ freq: 880, durMs: 110, type: 'sine', gain: 0.09 });
  setTimeout(() => playTone({ freq: 1320, durMs: 140, type: 'sine', gain: 0.09 }), 90); }
function soundWrong()    { playTone({ freq: 220, durMs: 240, type: 'square', gain: 0.06, glide: -120 }); }
function soundDemoStep() { playTone({ freq: 660, durMs: 50, type: 'triangle', gain: 0.05 }); }

function setSoundOn(on) {
  state.soundOn = !!on;
  const btn = $('#btn-toggle-sound');
  if (btn) btn.textContent = state.soundOn ? '🔊' : '🔇';
  if (state.soundOn) ensureAudio(); // some browsers need this to start the context
}

// =============== TEACHER POINTER OVERLAY (the "wall abacus" finger) ===============
function showTeacherPointer(rod, zone) {
  const overlay = $('#teacher-pointer');
  const rodEl = $(`.rod[data-rod="${rod}"]`);
  const frame = $('#abacus-frame');
  if (!overlay || !rodEl || !frame) return;
  const fr = frame.getBoundingClientRect();
  const rr = rodEl.getBoundingClientRect();
  const x = rr.left - fr.left + rr.width / 2;
  // Default: centered between zones (at the crossbar). Bias up/down by zone.
  let y = rr.top - fr.top + rr.height * 0.34;
  if (zone === 'upper') y = rr.top - fr.top + rr.height * 0.18;
  else if (zone === 'lower') y = rr.top - fr.top + rr.height * 0.62;
  overlay.style.left = `${x}px`;
  overlay.style.top = `${y}px`;
  overlay.classList.remove('hidden');
  clearTimeout(state.pointerHideTimer);
  state.pointerHideTimer = setTimeout(() => overlay.classList.add('hidden'), 1800);
}

let lastPointerEmitAt = 0;
function emitTeacherPointer(rod, zone) {
  if (state.role !== 'teacher' || !state.isInRoom || !state.socket) return;
  const now = Date.now();
  if (now - lastPointerEmitAt < 60) return; // throttle ~16 Hz
  lastPointerEmitAt = now;
  state.socket.emit('teacher-pointer', { rod, zone });
}

// =============== ANZAN / GHOST-BEAD VISIBILITY ===============
function applyVisibility(viz) {
  state.visibility = viz || 'full';
  const frame = $('#abacus-frame');
  if (!frame) return;
  frame.classList.remove('viz-fade50', 'viz-fade20', 'viz-hidden');
  if (state.visibility === 'fade50') frame.classList.add('viz-fade50');
  else if (state.visibility === 'fade20') frame.classList.add('viz-fade20');
  else if (state.visibility === 'hidden') frame.classList.add('viz-hidden');
  const sel = $('#sel-visibility'); if (sel) sel.value = state.visibility;
}

function setVisibility(viz) {
  applyVisibility(viz);
  if (state.role === 'teacher' && state.isInRoom && state.socket) {
    state.socket.emit('set-visibility', { visibility: viz });
  }
}

// =============== AUTONOMOUS: [ORDER-2] MIRROR MODE ===============
function applyMirrorMode(on, payload) {
  state.mirrorMode = !!on;
  const pane = document.getElementById('abacus-pane-mirror');
  const labelMain = document.getElementById('abacus-label-main');
  const labelMirror = document.getElementById('abacus-label-mirror');
  const lockBtn = document.getElementById('btn-toggle-lock');
  const mirrorBtn = document.getElementById('btn-toggle-mirror');
  if (mirrorBtn) mirrorBtn.textContent = on ? '🪞 Mirror: ON' : '🪞 Mirror';

  if (on) {
    payload = payload || {};
    // Pick the right side as MY beads, the other side as OTHER beads
    const teacherBeads = (payload.teacherBeads && payload.teacherBeads.length) ? payload.teacherBeads : null;
    const studentBeads = (payload.studentBeads && payload.studentBeads.length) ? payload.studentBeads : null;
    const fallback = JSON.parse(JSON.stringify(state.beadsState || []));
    if (state.role === 'teacher') {
      state.beadsState = teacherBeads || fallback;
      state.otherBeads = studentBeads || fallback;
      if (labelMain) { labelMain.textContent = '👨‍🏫 You (Teacher)'; labelMain.classList.remove('hidden'); }
      if (labelMirror) labelMirror.textContent = '🧑 Student';
    } else {
      state.beadsState = studentBeads || fallback;
      state.otherBeads = teacherBeads || fallback;
      if (labelMain) { labelMain.textContent = '🧑 You (Student)'; labelMain.classList.remove('hidden'); }
      if (labelMirror) labelMirror.textContent = '👨‍🏫 Teacher';
    }
    if (pane) pane.classList.remove('hidden');
    if (lockBtn) lockBtn.style.display = 'none'; // lock is irrelevant in mirror mode
    renderAbacus();         // main
    renderMirrorAbacus();   // secondary
  } else {
    // Returning to single-abacus: server sends the new shared beadsState
    if (payload && payload.beadsState && payload.beadsState.length) {
      state.beadsState = payload.beadsState;
    }
    state.otherBeads = [];
    if (pane) pane.classList.add('hidden');
    if (labelMain) labelMain.classList.add('hidden');
    if (lockBtn) lockBtn.style.display = '';
    renderAbacus();
  }
  updateMatchIndicator();
}

function renderMirrorAbacus() {
  if (!state.mirrorMode) return;
  const frame = document.getElementById('abacus-frame-2');
  const valueEl = document.getElementById('abacus-value-2');
  if (!frame) return;
  renderAbacus({
    frame, valueEl,
    beads: state.otherBeads,
    rodCount: state.rodCount,
    interactive: false,
  });
}

function updateMirrorAbacus() {
  if (!state.mirrorMode) return;
  const frame = document.getElementById('abacus-frame-2');
  const valueEl = document.getElementById('abacus-value-2');
  if (!frame || !state.otherBeads || !state.otherBeads.length) return;
  updateAllBeadPositions({
    frame, valueEl,
    beads: state.otherBeads,
    rodCount: state.rodCount,
  });
}

function updateMatchIndicator() {
  const ind = document.getElementById('match-indicator');
  if (!ind) return;
  if (!state.mirrorMode) { ind.classList.add('hidden'); return; }
  ind.classList.remove('hidden');
  const mine = state.abacusValue;
  const theirs = computeBeadValue(state.otherBeads || [], state.rodCount);
  if (mine === theirs) {
    ind.textContent = `✓ Matched · ${mine}`;
    ind.className = 'match-indicator matched';
  } else {
    ind.textContent = `✗ ${mine} vs ${theirs}`;
    ind.className = 'match-indicator different';
  }
}

function toggleMirrorMode() {
  if (state.role !== 'teacher' || !state.isInRoom || !state.socket) {
    toast('Mirror Mode is teacher-only inside a room'); return;
  }
  state.socket.emit('set-mirror-mode', { on: !state.mirrorMode });
}

// =============== WHITEBOARD (paste-image side panel) ===============
const WB_MAX_IMAGES = 5;
const WB_MAX_WIDTH = 1400;
const WB_QUALITY = 0.78;

function canEditWhiteboard() {
  // Solo users (not in a room) edit freely. In a room: teacher only.
  return !state.isInRoom || state.role === 'teacher';
}

function setWhiteboardOpen(open, opts = {}) {
  state.whiteboardOpen = !!open;
  document.body.classList.toggle('whiteboard-on', state.whiteboardOpen);
  const panel = document.getElementById('whiteboard');
  if (panel) panel.classList.toggle('hidden', !state.whiteboardOpen);
  // Reflect read-only on the student
  document.body.classList.toggle('wb-readonly', state.isInRoom && state.role === 'student');
  if (state.whiteboardOpen) {
    document.getElementById('wb-paste-zone')?.focus();
  }
  // Broadcast unless suppressed (incoming server event sets opts.fromServer=true)
  if (!opts.fromServer && state.isInRoom && state.role === 'teacher' && state.socket) {
    state.socket.emit('whiteboard-toggle', { open: state.whiteboardOpen });
  }
}

function toggleWhiteboard() {
  setWhiteboardOpen(!state.whiteboardOpen);
}

// Compress a File/Blob into a base64 JPEG data URL. Caps width and quality.
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, WB_MAX_WIDTH / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // flatten alpha so JPEG doesn't render black
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', WB_QUALITY);
        URL.revokeObjectURL(url);
        resolve({ src: dataUrl, w, h });
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

async function addWhiteboardImageFromFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return false;
  if (!canEditWhiteboard()) {
    toast('Only the teacher can add images to the whiteboard');
    return false;
  }
  try {
    const { src, w, h } = await compressImage(file);
    if (src.length > 700 * 1024) {
      // Try once more with harsher compression
      toast('Image too large — try a smaller screenshot');
      return false;
    }
    if (state.isInRoom && state.role === 'teacher' && state.socket) {
      state.socket.emit('whiteboard-add', { src, w, h }, (resp) => {
        if (!resp || !resp.ok) {
          toast('Whiteboard add failed: ' + (resp?.error || 'unknown'));
        }
      });
    } else {
      // Solo: render locally, no broadcast
      const img = { id: 'local-' + Date.now() + '-' + Math.floor(Math.random() * 1e6), src, w, h };
      state.whiteboardImages.push(img);
      if (state.whiteboardImages.length > WB_MAX_IMAGES) state.whiteboardImages.shift();
      setWhiteboardOpen(true);
      renderWhiteboard();
    }
    return true;
  } catch (e) {
    toast('Could not read image');
    return false;
  }
}

function removeWhiteboardImage(id) {
  if (!canEditWhiteboard()) return;
  if (state.isInRoom && state.socket) {
    state.socket.emit('whiteboard-remove', { id });
  } else {
    state.whiteboardImages = state.whiteboardImages.filter(i => i.id !== id);
    renderWhiteboard();
  }
}

function clearWhiteboard() {
  if (!canEditWhiteboard()) return;
  if (state.isInRoom && state.socket) {
    state.socket.emit('whiteboard-clear', {});
  } else {
    state.whiteboardImages = [];
    renderWhiteboard();
  }
}

function renderWhiteboard() {
  const grid = document.getElementById('wb-grid');
  const empty = document.getElementById('wb-empty');
  if (!grid || !empty) return;
  if (!state.whiteboardImages.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = '';
  state.whiteboardImages.forEach(img => {
    const card = document.createElement('div');
    card.className = 'wb-img-card';
    card.innerHTML = `
      <img alt="Pasted question" loading="lazy" />
      <button class="wb-remove" title="Remove">✕</button>
    `;
    // Set src via property assignment so we don't HTML-escape a base64 string
    card.querySelector('img').src = img.src;
    card.querySelector('.wb-remove').addEventListener('click', () => removeWhiteboardImage(img.id));
    grid.appendChild(card);
  });
}

async function whiteboardPasteHandler(e) {
  // Only handle paste when our panel is the focus context, OR the panel is open
  if (!state.whiteboardOpen) return;
  if (!canEditWhiteboard()) return;
  const items = (e.clipboardData || {}).items || [];
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) await addWhiteboardImageFromFile(blob);
      return;
    }
  }
}

function whiteboardDropHandler(e) {
  e.preventDefault();
  const zone = document.getElementById('wb-paste-zone');
  zone?.classList.remove('dragover');
  if (!canEditWhiteboard()) return;
  const files = (e.dataTransfer && e.dataTransfer.files) ? Array.from(e.dataTransfer.files) : [];
  for (const f of files) addWhiteboardImageFromFile(f);
}

function wireWhiteboard() {
  const btn = document.getElementById('btn-toggle-whiteboard');
  if (btn) btn.addEventListener('click', toggleWhiteboard);
  document.getElementById('btn-wb-close')?.addEventListener('click', () => setWhiteboardOpen(false));
  document.getElementById('btn-wb-clear')?.addEventListener('click', () => {
    if (!state.whiteboardImages.length) return;
    if (confirm(`Clear ${state.whiteboardImages.length} image${state.whiteboardImages.length > 1 ? 's' : ''}?`)) clearWhiteboard();
  });
  // Global paste — works regardless of focus when whiteboard is open
  window.addEventListener('paste', whiteboardPasteHandler);
  // Drag-drop onto the paste zone
  const zone = document.getElementById('wb-paste-zone');
  if (zone) {
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.add('dragover');
    }));
    ['dragleave', 'dragend'].forEach(ev => zone.addEventListener(ev, () => zone.classList.remove('dragover')));
    zone.addEventListener('drop', whiteboardDropHandler);
  }
}

// =============== DEMO REPLAY (animated solution playback) ===============
async function playDemoForCurrentQuestion() {
  if (state.demoPlaying) return;
  // Students (in a room) shouldn't play demo authoritatively — they ask the
  // teacher via request-demo. Outside a room, anyone can self-demo.
  if (state.isInRoom && state.role === 'student') {
    toast('Asking teacher to demo'); return;
  }
  const q = state.allQuestions[state.currentQIndex];
  if (!q) { toast('No question loaded to demo'); return; }
  state.demoPlaying = true;
  const broadcast = state.isInRoom && state.role === 'teacher' && state.socket;
  try {
    // Step 0: set abacus to start value (animated by CSS transition)
    state.beadsState = beadsStateFromNumber(q.start, state.rodCount);
    updateAllBeadPositions();
    soundDemoStep();
    if (broadcast) state.socket.emit('demo-step', { rodCount: state.rodCount, beadsState: state.beadsState, label: `Start: ${q.start}` });
    highlightDictRow(0);
    await sleep(900);
    let cur = q.start;
    for (let i = 0; i < q.ops.length; i++) {
      const o = q.ops[i];
      cur = o.op === '+' ? cur + o.n : cur - o.n;
      state.beadsState = beadsStateFromNumber(cur, state.rodCount);
      updateAllBeadPositions();
      soundDemoStep();
      if (broadcast) state.socket.emit('demo-step', { rodCount: state.rodCount, beadsState: state.beadsState, label: `${o.op}${o.n}` });
      highlightDictRow(i + 1);
      await sleep(900);
    }
    toast(`Demo complete → ${q.answer}`);
  } finally {
    state.demoPlaying = false;
    setTimeout(() => clearDictRowHighlight(), 1500);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// =============== DICTATION ROW HIGHLIGHT ===============
function highlightDictRow(idx) {
  clearDictRowHighlight();
  const rows = $$('#q-column .q-num');
  if (rows[idx]) {
    rows[idx].classList.add('dict-active');
    rows[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
function clearDictRowHighlight() {
  $$('#q-column .q-num.dict-active').forEach(el => el.classList.remove('dict-active'));
}

// =============== CONNECTION STATUS ===============
function setConnStatus(state_) {
  const pill = $('#conn-pill');
  if (!pill) return;
  pill.classList.remove('conn-online', 'conn-reconnecting', 'conn-offline');
  if (state_ === 'online')        { pill.classList.add('conn-online');        pill.textContent = '🟢 Live'; }
  else if (state_ === 'reconnecting') { pill.classList.add('conn-reconnecting'); pill.textContent = '🟡 Reconnecting'; }
  else                            { pill.classList.add('conn-offline');       pill.textContent = '⚪ Offline'; }
}

// =============== SOCKET.IO ===============
function backendBase() {
  const proto = window.location.protocol;
  const origin = window.location.origin;
  if (proto === 'file:' || origin === 'null') return 'http://localhost:3001';
  if (window.location.hostname.includes('github.io')) return RENDER_BACKEND_URL;
  return origin;
}

function buildShareUrl(code) {
  return `${backendBase()}?room=${encodeURIComponent(code)}`;
}

function initSocket() {
  if (state.socket) return;
  try {
    state.socket = io(backendBase(), { transports: ['websocket','polling'] });
  } catch (e) {
    console.warn('Socket init failed', e);
    return;
  }
  const s = state.socket;

  s.on('connect', () => { console.log('socket connected', s.id); setConnStatus('online'); });
  s.on('disconnect', () => { console.log('socket disconnected'); setConnStatus(state.isInRoom ? 'reconnecting' : 'offline'); });
  s.on('connect_error', () => setConnStatus('reconnecting'));
  s.on('reconnect', () => setConnStatus('online'));

  s.on('bead-update', (data) => {
    if (!data) return;
    state.suppressRemoteUpdate = true;
    // CRITICAL: only rebuild the DOM if rodCount changed. Otherwise just update
    // bead positions so the CSS transition animates the move (mimics watching
    // the teacher's hand move the bead across the rod).
    const rodCountChanged = data.rodCount && data.rodCount !== state.rodCount;
    if (data.rodCount) state.rodCount = data.rodCount;
    if (data.beadsState) state.beadsState = data.beadsState;
    $('#sel-rod-count').value = state.rodCount;
    if (rodCountChanged) renderAbacus();
    else updateAllBeadPositions();
    state.suppressRemoteUpdate = false;
  });
  s.on('rod-change', (data) => {
    state.rodCount = data.rodCount;
    initBeadsState(state.rodCount);
    $('#sel-rod-count').value = state.rodCount;
    renderAbacus();
  });
  s.on('abacus-reset', () => {
    state.suppressRemoteUpdate = true;
    initBeadsState(state.rodCount); renderAbacus();
    state.suppressRemoteUpdate = false;
  });
  s.on('session-update', (data) => {
    if (!data) return;
    state.allQuestions = data.allQuestions || [];
    state.currentQIndex = data.currentQIndex || 0;
    state.currentMode = data.currentMode || state.currentMode;
    if (data.listeningMode !== undefined) state.listeningMode = !!data.listeningMode;
    if (state.role === 'student') loadQuestion();
  });
  s.on('student-joined', () => toast('👥 Student joined'));
  s.on('student-left', () => toast('Student left'));
  s.on('teacher-left', () => toast('Teacher left'));
  s.on('user-count-update', ({teacher, students}) => {
    $('#user-count').textContent = `👥 ${(+teacher||0)+(+students||0)}`;
  });
  s.on('room-expired', () => { toast('Room expired'); leaveRoom(); });

  s.on('lock-update', ({ locked }) => {
    state.studentLocked = !!locked;
    renderLockState();
    toast(locked ? '🔒 Student locked (view-only)' : '🔓 Student can now interact');
  });

  s.on('set-value', (data) => {
    if (!data) return;
    state.suppressRemoteUpdate = true;
    const rodCountChanged = data.rodCount && data.rodCount !== state.rodCount;
    if (data.rodCount) state.rodCount = data.rodCount;
    // AUTONOMOUS: [ORDER-2] in mirror mode, set-value is the teacher pushing
    // their own abacus state, which on a student is the OTHER (read-only)
    // abacus, not the student's own.
    if (state.mirrorMode && state.role === 'student') {
      if (data.beadsState) state.otherBeads = data.beadsState;
      $('#sel-rod-count').value = state.rodCount;
      updateMirrorAbacus();
    } else {
      if (data.beadsState) state.beadsState = data.beadsState;
      $('#sel-rod-count').value = state.rodCount;
      if (rodCountChanged) renderAbacus();
      else updateAllBeadPositions();
    }
    state.suppressRemoteUpdate = false;
    if (typeof data.value === 'number') toast(`Teacher set value → ${data.value.toLocaleString()}`);
  });

  s.on('push-question', (q) => {
    state.pushedQuestion = q;
    renderPushedQuestion();
  });

  s.on('student-answer', (data) => {
    if (state.role !== 'teacher') return;
    const ok = data && data.correct;
    toast(`👤 Student answered ${data.value}: ${ok ? '✓ correct' : '✗ wrong'}`);
  });

  // Teacher's "finger" position relayed to the student
  s.on('teacher-pointer', ({ rod, zone } = {}) => {
    if (state.role === 'teacher') return; // teacher doesn't render their own pointer
    if (typeof rod !== 'number') return;
    showTeacherPointer(rod, zone);
  });

  // Anzan / ghost-bead mode set by teacher
  s.on('set-visibility', ({ visibility } = {}) => {
    applyVisibility(visibility);
    if (visibility !== 'full') toast(`👁 Visibility: ${visibility}`);
  });

  // AUTONOMOUS: [ORDER-2] MIRROR MODE — teacher toggles, server broadcasts
  s.on('set-mirror-mode', (payload) => {
    applyMirrorMode(payload && payload.on, payload || {});
    toast(payload && payload.on
      ? '🪞 Mirror mode ON — your abacus + the other one'
      : '🪞 Mirror mode OFF — back to shared abacus');
  });

  s.on('mirror-bead-update', ({ side, beadsState } = {}) => {
    if (!state.mirrorMode || !beadsState) return;
    state.otherBeads = beadsState;
    updateMirrorAbacus();
  });

  // ---- WHITEBOARD events (synced across the room) ----
  s.on('whiteboard-add', (img) => {
    if (!img || !img.src) return;
    state.whiteboardImages.push(img);
    if (state.whiteboardImages.length > WB_MAX_IMAGES) state.whiteboardImages.shift();
    setWhiteboardOpen(true, { fromServer: true });
    renderWhiteboard();
  });
  s.on('whiteboard-remove', ({ id } = {}) => {
    state.whiteboardImages = state.whiteboardImages.filter(i => i.id !== id);
    renderWhiteboard();
  });
  s.on('whiteboard-clear', () => {
    state.whiteboardImages = [];
    renderWhiteboard();
  });
  s.on('whiteboard-toggle', ({ open } = {}) => {
    setWhiteboardOpen(!!open, { fromServer: true });
  });

  // ---- LISTENING PRACTICE — teacher's dictation step driving student reveal/audio ----
  s.on('dictation-step', ({ step } = {}) => {
    if (typeof step !== 'number') return;
    state.dictationStep = step;
    state.dictationIdx = step;
    revealUpTo(step); // reveal up to this step, hide anything after
    highlightDictRow(step);
    // Speak this step locally so the student hears audio in sync with reveal
    const seq = currentDictationSeq();
    if (seq && seq[step]) {
      try { speechSynthesis.cancel(); } catch (_) {}
      speakText(seq[step], state.dictationLang, state.dictationSpeed);
    }
  });

  // Student → teacher: "I'm stuck, show me"
  s.on('request-demo', () => {
    if (state.role !== 'teacher') return;
    toast('🆘 Student requests a demo — click ▶ Demo to play');
    soundDemoStep();
  });

  // Demo step broadcast: animate to the new bead state (student side)
  s.on('demo-step', (data) => {
    if (!data || !data.beadsState) return;
    state.suppressRemoteUpdate = true;
    if (data.rodCount) state.rodCount = data.rodCount;
    // AUTONOMOUS: [ORDER-2] in mirror mode, demo plays on the teacher's
    // abacus — for a student that's the OTHER side (read-only mirror frame).
    if (state.mirrorMode && state.role === 'student') {
      state.otherBeads = data.beadsState;
      updateMirrorAbacus();
    } else {
      state.beadsState = data.beadsState;
      updateAllBeadPositions();
    }
    state.suppressRemoteUpdate = false;
    soundDemoStep();
    if (data.label) toast(`Demo: ${data.label}`);
  });
}

function renderLockState() {
  const pill = $('#lock-pill');
  const btn = $('#btn-toggle-lock');
  if (pill) {
    pill.textContent = state.studentLocked ? '🔒 Student locked' : '🔓 Student unlocked';
    pill.classList.toggle('locked', state.studentLocked);
    pill.classList.toggle('unlocked', !state.studentLocked);
  }
  if (btn) {
    btn.textContent = state.studentLocked ? '🔓 Unlock Student' : '🔒 Lock Student';
  }
  document.body.classList.toggle('student-locked', !!state.studentLocked);
}

function renderPushedQuestion() {
  const el = $('#pushed-q');
  if (!el) return;
  const q = state.pushedQuestion;
  if (!q || !q.text) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="pushed-q-label">📤 Teacher’s question</div>
    <div class="pushed-q-text">${escapeHtml(q.text)}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// AUTONOMOUS: [ORDER-1] C6 — safe arithmetic evaluator (no eval, no Function).
// Supports + - * / and parentheses on integers/decimals. Throws on anything else.
function safeArithmetic(input) {
  const tokens = [];
  const src = String(input).replace(/\s+/g, '');
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let j = i + 1;
      while (j < src.length && (src[j] === '.' || (src[j] >= '0' && src[j] <= '9'))) j++;
      tokens.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j;
    } else if ('+-*/()'.indexOf(ch) >= 0) {
      tokens.push({ t: 'op', v: ch });
      i++;
    } else {
      throw new Error('bad char');
    }
  }
  let p = 0;
  const peek = () => tokens[p];
  const eat = () => tokens[p++];
  function parseExpr() {
    let left = parseTerm();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = eat().v;
      const right = parseFactor();
      if (op === '/' && right === 0) throw new Error('div by zero');
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function parseFactor() {
    const tok = eat();
    if (!tok) throw new Error('unexpected end');
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'op' && tok.v === '(') {
      const v = parseExpr();
      const close = eat();
      if (!close || close.v !== ')') throw new Error('unclosed paren');
      return v;
    }
    if (tok.t === 'op' && tok.v === '-') return -parseFactor(); // unary minus
    if (tok.t === 'op' && tok.v === '+') return parseFactor();  // unary plus
    throw new Error('unexpected token');
  }
  const result = parseExpr();
  if (p !== tokens.length) throw new Error('trailing tokens');
  if (!Number.isFinite(result)) throw new Error('not finite');
  return result;
}

function createRoom() {
  initSocket();
  state.socket.emit('create-room', {}, (resp) => {
    if (!resp?.ok) { toast('Could not create room'); return; }
    // AUTONOMOUS: [ORDER-1] C4 — persist the teacher token so a reload of
    // this tab can re-claim teacher. Anyone WITHOUT this token (other tabs,
    // siblings clicking the share link) is forced into student role.
    if (resp.teacherToken) {
      try { sessionStorage.setItem(`teacherToken-${resp.code}`, resp.teacherToken); } catch (_) {}
      state.teacherToken = resp.teacherToken;
    }
    enterRoom(resp.code, 'teacher');
  });
}

function joinRoom(code) {
  if (!code) { toast('Enter a room code'); return; }
  initSocket();
  // AUTONOMOUS: [ORDER-1] C4 — if THIS browser created this room, reclaim
  // teacher role with the stored token. Otherwise join as student.
  let savedTeacherToken = null;
  try { savedTeacherToken = sessionStorage.getItem(`teacherToken-${code.toUpperCase()}`); } catch (_) {}
  const asRole = savedTeacherToken ? 'teacher' : 'student';
  state.socket.emit('join-room', { code: code.toUpperCase(), asRole, teacherToken: savedTeacherToken || undefined }, (resp) => {
    if (!resp?.ok) { toast('Room not found'); return; }
    enterRoom(resp.code, resp.role);
    if (resp.state) {
      if (resp.state.beadsState?.length) {
        state.rodCount = resp.state.rodCount || state.rodCount;
        state.beadsState = resp.state.beadsState;
        $('#sel-rod-count').value = state.rodCount;
        renderAbacus();
      }
      state.studentLocked = resp.state.studentLocked !== false; // default locked
      state.pushedQuestion = resp.state.currentQuestion || null;
      applyVisibility(resp.state.visibility || 'full');
      renderLockState();
      renderPushedQuestion();
      // AUTONOMOUS: [ORDER-2] re-apply mirror mode if room is already in it
      if (resp.state.mirrorMode) {
        applyMirrorMode(true, {
          teacherBeads: resp.state.teacherBeads,
          studentBeads: resp.state.studentBeads,
        });
      }
      // WHITEBOARD: rehydrate images and panel state for late joiners
      if (Array.isArray(resp.state.whiteboardImages) && resp.state.whiteboardImages.length) {
        state.whiteboardImages = resp.state.whiteboardImages;
        renderWhiteboard();
      }
      if (resp.state.whiteboardOpen) setWhiteboardOpen(true, { fromServer: true });
    }
  });
}

function enterRoom(code, role) {
  state.roomCode = code;
  state.role = role;
  state.isInRoom = true;
  $('#room-bar-idle').classList.add('hidden');
  $('#room-bar-connected').classList.remove('hidden');
  $('#room-code-display').textContent = code;
  $('#role-pill').textContent = role === 'teacher' ? 'Teacher' : 'Student';
  document.body.classList.toggle('student-mode', role === 'student');
  document.body.classList.toggle('wb-readonly', role === 'student');
  if (role === 'teacher') state.studentLocked = true; // freshly created room
  renderLockState();
  toast(role === 'teacher' ? `Room ${code} created` : `Joined room ${code}`);
}

function leaveRoom() {
  if (state.socket) state.socket.emit('leave-room');
  state.isInRoom = false; state.roomCode = null; state.role = null;
  $('#room-bar-idle').classList.remove('hidden');
  $('#room-bar-connected').classList.add('hidden');
  document.body.classList.remove('student-mode');
  document.body.classList.remove('wb-readonly');
}

function emitBeadSync() {
  if (!state.isInRoom || !state.socket || state.suppressRemoteUpdate) return;
  // AUTONOMOUS: [ORDER-2] mirror mode — emit to the dual-state channel and
  // skip the lock check (each side owns their own abacus).
  if (state.mirrorMode) {
    state.socket.emit('mirror-bead-update', {
      rodCount: state.rodCount,
      beadsState: state.beadsState,
    });
    updateMatchIndicator();
    return;
  }
  if (state.role === 'student' && state.studentLocked) return;
  state.socket.emit('bead-update', {
    rodCount: state.rodCount,
    beadsState: state.beadsState,
  });
}
function emitSession() {
  if (!state.isInRoom || !state.socket || state.role !== 'teacher') return;
  state.socket.emit('session-update', {
    allQuestions: state.allQuestions,
    currentQIndex: state.currentQIndex,
    currentMode: state.currentMode,
    listeningMode: state.listeningMode,
  });
}

async function saveSessionLog() {
  if (state.isInRoom && state.role !== 'teacher') {
    toast('Only the teacher can save the session log');
    return;
  }
  if (!state.questionTimings.length) {
    toast('No questions answered yet — start a practice first');
    return;
  }
  const total = state.correctCount + state.wrongCount;
  const accuracy = total ? +(state.correctCount / total).toFixed(3) : 0;
  const totalTimeSec = state.sessionStart ? Math.floor((Date.now() - state.sessionStart) / 1000) : 0;
  const studentName = (state.studentName || $('#inp-student-name')?.value || '').trim();
  const payload = {
    roomCode: state.roomCode || 'solo',
    studentName,
    startedAt: state.sessionStart ? new Date(state.sessionStart).toISOString() : null,
    totalTimeSec,
    score: state.score,
    streak: state.streak,
    correctCount: state.correctCount,
    wrongCount: state.wrongCount,
    accuracy,
    assistedCount: state.assistedCount,
    questions: state.questionTimings.map((t) => ({
      trickId: t.q.trickId,
      start: t.q.start,
      ops: t.q.ops,
      expected: t.q.answer,
      elapsedSec: +t.elapsed.toFixed(2),
      correct: t.correct,
    })),
  };
  try {
    const res = await fetch(`${backendBase()}/api/session-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    toast(j.ok ? '💾 Session saved' : 'Save failed');
  } catch (e) {
    toast('Save failed (offline?)');
  }
}

async function copyShareLink() {
  if (!state.roomCode) { toast('Create or join a room first'); return; }
  const url = buildShareUrl(state.roomCode);
  try {
    await navigator.clipboard.writeText(url);
    toast(`🔗 Copied: ${url}`);
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast(`🔗 Copied: ${url}`);
  }
}

// =============== LIBRARY UI ===============
function renderLibraryCategoryTabs() {
  const el = $('#library-cat-tabs');
  if (!el) return;
  el.innerHTML = '';
  EXERCISE_CATEGORIES.forEach(c => {
    const b = document.createElement('button');
    b.className = 'lib-cat-tab' + (c.id === state.activeLibraryCat ? ' active' : '');
    b.textContent = c.name;
    b.dataset.cat = c.id;
    b.addEventListener('click', () => {
      state.activeLibraryCat = c.id;
      renderLibraryCategoryTabs();
      renderLibraryCards();
    });
    el.appendChild(b);
  });
  const cat = EXERCISE_CATEGORIES.find(c => c.id === state.activeLibraryCat) || EXERCISE_CATEGORIES[0];
  $('#library-cat-desc').textContent = cat.desc;
}

function renderLibraryCards() {
  const el = $('#library-cards');
  if (!el) return;
  el.innerHTML = '';
  const items = EXERCISES.filter(e => e.cat === state.activeLibraryCat);
  if (!items.length) {
    el.innerHTML = '<div class="empty-state">No exercises in this category yet.</div>';
    return;
  }
  items.forEach(ex => {
    const card = document.createElement('div');
    card.className = 'lib-card';
    card.innerHTML = `
      <div class="lib-card-head">
        <span class="lib-badge">${ex.badge || ''}</span>
      </div>
      <div class="lib-title">${ex.title}</div>
      <div class="lib-sub">${ex.sub || ''}</div>
      <div class="lib-config">
        <span>${ex.config.count}× questions</span>
        <span>${ex.config.rows} rows</span>
        <span>${(ex.config.pace / 1000).toFixed(1)}s pace</span>
        ${ex.config.viz && ex.config.viz !== 'full' ? `<span>👁 ${ex.config.viz}</span>` : ''}
      </div>
      <button class="btn primary lib-launch">▶ Start</button>
    `;
    card.querySelector('.lib-launch').addEventListener('click', () => launchExercise(ex));
    el.appendChild(card);
  });
}

function launchExercise(ex) {
  const cfg = ex.config || {};
  const tricks = cfg.tricks ? cfg.tricks : (cfg.trick ? [cfg.trick] : ['direct_add']);
  const count = Math.max(1, cfg.count || 10);
  const rows = Math.max(2, cfg.rows || 5);
  const mode = cfg.mode || 'guided';
  // AUTONOMOUS: [ORDER-2] C9 — capture title for the persistent badge
  state.currentExerciseTitle = ex.title || '';
  setNowPracticing(state.currentExerciseTitle);

  // Reset session state
  state.allQuestions = [];
  for (let i = 0; i < count; i++) {
    const tid = tricks[Math.floor(Math.random() * tricks.length)];
    state.allQuestions.push(genQuestion(tid, rows));
  }
  state.currentQIndex = 0;
  state.currentMode = mode;
  state.score = 0; state.streak = 0;
  state.correctCount = 0; state.wrongCount = 0;
  state.assistedCount = 0;
  state.questionTimings = [];
  state.sessionStart = Date.now();
  state.rowsPerQuestion = rows;
  state.rowIntervalMs = cfg.pace || 2500;

  // Reflect into Advanced selectors so the user sees what's loaded
  if ($('#sel-rows-per-q')) $('#sel-rows-per-q').value = String(rows);
  if ($('#sel-row-interval')) $('#sel-row-interval').value = String(state.rowIntervalMs);
  if ($('#inp-qcount')) $('#inp-qcount').value = String(count);
  if ($('#sel-mode')) $('#sel-mode').value = mode;

  // Visibility / Anzan
  if (cfg.viz) setVisibility(cfg.viz);

  // Sidebar mode
  if (mode === 'recall') { setSidebarOpen(false); state.trickPanelVisible = false; }
  else { setSidebarOpen(true); state.trickPanelVisible = true; }

  startTimer();
  updatePills();
  loadQuestion();
  emitSession();
  toast(`▶ ${ex.title}`);
}

// AUTONOMOUS: [ORDER-2] C9 — surface the loaded exercise title in the
// practice header so the tutor always knows what set is loaded (the
// transient toast was the only previous indicator and it faded in 2s).
function setNowPracticing(title) {
  const el = $('#now-practicing');
  if (!el) return;
  if (!title) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden');
  el.textContent = `▶ ${title}`;
}

// =============== AUTONOMOUS: [ORDER-2] LOCAL SESSION SAVE/RESTORE ===============
// Practice state is held in memory; an accidental refresh wipes everything mid
// session. Auto-snapshot to localStorage and offer to resume on next load.
const LS_KEY = 'abacus-current-session-v1';
const LS_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function saveLocalSession() {
  if (!state.allQuestions.length) return;
  if (state.currentQIndex >= state.allQuestions.length) return; // already complete
  try {
    const payload = {
      v: 1, savedAt: Date.now(),
      title: state.currentExerciseTitle,
      allQuestions: state.allQuestions,
      currentQIndex: state.currentQIndex,
      currentMode: state.currentMode,
      score: state.score, streak: state.streak,
      correctCount: state.correctCount, wrongCount: state.wrongCount,
      assistedCount: state.assistedCount,
      sessionStart: state.sessionStart,
      questionTimings: state.questionTimings.map(t => ({
        // q is structurally JSON-safe (start, ops, answer, trickId)
        q: t.q, elapsed: t.elapsed, correct: t.correct,
      })),
      rowsPerQuestion: state.rowsPerQuestion,
      rowIntervalMs: state.rowIntervalMs,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch (_) {}
}
function clearLocalSession() {
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
}
function tryShowRestoreBanner() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) {}
  if (!p || p.v !== 1 || !Array.isArray(p.allQuestions) || !p.allQuestions.length) return;
  if (p.currentQIndex >= p.allQuestions.length) { clearLocalSession(); return; }
  if (Date.now() - (p.savedAt || 0) > LS_TTL_MS) { clearLocalSession(); return; }
  const banner = $('#restore-banner');
  if (!banner) return;
  const total = (p.correctCount || 0) + (p.wrongCount || 0);
  $('#restore-summary').textContent = `${p.title || 'practice'} — Q ${(p.currentQIndex || 0) + 1} of ${p.allQuestions.length} (${p.correctCount || 0}/${total} correct)`;
  banner.classList.remove('hidden');
  $('#btn-restore-yes').onclick = () => { restoreLocalSession(p); banner.classList.add('hidden'); };
  $('#btn-restore-no').onclick = () => { clearLocalSession(); banner.classList.add('hidden'); };
}
function restoreLocalSession(p) {
  state.allQuestions = p.allQuestions;
  state.currentQIndex = p.currentQIndex || 0;
  state.currentMode = p.currentMode || 'guided';
  state.score = p.score || 0;
  state.streak = p.streak || 0;
  state.correctCount = p.correctCount || 0;
  state.wrongCount = p.wrongCount || 0;
  state.assistedCount = p.assistedCount || 0;
  state.questionTimings = (p.questionTimings || []).map(t => ({ q: t.q, elapsed: t.elapsed, correct: t.correct }));
  state.sessionStart = p.sessionStart || Date.now();
  state.currentExerciseTitle = p.title || '';
  state.rowsPerQuestion = p.rowsPerQuestion || state.rowsPerQuestion;
  state.rowIntervalMs = p.rowIntervalMs ?? state.rowIntervalMs;
  setNowPracticing(state.currentExerciseTitle);
  startTimer();
  updatePills();
  loadQuestion();
  toast(`▶ Resumed: Q ${state.currentQIndex + 1}/${state.allQuestions.length}`);
}

// =============== TAB SWITCHING ===============
function switchPane(name) {
  state.activePane = name;
  $$('#tc-tabs .tc-tab').forEach(t => t.classList.toggle('active', t.dataset.pane === name));
  $$('.tc-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== name));
  if (name === 'progress') refreshProgressPanel();
  if (name === 'library') { renderLibraryCategoryTabs(); renderLibraryCards(); }
}

// AUTONOMOUS: [ORDER-2] live accuracy badge on the Progress tab so the tutor
// sees how the student is doing without leaving the Library pane.
function updateProgressTabBadge() {
  const tab = document.querySelector('#tc-tabs .tc-tab[data-pane="progress"]');
  if (!tab) return;
  const total = state.correctCount + state.wrongCount;
  if (!total) {
    tab.innerHTML = '📊 Progress';
    return;
  }
  const acc = Math.round((state.correctCount / total) * 100);
  const cls = acc >= 80 ? 'tab-badge ok' : acc >= 50 ? 'tab-badge warn' : 'tab-badge bad';
  tab.innerHTML = `📊 Progress <span class="${cls}">${acc}%</span>`;
}

// =============== PROGRESS PANEL ===============
function refreshProgressPanel() {
  // Live current-session stats
  const total = state.correctCount + state.wrongCount;
  $('#prog-correct').textContent = `${state.correctCount}/${total}`;
  $('#prog-accuracy').textContent = total ? `${Math.round((state.correctCount / total) * 100)}%` : '—';
  const avg = state.questionTimings.length
    ? (state.questionTimings.reduce((s, t) => s + t.elapsed, 0) / state.questionTimings.length)
    : 0;
  $('#prog-avg').textContent = avg ? `${avg.toFixed(1)}s` : '—';
  $('#prog-streak').textContent = state.streak;
  $('#prog-assisted').textContent = state.assistedCount;

  // Weak trick
  const byTrick = {};
  state.questionTimings.forEach(t => {
    const tid = t.q.trickId;
    byTrick[tid] = byTrick[tid] || { c: 0, n: 0 };
    byTrick[tid].n++;
    if (t.correct) byTrick[tid].c++;
  });
  let weak = null, weakAcc = 2;
  Object.entries(byTrick).forEach(([tid, d]) => {
    const acc = d.c / d.n;
    if (acc < weakAcc) { weakAcc = acc; weak = tid; }
  });
  $('#prog-weak').textContent = weak ? TRICKS[weak].name : '—';

  // Past sessions
  fetchPastSessions();
}

async function fetchPastSessions() {
  const el = $('#prog-history-list');
  if (!el) return;
  const name = (state.studentName || $('#inp-student-name')?.value || '').trim();
  const room = state.roomCode;
  let url;
  if (name) url = `${backendBase()}/api/sessions/by-student/${encodeURIComponent(name)}`;
  else if (room) url = `${backendBase()}/api/sessions/by-room/${encodeURIComponent(room)}`;
  else { el.innerHTML = '<div class="empty-state">Enter a student name (in the room bar) to load past sessions.</div>'; return; }

  try {
    const res = await fetch(url);
    const j = await res.json();
    if (!j.ok || !j.sessions || !j.sessions.length) {
      el.innerHTML = '<div class="empty-state">No saved sessions yet for this student.</div>';
      return;
    }
    const sum = j.summary || {};
    const sumHtml = `
      <div class="prog-summary">
        <span><b>${j.sessions.length}</b> sessions</span>
        <span><b>${sum.totalCorrect || 0}</b>/<b>${sum.totalQuestions || 0}</b> correct</span>
        <span>Avg accuracy: <b>${Math.round((sum.accuracy || 0) * 100)}%</b></span>
        <span>Time: <b>${formatHMS(sum.totalTimeSec || 0)}</b></span>
        ${sum.weakestTrick && TRICKS[sum.weakestTrick] ? `<span>⚠ Weak: <b>${TRICKS[sum.weakestTrick].name}</b></span>` : ''}
      </div>
    `;
    const rows = j.sessions
      .slice()
      .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
      .slice(0, 20)
      .map(s => {
        const acc = (s.correctCount || 0) + (s.wrongCount || 0)
          ? Math.round(((s.correctCount || 0) / ((s.correctCount || 0) + (s.wrongCount || 0))) * 100)
          : 0;
        const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '—';
        // AUTONOMOUS: [ORDER-1] C1 — escape stored fields before innerHTML.
        // The server now validates inputs (defense-in-depth), but old logs
        // written before validation may still contain unsafe strings.
        return `<div class="prog-history-row">
          <span class="ph-when">${escapeHtml(when)}</span>
          <span class="ph-stat">${s.correctCount || 0}/${(s.correctCount || 0) + (s.wrongCount || 0)} (${acc}%)</span>
          <span class="ph-stat">${escapeHtml(formatHMS(s.totalTimeSec || 0))}</span>
          <span class="ph-stat">Room ${escapeHtml(s.roomCode || '—')}</span>
        </div>`;
      }).join('');
    el.innerHTML = sumHtml + rows;
  } catch (e) {
    el.innerHTML = '<div class="empty-state">Could not fetch sessions (backend offline?).</div>';
  }
}

function formatHMS(secs) {
  secs = Math.max(0, Math.floor(secs));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// =============== UI WIRING ===============
function populateSelectors() {
  const levelSel = $('#sel-level');
  LEVELS.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.name;
    levelSel.appendChild(o);
  });
  levelSel.value = '1';
  refreshTrickOptions();
  levelSel.addEventListener('change', refreshTrickOptions);
}
function refreshTrickOptions() {
  const levelId = +$('#sel-level').value;
  const level = LEVELS.find(l => l.id === levelId);
  const sel = $('#sel-trick');
  sel.innerHTML = '<option value="auto">Auto (any in this level)</option>';
  level.tricks.forEach(tid => {
    const o = document.createElement('option');
    o.value = tid; o.textContent = TRICKS[tid].name;
    sel.appendChild(o);
  });
}

function wireEvents() {
  // Abacus
  $('#sel-rod-count').addEventListener('change', (e) => {
    state.rodCount = +e.target.value;
    initBeadsState(state.rodCount);
    renderAbacus();
    if (state.isInRoom && state.socket) state.socket.emit('rod-change', { rodCount: state.rodCount });
  });
  $('#btn-reset-abacus').addEventListener('click', () => {
    resetAbacus();
    if (state.isInRoom && state.socket) state.socket.emit('abacus-reset', {});
  });

  // Teacher
  $('#btn-generate').addEventListener('click', generatePractice);
  $('#btn-custom-toggle').addEventListener('click', () => {
    $('#custom-row').classList.toggle('hidden');
  });
  $('#btn-play-custom').addEventListener('click', () => {
    const v = $('#inp-custom').value.trim();
    const q = parseCustom(v);
    if (!q) { toast('Format: 5+3-2+7'); return; }
    state.allQuestions = [q]; state.currentQIndex = 0;
    state.currentMode = 'guided'; state.sessionStart = Date.now();
    startTimer(); loadQuestion(); emitSession();
  });
  $('#sel-speed').addEventListener('change', e => state.dictationSpeed = +e.target.value);
  $('#sel-lang').addEventListener('change', e => state.dictationLang = e.target.value);
  $('#sel-row-interval').addEventListener('change', e => state.rowIntervalMs = +e.target.value || 0);
  $('#btn-dict-play').addEventListener('click', () => playDictation()); // resume-or-restart
  $('#btn-dict-pause').addEventListener('click', pauseDictation);
  $('#btn-dict-repeat').addEventListener('click', repeatRow);
  $('#btn-dict-prev').addEventListener('click', previousStep);
  $('#chk-listening-mode').addEventListener('change', (e) => {
    setListeningMode(!!e.target.checked);
    // Reflect to the student via session-update so their reveals match
    if (state.isInRoom && state.role === 'teacher') emitSession();
  });

  // Anzan / ghost-bead visibility (teacher controls; broadcasts to student)
  $('#sel-visibility').addEventListener('change', (e) => setVisibility(e.target.value));

  // Demo — teacher animates the current question's solution
  $('#btn-demo-question').addEventListener('click', playDemoForCurrentQuestion);

  // Sound on/off
  $('#btn-toggle-sound').addEventListener('click', () => setSoundOn(!state.soundOn));

  // AUTONOMOUS: [ORDER-2] Mirror Mode toggle
  $('#btn-toggle-mirror').addEventListener('click', toggleMirrorMode);

  // Pane tabs (Library / Progress / Advanced)
  $$('#tc-tabs .tc-tab').forEach(t => {
    t.addEventListener('click', () => switchPane(t.dataset.pane));
  });

  // Refresh past sessions on demand
  $('#btn-refresh-history')?.addEventListener('click', refreshProgressPanel);

  // Capture student name into state on input
  $('#inp-student-name')?.addEventListener('input', (e) => {
    state.studentName = e.target.value.trim();
  });

  // Practice
  $('#btn-check').addEventListener('click', checkAnswer);
  $('#btn-next').addEventListener('click', nextQuestion);
  $('#btn-skip').addEventListener('click', skipQuestion);
  $('#btn-hint').addEventListener('click', () => {
    toast('💡 ' + (state.currentHint || 'Think about which trick fits.'));
    setSidebarOpen(true);
    if (state.currentTrickId) highlightTrickCard(state.currentTrickId);
  });
  $('#btn-stuck').addEventListener('click', () => {
    state.assistedCount++;
    setSidebarOpen(true);
    if (state.currentTrickId) highlightTrickCard(state.currentTrickId);
    toast('Showing panel (tagged: Assisted)');
  });

  // "Show Me" — student asks teacher for a demo, or self-plays solo.
  $('#btn-show-me').addEventListener('click', () => {
    if (state.role === 'student' && state.isInRoom && state.socket) {
      state.socket.emit('request-demo', {});
      toast('Asked teacher to demo');
      return;
    }
    // Solo (no room or teacher) → animate locally
    playDemoForCurrentQuestion();
  });
  $('#inp-answer').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkAnswer();
  });

  // Sidebar
  $('#btn-open-sidebar').addEventListener('click', () => setSidebarOpen(true));
  $('#btn-close-sidebar').addEventListener('click', () => setSidebarOpen(false));
  $('#btn-toggle-panel').addEventListener('click', () => {
    const open = !$('#sidebar').classList.contains('open');
    setSidebarOpen(open);
    $('#btn-toggle-panel').textContent = open ? 'Hide Panel (Recall)' : 'Show Panel (Assisted)';
  });
  $('#btn-pin-trick').addEventListener('click', () => {
    state.pinnedTrick = state.currentTrickId;
    toast(state.pinnedTrick ? `📌 Pinned: ${TRICKS[state.pinnedTrick].name}` : 'Nothing to pin');
  });

  // Room
  $('#btn-create-room').addEventListener('click', createRoom);
  $('#btn-join-room').addEventListener('click', () => joinRoom($('#inp-join-code').value.trim()));
  $('#btn-copy-link').addEventListener('click', copyShareLink);
  $('#btn-leave-room').addEventListener('click', leaveRoom);
  $('#room-code-display').addEventListener('click', copyShareLink);

  // Set abacus value (teacher and offline)
  $('#btn-set-value').addEventListener('click', () => {
    const v = parseInt($('#inp-set-value').value, 10);
    if (Number.isNaN(v) || v < 0) { toast('Enter a non-negative number'); return; }
    setAbacusValue(v);
  });
  $('#inp-set-value').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-set-value').click();
  });

  // Lock / unlock student
  $('#btn-toggle-lock').addEventListener('click', () => {
    if (!state.isInRoom || state.role !== 'teacher' || !state.socket) {
      toast('Create a room first to manage student access'); return;
    }
    const next = !state.studentLocked;
    state.socket.emit('set-lock', { locked: next }, (resp) => {
      if (resp && resp.ok) {
        state.studentLocked = !!resp.locked;
        renderLockState();
      }
    });
  });

  // Push a free-text question to the student
  $('#btn-push-q').addEventListener('click', () => {
    if (!state.isInRoom || state.role !== 'teacher' || !state.socket) {
      toast('Create a room first'); return;
    }
    const text = $('#inp-push-q').value.trim();
    if (!text) { toast('Type a question'); return; }
    // AUTONOMOUS: [ORDER-1] C6 — replace Function() eval with a deterministic
    // recursive-descent parser. The regex was already tight, but eval is a
    // footgun — anyone widening the regex later would create a real RCE.
    const m = text.match(/^([\d+\-*/\s().]+?)\s*=\s*\?\s*$/);
    let expected = null;
    if (m) {
      try { expected = safeArithmetic(m[1]); } catch (_) {}
    }
    const q = { text, expected, pushedAt: Date.now() };
    state.pushedQuestion = q;
    state.socket.emit('push-question', q);
    renderPushedQuestion();
    toast('📤 Pushed to student');
  });

  // Save current session summary to backend log
  $('#btn-save-log').addEventListener('click', saveSessionLog);

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
      if (e.key === 'Enter' && document.activeElement.id === 'inp-answer') return; // handled
      return;
    }
    if (e.key === 'Enter') { checkAnswer(); }
    else if (e.key === 'n' || e.key === 'N') { nextQuestion(); }
    else if (e.key === 'h' || e.key === 'H') { $('#btn-hint').click(); }
    else if (e.key === 'r' || e.key === 'R') { resetAbacus(); }
    // AUTONOMOUS: [ORDER-2] Z to undo last bead move (also Ctrl/Cmd+Z)
    else if (e.key === 'z' || e.key === 'Z' || ((e.ctrlKey || e.metaKey) && e.key === 'z')) {
      e.preventDefault();
      undoBeadMove();
    }
    else if (e.key === 'Escape') { setSidebarOpen(false); }
  });

  // Auto-join from URL ?room=CODE
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get('room');
  if (roomFromUrl) {
    setTimeout(() => joinRoom(roomFromUrl), 300);
  }

  // Window resize to recompute bead positions
  window.addEventListener('resize', () => updateAllBeadPositions());
}

// =============== BOOT ===============
document.addEventListener('DOMContentLoaded', () => {
  initBeadsState(state.rodCount);
  renderAbacus();
  renderFormulaSidebar();
  populateSelectors();
  wireEvents();
  updatePills();
  setSoundOn(true);
  setConnStatus('offline');
  renderLibraryCategoryTabs();
  renderLibraryCards();
  wireWhiteboard();
  // AUTONOMOUS: [ORDER-2] offer to resume an interrupted session
  tryShowRestoreBanner();
  // Give layout a frame then recompute positions (zone heights now known)
  requestAnimationFrame(() => updateAllBeadPositions());
});
