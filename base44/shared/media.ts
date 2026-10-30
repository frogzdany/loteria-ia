// Backend-only helpers shared by the Lotería functions (Deno runtime).
// Every external call has a timeout and throws an Error with a readable message.

import { elevenBackoffMs, elevenStability } from "./loteria.js";

export const ELEVEN_MODEL_QUALITY = "eleven_v3";
export const ELEVEN_MODEL_FAST = "eleven_flash_v2_5";
/** v3 and v4 read audio tags like [shouts] as directions; older models would say them aloud. */
export function supportsAudioTags(modelId: string): boolean {
  return /^eleven_v[34]/.test(String(modelId));
}

/** Pins the language so the voice does not drift to another accent between cards. */
export const ELEVEN_LANGUAGE = "es";

/**
 * ElevenLabs answered 429 on every attempt (the Starter plan allows 3 concurrent requests and
 * the generator runs 4 cards at a time). Callers must not fall back to another TTS voice on
 * this error: the card would sound like a different person. The card keeps no audio and
 * "Reintentar" or "Completar faltantes" fills it later with the right voice.
 */
export class ElevenLabsBusyError extends Error {}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object") {
    // axios errors from the SDK carry the server body here
    // deno-lint-ignore no-explicit-any
    const anyE = e as any;
    const body = anyE.response?.data;
    if (body) {
      const detail = typeof body === "string" ? body : (body.message || body.detail || body.error || JSON.stringify(body));
      return `${anyE.message ?? "error"}: ${String(detail).slice(0, 300)}`;
    }
    if (anyE.message) return String(anyE.message);
  }
  return String(e);
}

/** Race a promise (e.g. an SDK call, which takes no AbortSignal) against a timer. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/** Remove ElevenLabs v3 audio tags like [shouts] for models that would read them aloud. */
export function stripAudioTags(text: string): string {
  return String(text).replace(/\[[^\]]*\]/g, " ").replace(/\s{2,}/g, " ").trim();
}

export async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- Firecrawl

export async function scrapeMarkdown(
  url: string,
  apiKey: string,
  timeoutMs = 30000,
): Promise<{ markdown: string; title: string }> {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Firecrawl returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!json?.success) throw new Error(`Firecrawl unsuccessful: ${text.slice(0, 300)}`);
  const markdown = String(json.data?.markdown ?? "");
  const title = String(json.data?.metadata?.title ?? json.data?.metadata?.ogTitle ?? "").trim();
  return { markdown, title };
}

// ---------------------------------------------------------------- Speech and storage

export async function elevenLabsTTS(
  text: string,
  opts: {
    apiKey: string;
    voiceId: string;
    modelId: string;
    timeoutMs?: number;
    stability?: number;
    attempts?: number;
  },
): Promise<Uint8Array> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`;
  const attempts = opts.attempts ?? 6;
  const body = JSON.stringify({
    text,
    model_id: opts.modelId,
    language_code: ELEVEN_LANGUAGE,
    voice_settings: { stability: opts.stability ?? elevenStability(undefined, opts.modelId), similarity_boost: 0.8 },
  });
  for (let i = 1; ; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": opts.apiKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
    });
    if (res.status === 429) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      if (i >= attempts) throw new ElevenLabsBusyError(`ElevenLabs HTTP 429 after ${attempts} attempts: ${detail}`);
      const wait = elevenBackoffMs(i);
      console.log(`ElevenLabs 429 (attempt ${i}/${attempts}), retrying in ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`ElevenLabs HTTP ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 1000) throw new Error(`ElevenLabs returned a suspiciously small file (${bytes.length} bytes)`);
    return bytes;
  }
}

/**
 * Upload bytes publicly with retries (audio or images). There is no base64 fallback on purpose:
 * Base44 entity fields reject payloads of this size ("Field exceeds the maximum allowed size"),
 * so storing base64 only wasted the generated file. A failure here is reported to the caller,
 * who can retry the card ("Reintentar"). The local dev server emulates UploadFile on disk.
 */
export async function storeFile(
  // deno-lint-ignore no-explicit-any
  base44: any,
  bytes: Uint8Array,
  filename: string,
  contentType: string,
  attempts = 3,
): Promise<{ url: string }> {
  let lastErr: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const file = new File([bytes as BlobPart], filename, { type: contentType });
      const res = await withTimeout(
        base44.asServiceRole.integrations.Core.UploadFile({ file }),
        45000,
        "UploadFile",
      );
      // deno-lint-ignore no-explicit-any
      const url = (res as any)?.file_url;
      if (!url) throw new Error(`UploadFile returned no file_url: ${JSON.stringify(res).slice(0, 200)}`);
      return { url };
    } catch (e) {
      lastErr = e;
      console.log(`UploadFile attempt ${i}/${attempts} failed: ${errMsg(e)}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw new Error(`UploadFile failed after ${attempts} attempts: ${errMsg(lastErr)}`);
}

