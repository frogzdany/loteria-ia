import { createClientFromRequest } from "npm:@base44/sdk@0.8.57";
import { secrets } from "base44:runtime";
import { imagePrompt, ttsText } from "../../shared/loteria.js";
import { ELEVEN_MODEL_QUALITY, errMsg, parseJsonBody } from "../../shared/media.ts";
import { describeRuntime, getProviders } from "../../shared/providers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// deno-lint-ignore no-explicit-any
const isComplete = (c: any) => !!c.image_url && !!(c.audio_url || c.audio_b64);

// deno-lint-ignore no-explicit-any
async function recomputeProgress(db: any, deckId: string) {
  const deck = await db.Deck.get(deckId);
  const cards = await db.Card.filter({ deck_id: deckId });
  const progress = cards.filter(isComplete).length;
  const cardCount = Number(deck?.card_count) || cards.length;
  const status = progress >= cardCount ? "ready" : (deck?.status === "error" ? "error" : "generating");
  if (deck && (deck.progress !== progress || deck.status !== status)) {
    await db.Deck.update(deckId, { progress, status });
  }
  return { progress, status, cardCount };
}

export default async function (req: Request): Promise<Response> {
  const t0 = Date.now();
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities;
  const providers = getProviders(base44, req, secrets);
  const body = await parseJsonBody(req);
  const cardId = String(body.cardId ?? "").trim();
  const force = body.force === true;
  if (!cardId) return Response.json({ error: "cardId is required" }, { status: 400 });

  // deno-lint-ignore no-explicit-any
  let card: any = null;
  try {
    card = await db.Card.get(cardId);
  } catch (e) {
    console.log(`generate-card-assets: Card.get(${cardId}) failed: ${errMsg(e)}`);
  }
  if (!card) return Response.json({ error: `Card ${cardId} not found` }, { status: 404 });

  try {
    const wantImage = !card.image_url || force;
    const wantAudio = !(card.audio_url || card.audio_b64) || force;
    console.log(`generate-card-assets: card ${cardId} #${card.number} "${card.name}" image=${wantImage} audio=${wantAudio} force=${force} provider=${providers.name} ${describeRuntime(req)}`);

    const imageTask = wantImage
      ? (async () => {
        const ti = Date.now();
        const url = await providers.generateImage({
          prompt: card.image_prompt || imagePrompt(card.visual || card.name),
          card: { number: card.number, name: card.name },
          timeoutMs: 120000,
        });
        console.log(`generate-card-assets: image via ${providers.name} in ${Date.now() - ti} ms`);
        return url;
      })()
      : Promise.resolve(null);

    const audioTask = wantAudio
      ? (async () => {
        const ta = Date.now();
        const r = await providers.synthesize({
          text: ttsText(card),
          fallbackText: ttsText(card, ""),
          modelId: ELEVEN_MODEL_QUALITY,
          filename: `card-${card.number}.mp3`,
          timeoutMs: 60000,
          seed: Number(card.number) || 0,
        });
        console.log(`generate-card-assets: audio via ${r.provider} in ${Date.now() - ta} ms`);
        return r;
      })()
      : Promise.resolve(null);

    const [img, aud] = await Promise.allSettled([imageTask, audioTask]);
    const errors: string[] = [];
    // deno-lint-ignore no-explicit-any
    const patch: Record<string, any> = {};

    if (img.status === "fulfilled") {
      if (img.value) patch.image_url = img.value;
    } else {
      errors.push(`image: ${errMsg(img.reason)}`);
    }
    if (aud.status === "fulfilled") {
      const a = aud.value;
      if (a) {
        if (a.audio_url) {
          patch.audio_url = a.audio_url;
          patch.audio_b64 = "";
        } else if (a.audio_b64) {
          patch.audio_b64 = a.audio_b64;
          patch.audio_url = "";
        }
        // ElevenLabs->GenerateSpeech fallback or base64 fallback are not errors, just logged warnings.
        for (const w of a.warnings) console.log(`generate-card-assets: warning: ${w}`);
      }
    } else {
      errors.push(`audio: ${errMsg(aud.reason)}`);
    }
    patch.asset_error = errors.join(" | ");

    try {
      await db.Card.update(cardId, patch);
    } catch (e) {
      errors.push(`save: ${errMsg(e)}`);
    }

    let { progress, status, cardCount } = await recomputeProgress(db, card.deck_id);
    if (progress < cardCount && progress >= cardCount - 4) {
      // Near the end, concurrent workers (pool of 4) may finish between our read and write; re-check once.
      await sleep(1500);
      ({ progress, status } = await recomputeProgress(db, card.deck_id));
    }

    const fresh = await db.Card.get(cardId).catch(() => ({ ...card, ...patch }));
    console.log(`generate-card-assets: done in ${Date.now() - t0} ms, progress ${progress}/${cardCount}, errors=${errors.length}`);
    return Response.json({ card: fresh, progress, status, errors, provider: providers.name });
  } catch (e) {
    const error = errMsg(e);
    console.log(`generate-card-assets: unexpected failure: ${error}`);
    try {
      await db.Card.update(cardId, { asset_error: error });
    } catch { /* ignore */ }
    return Response.json({ error }, { status: 500 });
  }
}
