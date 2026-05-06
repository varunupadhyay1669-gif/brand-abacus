// Abacus Studio backend - Express + Socket.IO
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;
const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(__dirname, 'session-logs.json');
const LOG_FILE_TMP = LOG_FILE + '.tmp';
const MAX_LOG_ENTRIES = 2000;       // AUTONOMOUS: [ORDER-4] FP1 — cap log file growth
const MAX_BEADS_PER_UPDATE = 30;    // AUTONOMOUS: [ORDER-4] FP3 — cap rod count payload

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// AUTONOMOUS: [ORDER-1] defense-in-depth security headers. Server-side input
// validation is the primary XSS defense; CSP is a second line that limits
// blast radius if an unsanitized field slips through. unsafe-inline on style-src
// is unavoidable here because the bead positioning sets `style="transform:..."`
// inline on every render. script-src does NOT allow unsafe-inline.
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.socket.io",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Serve frontend statics from repo root
app.use(express.static(ROOT));

// Rooms: Map<code, { teacherId, students:Set<socketId>, state, lastActivity }>
// state: { abacusValue, rodCount, beadsState, studentLocked, currentQuestion }
const rooms = new Map();

function defaultState() {
  return {
    abacusValue: 0,
    rodCount: 7,
    beadsState: [],
    studentLocked: true, // students start in view-only mode
    currentQuestion: null,
    visibility: 'full', // 'full' | 'fade50' | 'fade20' | 'hidden' (Anzan / mental-abacus mode)
  };
}

// AUTONOMOUS: [ORDER-1] C5 — serialize log writes through a single-flight queue
// so concurrent POSTs don't read-modify-write over each other. Atomic via
// write-temp-then-rename so a crash mid-write doesn't corrupt the file.
let logWriteChain = Promise.resolve();
function appendSessionLog(entry) {
  logWriteChain = logWriteChain.then(() => new Promise((resolve) => {
    try {
      let arr = [];
      if (fs.existsSync(LOG_FILE)) {
        try { arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch (_) { arr = []; }
      }
      arr.push({ ...entry, savedAt: new Date().toISOString() });
      // FP1: trim to last MAX_LOG_ENTRIES
      if (arr.length > MAX_LOG_ENTRIES) arr = arr.slice(arr.length - MAX_LOG_ENTRIES);
      fs.writeFileSync(LOG_FILE_TMP, JSON.stringify(arr, null, 2));
      fs.renameSync(LOG_FILE_TMP, LOG_FILE);
      resolve(true);
    } catch (e) {
      console.error('session log write failed', e);
      try { fs.existsSync(LOG_FILE_TMP) && fs.unlinkSync(LOG_FILE_TMP); } catch (_) {}
      resolve(false);
    }
  }));
  return logWriteChain;
}

// AUTONOMOUS: [ORDER-1] C2 — strict validation/sanitization for session-log POST.
// Anything written here is later rendered in the Progress panel; without these
// checks a malicious POST can store an XSS payload that fires for every teacher.
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s._@'\-]{0,64}$/u; // letters, digits, spaces, common punct
const SAFE_ROOM_RE = /^[A-Z0-9]{1,12}$|^solo$/;
function safeText(v, max = 64) {
  if (typeof v !== 'string') return '';
  const s = v.trim().slice(0, max);
  return SAFE_TEXT_RE.test(s) ? s : '';
}
function clampNum(v, lo, hi) { v = +v || 0; return Math.max(lo, Math.min(hi, v)); }
function sanitizeSessionLog(body) {
  if (!body || typeof body !== 'object') return null;
  const roomCode = (body.roomCode || '').toString().toUpperCase();
  if (!SAFE_ROOM_RE.test(roomCode)) return null;
  const out = {
    roomCode,
    studentName: safeText(body.studentName, 64),
    startedAt: typeof body.startedAt === 'string' ? body.startedAt.slice(0, 40) : null,
    totalTimeSec: clampNum(body.totalTimeSec, 0, 24 * 3600),
    score: clampNum(body.score, 0, 1e6),
    streak: clampNum(body.streak, 0, 1000),
    correctCount: clampNum(body.correctCount, 0, 5000),
    wrongCount: clampNum(body.wrongCount, 0, 5000),
    accuracy: Math.max(0, Math.min(1, +body.accuracy || 0)),
    assistedCount: clampNum(body.assistedCount, 0, 5000),
    questions: Array.isArray(body.questions) ? body.questions.slice(0, 200).map(q => ({
      trickId: safeText(q.trickId, 40),
      start: clampNum(q.start, 0, 1e12),
      ops: Array.isArray(q.ops) ? q.ops.slice(0, 50).map(o => ({
        op: o.op === '+' || o.op === '-' ? o.op : '+',
        n: clampNum(o.n, 0, 9999),
      })) : [],
      expected: clampNum(q.expected, -1e12, 1e12),
      elapsedSec: Math.max(0, +q.elapsedSec || 0),
      correct: !!q.correct,
    })) : [],
  };
  return out;
}

// 6-char code, exclude O 0 I 1
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return rooms.has(c) ? genCode() : c;
}

