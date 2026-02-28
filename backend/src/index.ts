import express from "express";
import cors from "cors";
import { Chess, type Move, type Color, type PieceSymbol } from "chess.js";

const app = express();
app.use(cors());
app.use(express.json());

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

// Get legal moves for a square
app.post("/api/legal-moves", (req, res) => {
  const { fen, square } = req.body as { fen: string; square: string };
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ square: square as Parameters<typeof chess.moves>[0]["square"], verbose: true });
    res.json({ moves: moves.map((m) => m.to) });
  } catch {
    res.status(400).json({ error: "Invalid position" });
  }
});

// New game
app.get("/api/new-game", (_req, res) => {
  const chess = new Chess();
  res.json({ fen: chess.fen(), turn: "w" });
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`♟  Chess AI server running on http://localhost:${PORT}`);
});
