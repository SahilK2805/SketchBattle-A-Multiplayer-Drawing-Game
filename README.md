# 🎨 SketchBattle — Distributed Multiplayer Drawing & Guessing Game

> A full-stack, real-time multiplayer game built with Node.js, Socket.io, MongoDB, and Vanilla JavaScript.

---

## 📁 Project Structure

```
drawing-game/
├── backend/
│   ├── server.js                  ← Express + Socket.io entry point
│   ├── config/
│   │   └── db.js                  ← MongoDB connection with auto-reconnect
│   ├── models/
│   │   ├── Room.js                ← Room schema (game state, players, scores)
│   │   └── Player.js              ← Player schema (socketId, name, score)
│   ├── sockets/
│   │   └── gameSocket.js          ← All real-time game logic
│   ├── controllers/
│   │   └── gameController.js      ← REST endpoint handlers
│   └── routes/
│       └── gameRoutes.js          ← Express API routes
│
├── frontend/
│   ├── index.html                 ← Lobby (create / join room)
│   ├── game.html                  ← Game UI (canvas, chat, scores)
│   ├── css/
│   │   └── style.css              ← Full dark-arcade stylesheet
│   └── js/
│       ├── main.js                ← Lobby page logic
│       └── game.js                ← Game client (socket, canvas, chat)
│
├── package.json
└── README.md
```

---

## 🚀 Quick Start (Run Instructions)

### Prerequisites
| Tool | Version |
|------|---------|
| Node.js | ≥ 18.x |
| MongoDB | ≥ 6.x (local) or MongoDB Atlas URI |
| npm | ≥ 9.x |

### Step 1 — Install dependencies
```bash
cd drawing-game
npm install
```

### Step 2 — Configure environment (optional)
```bash
# Create a .env file (or skip to use defaults)
echo "PORT=3000" > .env
echo "MONGO_URI=mongodb://127.0.0.1:27017/drawing_game" >> .env
```

### Step 3 — Start MongoDB (if using local)
```bash
# macOS (Homebrew)
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# Windows
net start MongoDB
```

### Step 4 — Start the server
```bash
npm start
# or for development with auto-reload:
npm run dev
```

You should see:
```
🚀  Server running at http://localhost:3000
📡  Socket.io ready
✅  MongoDB connected
```

### Step 5 — Open the game
Open **3–4 different browser tabs** (or windows / incognito) and navigate to:
```
http://localhost:3000
```

### Step 6 — Test Multiplayer
1. **Tab 1**: Enter a name → Click **Create Room** → Copy the 6-char room code
2. **Tab 2, 3, 4**: Enter different names → Click **Join Room** → paste the code
3. **Tab 1 (host)**: Click **▶ Start Game** (requires ≥ 2 players)
4. The first drawer gets the secret word; everyone else types guesses in chat
5. Correct guesses earn points based on speed
6. After all rounds, the scoreboard appears

---

## 🌐 Socket Events Reference

| Event | Direction | Description |
|-------|-----------|-------------|
| `createRoom` | Client → Server | Create a new game room |
| `joinRoom` | Client → Server | Join an existing room |
| `startGame` | Client → Server | Host starts the game |
| `draw` | Client → Server → Others | Relay a stroke segment |
| `clearCanvas` | Client → Server → Others | Wipe the canvas |
| `fillCanvas` | Client → Server → Others | Flood-fill action |
| `guess` | Client → Server | Submit a word guess |
| `chatMessage` | Client ↔ Server | Chat (non-guess) messages |
| `restartGame` | Client → Server | Host restarts |
| `rejoinRoom` | Client → Server | Reconnect to active session |
| `youAreDrawing` | Server → Drawer | Secret word + turn info |
| `turnStart` | Server → All | New turn announcement |
| `timerTick` | Server → All | Countdown tick (1/sec) |
| `correctGuess` | Server → All | Correct guess broadcast + scores |
| `turnEnd` | Server → All | Turn over, reveal word |
| `gameEnded` | Server → All | Final scores + winner |
| `playerJoined` | Server → All | New player entered lobby |
| `playerDisconnected` | Server → All | Player left |
| `playerRejoined` | Server → All | Player reconnected |
| `becameHost` | Server → Client | Host migration notification |

---

## 🗄️ Database Schema

### Room Collection
```js
{
  roomCode:           String,   // Unique 6-char code (indexed)
  players: [{
    socketId:         String,
    name:             String,
    score:            Number,
    isHost:           Boolean,
    isConnected:      Boolean,
    joinedAt:         Date,
  }],
  gameState:          'waiting' | 'playing' | 'ended',
  currentDrawerIndex: Number,
  currentWord:        String,
  currentRound:       Number,
  totalRounds:        Number,
  roundTimeLimit:     Number,
  createdAt:          Date,     // TTL index – auto-deletes after 24 h
}
```