function touch(code) {
  const r = rooms.get(code);
  if (r) r.lastActivity = Date.now();
}

// 2-hour TTL cleanup
setInterval(() => {
  const now = Date.now();
  const TTL = 2 * 60 * 60 * 1000;
  for (const [code, r] of rooms.entries()) {
    if (now - r.lastActivity > TTL) {
      io.to(code).emit('room-expired', { code });
      rooms.delete(code);
    }
  }
}, 60 * 1000);

// Share link helper endpoints
app.get('/join/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  res.redirect(`/?room=${encodeURIComponent(code)}`);
});

app.get('/api/room-info/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const r = rooms.get(code);
  if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({
    ok: true,
    code,
    studentCount: r.students.size,
    hasTeacher: !!r.teacherId,
    lastActivity: r.lastActivity
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// Persist a session summary (questions, answers, time, accuracy).
// MVP storage: JSON file on disk. Drop-in replace with Postgres/Supabase later.
app.post('/api/session-log', async (req, res) => {
  // AUTONOMOUS: [ORDER-1] C2 — sanitize before persisting
  const clean = sanitizeSessionLog(req.body);
  if (!clean) return res.status(400).json({ ok: false, error: 'invalid_payload' });
  const ok = await appendSessionLog(clean);
  res.json({ ok });
});

app.get('/api/session-logs', (_req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json({ ok: true, logs: [] });
    const arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    res.json({ ok: true, logs: arr });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'read_failed' });
  }
});

// Sessions filtered by student name (case-insensitive). For the Progress panel.
app.get('/api/sessions/by-student/:name', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json({ ok: true, sessions: [], summary: emptySummary() });
    const arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    const want = (req.params.name || '').trim().toLowerCase();
    const sessions = arr.filter(s => (s.studentName || '').toLowerCase() === want);
    res.json({ ok: true, sessions, summary: summarizeSessions(sessions) });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'read_failed' });
  }
});

// Sessions for a given room (one-shot: any session that ran in this room code).
app.get('/api/sessions/by-room/:code', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json({ ok: true, sessions: [], summary: emptySummary() });
    const arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    const want = (req.params.code || '').toUpperCase();
    const sessions = arr.filter(s => (s.roomCode || '').toUpperCase() === want);
    res.json({ ok: true, sessions, summary: summarizeSessions(sessions) });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'read_failed' });
  }
});

