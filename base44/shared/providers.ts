// Provider layer for the three AI-dependent steps: card texts, card image, speech.
//
// "base44": Core.InvokeLLM, Core.GenerateImage, ElevenLabs (GenerateSpeech fallback) and
//           UploadFile. Spends Base44 integration credits and ElevenLabs characters.
// "openai": chat completions with structured output for the cards, gpt-image-1 for the
//           images (stored with UploadFile), ElevenLabs for the voice when configured and
//           OpenAI TTS otherwise. Needs OPENAI_API_KEY; Base44 credits only for UploadFile.
// "mock":   deterministic and offline, no key: 24 fixed cards, SVG placeholders and a short
//           WAV beep per card. UploadFile stores the WAV, which the local dev
//           server emulates on disk; if it fails the audio becomes a data URL.
//
// Base44 blocks InvokeLLM and GenerateImage from the local dev runtime (`npx base44 dev`),
// so on a loopback host the provider is "openai" when OPENAI_API_KEY is set, else "mock".
// Anywhere else it is "base44". The LOTERIA_PROVIDER secret overrides all of that.
import {
  hashText,
  mockCardsResponse,
  mockImageDataUrl,
  mockWavBytes,
  resolveProviderName,
  wavFilename,
} from "./mock.js";
import {
  buildChatRequest,
  buildImageRequest,
  buildSpeechRequest,
  decodeBase64,
  IMAGE_MODEL_FALLBACKS,
  isModelUnavailable,
  OPENAI_API,
  OPENAI_DEFAULTS,
  openaiErrorMessage,
  openaiUsageSummary,
  parseChatCards,
  parseImageResponse,
} from "./openai.js";
import {
  elevenLabsStep,
  errMsg,
  storeFile,
  storeMp3,
  stripAudioTags,
  synthesizeAndStore,
  toBase64,
  withTimeout,
} from "./media.ts";
import type { SynthResult } from "./media.ts";

export type ProviderName = "base44" | "mock" | "openai";

export type SynthesizeOpts = {
  text: string; // text for ElevenLabs (may include v3 tags)
  fallbackText?: string; // text for the fallback TTS (no tags)
  modelId: string;
  filename: string; // .mp3 name; the mock stores a .wav instead
  timeoutMs?: number;
  seed?: number; // mock only: picks the beep pitch (card number)
};

export type SynthesizeResult = SynthResult;

export interface Providers {
  name: ProviderName;
  generateCards(args: { prompt: string; schema: unknown; count: number; timeoutMs?: number }): Promise<unknown>;
  generateImage(args: { prompt: string; card?: { number?: number; name?: string }; timeoutMs?: number }): Promise<string>;
  synthesize(opts: SynthesizeOpts): Promise<SynthesizeResult>;
}

type Secrets = { get(key: string): string | null | undefined };

// deno-lint-ignore no-explicit-any
export function getProviders(base44: any, req: Request, secrets: Secrets): Providers {
  const name = resolveProviderName(secrets.get("LOTERIA_PROVIDER"), {
    requestUrl: req.url,
    openaiKey: secrets.get("OPENAI_API_KEY") ?? "",
  }) as ProviderName;
  if (name === "mock") return mockProviders(base44);
  if (name === "openai") return openaiProviders(base44, secrets);
  return base44Providers(base44, secrets);
}

/** For logs: which runtime and host served the request (helps to see why a provider was picked). */
export function describeRuntime(req: Request): string {
  // deno-lint-ignore no-explicit-any
  const deno = typeof (globalThis as any).Deno !== "undefined";
  let host = "?";
  try {
    host = new URL(req.url).host;
  } catch { /* ignore */ }
  return `${deno ? "deno" : "non-deno"} host=${host}`;
}

// ---------------------------------------------------------------- base44

// deno-lint-ignore no-explicit-any
function base44Providers(base44: any, secrets: Secrets): Providers {
  return {
    name: "base44",
    async generateCards({ prompt, schema, timeoutMs = 150000 }) {
      return await withTimeout(
        base44.asServiceRole.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }),
        timeoutMs,
        "InvokeLLM",
      );
    },
    async generateImage({ prompt, timeoutMs = 120000 }) {
      const res = await withTimeout(
        base44.asServiceRole.integrations.Core.GenerateImage({ prompt }),
        timeoutMs,
        "GenerateImage",
      );
      // deno-lint-ignore no-explicit-any
      const url = (res as any)?.url;
      if (!url) throw new Error(`GenerateImage returned no url: ${JSON.stringify(res).slice(0, 200)}`);
      return url as string;
    },
    synthesize(opts) {
      return synthesizeAndStore(base44, {
        text: opts.text,
        fallbackText: opts.fallbackText,
        modelId: opts.modelId,
        filename: opts.filename,
        timeoutMs: opts.timeoutMs,
        apiKey: secrets.get("ELEVENLABS_API_KEY"),
        voiceId: secrets.get("ELEVENLABS_VOICE_ID"),
        stability: secrets.get("ELEVENLABS_STABILITY"),
        modelOverride: secrets.get("ELEVENLABS_MODEL"),
      });
    },
  };
}

// ---------------------------------------------------------------- openai

