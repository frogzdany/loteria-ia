// Pure helpers for the OpenAI provider: request bodies, response parsing and the strict
// schema conversion. No fetch here, so vitest covers this file offline; the HTTP calls
// live in providers.ts.

export const OPENAI_API = "https://api.openai.com/v1";

export const OPENAI_DEFAULTS = Object.freeze({
  textModel: "gpt-4.1-mini",
  imageModel: "gpt-image-1",
  imageQuality: "low", // low | medium | high. low is enough to see the layout; raise it for the real deck
  imageSize: "1024x1536", // portrait, like a card
  ttsModel: "gpt-4o-mini-tts",
  ttsVoice: "onyx",
});

export const GRITON_INSTRUCTIONS =
  "Habla como un gritón de lotería mexicana en una feria: voz festiva y grave, ritmo rápido, " +
  "acento de la Ciudad de México, y grita el nombre de la carta al final.";

/**
 * OpenAI strict structured outputs reject minItems/maxItems and need every object closed with
 * additionalProperties:false and all its properties listed in required. Returns a new schema.
 */
export function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "minItems" || k === "maxItems") continue;
    if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictSchema(pv)]));
    } else {
      out[k] = strictSchema(v);
    }
  }
  if (out.type === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties ?? {});
  }
  return out;
}

/** Body for POST /chat/completions. The count lives in the prompt; normalizeCards enforces it. */
export function buildChatRequest({ prompt, schema, model = OPENAI_DEFAULTS.textModel }) {
  return {
    model,
    messages: [
      {
        role: "system",
        content: "Eres el gritón de una lotería mexicana. Respondes solo con JSON válido que cumple el esquema.",
      },
      { role: "user", content: String(prompt) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "loteria_cards", strict: true, schema: strictSchema(schema) },
    },
  };
}

/** The parsed JSON object from a chat completion, or a readable error. */
export function parseChatCards(json) {
  const choice = json?.choices?.[0];
  const msg = choice?.message;
  if (msg?.refusal) throw new Error(`OpenAI refused: ${String(msg.refusal).slice(0, 200)}`);
  const content = typeof msg?.content === "string"
    ? msg.content
    : Array.isArray(msg?.content)
    ? msg.content.map((p) => p?.text ?? "").join("")
    : "";
  if (!content.trim()) throw new Error(`OpenAI returned no content (finish_reason=${choice?.finish_reason ?? "?"})`);
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`OpenAI returned non-JSON: ${content.slice(0, 200)}`);
  }
}

/** Models tried after the configured one when OpenAI says it does not exist or is not enabled for the account. */
export const IMAGE_MODEL_FALLBACKS = ["gpt-image-1-mini", "dall-e-3"];

/** gpt-image-1 needs organization verification; without it the API answers 400 "does not exist". */
export function isModelUnavailable(message) {
  return /does not exist|not found|verif|not have access|do not have access|unsupported model|invalid model/i.test(String(message ?? ""));
}

/**
 * Body for POST /images/generations. gpt-image models take low/medium/high quality, a 1024x1536
 * portrait and a jpeg output and always answer with base64. dall-e-3 takes standard/hd, 1024x1792
 * and is asked for base64 too, so the caller stores the file either way.
 */
export function buildImageRequest({
  prompt,
  model = OPENAI_DEFAULTS.imageModel,
  quality = OPENAI_DEFAULTS.imageQuality,
  size = OPENAI_DEFAULTS.imageSize,
}) {
  if (/^dall-e/i.test(model)) {
    return {
      model,
      prompt: String(prompt),
      n: 1,
      size: "1024x1792",
      quality: quality === "high" ? "hd" : "standard",
      response_format: "b64_json",
    };
  }
  return { model, prompt: String(prompt), n: 1, size, quality, output_format: "jpeg" };
}

export function parseImageResponse(json) {
  const d = json?.data?.[0];
  if (d?.b64_json) return { b64: d.b64_json };
  if (d?.url) return { url: d.url };
  throw new Error(`OpenAI image response has no data: ${JSON.stringify(json ?? null).slice(0, 200)}`);
}

/** Body for POST /audio/speech. */
export function buildSpeechRequest({
  text,
  model = OPENAI_DEFAULTS.ttsModel,
  voice = OPENAI_DEFAULTS.ttsVoice,
  instructions = GRITON_INSTRUCTIONS,
}) {
  return { model, voice, input: String(text), instructions, response_format: "mp3" };
}

export function decodeBase64(b64) {
  const bin = atob(String(b64 ?? "").replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function openaiErrorMessage(status, bodyText) {
  let detail = String(bodyText ?? "").slice(0, 300);
  try {
    const j = JSON.parse(bodyText);
    if (j?.error?.message) detail = String(j.error.message).slice(0, 300);
  } catch {
    // keep the raw text
  }
  return `OpenAI HTTP ${status}: ${detail}`;
}

/** One line for logs from either usage shape (chat: prompt/completion, images and responses: input/output). */
export function openaiUsageSummary(json) {
  const u = json?.usage ?? {};
  const inTok = u.prompt_tokens ?? u.input_tokens;
  const outTok = u.completion_tokens ?? u.output_tokens;
  if (inTok == null && outTok == null) return "usage n/a";
  return `tokens in=${inTok ?? "?"} out=${outTok ?? "?"}`;
}
