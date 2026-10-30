import { describe, it, expect } from "vitest";
import {
  CARDS_PER_DECK,
  BOARD_SIZE,
  LINES,
  findWinningLine,
  isWinner,
  calledPositions,
  shuffle,
  dealBoard,
  nextCard,
  makeGameCode,
  CARDS_SCHEMA,
  buildCardsPrompt,
  imagePrompt,
  ttsText,
  LOTERIA_SHOUT_TEXT,
  elevenStability,
  elevenBackoffMs,
  cleanContext,
  normalizeCards,
} from "../base44/shared/loteria.js";

const ids = Array.from({ length: 16 }, (_, i) => `c${i}`);
const boardWith = (marked) => ({ card_ids: ids, marked });
const seq = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("constants", () => {
  it("has 11 lines of 4 positions inside the 4x4 board", () => {
    expect(LINES).toHaveLength(11);
    for (const line of LINES) {
      expect(line).toHaveLength(4);
      for (const p of line) expect(p).toBeGreaterThanOrEqual(0), expect(p).toBeLessThan(BOARD_SIZE);
    }
    expect(CARDS_PER_DECK).toBe(16);
  });

  it("CARDS_SCHEMA requires name, verse and visual for exactly 16 cards", () => {
    const item = CARDS_SCHEMA.properties.cards;
    expect(item.minItems).toBe(16);
    expect(item.maxItems).toBe(16);
    expect(item.items.required).toEqual(["name", "verse", "visual"]);
  });
});

describe("findWinningLine / isWinner", () => {
  it.each(LINES.map((line, i) => [i, line]))("detects line %i", (_i, line) => {
    const board = boardWith(line);
    const called = line.map((p) => ids[p]);
    expect(findWinningLine(board, called)).toEqual(line);
    expect(isWinner(board, called)).toBe(true);
  });

  it("does not win when positions are marked but the cards were not called", () => {
    const board = boardWith([0, 1, 2, 3]);
    expect(isWinner(board, [])).toBe(false);
    expect(isWinner(board, ["c0", "c1", "c2"])).toBe(false);
  });

  it("does not win when cards were called but positions are not marked", () => {
    const board = boardWith([0, 1, 2]);
    expect(isWinner(board, ["c0", "c1", "c2", "c3"])).toBe(false);
  });

  it("wins with the four corners", () => {
    const board = boardWith([0, 3, 12, 15]);
    expect(findWinningLine(board, ["c0", "c3", "c12", "c15"])).toEqual([0, 3, 12, 15]);
  });

  it("ignores extra marks and extra called cards", () => {
    const board = boardWith([0, 1, 2, 3, 7, 9]);
    expect(isWinner(board, [...ids])).toBe(true);
  });

  it("returns null for empty or missing inputs", () => {
    expect(findWinningLine({ card_ids: ids, marked: [] }, ids)).toBeNull();
    expect(findWinningLine(null, ids)).toBeNull();
    expect(findWinningLine(undefined, undefined)).toBeNull();
    expect(isWinner({}, [])).toBe(false);
  });

  it("returns the first line in LINES order when two lines complete", () => {
    const marked = [0, 1, 2, 3, 4, 8, 12];
    const board = boardWith(marked);
    expect(findWinningLine(board, ids)).toEqual([0, 1, 2, 3]);
  });
});

describe("calledPositions", () => {
  it("returns positions whose card was called, in board order", () => {
    const board = boardWith([]);
    expect(calledPositions(board, ["c5", "c2", "zzz"])).toEqual([2, 5]);
  });

  it("returns an empty array for empty or missing inputs", () => {
    expect(calledPositions(boardWith([]), [])).toEqual([]);
    expect(calledPositions(null, ["c1"])).toEqual([]);
    expect(calledPositions(boardWith([]), undefined)).toEqual([]);
  });
});

describe("shuffle", () => {
  it("keeps length and multiset", () => {
    const out = shuffle(ids, seq([0.1, 0.9, 0.5, 0.3]));
    expect(out).toHaveLength(ids.length);
    expect([...out].sort()).toEqual([...ids].sort());
  });

  it("does not mutate the input", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = input.slice();
    shuffle(input, () => 0);
    expect(input).toEqual(copy);
  });

  it("is deterministic with the same rand sequence", () => {
    const a = shuffle(ids, seq([0.2, 0.7, 0.4]));
    const b = shuffle(ids, seq([0.2, 0.7, 0.4]));
    expect(a).toEqual(b);
  });

  it("rand always 0 rotates the first element to the end", () => {
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
  });

  it("handles empty and single element arrays", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["x"])).toEqual(["x"]);
  });
});

