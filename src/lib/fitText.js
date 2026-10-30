/**
 * Font size (in cqw of the card) that keeps a card name on whole words: the longest word must fit
 * on one line and the whole name in two. Alfa Slab One capitals are about 0.84 em wide (measured: NETWORKING overflowed at 0.72).
 * Returns `base` when the name already fits, so short names keep the design size.
 */
export function nameFontSize(name, base, { width = 86, lines = 2, charEm = 0.84 } = {}) {
  const text = String(name ?? "").trim().toUpperCase();
  if (!text) return base;
  const longest = Math.max(...text.split(/\s+/).map((w) => w.length));
  const byWord = width / (longest * charEm);
  const byTotal = (width * lines) / (text.length * charEm);
  return Math.max(4, Math.min(base, byWord, byTotal));
}
