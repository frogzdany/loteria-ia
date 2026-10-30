import { createClientFromRequest } from "npm:@base44/sdk@0.8.57";
import { secrets } from "base44:runtime";
import { ttsText } from "../../shared/loteria.js";
import { ELEVEN_MODEL_QUALITY, errMsg, parseJsonBody } from "../../shared/media.ts";
import { getProviders } from "../../shared/providers.ts";

const MAX_TEXT = 500;

export default async function (req: Request): Promise<Response> {
  const t0 = Date.now();
  const base44 = createClientFromRequest(req);
  const providers = getProviders(base44, req, secrets);
  const body = await parseJsonBody(req);
  const cardId = String(body.cardId ?? "").trim();
  let text = String(body.text ?? "").trim();
  let seed: number | undefined;
  let fallbackText: string | undefined;

  if (!cardId && !text) return Response.json({ error: "Provide cardId or text" }, { status: 400 });
  try {
    if (cardId) {
      const card = await base44.asServiceRole.entities.Card.get(cardId).catch(() => null);
      if (!card) return Response.json({ error: `Card ${cardId} not found` }, { status: 404 });
      text = ttsText(card);
      fallbackText = ttsText(card, "");
      seed = Number(card.number) || undefined;
    }
    // Same model and voice settings as the pre-generated cards (eleven_v3 with [shouts]), so a
    // card spoken live sounds like the rest of the deck. Costs about 2 s more than flash_v2_5.
    text = text.slice(0, MAX_TEXT);
    if (!text) return Response.json({ error: "Text is empty" }, { status: 400 });

    const r = await providers.synthesize({
      text,
      fallbackText,
      modelId: ELEVEN_MODEL_QUALITY,
      filename: cardId ? `speak-${cardId}.mp3` : "speak.mp3",
      timeoutMs: 30000,
      seed,
    });
    for (const w of r.warnings) console.log(`speak-card: warning: ${w}`);
    console.log(`speak-card: ${r.provider} ${text.length} chars in ${Date.now() - t0} ms`);
    const out: { audio_url?: string; audio_b64?: string; provider: string } = { provider: r.provider };
    if (r.audio_url) out.audio_url = r.audio_url;
    if (r.audio_b64) out.audio_b64 = r.audio_b64;
    return Response.json(out);
  } catch (e) {
    const error = errMsg(e);
    console.log(`speak-card: failure: ${error}`);
    return Response.json({ error }, { status: 500 });
  }
}