/** MP3 convenience wrapper used by the speech paths. */
export async function storeMp3(
  // deno-lint-ignore no-explicit-any
  base44: any,
  bytes: Uint8Array,
  filename: string,
  attempts = 3,
): Promise<{ audio_url: string }> {
  const { url } = await storeFile(base44, bytes, filename, "audio/mpeg", attempts);
  return { audio_url: url };
}

export type SynthResult = {
  audio_url?: string;
  audio_b64?: string;
  provider: string;
  bytes?: number;
  warnings: string[];
};

export type SynthOpts = {
  text: string; // text for ElevenLabs (may include v3 tags)
  fallbackText?: string; // text for the fallback TTS (no tags)
  modelId: string;
  filename: string;
  apiKey?: string | null;
  voiceId?: string | null;
  stability?: string | number | null; // raw ELEVENLABS_STABILITY secret, see elevenStability
  modelOverride?: string | null; // ELEVENLABS_MODEL secret, e.g. eleven_v4 (default: the caller's modelId)
  timeoutMs?: number;
};

/**
 * The ElevenLabs step shared by the providers. Returns null when ElevenLabs is not configured
 * or failed; the reason is pushed to `warnings` so the caller can fall back to another TTS.
 */
// deno-lint-ignore no-explicit-any
export async function elevenLabsStep(base44: any, opts: SynthOpts, warnings: string[]): Promise<SynthResult | null> {
  if (!(opts.apiKey && opts.voiceId)) {
    warnings.push("ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID missing");
    return null;
  }
  const modelId = opts.modelOverride || opts.modelId;
  const elText = supportsAudioTags(modelId) ? opts.text : stripAudioTags(opts.text);
  try {
    const t0 = Date.now();
    const bytes = await elevenLabsTTS(elText, {
      apiKey: opts.apiKey,
      voiceId: opts.voiceId,
      modelId,
      timeoutMs: opts.timeoutMs,
      stability: elevenStability(opts.stability, modelId),
    });
    console.log(`ElevenLabs ${modelId}: ${bytes.length} bytes, ${elText.length} chars, ${Date.now() - t0} ms`);
    const stored = await storeMp3(base44, bytes, opts.filename);
    return { audio_url: stored.audio_url, provider: "elevenlabs", bytes: bytes.length, warnings };
  } catch (e) {
    // Busy is transient: keep the card without audio instead of switching to another voice.
    if (e instanceof ElevenLabsBusyError) throw e;
    warnings.push(`ElevenLabs step failed: ${errMsg(e)}`);
    return null;
  }
}

/** Synthesize speech: ElevenLabs first (if configured), then Core.GenerateSpeech (Base44 credits). */
// deno-lint-ignore no-explicit-any
export async function synthesizeAndStore(base44: any, opts: SynthOpts): Promise<SynthResult> {
  const warnings: string[] = [];
  const el = await elevenLabsStep(base44, opts, warnings);
  if (el) return el;
  console.log(`${warnings[warnings.length - 1]}; using GenerateSpeech`);
  const text = stripAudioTags(opts.fallbackText ?? opts.text);
  const t0 = Date.now();
  let url: string | undefined;
  try {
    const res = await withTimeout(
      base44.asServiceRole.integrations.Core.GenerateSpeech({ text, language_code: "es" }),
      60000,
      "GenerateSpeech",
    );
    // deno-lint-ignore no-explicit-any
    url = (res as any)?.url;
    if (!url) throw new Error(`GenerateSpeech returned no url: ${JSON.stringify(res).slice(0, 200)}`);
  } catch (e) {
    throw new Error([...warnings, `GenerateSpeech failed: ${errMsg(e)}`].join(" | "));
  }
  console.log(`GenerateSpeech ok in ${Date.now() - t0} ms`);
  return { audio_url: url, provider: "generate-speech", warnings };
}
