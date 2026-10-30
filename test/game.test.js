import { describe, it, expect } from "vitest";
import {
  CLAIM_SETTLE_MS,
  mergeGame,
  pickWinner,
  planNextCall,
  resolveClaim,
  sanitizeMarked,
} from "../base44/shared/game.js";
import { findWinningLine } from "../base44/shared/loteria.js";
import { createLatestWriter } from "../src/lib/latestWriter.js";

// ---------------------------------------------------------------- helpers

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * In-memory stand-in for base44.entities with Board and Game. Every call takes a random delay;
 * reads return a snapshot taken when the read lands and writes apply when they land, so
 * concurrent claims interleave the way they do against the real API.
 */
function fakeDb({ rand = Math.random, maxDelay = 0 } = {}) {
  const tables = { Board: new Map(), Game: new Map() };
  const delay = () => (maxDelay ? wait(Math.floor(rand() * maxDelay)) : Promise.resolve());
  const clone = (x) => structuredClone(x);
  const entity = (name) => ({
    async get(id) {
      await delay();
      const row = tables[name].get(id);
      if (!row) throw Object.assign(new Error("not found"), { status: 404 });
      return clone(row);
    },
    async update(id, patch) {
      await delay();
      const row = tables[name].get(id);
      if (!row) throw Object.assign(new Error("not found"), { status: 404 });
      Object.assign(row, clone(patch));
      return clone(row);
    },
    async filter(query) {
      await delay();
      return [...tables[name].values()].filter((r) => Object.entries(query).every(([k, v]) => r[k] === v)).map(clone);
    },
  });
  return { tables, Board: entity("Board"), Game: entity("Game") };
}

const CARDS = Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, number: i + 1 }));
const CARD_IDS = CARDS.map((c) => c.id);
const ROW0 = [0, 1, 2, 3];

/** Game with row 0 of the identity board called, plus `boards` [{ id, marked }]. */
function seed(db, boards, { called = ["c0", "c1", "c2", "c3", "c9"], game = {} } = {}) {
  db.tables.Game.set("g1", { id: "g1", code: "MTWTST", status: "playing", called_card_ids: called, ...game });
  for (const b of boards) {
    db.tables.Board.set(b.id, { id: b.id, game_id: "g1", player_name: `P-${b.id}`, card_ids: CARD_IDS, marked: [], ...b });
  }
}

function clock(start = Date.parse("2026-10-30T18:00:00.000Z")) {
  let t = start;
  return () => new Date(t++).toISOString();
}

const fast = { settleMs: 0, confirmMs: 0 };

// The algorithm validate-board used before game.js, kept here to show the race test catches it.
async function naiveClaim(db, boardId) {
  const board = await db.Board.get(boardId);
  const game = await db.Game.get(board.game_id);
  const line = findWinningLine(board, game.called_card_ids);
  await db.Board.update(boardId, { valid: !!line, shouted_at: new Date().toISOString(), winning_line: line ?? [] });
  if (!line) return { isFirstWinner: false };
  if (game.winner_board_id) return { isFirstWinner: game.winner_board_id === boardId };
  await db.Game.update(game.id, { winner_board_id: boardId, winner_name: board.player_name, status: "finished" });
  const after = await db.Game.get(game.id);
  return { isFirstWinner: after.winner_board_id === boardId };
}

// ---------------------------------------------------------------- pure rules

describe("sanitizeMarked", () => {
  it("keeps unique integers 0-15, sorted", () => {
    expect(sanitizeMarked([3, "2", 2, 15, 16, -1, 1.5, null, "x"])).toEqual([2, 3, 15]);
  });
  it("returns [] for anything that is not an array", () => {
    expect(sanitizeMarked(undefined)).toEqual([]);
    expect(sanitizeMarked("0,1")).toEqual([]);
  });
});

