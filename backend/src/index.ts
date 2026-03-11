import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { Chess, type Move, type Color, type PieceSymbol } from "chess.js";
import Database from "better-sqlite3";
import path from "path";

// ─── Database setup ───────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "chess.db");
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    mode        TEXT    NOT NULL,
    difficulty  TEXT,
    player_color TEXT,
    result      TEXT    NOT NULL,
    result_detail TEXT  NOT NULL,
    pgn         TEXT    NOT NULL,
    moves_count INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    white_label TEXT    NOT NULL DEFAULT 'White',
    black_label TEXT    NOT NULL DEFAULT 'Black'
  );
`);

// ─── PGN helpers ─────────────────────────────────────────────────────────────
function buildPGN(params: {
  whiteLabel: string;
  blackLabel: string;
  result: string;
  date: string;
  mode: string;
  difficulty?: string;
  sanMoves: string[];
}): string {
  const resultTag = params.result === "white" ? "1-0"
    : params.result === "black" ? "0-1"
    : "1/2-1/2";

  const header = [
    `[Event "Casual Game"]`,
    `[Site "Chess App"]`,
    `[Date "${params.date.replace(/-/g, ".")}"]`,
    `[White "${params.whiteLabel}"]`,
    `[Black "${params.blackLabel}"]`,
    `[Result "${resultTag}"]`,
    params.mode === "ai" && params.difficulty
      ? `[Difficulty "${params.difficulty}"]`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Group SANs into move pairs: "1. e4 e5 2. Nf3 Nc6 ..."
  let movesStr = "";
  for (let i = 0; i < params.sanMoves.length; i++) {
    if (i % 2 === 0) movesStr += `${Math.floor(i / 2) + 1}. `;
    movesStr += params.sanMoves[i] + " ";
  }

  return `${header}\n\n${movesStr.trim()} ${resultTag}\n`;
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json());

// ─── Multiplayer Room Management ─────────────────────────────────────────────
interface RoomPlayer { socketId: string; color: "w" | "b"; name: string; }
interface Room { code: string; players: RoomPlayer[]; fen: string; sanMoves: string[]; startedAt: number; }
const rooms = new Map<string, Room>();

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function getRoomBySocket(socketId: string): Room | undefined {
  for (const room of rooms.values())
    if (room.players.some(p => p.socketId === socketId)) return room;
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name }: { name: string }) => {
    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();
    const room: Room = {
      code, players: [{ socketId: socket.id, color: "w", name: name || "Player 1" }],
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      sanMoves: [], startedAt: Date.now(),
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit("room-created", { code, color: "w" });
  });

  socket.on("join-room", ({ code, name }: { code: string; name: string }) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) { socket.emit("join-error", { message: "Room not found. Check the code!" }); return; }
    if (room.players.length >= 2) { socket.emit("join-error", { message: "Room is full!" }); return; }
    room.players.push({ socketId: socket.id, color: "b", name: name || "Player 2" });
    socket.join(code);
    const white = room.players.find(p => p.color === "w")!;
    const black = room.players.find(p => p.color === "b")!;
    socket.emit("game-start", { color: "b", fen: room.fen, opponentName: white.name });
    io.to(white.socketId).emit("game-start", { color: "w", fen: room.fen, opponentName: black.name });
  });

  socket.on("online-move", ({ code, from, to, promotion }: { code: string; from: string; to: string; promotion?: string }) => {
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    try {
      const chess = new Chess(room.fen);
      if (chess.turn() !== player.color) { socket.emit("move-error", { message: "Not your turn!" }); return; }
      const move = chess.move({ from, to, promotion: promotion ?? "q" });
      if (!move) { socket.emit("move-error", { message: "Illegal move" }); return; }
      room.fen = chess.fen();
      room.sanMoves.push(move.san);
      const payload = {
        fen: chess.fen(), move, isCheck: chess.isCheck(),
        isCheckmate: chess.isCheckmate(), isDraw: chess.isDraw(),
        isStalemate: chess.isStalemate(), isGameOver: chess.isGameOver(), turn: chess.turn(),
      };
      io.to(code).emit("move-made", payload);
      if (chess.isGameOver()) setTimeout(() => rooms.delete(code), 60000);
    } catch { socket.emit("move-error", { message: "Invalid move" }); }
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    socket.to(room.code).emit("opponent-disconnected", {
      message: `${player?.name ?? "Your opponent"} disconnected.`,
    });
    rooms.delete(room.code);
  });
});

// ─── Piece values ────────────────────────────────────────────────────────────
const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square tables for positional bonuses (white's perspective)
const PST: Record<PieceSymbol, number[]> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
  ],
};

// ─── Evaluation ──────────────────────────────────────────────────────────────
function getPSTValue(piece: PieceSymbol, color: Color, square: string): number {
  const file = square.charCodeAt(0) - 97; // a=0 .. h=7
  const rank = parseInt(square[1]!) - 1;  // 1=0 .. 8=7
  const index = color === "w" ? (7 - rank) * 8 + file : rank * 8 + file;
  return PST[piece][index] ?? 0;
}

function evaluate(chess: Chess): number {
  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      const val = PIECE_VALUES[cell.type] + getPSTValue(cell.type, cell.color, cell.square);
      score += cell.color === "w" ? val : -val;
    }
  }
  return score;
}

// ─── Minimax with Alpha-Beta ──────────────────────────────────────────────────
function minimax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean
): number {
  if (depth === 0 || chess.isGameOver()) {
    if (chess.isCheckmate()) return maximizing ? -100000 : 100000;
    return evaluate(chess);
  }

  const moves = chess.moves({ verbose: true });

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      chess.move(move);
      best = Math.max(best, minimax(chess, depth - 1, alpha, beta, false));
      chess.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      chess.move(move);
      best = Math.min(best, minimax(chess, depth - 1, alpha, beta, true));
      chess.undo();
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

type Difficulty = "easy" | "medium" | "hard";

function getBestMove(chess: Chess, difficulty: Difficulty): Move | null {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  if (difficulty === "easy") {
    // Random move
    return moves[Math.floor(Math.random() * moves.length)] ?? null;
  }

  const depth = difficulty === "medium" ? 2 : 3;
  const isMaximizing = chess.turn() === "w";

  let bestMove: Move | null = null;
  let bestScore = isMaximizing ? -Infinity : Infinity;

  // Shuffle for variety at same score
  const shuffled = moves.sort(() => Math.random() - 0.5);

  for (const move of shuffled) {
    chess.move(move);
    const score = minimax(chess, depth - 1, -Infinity, Infinity, !isMaximizing);
    chess.undo();

    if (isMaximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Validate & apply a player move
app.post("/api/move", (req, res) => {
  const { fen, from, to, promotion } = req.body as {
    fen: string;
    from: string;
    to: string;
    promotion?: string;
  };

  try {
    const chess = new Chess(fen);
    const move = chess.move({ from, to, promotion: promotion ?? "q" });
    if (!move) {
      res.status(400).json({ error: "Illegal move" });
      return;
    }
    res.json({
      fen: chess.fen(),
      move,
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      isStalemate: chess.isStalemate(),
      isGameOver: chess.isGameOver(),
      turn: chess.turn(),
    });
  } catch {
    res.status(400).json({ error: "Invalid position" });
  }
});

// Get AI move
app.post("/api/ai-move", (req, res) => {
  const { fen, difficulty = "medium" } = req.body as {
    fen: string;
    difficulty?: Difficulty;
  };

  try {
    const chess = new Chess(fen);
    if (chess.isGameOver()) {
      res.json({ gameOver: true });
      return;
    }

    const move = getBestMove(chess, difficulty);
    if (!move) {
      res.json({ gameOver: true });
      return;
    }

    chess.move(move);
    res.json({
      fen: chess.fen(),
      move,
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      isStalemate: chess.isStalemate(),
      isGameOver: chess.isGameOver(),
      turn: chess.turn(),
    });
  } catch {
    res.status(400).json({ error: "Invalid position" });
  }
});

// Get legal moves for a square (returns rich move info)
app.post("/api/legal-moves", (req, res) => {
  const { fen, square } = req.body as { fen: string; square: string };
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ square: square as Parameters<typeof chess.moves>[0]["square"], verbose: true });
    res.json({
      moves: moves.map((m) => ({
        to: m.to,
        from: m.from,
        san: m.san,
        isCapture: !!m.captured,
        isEnPassant: !!(m.flags && m.flags.includes("e")),
        isPromotion: !!(m.flags && m.flags.includes("p")),
        isCastle: !!(m.flags && (m.flags.includes("k") || m.flags.includes("q"))),
      })),
    });
  } catch {
    res.status(400).json({ error: "Invalid position" });
  }
});

// Evaluate current position (for eval bar)
app.post("/api/evaluate", (req, res) => {
  const { fen } = req.body as { fen: string };
  try {
    const chess = new Chess(fen);
    const score = evaluate(chess);
    // Clamp to a reasonable range for display
    const clamped = Math.max(-2000, Math.min(2000, score));
    // Convert to "pawns" scale (-20 to +20)
    const pawns = clamped / 100;
    res.json({ score, pawns: Math.round(pawns * 10) / 10 });
  } catch {
    res.status(400).json({ error: "Invalid position" });
  }
});

// New game
app.get("/api/new-game", (_req, res) => {
  const chess = new Chess();
  res.json({ fen: chess.fen(), turn: "w" });
});

// Validate a FEN string
app.post("/api/validate-fen", (req, res) => {
  const { fen } = req.body as { fen: string };
  try {
    const chess = new Chess(fen);
    res.json({ valid: true, turn: chess.turn() });
  } catch {
    res.json({ valid: false });
  }
});

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => {
  console.log(`♟  Chess AI server running on http://localhost:${PORT}`);
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Multiplayer: Socket.io enabled ✓`);
});

// ─── Game History Routes ─────────────────────────────────────────────────────

// Save a completed game
app.post("/api/games", (req, res) => {
  const {
    mode,
    difficulty,
    playerColor,
    result,
    resultDetail,
    sanMoves,
    durationSeconds = 0,
  } = req.body as {
    mode: string;
    difficulty?: string;
    playerColor?: string;
    result: "white" | "black" | "draw";
    resultDetail: string;
    sanMoves: string[];
    durationSeconds?: number;
  };

  if (!result || !Array.isArray(sanMoves)) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const now = new Date();
  const date = now.toISOString().split("T")[0]!;

  const whiteLabel =
    mode === "ai"
      ? playerColor === "w" ? "You" : `Computer (${difficulty ?? "medium"})`
      : "White";
  const blackLabel =
    mode === "ai"
      ? playerColor === "b" ? "You" : `Computer (${difficulty ?? "medium"})`
      : "Black";

  const pgn = buildPGN({
    whiteLabel,
    blackLabel,
    result,
    date,
    mode,
    difficulty,
    sanMoves,
  });

  const stmt = db.prepare(`
    INSERT INTO games
      (date, mode, difficulty, player_color, result, result_detail, pgn,
       moves_count, duration_seconds, white_label, black_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    date,
    mode,
    difficulty ?? null,
    playerColor ?? null,
    result,
    resultDetail,
    pgn,
    sanMoves.length,
    durationSeconds,
    whiteLabel,
    blackLabel
  );

  res.json({ id: info.lastInsertRowid, pgn });
});

