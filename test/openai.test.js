import { describe, it, expect } from "vitest";
import { CARDS_SCHEMA } from "../base44/shared/loteria.js";
import {
  GRITON_INSTRUCTIONS,
  IMAGE_MODEL_FALLBACKS,
  isModelUnavailable,
  OPENAI_API,
  OPENAI_DEFAULTS,
  buildChatRequest,
  buildImageRequest,
  buildSpeechRequest,
  decodeBase64,
  openaiErrorMessage,
  openaiUsageSummary,
  parseChatCards,
  parseImageResponse,
  strictSchema,
} from "../base44/shared/openai.js";

describe("strictSchema", () => {
  it("drops minItems/maxItems and closes every object", () => {
    const s = strictSchema(CARDS_SCHEMA);
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["cards"]);
    expect(s.properties.cards.minItems).toBeUndefined();
    expect(s.properties.cards.maxItems).toBeUndefined();
    expect(s.properties.cards.items.additionalProperties).toBe(false);
    expect(s.properties.cards.items.required).toEqual(["name", "verse", "visual"]);
    expect(s.properties.cards.items.properties.name.type).toBe("string");
  });

  it("does not mutate the input schema", () => {
    strictSchema(CARDS_SCHEMA);
    expect(CARDS_SCHEMA.properties.cards.minItems).toBe(16);
    expect(CARDS_SCHEMA.additionalProperties).toBeUndefined();
  });

  it("passes scalars and arrays through", () => {
    expect(strictSchema("x")).toBe("x");
    expect(strictSchema(["a", { type: "object", properties: {} }])).toEqual(["a", { type: "object", properties: {}, additionalProperties: false, required: [] }]);
  });
});

describe("chat completion", () => {
  it("builds a strict json_schema request with the prompt as the user turn", () => {
    const body = buildChatRequest({ prompt: "haz 4 cartas", schema: CARDS_SCHEMA });
    expect(body.model).toBe(OPENAI_DEFAULTS.textModel);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "haz 4 cartas" });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.cards.maxItems).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it("honors the model override", () => {
    expect(buildChatRequest({ prompt: "x", schema: CARDS_SCHEMA, model: "gpt-5-mini" }).model).toBe("gpt-5-mini");
  });

  it("parses the JSON content, as a string or as parts", () => {
    expect(parseChatCards({ choices: [{ message: { content: '{"cards":[]}' } }] })).toEqual({ cards: [] });
    const parts = { choices: [{ message: { content: [{ type: "text", text: '{"cards":' }, { type: "text", text: "[]}" }] } }] };
    expect(parseChatCards(parts)).toEqual({ cards: [] });
  });

  it("throws readable errors on refusal, empty and non-JSON answers", () => {
    expect(() => parseChatCards({ choices: [{ message: { refusal: "no" } }] })).toThrow(/refused/);
    expect(() => parseChatCards({ choices: [{ finish_reason: "length", message: { content: "" } }] })).toThrow(/no content.*length/);
    expect(() => parseChatCards({ choices: [{ message: { content: "not json" } }] })).toThrow(/non-JSON/);
    expect(() => parseChatCards(null)).toThrow(/no content/);
  });
});

describe("image generation", () => {
  it("defaults to gpt-image-1, low quality, portrait, one jpeg", () => {
    expect(buildImageRequest({ prompt: "un gallo" })).toEqual({
      model: "gpt-image-1",
      prompt: "un gallo",
      n: 1,
      size: "1024x1536",
      quality: "low",
      output_format: "jpeg",
    });
  });

  it("honors model and quality overrides", () => {
    const b = buildImageRequest({ prompt: "x", model: "gpt-image-1-mini", quality: "high" });
    expect(b.model).toBe("gpt-image-1-mini");
    expect(b.quality).toBe("high");
  });

  it("shapes a dall-e-3 request differently: portrait 1024x1792, standard/hd, base64 answer", () => {
    const b = buildImageRequest({ prompt: "x", model: "dall-e-3" });
    expect(b).toEqual({ model: "dall-e-3", prompt: "x", n: 1, size: "1024x1792", quality: "standard", response_format: "b64_json" });
    expect(buildImageRequest({ prompt: "x", model: "dall-e-3", quality: "high" }).quality).toBe("hd");
    expect(buildImageRequest({ prompt: "x", model: "dall-e-3" }).output_format).toBeUndefined();
  });

  it("lists the fallback models and recognizes an unavailable-model error", () => {
    expect(IMAGE_MODEL_FALLBACKS).toEqual(["gpt-image-1-mini", "dall-e-3"]);
    expect(isModelUnavailable("OpenAI HTTP 400: The model 'gpt-image-1' does not exist.")).toBe(true);
    expect(isModelUnavailable("Your organization must be verified to use the model")).toBe(true);
    expect(isModelUnavailable("OpenAI HTTP 429: Rate limit reached")).toBe(false);
    expect(isModelUnavailable("")).toBe(false);
  });

  it("parses base64 or url answers and rejects empty ones", () => {
    expect(parseImageResponse({ data: [{ b64_json: "QUJD" }] })).toEqual({ b64: "QUJD" });
    expect(parseImageResponse({ data: [{ url: "https://x/y.png" }] })).toEqual({ url: "https://x/y.png" });
    expect(() => parseImageResponse({ data: [] })).toThrow(/no data/);
    expect(() => parseImageResponse(undefined)).toThrow(/no data/);
  });
});

describe("speech", () => {
  it("builds an mp3 request with the gritón instructions", () => {
    const b = buildSpeechRequest({ text: "¡El founder!" });
    expect(b).toEqual({
      model: OPENAI_DEFAULTS.ttsModel,
      voice: OPENAI_DEFAULTS.ttsVoice,
      input: "¡El founder!",
      instructions: GRITON_INSTRUCTIONS,
      response_format: "mp3",
    });
    expect(buildSpeechRequest({ text: "x", voice: "ash" }).voice).toBe("ash");
  });
});

describe("helpers", () => {
  it("points at the public API", () => {
    expect(OPENAI_API).toBe("https://api.openai.com/v1");
  });

  it("decodes base64 to bytes", () => {
    expect(Array.from(decodeBase64(btoa("hola")))).toEqual([104, 111, 108, 97]);
    expect(decodeBase64("").length).toBe(0);
  });

  it("extracts the OpenAI error message when the body is JSON", () => {
    expect(openaiErrorMessage(429, JSON.stringify({ error: { message: "Rate limit reached" } }))).toBe("OpenAI HTTP 429: Rate limit reached");
    expect(openaiErrorMessage(502, "<html>bad gateway</html>")).toBe("OpenAI HTTP 502: <html>bad gateway</html>");
  });

  it("summarizes usage from the chat and the image shapes", () => {
    expect(openaiUsageSummary({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toBe("tokens in=10 out=5");
    expect(openaiUsageSummary({ usage: { input_tokens: 100, output_tokens: 1000 } })).toBe("tokens in=100 out=1000");
    expect(openaiUsageSummary({})).toBe("usage n/a");
  });
});