describe("pickWinner", () => {
  const at = (s) => `2026-10-30T18:00:0${s}.000Z`;
  it("picks the earliest valid shout", () => {
    const w = pickWinner([
      { id: "b", valid: true, shouted_at: at(2) },
      { id: "a", valid: true, shouted_at: at(1) },
      { id: "c", valid: false, shouted_at: at(0) },
    ]);
    expect(w.id).toBe("a");
  });
  it("breaks an exact tie by board id, so every caller agrees", () => {
    const boards = [
      { id: "zz", valid: true, shouted_at: at(1) },
      { id: "aa", valid: true, shouted_at: at(1) },
    ];
    expect(pickWinner(boards).id).toBe("aa");
    expect(pickWinner([...boards].reverse()).id).toBe("aa");
  });
  it("ignores claims without a valid time and returns null when nobody won", () => {
    expect(pickWinner([{ id: "a", valid: true }, { id: "b", valid: true, shouted_at: "nope" }])).toBeNull();
    expect(pickWinner([])).toBeNull();
    expect(pickWinner(undefined)).toBeNull();
  });
});

describe("mergeGame", () => {
  const prev = { id: "g1", status: "playing", called_card_ids: ["c1", "c2", "c3"] };

  it("keeps the newer called list when a slow poll answers with an older one", () => {
    const merged = mergeGame(prev, { id: "g1", status: "playing", called_card_ids: ["c1", "c2"] });
    expect(merged.called_card_ids).toEqual(["c1", "c2", "c3"]);
  });
  it("takes a longer list from the server", () => {
    expect(mergeGame(prev, { ...prev, called_card_ids: ["c1", "c2", "c3", "c4"] }).called_card_ids).toHaveLength(4);
  });
  it("never unsets a winner or moves the status back", () => {
    const won = { ...prev, status: "finished", winner_board_id: "b1", winner_name: "Ana" };
    const merged = mergeGame(won, { ...prev });
    expect(merged.winner_board_id).toBe("b1");
    expect(merged.winner_name).toBe("Ana");
    expect(merged.status).toBe("finished");
    expect(mergeGame({ ...prev, status: "playing" }, { ...prev, status: "lobby" }).status).toBe("playing");
  });
  it("adds a winner that arrives from the server", () => {
    const merged = mergeGame(prev, { ...prev, status: "finished", winner_board_id: "b2", winner_name: "Beto" });
    expect(merged).toMatchObject({ status: "finished", winner_board_id: "b2", winner_name: "Beto" });
  });
  it("replaces the state for another game and handles empty inputs", () => {
    const other = { id: "g2", status: "lobby", called_card_ids: [] };
    expect(mergeGame(prev, other)).toBe(other);
    expect(mergeGame(null, other)).toBe(other);
    expect(mergeGame(prev, null)).toBe(prev);
  });
});

describe("planNextCall", () => {
  it("calls a card that was not called and moves the lobby to playing", () => {
    const plan = planNextCall({ id: "g1", status: "lobby", called_card_ids: ["c0"] }, CARDS, () => 0);
    expect(plan.card.id).toBe("c1");
    expect(plan.patch).toEqual({ called_card_ids: ["c0", "c1"], status: "playing" });
  });
  it("does not rewrite the status while playing and never touches the winner fields", () => {
    const plan = planNextCall({ id: "g1", status: "playing", called_card_ids: [] }, CARDS, () => 0);
    expect(Object.keys(plan.patch)).toEqual(["called_card_ids"]);
  });
  it("refuses to call after a winner, even if the status was not updated yet", () => {
    expect(planNextCall({ id: "g1", status: "playing", winner_board_id: "b1", called_card_ids: [] }, CARDS).reason).toBe("finished");
    expect(planNextCall({ id: "g1", status: "finished", called_card_ids: [] }, CARDS).reason).toBe("finished");
  });
  it("reports an exhausted deck and a missing game", () => {
    expect(planNextCall({ id: "g1", status: "playing", called_card_ids: CARD_IDS }, CARDS).reason).toBe("exhausted");
    expect(planNextCall(null, CARDS).reason).toBe("no-game");
  });
});

// ---------------------------------------------------------------- resolveClaim, one phone at a time