// List all saved games (newest first)
app.get("/api/games", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, date, mode, difficulty, player_color, result, result_detail,
              moves_count, duration_seconds, white_label, black_label
       FROM games ORDER BY id DESC`
    )
    .all();
  res.json({ games: rows });
});

// Get a single game (with full PGN)
app.get("/api/games/:id", (req, res) => {
  const row = db
    .prepare(`SELECT * FROM games WHERE id = ?`)
    .get(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(row);
});

// Download PGN file for a game
app.get("/api/games/:id/pgn", (req, res) => {
  const row = db
    .prepare(`SELECT * FROM games WHERE id = ?`)
    .get(req.params.id) as { pgn: string; date: string; id: number } | undefined;
  if (!row) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.setHeader("Content-Type", "application/x-chess-pgn");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="chess-game-${row.id}-${row.date}.pgn"`
  );
  res.send(row.pgn);
});

// Delete a saved game
app.delete("/api/games/:id", (req, res) => {
  const info = db.prepare(`DELETE FROM games WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json({ deleted: true });
});

// Get player stats summary
app.get("/api/stats", (_req, res) => {
  const total = db.prepare(`SELECT COUNT(*) as count FROM games`).get() as { count: number };
  const wins = db.prepare(
    `SELECT COUNT(*) as count FROM games
     WHERE (result = 'white' AND player_color = 'w')
        OR (result = 'black' AND player_color = 'b')`
  ).get() as { count: number };
  const losses = db.prepare(
    `SELECT COUNT(*) as count FROM games
     WHERE (result = 'white' AND player_color = 'b')
        OR (result = 'black' AND player_color = 'w')`
  ).get() as { count: number };
  const draws = db.prepare(
    `SELECT COUNT(*) as count FROM games WHERE result = 'draw'`
  ).get() as { count: number };
  const avgMoves = db.prepare(
    `SELECT AVG(moves_count) as avg FROM games`
  ).get() as { avg: number | null };
  const avgDuration = db.prepare(
    `SELECT AVG(duration_seconds) as avg FROM games`
  ).get() as { avg: number | null };
  const longestGame = db.prepare(
    `SELECT MAX(moves_count) as max FROM games`
  ).get() as { max: number | null };

  res.json({
    total: total.count,
    wins: wins.count,
    losses: losses.count,
    draws: draws.count,
    avgMoves: Math.round(avgMoves.avg ?? 0),
    avgDuration: Math.round(avgDuration.avg ?? 0),
    longestGame: longestGame.max ?? 0,
    winRate: total.count > 0 ? Math.round((wins.count / total.count) * 100) : 0,
  });
});