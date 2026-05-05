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
};

// =============== TRICKS ===============
const TRICKS = {
  direct_add: {
    id: 'direct_add',
    name: '+1 to +4 Direct',
    why: 'Lower beads are free, so add directly.',
    visual: '+3 → move 3 lower beads up',
    level: 1,
  },
  direct_sub: {
    id: 'direct_sub',
    name: '−1 to −4 Direct',
    why: 'Lower beads are on, so minus directly.',
    visual: '−2 → move 2 lower beads down',
    level: 2,
  },
  plus5_direct: {
    id: 'plus5_direct',
    name: '+5 Use 5-bead',
    why: 'No more lower beads free — use the 5-bead.',
    visual: '+5 → drop heaven bead',
    level: 1,
  },
  minus5_direct: {
    id: 'minus5_direct',
    name: '−5 Use 5-bead',
    why: 'Remove the 5-bead only.',
    visual: '−5 → lift heaven bead',
    level: 2,
  },
  small_friend_add: {
    id: 'small_friend_add',
    name: '+1..+4 Small Friend (5-complement)',
    why: 'No room for lower beads — use +5 then subtract the small friend.',
    visual: '+4 = +5 −1',
    level: 3,
  },
  small_friend_sub: {
    id: 'small_friend_sub',
    name: '−1..−4 Small Friend',
    why: 'Not enough lower beads — use −5 then add the small friend.',
    visual: '−4 = −5 +1',
    level: 4,
  },
  big_friend_add: {
    id: 'big_friend_add',
    name: '+6..+9 Big Friend (10-complement)',
    why: 'For +9, do +10 −1 because 9 is near 10.',
    visual: '+9 = +10 −1',
    level: 5,
  },
  big_friend_sub: {
    id: 'big_friend_sub',
    name: '−6..−9 Big Friend',
    why: 'For −9, do −10 +1 — borrow from the next rod.',
    visual: '−9 = −10 +1',
    level: 6,
  },
  mix_friend: {
    id: 'mix_friend',
    name: 'Mix Friend (combined 5+10 complement)',
    why: 'When small friend fails, combine with 10-complement.',
    visual: '+7 on 4 = +10 −3',
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

function renderAbacus() {
  const frame = $('#abacus-frame');
  frame.innerHTML = '';
  const count = state.rodCount;
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
    const ub = makeBead(r, 'upper', 0);
    upperZone.appendChild(ub);

    // Lower beads: index 3 (top) to 0 (bottom) in DOM order so visually stacked bottom-up
    for (let i = 3; i >= 0; i--) {
      lowerZone.appendChild(makeBead(r, 'lower', i));
    }

    frame.appendChild(rod);
  }
  updateAllBeadPositions();
}

function makeBead(rod, zone, index) {
  const b = document.createElement('div');
  b.className = 'bead';
  b.dataset.rod = rod;
  b.dataset.zone = zone;
  b.dataset.index = index; // for lower: 0=bottom, 3=top; for upper: 0
  attachBeadPointer(b);
  return b;
}

function updateAllBeadPositions() {
  const count = state.rodCount;
  for (let r = 0; r < count; r++) updateRodVisual(r);
  recomputeValue();
}

// Visual gap each active bead leaves between its surface and the crossbar.
// Combined with the crossbar's own thickness this gives clear "above the line /
// below the line" separation regardless of zone height.
const BEAD_CROSSBAR_GAP = 6;
const CROSSBAR_THICKNESS = 3; // matches .crossbar { height:3px }

function updateRodVisual(r) {
  const rodEl = $(`.rod[data-rod="${r}"]`);
  if (!rodEl) return;
  const s = state.beadsState[r];
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

function recomputeValue() {
  let total = 0;
  const n = state.rodCount;
  for (let r = 0; r < n; r++) {
    const s = state.beadsState[r];
    const rodVal = (s.upper ? 5 : 0) + s.lower.filter(Boolean).length;
    const place = Math.pow(10, n - 1 - r);
    total += rodVal * place;
  }
  state.abacusValue = total;
  $('#abacus-value').textContent = total.toLocaleString();
}

function resetAbacus() {
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
  // A student in a room cannot manipulate beads while locked.
  return state.isInRoom && state.role === 'student' && state.studentLocked;
}

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
    emitBeadSync();
  };

  bead.addEventListener('pointerdown', onDown);
  bead.addEventListener('pointermove', onMove);
  bead.addEventListener('pointerup', onUp);
  bead.addEventListener('pointercancel', onUp);
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
    toast('✓ Correct!');
  } else {
    state.streak = 0; state.wrongCount += 1;
    toast(`✗ Expected ${state.expectedAnswer}`);
  }
  if (state.currentMode === 'guided') state.guidedAccuracy.total++;
  updatePills();
  // Show the "why" line every time
  const wl = $('#why-line');
  wl.textContent = `Why this trick? ${state.whyLine}`;
  wl.classList.remove('hidden');

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
  state.currentQIndex += 1;
  if (state.currentQIndex >= state.allQuestions.length) showSummary();
  else loadQuestion();
  emitSession();
}