function emptySummary() {
  return { totalSessions: 0, totalQuestions: 0, totalCorrect: 0, accuracy: 0, totalTimeSec: 0, weakestTrick: null };
}
function summarizeSessions(sessions) {
  if (!sessions.length) return emptySummary();
  let q = 0, c = 0, t = 0;
  const trickStats = {};
  for (const s of sessions) {
    q += (s.correctCount || 0) + (s.wrongCount || 0);
    c += (s.correctCount || 0);
    t += (s.totalTimeSec || 0);
    for (const qq of (s.questions || [])) {
      if (!qq.trickId) continue;
      const ts = trickStats[qq.trickId] = trickStats[qq.trickId] || { c: 0, n: 0 };
      ts.n++;
      if (qq.correct) ts.c++;
    }
  }
  let weakestTrick = null, weakAcc = 2;
  for (const [tid, ts] of Object.entries(trickStats)) {
    const acc = ts.n ? ts.c / ts.n : 1;
    if (acc < weakAcc) { weakAcc = acc; weakestTrick = tid; }
  }
  return {
    totalSessions: sessions.length,
    totalQuestions: q,
    totalCorrect: c,
    accuracy: q ? +(c / q).toFixed(3) : 0,
    totalTimeSec: t,
    weakestTrick,
  };
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

io.on('connection', (socket) => {
  let joinedCode = null;
  let role = null;

  socket.on('create-room', (_payload, ack) => {
    const code = genCode();
    // AUTONOMOUS: [ORDER-1] C4 — issue a teacher token at room creation. Only
    // a client that presents this token can later claim teacher role on
    // rejoin. Stops a malicious peer from hijacking after the teacher's
    // socket drops momentarily.
    const teacherToken = crypto.randomBytes(16).toString('hex');
    rooms.set(code, {
      teacherId: socket.id,
      teacherToken,
      students: new Set(),
      state: defaultState(),
      lastActivity: Date.now()
    });
    socket.join(code);
    joinedCode = code;
    role = 'teacher';
    ack && ack({ ok: true, code, teacherToken });
    io.to(code).emit('user-count-update', { teacher: 1, students: 0 });
  });

  socket.on('join-room', ({ code, asRole, teacherToken } = {}, ack) => {
    code = (code || '').toUpperCase();
    const r = rooms.get(code);
    if (!r) { ack && ack({ ok: false, error: 'not_found' }); return; }
    socket.join(code);
    joinedCode = code;
    // AUTONOMOUS: [ORDER-1] C4 — only honor asRole='teacher' when the right
    // token is presented. Anyone else falls back to student.
    const tokenOk = teacherToken && r.teacherToken && teacherToken === r.teacherToken;
    if (asRole === 'teacher' && tokenOk) {
      r.teacherId = socket.id;
      role = 'teacher';
    } else {
      r.students.add(socket.id);
      role = 'student';
      socket.to(code).emit('student-joined', { id: socket.id });
    }
    touch(code);
    ack && ack({ ok: true, code, role, state: r.state });
    io.to(code).emit('user-count-update', {
      teacher: r.teacherId ? 1 : 0,
      students: r.students.size
    });
  });

  socket.on('leave-room', () => leave());

  function leave() {
    if (!joinedCode) return;
    const r = rooms.get(joinedCode);
    if (r) {
      if (r.teacherId === socket.id) {
        r.teacherId = null;
        socket.to(joinedCode).emit('teacher-left', {});
      } else {
        r.students.delete(socket.id);
        socket.to(joinedCode).emit('student-left', { id: socket.id });
      }
      io.to(joinedCode).emit('user-count-update', {
        teacher: r.teacherId ? 1 : 0,
        students: r.students.size
      });
      if (!r.teacherId && r.students.size === 0) rooms.delete(joinedCode);
    }
    socket.leave(joinedCode);
    joinedCode = null;
    role = null;
  }

  socket.on('disconnect', leave);

  function getRoom() {
    if (!joinedCode) return null;
    return rooms.get(joinedCode) || null;
  }
  function isTeacher() {
    const r = getRoom();
    return !!r && r.teacherId === socket.id;
  }
  function ack(cb, payload) { try { cb && cb(payload); } catch (_) {} }

  // ---- Bead manipulation: gated by lock for students ----
  // AUTONOMOUS: [ORDER-4] FP2 — per-socket throttle for bead-update so a buggy
  // or malicious client can't fan out > ~30 updates/sec. Drops silently when
  // breaching; the next legitimate update will catch up authoritative state.
  let lastBeadUpdateAt = 0;
  socket.on('bead-update', (data, cb) => {
    const now = Date.now();
    if (now - lastBeadUpdateAt < 30) return ack(cb, { ok: false, error: 'throttled' });
    lastBeadUpdateAt = now;
    const r = getRoom();
    if (!r) return ack(cb, { ok: false, error: 'no_room' });
    if (!isTeacher() && r.state.studentLocked) {
      socket.emit('bead-update', { rodCount: r.state.rodCount, beadsState: r.state.beadsState });
      return ack(cb, { ok: false, error: 'locked' });
    }
    // AUTONOMOUS: [ORDER-4] FP3 — cap payload size to prevent memory abuse
    if (data && Array.isArray(data.beadsState) && data.beadsState.length > MAX_BEADS_PER_UPDATE) {
      return ack(cb, { ok: false, error: 'too_many_rods' });
    }
    r.state.rodCount = (data && data.rodCount) || r.state.rodCount;
    r.state.beadsState = (data && data.beadsState) || r.state.beadsState;
    touch(joinedCode);
    socket.to(joinedCode).emit('bead-update', data);
    ack(cb, { ok: true });
  });

  socket.on('abacus-reset', (data, cb) => {
    const r = getRoom();
    if (!r) return ack(cb, { ok: false, error: 'no_room' });
    if (!isTeacher() && r.state.studentLocked) return ack(cb, { ok: false, error: 'locked' });
    touch(joinedCode);
    socket.to(joinedCode).emit('abacus-reset', data || {});
    ack(cb, { ok: true });
  });

  socket.on('rod-change', (data, cb) => {
    if (!isTeacher()) return ack(cb, { ok: false, error: 'teacher_only' });
    const r = getRoom();
    if (!r) return ack(cb, { ok: false, error: 'no_room' });
    r.state.rodCount = data.rodCount;
    r.state.beadsState = []; // reinitialized client-side
    touch(joinedCode);
    socket.to(joinedCode).emit('rod-change', data);
    ack(cb, { ok: true });
  });

  // ---- Teacher-only authoritative actions ----
  socket.on('set-lock', ({ locked } = {}, cb) => {
    if (!isTeacher()) return ack(cb, { ok: false, error: 'teacher_only' });
    const r = getRoom(); if (!r) return ack(cb, { ok: false, error: 'no_room' });
    r.state.studentLocked = !!locked;
    touch(joinedCode);
    io.to(joinedCode).emit('lock-update', { locked: r.state.studentLocked });
    ack(cb, { ok: true, locked: r.state.studentLocked });
  });

  socket.on('set-value', (data, cb) => {
    if (!isTeacher()) return ack(cb, { ok: false, error: 'teacher_only' });
    const r = getRoom(); if (!r) return ack(cb, { ok: false, error: 'no_room' });
    r.state.beadsState = (data && data.beadsState) || r.state.beadsState;
    r.state.rodCount = (data && data.rodCount) || r.state.rodCount;
    touch(joinedCode);
    io.to(joinedCode).emit('set-value', {
      rodCount: r.state.rodCount,
      beadsState: r.state.beadsState,
      value: data && data.value,
    });
    ack(cb, { ok: true });
  });

  socket.on('push-question', (data, cb) => {
    if (!isTeacher()) return ack(cb, { ok: false, error: 'teacher_only' });
    const r = getRoom(); if (!r) return ack(cb, { ok: false, error: 'no_room' });
    r.state.currentQuestion = data || null;
    touch(joinedCode);
    io.to(joinedCode).emit('push-question', data);
    ack(cb, { ok: true });
  });

  // ---- Student → teacher answer relay ----
  socket.on('student-answer', (data, cb) => {
    const r = getRoom(); if (!r) return ack(cb, { ok: false, error: 'no_room' });
    if (r.teacherId) io.to(r.teacherId).emit('student-answer', { ...data, fromId: socket.id });
    touch(joinedCode);
    ack(cb, { ok: true });
  });

  // ---- Pure relays (no state mutation, no gating) ----
  ['session-update', 'scroll-sync', 'force-sync'].forEach((ev) => {
    socket.on(ev, (data) => {
      if (!joinedCode) return;
      touch(joinedCode);
      socket.to(joinedCode).emit(ev, data);
    });
  });

  // ---- Teacher → Student: pointer/finger position (the "wall abacus" effect) ----
  socket.on('teacher-pointer', (data) => {
    if (!isTeacher()) return;
    if (!joinedCode) return;
    touch(joinedCode);
    socket.to(joinedCode).emit('teacher-pointer', data || {});
  });

  // ---- Anzan / bead visibility mode (teacher-authoritative) ----
  socket.on('set-visibility', ({ visibility } = {}, cb) => {
    if (!isTeacher()) return ack(cb, { ok: false, error: 'teacher_only' });
    const r = getRoom(); if (!r) return ack(cb, { ok: false, error: 'no_room' });
    const allowed = ['full', 'fade50', 'fade20', 'hidden'];
    if (!allowed.includes(visibility)) return ack(cb, { ok: false, error: 'bad_visibility' });
    r.state.visibility = visibility;
    touch(joinedCode);
    io.to(joinedCode).emit('set-visibility', { visibility });
    ack(cb, { ok: true, visibility });
  });

  // ---- Student → Teacher: "I'm stuck, show me" ----
  socket.on('request-demo', (data, cb) => {
    const r = getRoom(); if (!r) return ack(cb, { ok: false, error: 'no_room' });
    if (r.teacherId) io.to(r.teacherId).emit('request-demo', { ...(data || {}), fromId: socket.id });
    touch(joinedCode);
    ack(cb, { ok: true });
  });

  // ---- Demo replay: teacher steps through ops; each step broadcasts beads to all ----
  socket.on('demo-step', (data, cb) => {
    if (!isTeacher()) return ack(cb, { ok: false, error: 'teacher_only' });
    const r = getRoom(); if (!r) return ack(cb, { ok: false, error: 'no_room' });
    if (data && data.beadsState) {
      r.state.beadsState = data.beadsState;
      r.state.rodCount = data.rodCount || r.state.rodCount;
    }
    touch(joinedCode);
    io.to(joinedCode).emit('demo-step', data || {});
    ack(cb, { ok: true });
  });
});

server.listen(PORT, () => {
  console.log(`Abacus Studio backend listening on :${PORT}`);
});
