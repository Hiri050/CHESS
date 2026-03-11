# ♟ Chess AI

A full-featured chess application with an AI opponent, real-time online multiplayer, game history, and PGN export — built with TypeScript, Express, Socket.io, and vanilla HTML/CSS/JS.

---

## Features

### 🎮 Game Modes
- **vs Computer** — Play against a minimax AI with Easy / Medium / Hard difficulty
- **Pass & Play** — Two players on the same device; board flips after each move
- **🌐 Online Multiplayer** — Real-time 2-player games via room codes (Socket.io)

### 🤖 AI Engine
- Minimax algorithm with alpha-beta pruning (depth 3 on Hard)
- Piece-square tables for positional evaluation
- Shuffled move ordering for variety

### 🎨 UI & Experience
- Dark / Light theme toggle
- 5 board color themes: Green, Classic, Blue, Purple, Wood
- Live evaluation bar (position score in pawns)
- Captured pieces & material advantage display
- Drag-and-drop and click-to-move
- Pawn promotion dialog
- Sound effects (move, capture, check, castle, game over)
- Confetti on win 🎉
- Responsive design (mobile-friendly)

### 💾 Game History (SQLite)
- Save completed games to a local SQLite database
- View all saved games with WIN / LOSS / DRAW badges
- Player stats: total games, wins, losses, win rate
- Full PGN viewer and `.pgn` file download (compatible with Lichess, Chess.com)

### ⌨️ Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `N` | New Game |
| `F` | Flip Board |
| `H` | History |
| `S` | Settings |
| `Ctrl+Z` | Undo Move |
| `Esc` | Close modal |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + TypeScript + Express |
| Real-time | Socket.io |
| Chess Logic | chess.js |
| Database | SQLite (better-sqlite3) |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Fonts | Google Fonts (DM Sans, DM Serif Display, DM Mono) |

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
# Clone the repo
git clone https://github.com/Hiri050/CHESS.git
cd CHESS/backend

# Install dependencies
npm install
```

### Running the App

**Terminal — start the backend:**
```bash
cd backend
npm run dev
```

You should see:
```
♟  Chess AI server running on http://localhost:3001
   Database: /path/to/chess.db
   Multiplayer: Socket.io enabled ✓
```

**Open the frontend:**  
Open `frontend/index.html` in your browser via Live Server (VS Code) or by double-clicking.

> **Note:** If using Live Server, the `index.html` already points to `http://localhost:3001` — no extra URL params needed.

---

## Online Multiplayer

1. Both players open `frontend/index.html`
2. Both click **🌐 Online** in the Mode panel
3. **Player 1:** Enter a name → click **Create Room** → share the 5-letter code
4. **Player 2:** Enter a name → paste the code → click **Join Room**
5. The game starts automatically — boards are oriented correctly for each player

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/move` | Validate and apply a player move |
| `POST` | `/api/ai-move` | Get the AI's best move |
| `POST` | `/api/legal-moves` | Get legal moves for a square |
| `POST` | `/api/evaluate` | Get position evaluation score |
| `GET` | `/api/new-game` | Get starting FEN |
| `POST` | `/api/games` | Save a completed game |
| `GET` | `/api/games` | List all saved games |
| `GET` | `/api/games/:id` | Get a single game with PGN |
| `GET` | `/api/games/:id/pgn` | Download `.pgn` file |
| `DELETE` | `/api/games/:id` | Delete a saved game |
| `GET` | `/api/stats` | Get player stats summary |

### Socket.io Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `create-room` | Client → Server | Create a new multiplayer room |
| `join-room` | Client → Server | Join an existing room by code |
| `online-move` | Client → Server | Send a move in an online game |
| `room-created` | Server → Client | Room created, returns room code |
| `game-start` | Server → Client | Game ready, returns color + opponent name |
| `move-made` | Server → Client | A move was played, returns new game state |
| `opponent-disconnected` | Server → Client | Opponent left the game |

---

## Project Structure

```
CHESS/
├── backend/
│   ├── index.ts          # Express server + Socket.io + AI + DB
│   ├── chess.db          # SQLite database (auto-created)
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── index.html        # Complete single-file frontend
└── README.md
```

---

## Roadmap

- [ ] Phase 3: Python + Stockfish analysis API
- [ ] Phase 4: Rust/WebAssembly engine for offline AI
- [ ] Online game history saving
- [ ] Move clock / time controls
- [ ] Opening book integration

---

## License

MIT