describe("resolveClaim", () => {
  it("accepts a valid line and makes it the winner", async () => {
    const db = fakeDb();
    seed(db, [{ id: "b1", marked: ROW0 }]);
    const res = await resolveClaim(db, { boardId: "b1" }, { ...fast, now: clock() });
    expect(res).toMatchObject({ valid: true, winningLine: ROW0, isFirstWinner: true, winnerName: "P-b1", calledCount: 5 });
    expect(db.tables.Game.get("g1")).toMatchObject({ winner_board_id: "b1", winner_name: "P-b1", status: "finished" });
  });

  it("does not count beans on cards that were not called", async () => {
    const db = fakeDb();
    seed(db, [{ id: "b1", marked: [4, 5, 6, 7] }]);
    const res = await resolveClaim(db, { boardId: "b1" }, fast);
    expect(res.valid).toBe(false);
    expect(db.tables.Game.get("g1").winner_board_id).toBeUndefined();
    expect(db.tables.Board.get("b1").valid).toBe(false);
  });

  it("uses the beans sent by the phone over stale stored ones and stores them", async () => {
    const db = fakeDb();
    seed(db, [{ id: "b1", marked: [0, 1] }]);
    const res = await resolveClaim(db, { boardId: "b1", marked: [3, 2, 1, 0, 99] }, fast);
    expect(res.isFirstWinner).toBe(true);
    expect(db.tables.Board.get("b1").marked).toEqual([0, 1, 2, 3]);
  });

  it("tells a late valid claim who already won and leaves the winner alone", async () => {
    const db = fakeDb();
    seed(db, [{ id: "b1", marked: ROW0 }, { id: "b2", marked: ROW0 }], {
      game: { status: "finished", winner_board_id: "b1", winner_name: "P-b1" },
    });
    const res = await resolveClaim(db, { boardId: "b2" }, fast);
    expect(res).toMatchObject({ valid: true, isFirstWinner: false, winnerName: "P-b1" });
    expect(db.tables.Game.get("g1").winner_board_id).toBe("b1");
  });

  it("answers the same to the winner pressing again and changes nothing", async () => {
    const db = fakeDb();
    seed(db, [{ id: "b1", marked: ROW0 }]);
    const now = clock();
    await resolveClaim(db, { boardId: "b1" }, { ...fast, now });
    const before = structuredClone(db.tables.Board.get("b1"));
    const again = await resolveClaim(db, { boardId: "b1", marked: [] }, { ...fast, now });
    expect(again).toMatchObject({ valid: true, isFirstWinner: true, winningLine: ROW0 });
    expect(db.tables.Board.get("b1")).toEqual(before);
  });

  it("keeps the time of the first valid shout when a board presses twice", async () => {
    const db = fakeDb();
    seed(db, [{ id: "b1", marked: ROW0 }], { game: { status: "finished", winner_board_id: "bX", winner_name: "X" } });
    const now = clock();
    await resolveClaim(db, { boardId: "b1" }, { ...fast, now });
    const first = db.tables.Board.get("b1").shouted_at;
    await resolveClaim(db, { boardId: "b1" }, { ...fast, now });
    expect(db.tables.Board.get("b1").shouted_at).toBe(first);
  });

  it("waits the settle window before choosing a winner", async () => {
    const db = fakeDb();
    seed(db, [{ id: "b1", marked: ROW0 }]);
    const sleeps = [];
    await resolveClaim(db, { boardId: "b1" }, { sleep: async (ms) => sleeps.push(ms) });
    expect(sleeps[0]).toBe(CLAIM_SETTLE_MS);
    expect(CLAIM_SETTLE_MS).toBeGreaterThanOrEqual(1000);
  });

  it("rejects a missing board id, an unknown board and a board without game", async () => {
    const db = fakeDb();
    seed(db, [{ id: "orphan", game_id: "nope" }]);
    await expect(resolveClaim(db, {}, fast)).rejects.toMatchObject({ status: 400 });
    await expect(resolveClaim(db, { boardId: "missing" }, fast)).rejects.toMatchObject({ status: 404 });
    await expect(resolveClaim(db, { boardId: "orphan" }, fast)).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------- resolveClaim, everyone at once

describe("simultaneous ¡Lotería!", () => {
  async function playRound(seedValue, claimFn, { winners = 4, losers = 3 } = {}) {
    const rand = mulberry32(seedValue);
    const db = fakeDb({ rand, maxDelay: 6 });
    const boards = [
      ...Array.from({ length: winners }, (_, i) => ({ id: `w${i}`, marked: ROW0 })),
      ...Array.from({ length: losers }, (_, i) => ({ id: `l${i}`, marked: [4, 5, 6, 7] })),
    ];
    seed(db, boards);
    const now = clock();
    const results = await Promise.all(
      boards.map(async (b) => {
        await wait(Math.floor(rand() * 4)); // phones press within a few ms of each other
        return [b.id, await claimFn(db, b.id, now)];
      })
    );
    return { db, results: Object.fromEntries(results) };
  }

  const claim = (db, id, now) => resolveClaim(db, { boardId: id }, { settleMs: 15, confirmMs: 5, now });

  it("always ends with exactly one winner, the earliest shout, and everyone agrees", async () => {
    for (let s = 1; s <= 60; s++) {
      const { db, results } = await playRound(s, claim);
      const firsts = Object.entries(results).filter(([, r]) => r.isFirstWinner);
      const game = db.tables.Game.get("g1");
      expect(firsts, `seed ${s}`).toHaveLength(1);
      expect(game.winner_board_id).toBe(firsts[0][0]);
      expect(game.winner_board_id).toBe(pickWinner([...db.tables.Board.values()]).id);
      for (const [id, r] of Object.entries(results)) {
        expect(r.valid).toBe(id.startsWith("w"));
        if (r.valid) expect(r.winnerName).toBe(game.winner_name);
      }
    }
  }, 30000);

  it("control: the previous algorithm crowned more than one winner in the same setup", async () => {
    let doubles = 0;
    for (let s = 1; s <= 60; s++) {
      const { results } = await playRound(s, (db, id) => naiveClaim(db, id));
      if (Object.values(results).filter((r) => r.isFirstWinner).length > 1) doubles++;
    }
    expect(doubles).toBeGreaterThan(0);
  }, 30000);
});

// ---------------------------------------------------------------- bean writes

describe("createLatestWriter", () => {
  it("stores the last value even when an older write is slower", async () => {
    let stored = null;
    const delays = [20, 0, 0];
    const writer = createLatestWriter(async (v) => {
      await wait(delays.shift() ?? 0);
      stored = v;
    });
    writer.push([0]);
    writer.push([0, 1]);
    await writer.push([0, 1, 2]);
    expect(stored).toEqual([0, 1, 2]);
  });

  it("collapses values pushed during a write into the newest one", async () => {
    const writes = [];
    const writer = createLatestWriter(async (v) => {
      writes.push(v);
      await wait(5);
    });
    writer.push(1);
    writer.push(2);
    writer.push(3);
    await writer.flush();
    expect(writes).toEqual([1, 3]);
  });

  it("keeps a failed value and sends it on flush", async () => {
    let fail = true;
    const writes = [];
    const writer = createLatestWriter(async (v) => {
      if (fail) throw new Error("offline");
      writes.push(v);
    });
    await expect(writer.push("a")).rejects.toThrow("offline");
    fail = false;
    await writer.flush();
    expect(writes).toEqual(["a"]);
  });
});

describe("nameFontSize", async () => {
  const { nameFontSize } = await import("../src/lib/fitText.js");
  it("keeps the design size for short names", () => {
    expect(nameFontSize("El VC", 12)).toBe(12);
  });
  it("shrinks so the longest word fits on one line", () => {
    const s = nameFontSize("La Networking", 12);
    expect(s).toBeLessThan(12);
    expect(s * 0.84 * "NETWORKING".length).toBeLessThanOrEqual(86.0001);
  });
  it("shrinks long names to fit in two lines and never goes below 4", () => {
    expect(nameFontSize("La demo que no cargó en el escenario principal", 12)).toBeLessThan(6);
    expect(nameFontSize("x".repeat(500), 12)).toBe(4);
    expect(nameFontSize("", 12)).toBe(12);
  });
});
