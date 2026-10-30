import { createClientFromRequest } from "npm:@base44/sdk@0.8.57";
import { secrets } from "base44:runtime";
import {
  buildCardsPrompt,
  CARDS_PER_DECK,
  CARDS_SCHEMA,
  cleanContext,
  imagePrompt,
  LOTERIA_SHOUT_TEXT,
  normalizeCards,
} from "../../shared/loteria.js";
import { ELEVEN_MODEL_QUALITY, errMsg, parseJsonBody, scrapeMarkdown } from "../../shared/media.ts";
import { describeRuntime, getProviders } from "../../shared/providers.ts";

const MAX_CARDS = 24;

/** CARDS_SCHEMA pins 16 items; adapt min/max to the requested count. */
function schemaFor(count: number) {
  // deno-lint-ignore no-explicit-any
  const s: any = structuredClone(CARDS_SCHEMA);
  s.properties.cards.minItems = count;
  s.properties.cards.maxItems = count;
  return s;
}

export default async function (req: Request): Promise<Response> {
  const t0 = Date.now();
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities;
  const providers = getProviders(base44, req, secrets);
  const body = await parseJsonBody(req);

  let theme = String(body.theme ?? "").trim();
  const sourceUrl = String(body.sourceUrl ?? "").trim();
  const rawCount = Number(body.count ?? CARDS_PER_DECK);
  const count = Number.isFinite(rawCount) ? Math.min(MAX_CARDS, Math.max(1, Math.round(rawCount))) : CARDS_PER_DECK;

  if (!theme && !sourceUrl) {
    return Response.json({ error: "Provide at least one of theme or sourceUrl" }, { status: 400 });
  }
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    return Response.json({ error: "sourceUrl must start with http:// or https://" }, { status: 400 });
  }

  let deckId = "";
  try {
    const deck = await db.Deck.create({
      theme: theme || sourceUrl,
      source_url: sourceUrl || undefined,
      status: "generating",
      progress: 0,
      card_count: count,
      provider: providers.name,
    });
    deckId = deck.id;
    console.log(
      `generate-deck: deck ${deckId} created (count=${count}, theme="${theme}", url="${sourceUrl}", provider=${providers.name}, ${describeRuntime(req)})`,
    );

    // 1. Optional scrape (non-fatal). The mock provider ignores the page, so skip the call.
    let context = "";
    const fcKey = secrets.get("FIRECRAWL_API_KEY");
    if (sourceUrl && providers.name === "mock") {
      console.log("generate-deck: mock provider, skipping scrape");
    } else if (sourceUrl && fcKey) {
      try {
        const ts = Date.now();
        const { markdown, title } = await scrapeMarkdown(sourceUrl, fcKey, 30000);
        context = cleanContext(markdown);
        if (!theme) theme = title || "Mexico Tech Week";
        console.log(`generate-deck: scraped ${markdown.length} chars -> context ${context.length} chars in ${Date.now() - ts} ms`);
      } catch (e) {
        console.log(`generate-deck: scrape failed (continuing with theme only): ${errMsg(e)}`);
      }
    } else if (sourceUrl) {
      console.log("generate-deck: FIRECRAWL_API_KEY missing, skipping scrape");
    }
    if (!theme) theme = "Mexico Tech Week";
    await db.Deck.update(deckId, { theme });

    // 2. Cards text (one retry if the output is unusable)
    let cards: Array<{ name: string; verse: string; visual: string }> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2 && !cards; attempt++) {
      try {
        const tl = Date.now();
        const raw = await providers.generateCards({
          prompt: buildCardsPrompt(theme, context, count),
          schema: schemaFor(count),
          count,
          timeoutMs: 150000,
        });
        cards = normalizeCards(raw, count);
        console.log(`generate-deck: ${providers.name} cards attempt ${attempt} ok in ${Date.now() - tl} ms`);
      } catch (e) {
        lastErr = e;
        console.log(`generate-deck: cards attempt ${attempt} failed: ${errMsg(e)}`);
      }
    }
    if (!cards) throw new Error(`Card generation failed: ${errMsg(lastErr)}`);

    // 3. Save cards
    const created = await db.Card.bulkCreate(
      cards.map((c, i) => ({
        deck_id: deckId,
        number: i + 1,
        name: c.name,
        verse: c.verse,
        visual: c.visual,
        image_prompt: imagePrompt(c.visual),
      })),
    );
    // deno-lint-ignore no-explicit-any
    let saved: any[] = Array.isArray(created) ? created : [];
    if (saved.length !== cards.length || !saved.every((c) => c?.id)) {
      saved = await db.Card.filter({ deck_id: deckId });
    }
    saved.sort((a, b) => a.number - b.number);
    console.log(`generate-deck: ${saved.length} cards saved`);

    // 4. Best-effort shout audio
    try {
      const shout = await providers.synthesize({
        text: LOTERIA_SHOUT_TEXT,
        modelId: ELEVEN_MODEL_QUALITY,
        filename: `deck-${deckId}-loteria.mp3`,
        timeoutMs: 45000,
      });
      const shoutUrl = shout.audio_url ?? (shout.audio_b64 ? `data:audio/mpeg;base64,${shout.audio_b64}` : undefined);
      if (shoutUrl) await db.Deck.update(deckId, { shout_audio_url: shoutUrl });
      console.log(`generate-deck: shout audio via ${shout.provider}`);
    } catch (e) {
      console.log(`generate-deck: shout audio failed (non-fatal): ${errMsg(e)}`);
    }

    console.log(`generate-deck: done in ${Date.now() - t0} ms`);
    return Response.json({
      deckId,
      theme,
      provider: providers.name,
      cards: saved.map((c) => ({ id: c.id, number: c.number, name: c.name, verse: c.verse })),
    });
  } catch (e) {
    const error = errMsg(e);
    console.log(`generate-deck: FATAL ${error}`);
    if (deckId) {
      try {
        await db.Deck.update(deckId, { status: "error", error });
      } catch (e2) {
        console.log(`generate-deck: could not mark deck as error: ${errMsg(e2)}`);
      }
    }
    return Response.json({ error, deckId: deckId || null }, { status: 500 });
  }
}
