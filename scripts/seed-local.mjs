#!/usr/bin/env node
// Copy a deck (Deck + Cards) from a deployed LoterIA app into the local
// `npx base44 dev` database and open a lobby Game for it. The UI can then be polished
// with real cards, images and audio while spending zero integration credits
// (entity reads and writes are free, and the image and audio files stay on their public URLs).
//
// Usage, with `npx base44 dev` running in another terminal:
//   node scripts/seed-local.mjs                       # demo deck, app id from base44/.app.jsonc
//   node scripts/seed-local.mjs --deck <id> --code MTWDEV --mark-ready
//
// Options:
//   --deck <id>     deck to copy (default: the deck behind the live demo)
//   --app-id <id>   Base44 app id (default: read from base44/.app.jsonc)
//   --from <url>    source API host (default: https://app.base44.com, anonymous reads)
//   --to <url>      local backend (default: http://localhost:4400)
//   --code <CODE>   game code to create (default: a random MTW code)
//   --mark-ready    store the local deck as "ready" even if a card lacks image or audio
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGameCode } from "../base44/shared/loteria.js";

const DEMO_DECK = "6ae25793491b90f51d9fcfe1";
const FRONTEND = "http://localhost:5173";

function parseArgs(argv) {
  const opts = { deck: DEMO_DECK, from: "https://app.base44.com", to: "http://localhost:4400", code: "", markReady: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--deck") opts.deck = next();
    else if (a === "--app-id") opts.appId = next();
    else if (a === "--from") opts.from = next().replace(/\/$/, "");
    else if (a === "--to") opts.to = next().replace(/\/$/, "");
    else if (a === "--code") opts.code = next().toUpperCase();
    else if (a === "--mark-ready") opts.markReady = true;
    else if (a === "-h" || a === "--help") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function readAppId() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const text = readFileSync(join(root, "base44", ".app.jsonc"), "utf8");
  const json = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,\s*([}\]])/g, "$1");
  const id = JSON.parse(json).id;
  if (!id) throw new Error("No app id in base44/.app.jsonc");
  return id;
}

async function api(base, appId, path, init = {}) {
  const res = await fetch(`${base}/api/apps/${appId}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "Base44-App-Id": appId, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${base}${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Keep only the fields worth copying, dropping ids, timestamps and empty values. */
function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const appId = opts.appId || readAppId();
  const post = (base, path, body) => api(base, appId, path, { method: "POST", body: JSON.stringify(body) });

  // 1. Local backend up?
  try {
    await api(opts.to, appId, "/entities/Deck?limit=1");
  } catch (e) {
    throw new Error(`Local backend not reachable at ${opts.to}. Start it first with: npx base44 dev\n${e.message}`);
  }

  // 2. Read the source deck and its cards (anonymous reads, no credits)
  const deck = await api(opts.from, appId, `/entities/Deck/${opts.deck}`);
  const cards = (await api(opts.from, appId, `/entities/Card?deck_id=${opts.deck}`)).sort((a, b) => a.number - b.number);
  if (!cards.length) throw new Error(`Deck ${opts.deck} has no cards at ${opts.from}`);
  const withAssets = cards.filter((c) => c.image_url && (c.audio_url || c.audio_b64)).length;
  console.log(`Source deck "${deck.theme}" (${deck.status}, ${withAssets}/${cards.length} cards with image and audio)`);

  // 3. Copy the deck
  const deckBody = pick(deck, ["theme", "source_url", "status", "progress", "card_count", "shout_audio_url", "error", "provider"]);
  deckBody.card_count = deckBody.card_count || cards.length;
  deckBody.progress = withAssets;
  if (opts.markReady) deckBody.status = "ready";
  else deckBody.status = withAssets >= deckBody.card_count ? "ready" : deck.status || "generating";
  const localDeck = await post(opts.to, "/entities/Deck", deckBody);

  // 4. Copy the cards, in order
  for (const c of cards) {
    const body = pick(c, ["number", "name", "verse", "visual", "image_prompt", "image_url", "audio_url", "audio_b64", "asset_error"]);
    await post(opts.to, "/entities/Card", { ...body, deck_id: localDeck.id });
  }

  // 5. Open a lobby game
  let code = opts.code;
  for (let i = 0; i < 20; i++) {
    const candidate = code || makeGameCode();
    const taken = await api(opts.to, appId, `/entities/Game?code=${encodeURIComponent(candidate)}`);
    if (!taken.length) {
      code = candidate;
      break;
    }
    if (opts.code) throw new Error(`A local game with code ${opts.code} already exists`);
    code = "";
  }
  if (!code) throw new Error("Could not find a free game code");
  const game = await post(opts.to, "/entities/Game", { deck_id: localDeck.id, code, called_card_ids: [], status: "lobby" });

  console.log(`Local deck ${localDeck.id} with ${cards.length} cards, game ${game.code} (${game.id})`);
  console.log(`  Deck:      ${FRONTEND}/generar?deck=${localDeck.id}`);
  console.log(`  Projector: ${FRONTEND}/griton/${game.code}`);
  console.log(`  Phone:     ${FRONTEND}/tabla/${game.code}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