describe("dealBoard", () => {
  it("returns 16 ids from a 16 card deck", () => {
    const board = dealBoard(ids, seq([0.3, 0.6]));
    expect(board).toHaveLength(16);
    expect(new Set(board)).toEqual(new Set(ids));
  });

  it("throws with fewer than 16 cards or invalid input", () => {
    expect(() => dealBoard(ids.slice(0, 15))).toThrow(/16/);
    expect(() => dealBoard(null)).toThrow();
    expect(() => dealBoard([])).toThrow();
  });

  it("gives 16 distinct ids from a 20 card deck", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `d${i}`);
    const board = dealBoard(twenty, seq([0.15, 0.85, 0.5]));
    expect(board).toHaveLength(16);
    expect(new Set(board).size).toBe(16);
    for (const id of board) expect(twenty).toContain(id);
  });
});

describe("nextCard", () => {
  const cards = ids.map((id, i) => ({ id, number: i + 1 }));

  it("never returns a called card", () => {
    const called = ids.slice(0, 15);
    for (const r of [0, 0.5, 0.999]) {
      expect(nextCard(cards, called, () => r).id).toBe("c15");
    }
  });

  it("returns null when every card was called", () => {
    expect(nextCard(cards, ids)).toBeNull();
    expect(nextCard([], [])).toBeNull();
    expect(nextCard(undefined, undefined)).toBeNull();
  });

  it("is deterministic with an injected rand", () => {
    expect(nextCard(cards, [], () => 0).id).toBe("c0");
    expect(nextCard(cards, [], () => 0.999).id).toBe("c15");
    expect(nextCard(cards, ["c0"], () => 0).id).toBe("c1");
  });

  it("drains the whole deck without repeats", () => {
    const called = [];
    let c;
    while ((c = nextCard(cards, called))) called.push(c.id);
    expect(called).toHaveLength(16);
    expect(new Set(called).size).toBe(16);
  });
});

describe("makeGameCode", () => {
  it("has the MTW prefix plus 3 chars from the alphabet without 0/O/1/I", () => {
    for (let i = 0; i < 200; i++) {
      const code = makeGameCode();
      expect(code).toMatch(/^MTW[A-HJ-NP-Z2-9]{3}$/);
    }
  });

  it("is deterministic with an injected rand", () => {
    expect(makeGameCode("MTW", () => 0)).toBe("MTWAAA");
    expect(makeGameCode("MTW", () => 0.999)).toBe("MTW999");
    expect(makeGameCode("MTW", seq([0, 0.5, 0.999]))).toBe("MTWAS9");
  });

  it("accepts a custom prefix and uppercases it", () => {
    expect(makeGameCode("xy", () => 0)).toBe("XYAAA");
  });
});

describe("buildCardsPrompt", () => {
  it("includes the theme and the default count", () => {
    const p = buildCardsPrompt("Mexico Tech Week");
    expect(p).toContain('"Mexico Tech Week"');
    expect(p).toContain("exactamente 16 cartas");
  });

  it("includes the context block only when context is non empty", () => {
    expect(buildCardsPrompt("t", "")).not.toContain("inspiración");
    expect(buildCardsPrompt("t", "   \n ")).not.toContain("inspiración");
    const withCtx = buildCardsPrompt("t", "AI House en Roma Norte");
    expect(withCtx).toContain("inspiración");
    expect(withCtx).toContain("AI House en Roma Norte");
  });

  it("uses a custom count", () => {
    expect(buildCardsPrompt("t", "", 8)).toContain("exactamente 8 cartas");
  });
});

describe("imagePrompt", () => {
  it("includes the visual and forbids text", () => {
    const p = imagePrompt("  un founder con laptop  ");
    expect(p).toContain("Sujeto central: un founder con laptop.");
    expect(p).toContain("Sin texto");
  });
});

describe("ttsText", () => {
  const card = { name: "El pitch", verse: "Tres minutos tienes\npara convencer" };

  it("shouts the verse and the name, each with its own tag", () => {
    expect(ttsText(card)).toBe("[shouts] ¡Tres minutos tienes, para convencer! ... [shouts] ¡El pitch!");
  });

  it("accepts a custom tag", () => {
    expect(ttsText(card, "[excited]").startsWith("[excited] ¡")).toBe(true);
  });

  it("with an empty tag gives plain text", () => {
    expect(ttsText(card, "")).toBe("¡Tres minutos tienes, para convencer! ... ¡El pitch!");
  });

  it("does not double the exclamation marks", () => {
    expect(ttsText({ name: "¡La Demo!", verse: "¡Que no falle el wifi!" }, "")).toBe("¡Que no falle el wifi! ... ¡La Demo!");
  });

  it("exports the winner shout text", () => {
    expect(LOTERIA_SHOUT_TEXT).toContain("¡Lotería!");
  });
});

