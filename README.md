# Abacus Studio

A real-time, **formula-first** soroban learning platform for teachers and students (ages 7–12, Levels 1–2 focus, scales to Level 13).

**Core USP:** we teach *which trick to use*, not just the answer. Every solved question shows a one-line "Why This Trick?" explanation.

---

## Features

- **Interactive drag-based soroban** — realistic bead physics with pointer events (mouse + touch), 5px tap/drag threshold, active beads flush against crossbar.
- **Configurable rods**: 3, 5, 7 (default), 9, 11, 13 — with place-value labels.
- **Formula Reference sidebar** — all 34 formulas (MVP: 6 core tricks pinned with static visual).
- **3 practice modes**:
  1. **Guided** — panel visible, one trick per set.
  2. **Recall** — panel auto-hidden. "I'm Stuck" reveals it and tags the question as Assisted.
  3. **Mixed** — unlocks after 80% Guided accuracy.
- **Question engine** covering Levels 1–13 (Direct, Small Friend, Big Friend, Mix Friend, multi-digit, speed drills).
- **Custom sequence input** — e.g. `5+3-2+7`, plays step-by-step.
- **Dictation engine** — English (IN) + Hindi TTS with 0.75x/1x/1.5x/2x speeds, Play/Pause/Repeat row.
- **Session insights** — score, avg time, weak trick, deep-dive on longest question.
- **Real-time collaboration** — Socket.IO rooms, 6-char codes, 2-hour TTL, student-mode UI hiding.
- **Defensive share link** — works from `file://`, GitHub Pages, and same-origin.
- **Keyboard shortcuts** — Enter (Check), N (Next), H (Hint), R (Reset), Esc (Close sidebar).
- **Dark premium UI** with glassmorphism, wooden abacus frame, golden beads.

---

## Stack

- **Frontend**: Vanilla HTML + CSS + JavaScript (no React). Files at repo root: `index.html`, `style.css`, `app.js`.
- **Backend**: Node.js + Express + Socket.IO. Folder: `backend/`.

---

## Run Locally

```bash
cd backend
npm install
node server.js
```

Then open **http://localhost:3001** in your browser. The backend serves the frontend from the repo root on the same origin.

Two devices on the same network? Replace `localhost` with your machine's LAN IP.

---

## Deployment

### Backend → Render.com
1. Create a new **Web Service** pointing to this repo.
2. Root directory: `backend/`.
3. Build command: `npm install`
4. Start command: `node server.js`
5. Copy your Render URL and set it as `RENDER_BACKEND_URL` at the top of `app.js`.

### Frontend → GitHub Pages
1. Push this repo to GitHub.
2. Enable Pages on the `main` branch, root folder.
3. Visit `https://<user>.github.io/<repo>/`. The frontend auto-detects and uses `RENDER_BACKEND_URL` for Socket.IO and share links.

Do **not** create nested git repos inside `backend/`.

---

## Share Link Logic (defensive)

```
if window.location.protocol === 'file:' or origin === 'null' → base = 'http://localhost:3001'
else if hostname includes 'github.io'                       → base = RENDER_BACKEND_URL
else                                                        → base = window.location.origin
finalUrl = `${base}?room=${ROOM_CODE}`
```

Both the **Share Link** button and clicking the **room code** copy the full URL. A toast shows the actual URL so teachers can verify.

---

## Student Mode

When a user joins as a student, `body.student-mode` is added. CSS hides `.teacher-controls`, `.abacus-controls`, and `.room-bar-idle`. Students still see the abacus, value display, and practice area, and can manipulate beads. `state.suppressRemoteUpdate` prevents echo loops.

---

## Project Structure

```
/
├── index.html
├── style.css
├── app.js
├── README.md
├── .gitignore
└── backend/
    ├── server.js
    └── package.json
```

---

## License

MIT
