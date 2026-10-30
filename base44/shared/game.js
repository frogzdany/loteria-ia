// Game flow rules shared by the validate-board function (Deno), the pages (Vite) and the tests.
// Plain JS with the database injected, so the concurrency rules run under vitest with a fake DB.
//
// Base44 entities have no transactions or conditional writes. Two phones can press "¡Lotería!"
// on the same called card (simulated: about 4 in 10 games with 30 players and a 16-card deck),
// so the winner cannot depend on which write lands last. The rule is the traditional one, the
// first valid shout wins, and every caller computes it the same way:
//   1. each claim stamps its board with the server time of its first valid shout,
//   2. waits a settle window (1 s) so claims made at the same moment are all visible,
//   3. if the game already has a winner, that winner stands (it is never replaced),
//   4. otherwise picks the earliest valid shout (ties broken by board id) and writes it,
//   5. re-reads the game after a short pause and answers from what is stored.

import { BOARD_SIZE, findWinningLine, nextCard } from "./loteria.js";

export const CLAIM_SETTLE_MS = 1000;
export const CLAIM_CONFIRM_MS = 250;

const STATUS_RANK = { lobby: 0, playing: 1, finished: 2 };

/** Board positions as unique sorted integers 0-15; anything else is dropped. */
export function sanitizeMarked(marked) {
  if (!Array.isArray(marked)) return [];
  const out = new Set();
  for (const v of marked) {
    if (typeof v !== "number" && !(typeof v === "string" && v.trim() !== "")) continue; // Number(null) is 0
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < BOARD_SIZE) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Earliest valid claim (by shouted_at, then id), or null. Same input, same answer, everywhere. */
export function pickWinner(boards) {
  const claims = (boards ?? []).filter((b) => b && b.valid === true && b.shouted_at && Number.isFinite(Date.parse(b.shouted_at)));
  claims.sort((a, b) => Date.parse(a.shouted_at) - Date.parse(b.shouted_at) || String(a.id).localeCompare(String(b.id)));
  return claims[0] ?? null;
}

/**
 * Merge a freshly read Game into the one on screen without ever going backwards: a slow poll
 * that answers after a newer write must not drop a called card, unset the winner or move the
 * status back. A different game id (new game) replaces the state.
 */
export function mergeGame(prev, next) {
  if (!next) return prev ?? null;
  if (!prev || prev.id !== next.id) return next;
  const pc = prev.called_card_ids ?? [];
  const nc = next.called_card_ids ?? [];
  const stale = nc.length < pc.length && nc.every((id, i) => pc[i] === id);
  const out = { ...next, called_card_ids: stale ? pc : nc };
  if ((STATUS_RANK[prev.status] ?? 0) > (STATUS_RANK[next.status] ?? 0)) out.status = prev.status;
  if (prev.winner_board_id && !next.winner_board_id) {
    out.winner_board_id = prev.winner_board_id;
    out.winner_name = prev.winner_name;
    out.status = "finished";
  }
  return out;
}

/**
 * What the caller's "Siguiente carta" should do. Returns { card, patch } with the fields to write,
 * or { reason } when no card may be called: "no-game", "finished" (there is a winner) or "exhausted".
 * The patch never touches the winner fields and never writes "finished" back to "playing".
 */
export function planNextCall(game, cards, rand = Math.random) {
  if (!game) return { reason: "no-game" };
  if (game.winner_board_id || game.status === "finished") return { reason: "finished" };
  const called = game.called_card_ids ?? [];
  const card = nextCard(cards, called, rand);
  if (!card) return { reason: "exhausted" };
  const patch = { called_card_ids: [...called, card.id] };
  if (game.status !== "playing") patch.status = "playing";
  return { card, patch };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Validate one "¡Lotería!" and settle the winner. `db` is `base44.entities` (frontend) or
 * `base44.asServiceRole.entities` (backend): only Board.get/update/filter and Game.get/update are used.
 * `marked` (optional) are the positions on the phone right now; they replace the stored ones so a
 * slow bean write cannot make a winning board look incomplete. Marks on cards not called yet never count.
 * Safe to call again for the same board: the first valid shout time is kept.
 *
 * Returns { valid, winningLine, isFirstWinner, winnerName, calledCount }.
 */
export async function resolveClaim(db, { boardId, marked, gameId } = {}, opts = {}) {
  const now = opts.now ?? (() => new Date().toISOString());
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const settleMs = opts.settleMs ?? CLAIM_SETTLE_MS;
  const confirmMs = opts.confirmMs ?? CLAIM_CONFIRM_MS;

  const id = String(boardId ?? "").trim();
  if (!id) throw httpError(400, "boardId is required");
  // With the game id from the phone, both reads go out together (one round trip less).
  const gid = String(gameId ?? "").trim();
  const [board, guess] = await Promise.all([
    db.Board.get(id).catch(() => null),
    gid ? db.Game.get(gid).catch(() => null) : null,
  ]);
  if (!board) throw httpError(404, `Board ${id} not found`);
  const game = guess && guess.id === board.game_id ? guess : await db.Game.get(board.game_id).catch(() => null);
  if (!game) throw httpError(404, `Game ${board.game_id} not found`);

  const called = Array.isArray(game.called_card_ids) ? game.called_card_ids : [];
  const result = (valid, line, winnerBoardId, winnerName) => ({
    valid,
    winningLine: line,
    isFirstWinner: Boolean(valid && winnerBoardId === id),
    winnerName: winnerName || null,
    calledCount: called.length,
  });

  // The winner pressing again: answer the same thing, change nothing.
  if (game.winner_board_id === id) {
    const line = board.winning_line?.length ? board.winning_line : findWinningLine(board, called);
    return result(true, line, id, game.winner_name);
  }

  const marks = marked === undefined ? sanitizeMarked(board.marked) : sanitizeMarked(marked);
  const line = findWinningLine({ ...board, marked: marks }, called);
  const patch = { marked: marks, valid: Boolean(line), winning_line: line ?? [] };
  if (line) patch.shouted_at = board.valid && board.shouted_at ? board.shouted_at : now();
  await db.Board.update(id, patch);
  const mine = { ...board, ...patch };

  if (!line) return result(false, null, game.winner_board_id, game.winner_name);
  if (game.winner_board_id) return result(true, line, game.winner_board_id, game.winner_name);

  await sleep(settleMs);
  const fresh = (await db.Game.get(game.id).catch(() => null)) ?? game;
  if (fresh.winner_board_id) return result(true, line, fresh.winner_board_id, fresh.winner_name);

  const boards = await db.Board.filter({ game_id: game.id }, null, 1000).catch(() => []);
  const claims = [...(boards ?? []).filter((b) => b.id !== id), mine];
  const winner = pickWinner(claims) ?? mine;
  await db.Game.update(game.id, { winner_board_id: winner.id, winner_name: winner.player_name, status: "finished" });

  await sleep(confirmMs);
  const final = (await db.Game.get(game.id).catch(() => null)) ?? { winner_board_id: winner.id, winner_name: winner.player_name };
  return result(true, line, final.winner_board_id, final.winner_name);
}
