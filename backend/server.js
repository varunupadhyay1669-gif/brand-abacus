// Abacus Studio backend - Express + Socket.IO
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;
const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(__dirname, 'session-logs.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

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

function appendSessionLog(entry) {
  try {
    let arr = [];
    if (fs.existsSync(LOG_FILE)) {
      try { arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch (_) { arr = []; }
    }
    arr.push({ ...entry, savedAt: new Date().toISOString() });
    fs.writeFileSync(LOG_FILE, JSON.stringify(arr, null, 2));
    return true;
  } catch (e) {
    console.error('session log write failed', e);
    return false;
  }
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
app.post('/api/session-log', (req, res) => {
  const body = req.body || {};
  if (!body.roomCode) return res.status(400).json({ ok: false, error: 'missing_roomCode' });
  const ok = appendSessionLog(body);
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
    rooms.set(code, {
      teacherId: socket.id,
      students: new Set(),
      state: defaultState(),
      lastActivity: Date.now()
    });
    socket.join(code);
    joinedCode = code;
    role = 'teacher';
    ack && ack({ ok: true, code });
    io.to(code).emit('user-count-update', { teacher: 1, students: 0 });
  });

  socket.on('join-room', ({ code, asRole } = {}, ack) => {
    code = (code || '').toUpperCase();
    const r = rooms.get(code);
    if (!r) { ack && ack({ ok: false, error: 'not_found' }); return; }
    socket.join(code);
    joinedCode = code;
    if (asRole === 'teacher' && !r.teacherId) {
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
  socket.on('bead-update', (data, cb) => {
    const r = getRoom();
    if (!r) return ack(cb, { ok: false, error: 'no_room' });
    if (!isTeacher() && r.state.studentLocked) {
      // Reassert authoritative state to the offending student so their UI reverts
      socket.emit('bead-update', { rodCount: r.state.rodCount, beadsState: r.state.beadsState });
      return ack(cb, { ok: false, error: 'locked' });
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