describe("cleanContext", () => {
  it("strips images, keeps link text and removes bare urls", () => {
    const md = "Hola ![logo](https://x.com/a.png) [Agenda](https://x.com/agenda) visita https://y.com/z hoy";
    const out = cleanContext(md);
    expect(out).not.toContain("http");
    expect(out).not.toContain("logo");
    expect(out).toContain("Agenda");
    expect(out).toContain("Hola");
  });

  it("collapses blank lines and trailing whitespace", () => {
    expect(cleanContext("a  \n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("truncates to maxChars", () => {
    expect(cleanContext("x".repeat(500), 100)).toHaveLength(100);
    expect(cleanContext("x".repeat(50000))).toHaveLength(12000);
  });

  it("returns an empty string for empty input", () => {
    expect(cleanContext("")).toBe("");
    expect(cleanContext(null)).toBe("");
    expect(cleanContext(undefined)).toBe("");
  });
});

describe("normalizeCards", () => {
  const make = (n, extra = {}) => ({
    cards: Array.from({ length: n }, (_, i) => ({
      name: `Carta ${i}`,
      verse: `verso ${i}`,
      visual: `visual ${i}`,
      ...extra,
    })),
  });

  it("returns exactly count cards", () => {
    expect(normalizeCards(make(20))).toHaveLength(16);
    expect(normalizeCards(make(8), 8)).toHaveLength(8);
  });

  it("dedupes by name case-insensitively", () => {
    const raw = make(16);
    raw.cards.push({ name: "CARTA 0", verse: "otro", visual: "x" });
    raw.cards[1] = { name: "carta 0", verse: "dup", visual: "x" };
    const out = normalizeCards(raw, 15);
    expect(out.filter((c) => c.name.toLowerCase() === "carta 0")).toHaveLength(1);
  });

  it("drops cards with an empty name or verse and throws when too few remain", () => {
    const raw = make(16);
    raw.cards[0].name = "  ";
    raw.cards[1].verse = "";
    expect(() => normalizeCards(raw)).toThrow(/14 usable cards, expected 16/);
  });

  it("throws on malformed input", () => {
    expect(() => normalizeCards(null)).toThrow();
    expect(() => normalizeCards({ cards: "nope" })).toThrow();
  });

  it("uses the name as visual fallback", () => {
    const raw = make(16);
    raw.cards[0].visual = "";
    delete raw.cards[1].visual;
    const out = normalizeCards(raw);
    expect(out[0].visual).toBe("Carta 0");
    expect(out[1].visual).toBe("Carta 1");
  });

  it("trims name, verse and visual", () => {
    const raw = make(16);
    raw.cards[0] = { name: "  El pitch ", verse: " verso \n", visual: "  algo " };
    expect(normalizeCards(raw)[0]).toEqual({ name: "El pitch", verse: "verso", visual: "algo" });
  });
});

describe("elevenStability", () => {
  it("defaults to 0.5 so the voice stays consistent", () => {
    expect(elevenStability(undefined, "eleven_v3")).toBe(0.5);
    expect(elevenStability("", "eleven_v3")).toBe(0.5);
    expect(elevenStability("abc", "eleven_flash_v2_5")).toBe(0.5);
  });

  it("snaps v3 values to 0, 0.5 or 1", () => {
    expect(elevenStability("0.2", "eleven_v3")).toBe(0);
    expect(elevenStability("0.4", "eleven_v3")).toBe(0.5);
    expect(elevenStability("0.9", "eleven_v3")).toBe(1);
  });

  it("keeps and clamps free values for other models", () => {
    expect(elevenStability("0.35", "eleven_flash_v2_5")).toBe(0.35);
    expect(elevenStability("7", "eleven_flash_v2_5")).toBe(1);
    expect(elevenStability("-1", "eleven_flash_v2_5")).toBe(0);
    expect(elevenStability("0.3", "eleven_v4")).toBe(0.5);
  });
});

describe("elevenBackoffMs", () => {
  it("grows per attempt and caps at 6 s plus jitter", () => {
    expect(elevenBackoffMs(1, () => 0)).toBe(1500);
    expect(elevenBackoffMs(2, () => 0)).toBe(3000);
    expect(elevenBackoffMs(10, () => 0)).toBe(6000);
    expect(elevenBackoffMs(1, () => 0.999)).toBe(2499);
  });
});