### Player Collection
```js
{
  socketId:    String,   // Indexed
  name:        String,
  score:       Number,
  roomCode:    String,
  isHost:      Boolean,
  isConnected: Boolean,
  joinedAt:    Date,     // TTL index – auto-expires after 24 h
}
```

---

## 📄 Full Project Report

### Abstract

SketchBattle is a distributed, real-time multiplayer drawing and guessing game. It demonstrates core distributed systems concepts — event broadcasting, state synchronisation, fault tolerance, and concurrent multi-room management — using a modern Node.js + Socket.io + MongoDB stack. The system supports 2–8 players per room across unlimited parallel sessions, with sub-100ms event propagation on a LAN.

---

### Introduction

Online multiplayer games are excellent test-beds for distributed systems because they demand:
- **Low-latency state sync** (drawing strokes must appear instantly on all screens)
- **Consistent shared state** (everyone must see the same scores and timer)
- **Fault tolerance** (a player disconnect should never crash the game)
- **Concurrency** (many rooms run simultaneously without interfering)

SketchBattle implements all four properties using WebSockets (Socket.io) for transport, an in-memory state map for hot-path performance, and MongoDB as the durable authoritative store.

---

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                        CLIENTS                           │
│                                                          │
│  [Browser Tab 1]  [Browser Tab 2]  [Browser Tab 3] ...  │
│   index.html/      index.html/      index.html/          │
│   game.html        game.html        game.html            │
│       │                │                │                │
│       └────────────────┴────────────────┘                │
│                         │                                │
│              WebSocket (Socket.io)                       │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                    BACKEND  (Node.js)                    │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Express HTTP Server                    │ │
│  │  GET  /             → frontend static files         │ │
│  │  POST /api/create-room → gameController             │ │
│  │  GET  /api/room/:code  → gameController             │ │
│  │  GET  /api/leaderboard/:code → gameController       │ │
│  └─────────────────────────────────────────────────────┘ │
│                          │                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           Socket.io Server (gameSocket.js)          │ │
│  │                                                     │ │
│  │  ┌──────────────┐   ┌────────────────────────────┐  │ │
│  │  │ activeRooms  │   │  Server-Side Game Engine   │  │ │
│  │  │    (Map)     │←→ │  startTurn() endTurn()     │  │ │
│  │  │  Hot state   │   │  endGame()  advanceTurn()  │  │ │
│  │  └──────────────┘   └────────────────────────────┘  │ │
│  │                                                     │ │
│  │  Socket Rooms:  room:ABCDEF  room:XYZPQR  ...       │ │
│  └─────────────────────────────────────────────────────┘ │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                       MongoDB                            │
│                                                          │
│   rooms collection          players collection           │
│  ┌──────────────────┐      ┌──────────────────┐          │
│  │ roomCode         │      │ socketId         │          │
│  │ players[]        │      │ name             │          │
│  │ gameState        │      │ score            │          │
│  │ currentWord      │      │ roomCode         │          │
│  │ scores           │      │ isConnected      │          │
│  │ TTL: 24h         │      │ TTL: 24h         │          │
│  └──────────────────┘      └──────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

---

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Node.js 18+ | Non-blocking I/O, event loop |
| HTTP Server | Express 4 | REST endpoints, static file serving |
| Real-time | Socket.io 4 | WebSocket transport with fallback |
| Database | MongoDB + Mongoose | Persistent game state storage |
| Frontend | HTML5 + CSS3 + Vanilla JS | Zero-framework client |
| Canvas | HTML5 Canvas API | Drawing engine |
| Fonts | Google Fonts (Orbitron, Exo 2) | UI typography |

---

### How It Works

#### 1. Room Creation
The host navigates to the lobby, enters a name, sets rounds/time, and clicks Create Room. `main.js` stores parameters in `sessionStorage` and redirects to `game.html`. `game.js` emits `createRoom` over the socket; `gameSocket.js` generates a unique 6-character code, persists a Room document in MongoDB, and registers the hot state in the `activeRooms` Map.

#### 2. Player Joining
Other players enter the room code and their name. The server validates the code, checks the room is in `waiting` state, and checks for duplicate names before adding the player to both the DB and in-memory state. A `playerJoined` broadcast notifies all clients.