/** POST to the OpenAI API with a timeout; retries 429 and 5xx twice (image rate limits are low on new accounts). */
async function openaiPost(path: string, body: unknown, apiKey: string, timeoutMs: number, attempts = 3): Promise<Response> {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${OPENAI_API}${path}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || i === attempts) throw new Error(openaiErrorMessage(res.status, text));
    const header = Number(res.headers.get("retry-after")) * 1000;
    const wait = Math.min(15000, header > 0 ? header : 5000 * i);
    console.log(`OpenAI ${path} HTTP ${res.status}, retry ${i}/${attempts - 1} in ${wait} ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error("unreachable");
}

// deno-lint-ignore no-explicit-any
function openaiProviders(base44: any, secrets: Secrets): Providers {
  const cfg = {
    apiKey: secrets.get("OPENAI_API_KEY") ?? "",
    textModel: secrets.get("OPENAI_TEXT_MODEL") || OPENAI_DEFAULTS.textModel,
    imageModel: secrets.get("OPENAI_IMAGE_MODEL") || OPENAI_DEFAULTS.imageModel,
    imageQuality: secrets.get("OPENAI_IMAGE_QUALITY") || OPENAI_DEFAULTS.imageQuality,
    ttsVoice: secrets.get("OPENAI_TTS_VOICE") || OPENAI_DEFAULTS.ttsVoice,
  };
  const key = () => {
    if (!cfg.apiKey) throw new Error("LOTERIA_PROVIDER=openai but OPENAI_API_KEY is missing");
    return cfg.apiKey;
  };
  return {
    name: "openai",
    async generateCards({ prompt, schema, timeoutMs = 120000 }) {
      const t0 = Date.now();
      const res = await openaiPost("/chat/completions", buildChatRequest({ prompt, schema, model: cfg.textModel }), key(), timeoutMs);
      const json = await res.json();
      console.log(`OpenAI ${cfg.textModel}: ${openaiUsageSummary(json)} in ${Date.now() - t0} ms`);
      return parseChatCards(json);
    },
    async generateImage({ prompt, card, timeoutMs = 120000 }) {
      const t0 = Date.now();
      // Try the configured model, then the fallbacks, skipping models this account cannot use.
      const models = [cfg.imageModel, ...IMAGE_MODEL_FALLBACKS].filter((m, i, all) => all.indexOf(m) === i);
      let json: unknown = null;
      let used = "";
      for (const model of models) {
        try {
          const body = buildImageRequest({ prompt, model, quality: cfg.imageQuality });
          const res = await openaiPost("/images/generations", body, key(), timeoutMs);
          json = await res.json();
          used = model;
          break;
        } catch (e) {
          const msg = errMsg(e);
          if (!isModelUnavailable(msg) || model === models[models.length - 1]) throw e;
          console.log(`OpenAI image model ${model} unavailable (${msg.slice(0, 120)}), trying ${models[models.indexOf(model) + 1]}`);
        }
      }
      const img = parseImageResponse(json);
      let bytes: Uint8Array;
      if (img.b64) {
        bytes = decodeBase64(img.b64);
      } else {
        // dall-e style answers give a URL that expires in an hour: copy the file to our storage
        const dl = await fetch(img.url as string, { signal: AbortSignal.timeout(60000) });
        if (!dl.ok) throw new Error(`Image download HTTP ${dl.status}`);
        bytes = new Uint8Array(await dl.arrayBuffer());
      }
      console.log(`OpenAI ${used} ${cfg.imageQuality}: ${bytes.length} bytes, ${openaiUsageSummary(json)}, ${Date.now() - t0} ms`);
      const { url } = await storeFile(base44, bytes, `card-${card?.number ?? 0}.jpg`, "image/jpeg");
      return url;
    },
    async synthesize(opts) {
      const warnings: string[] = [];
      const el = await elevenLabsStep(base44, {
        text: opts.text,
        modelId: opts.modelId,
        filename: opts.filename,
        timeoutMs: opts.timeoutMs,
        apiKey: secrets.get("ELEVENLABS_API_KEY"),
        voiceId: secrets.get("ELEVENLABS_VOICE_ID"),
        stability: secrets.get("ELEVENLABS_STABILITY"),
        modelOverride: secrets.get("ELEVENLABS_MODEL"),
      }, warnings);
      if (el) return el;
      const t0 = Date.now();
      const text = stripAudioTags(opts.fallbackText ?? opts.text);
      const res = await openaiPost("/audio/speech", buildSpeechRequest({ text, voice: cfg.ttsVoice }), key(), opts.timeoutMs ?? 60000);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 500) throw new Error(`OpenAI TTS returned a suspiciously small file (${bytes.length} bytes)`);
      console.log(`OpenAI ${OPENAI_DEFAULTS.ttsModel}/${cfg.ttsVoice}: ${bytes.length} bytes, ${text.length} chars, ${Date.now() - t0} ms`);
      const { audio_url } = await storeMp3(base44, bytes, opts.filename);
      return { audio_url, provider: "openai-tts", bytes: bytes.length, warnings };
    },
  };
}

// ---------------------------------------------------------------- mock

// deno-lint-ignore no-explicit-any
function mockProviders(base44: any): Providers {
  return {
    name: "mock",
    generateCards({ count }) {
      return Promise.resolve(mockCardsResponse(count));
    },
    generateImage({ card }) {
      return Promise.resolve(mockImageDataUrl(card ?? {}));
    },
    async synthesize(opts) {
      const bytes = mockWavBytes({ seed: opts.seed ?? hashText(opts.text) });
      const filename = wavFilename(opts.filename);
      try {
        const { url } = await storeFile(base44, bytes, filename, "audio/wav", 1);
        return { audio_url: url, provider: "mock", bytes: bytes.length, warnings: [] };
      } catch (e) {
        return {
          audio_url: `data:audio/wav;base64,${toBase64(bytes)}`,
          provider: "mock",
          bytes: bytes.length,
          warnings: [`UploadFile failed, using a data URL: ${errMsg(e)}`],
        };
      }
    },
  };
}
