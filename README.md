# ♟ Chess
A clean, minimal chess app with a TypeScript/Express backend and vanilla JS frontend.

## Features
- Play vs Computer (Easy / Medium / Hard) or local 2-player
- Minimax + Alpha-Beta pruning AI with piece-square tables
- Move highlighting, legal move dots, check indicator
- Undo, captured pieces, move history
- Pawn promotion dialog
- Play as White or Black

## Setup

### Backend
```bash
cd backend
npm install
npm run dev
```
Server runs on `http://localhost:3001`

### Frontend
Just open `frontend/index.html` in your browser — no build step needed!

## Project Structure
```
chess-ai/
├── backend/
│   ├── src/
│   │   └── index.ts     # Express server + chess AI
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── index.html       # Full chess UI (single file)
└── .gitignore
```

## How the AI works
- **Easy**: Random legal move
- **Medium**: Minimax depth 2 with material + positional evaluation
- **Hard**: Minimax depth 3 with Alpha-Beta pruning + piece-square tables