function skipQuestion() {
  state.wrongCount += 1;
  state.streak = 0;
  updatePills();
  nextQuestion();
}

function showSummary() {
  stopTimer();
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

  const html = `
    <h4>Session Insights</h4>
    <div>✅ Correct: <b>${state.correctCount} / ${total}</b></div>
    <div>⏱ Avg time per question: <b>${avg}s</b></div>
    <div>📈 Final streak: <b>${state.streak}</b></div>
    ${weak ? `<div>⚠ Weak Trick: <b>${TRICKS[weak].name}</b> → Practice more</div>` : ''}
    ${state.assistedCount ? `<div>🆘 Assisted: ${state.assistedCount}</div>` : ''}
    ${longest ? `<div style="margin-top:8px">🔬 Deep-dive: longest question took ${longest.elapsed.toFixed(1)}s —
      <i>${TRICKS[longest.q.trickId].why}</i></div>` : ''}
  `;
  const ss = $('#session-summary');
  ss.innerHTML = html; ss.classList.remove('hidden');
  $('#q-column').innerHTML = `<div class="empty-state">🎉 Session complete! See insights below.</div>`;
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

async function playDictation(startIdx = 0) {
  const q = state.allQuestions[state.currentQIndex];
  if (!q) return;
  state.dictationPaused = false;
  const seq = [q.start.toString(), ...q.ops.map(o => (o.op === '+' ? 'plus ' : 'minus ') + o.n)];
  state.dictationQueue = seq;
  for (let i = startIdx; i < seq.length; i++) {
    if (state.dictationPaused) { state.dictationIdx = i; return; }
    state.dictationIdx = i;
    await speakText(seq[i], state.dictationLang, state.dictationSpeed);
  }
}
function pauseDictation() { state.dictationPaused = true; try{speechSynthesis.cancel();}catch(_){} }
function repeatRow() {
  try { speechSynthesis.cancel(); } catch(_){}
  playDictation(state.dictationIdx);
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

  s.on('connect', () => console.log('socket connected', s.id));
  s.on('disconnect', () => console.log('socket disconnected'));

  s.on('bead-update', (data) => {
    if (!data) return;
    state.suppressRemoteUpdate = true;
    state.rodCount = data.rodCount || state.rodCount;
    state.beadsState = data.beadsState || state.beadsState;
    $('#sel-rod-count').value = state.rodCount;
    renderAbacus();
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
    state.rodCount = data.rodCount || state.rodCount;
    state.beadsState = data.beadsState || state.beadsState;
    $('#sel-rod-count').value = state.rodCount;
    renderAbacus();
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

function createRoom() {
  initSocket();
  state.socket.emit('create-room', {}, (resp) => {
    if (!resp?.ok) { toast('Could not create room'); return; }
    enterRoom(resp.code, 'teacher');
  });
}

function joinRoom(code) {
  if (!code) { toast('Enter a room code'); return; }
  initSocket();
  state.socket.emit('join-room', { code: code.toUpperCase(), asRole: 'student' }, (resp) => {
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
      renderLockState();
      renderPushedQuestion();
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
}

function emitBeadSync() {
  if (!state.isInRoom || !state.socket || state.suppressRemoteUpdate) return;
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
  });
}

async function saveSessionLog() {
  if (!state.isInRoom || state.role !== 'teacher') {
    toast('Only the teacher can save the session log');
    return;
  }
  const total = state.correctCount + state.wrongCount;
  const accuracy = total ? +(state.correctCount / total).toFixed(3) : 0;
  const totalTimeSec = state.sessionStart ? Math.floor((Date.now() - state.sessionStart) / 1000) : 0;
  const payload = {
    roomCode: state.roomCode,
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
  $('#btn-dict-play').addEventListener('click', () => playDictation(0));
  $('#btn-dict-pause').addEventListener('click', pauseDictation);
  $('#btn-dict-repeat').addEventListener('click', repeatRow);

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
    // Try to parse "expression = ?" style, e.g. "7 + 5 = ?"
    const m = text.match(/^([\d+\-*/\s]+?)\s*=\s*\?\s*$/);
    let expected = null;
    if (m) {
      try { expected = Function(`"use strict"; return (${m[1]});`)(); } catch (_) {}
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
  // Give layout a frame then recompute positions (zone heights now known)
  requestAnimationFrame(() => updateAllBeadPositions());
});