#### 3. Game Start
The host clicks Start Game (requires ≥ 2 players). The server shuffles player order into `drawTurnOrder`, resets all scores, and calls `startTurn()`.

#### 4. Turn Loop
`startTurn()`:
1. Picks a random word from the 100-word bank
2. Emits `youAreDrawing` (with secret word) **only** to the drawer
3. Emits `turnStart` (with `_ _ _ _ _` hint) to everyone else
4. Starts a `setInterval` server-side timer that emits `timerTick` every second

When the timer hits 0 (or all guessers guess correctly), `endTurn()` fires: it stops the timer, emits `turnEnd` revealing the word, then schedules the next turn 4 seconds later.

#### 5. Drawing Sync
Each pointer event on the canvas computes `(x0,y0,x1,y1)` normalised to canvas coordinates and emits a `draw` event. The server relays it instantly to all other sockets in the room (`socket.to(roomCode).emit`). Receivers call `drawSegment()` to replicate the stroke. The fill (bucket) tool uses a flood-fill algorithm and sends the normalised click coordinates.

#### 6. Guessing & Scoring
Guesses are matched (case-insensitive, trimmed) against `currentWord`. A correct guess:
- Adds the socket to `guessedPlayers` Set
- Calculates `points = 50 + timeBonus + orderBonus`
- Awards the drawer 20 pts per correct guesser
- Broadcasts `correctGuess` with updated scores

A near-miss (Levenshtein distance ≤ 2) is marked as `type: 'close'` in chat.

#### 7. Disconnect & Reconnect
On disconnect, the server marks `isConnected = false`. If the drawer disconnects, the turn is skipped automatically. If fewer than 2 players remain, the game ends gracefully. On Socket.io `reconnect`, the client emits `rejoinRoom`; the server patches the socketId and returns the full current state snapshot so the client can restore its view without reloading.

---

### Distributed Concepts Used

| Concept | Implementation |
|---------|---------------|
| **Client-Server Communication** | All game logic runs server-side; clients send inputs and receive state updates |
| **Event Broadcasting** | `io.to(roomCode).emit()` delivers events to all room members atomically |
| **State Synchronisation** | Server is single source of truth; clients are thin rendering layers |
| **Fault Tolerance** | Disconnect detection, host migration, drawer-skip, game-halt at <2 players |
| **Concurrent Multi-Room** | `activeRooms` Map + Socket.io rooms isolate parallel games |
| **Authoritative Timer** | Server-side `setInterval` prevents cheating and clock drift |
| **Idempotent Rejoin** | Full state snapshot sent on reconnect; no data loss |
| **TTL Indexes** | MongoDB automatically expires rooms and players after 24 h |
| **Levenshtein Distance** | Near-miss detection without exposing the answer |

---

### Screenshots (Where to Take)

1. **Lobby — Create Tab** (`http://localhost:3000`) — Show the name/rounds/time inputs
2. **Lobby — Join Tab** — Show the room code entry
3. **Waiting Room** — Two browser windows side by side, showing the room code
4. **In-Game Drawing** — Drawer's view with the word shown and canvas active, toolbar highlighted
5. **In-Game Guessing** — Guesser's view showing the `_ _ _ _` hint, chat messages
6. **Correct Guess Chat** — Green "guessed it!" message in chat panel
7. **Turn End Overlay** — Word reveal overlay in the centre of the canvas
8. **Final Scoreboard** — The end-game leaderboard overlay with medals

---

### Conclusion

SketchBattle demonstrates that a small, well-structured Node.js application can implement genuine distributed system properties: consistent shared state, real-time event propagation at scale, and graceful fault tolerance — all without complex infrastructure. The dual-layer state architecture (in-memory Map for speed + MongoDB for durability) is a practical pattern used in production game servers.

---

### Future Scope

| Feature | Description |
|---------|-------------|
| **Horizontal Scaling** | Add Redis adapter for Socket.io to support multiple server instances |
| **Custom Word Lists** | Let hosts upload their own word packs |
| **Spectator Mode** | Let late joiners watch without participating |
| **Drawing Replay** | Store stroke events and replay the drawing after each turn |
| **Persistent Accounts** | JWT auth + global leaderboard across sessions |
| **Mobile Gestures** | Pinch-to-zoom and palm rejection for tablet drawing |
| **Private Hints** | Letter-reveal hints at configurable intervals |
| **AI Drawer** | Use a generative model as a bot player when <2 humans join |
| **Voice Chat** | WebRTC peer channels within the room |
| **Undo / Redo** | Stroke history stack for the drawer |

---

## 📜 License
MIT — free to use, modify, and distribute.
