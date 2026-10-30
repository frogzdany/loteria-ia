import { describe, it, expect } from "vitest";
import { normalizeCards } from "../base44/shared/loteria.js";
import {
  MOCK_CARDS,
  MOCK_PALETTE,
  PROVIDERS,
  beepFrequency,
  hashText,
  isLoopbackUrl,
  mockCardsResponse,
  mockImageDataUrl,
  mockImageSvg,
  mockWavBytes,
  resolveProviderName,
  wavFilename,
} from "../base44/shared/mock.js";

const noun = (name) => name.replace(/^(El|La|Los|Las)\s+/i, "").toLowerCase();
const wordCount = (s) => s.trim().split(/\s+/).length;
const ascii = (bytes, offset, len) => String.fromCharCode(...bytes.subarray(offset, offset + len));

describe("MOCK_CARDS fixture", () => {
  it("has at least 24 complete cards", () => {
    expect(MOCK_CARDS.length).toBeGreaterThanOrEqual(24);
    for (const c of MOCK_CARDS) {
      expect(c.name.trim()).toBe(c.name);
      expect(c.verse.length).toBeGreaterThan(20);
      expect(c.visual.length).toBeGreaterThan(10);
    }
  });

  it("uses unique names that start with an article", () => {
    const names = MOCK_CARDS.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const c of MOCK_CARDS) expect(c.name).toMatch(/^(El|La) /);
  });

  it("keeps the riddle: a verse never says its card's noun and has at most 20 words", () => {
    for (const c of MOCK_CARDS) {
      const re = new RegExp(`\\b${noun(c.name)}\\b`, "i");
      expect(c.verse, c.name).not.toMatch(re);
      expect(wordCount(c.verse), c.name).toBeLessThanOrEqual(20);
    }
  });

  it("feeds normalizeCards unchanged for 16 and 24 cards", () => {
    expect(normalizeCards(mockCardsResponse(16), 16)).toHaveLength(16);
    expect(normalizeCards(mockCardsResponse(24), 24)).toHaveLength(24);
    expect(normalizeCards(mockCardsResponse(), 16)[0].name).toBe(MOCK_CARDS[0].name);
  });

  it("cannot produce more cards than the fixture", () => {
    expect(mockCardsResponse(40).cards).toHaveLength(MOCK_CARDS.length);
    expect(() => normalizeCards(mockCardsResponse(40), 40)).toThrow(/expected 40/);
  });

  it("returns copies, so callers cannot mutate the fixture", () => {
    const r = mockCardsResponse(2);
    r.cards[0].name = "X";
    expect(MOCK_CARDS[0].name).not.toBe("X");
  });
});

describe("mock image", () => {
  it("is a small SVG in the lotería palette that labels itself as mock", () => {
    const svg = mockImageSvg({ number: 7, name: "El Networking" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("mock #7 El Networking");
    expect(MOCK_PALETTE.some((hex) => svg.includes(`fill="${hex}"`))).toBe(true);
    expect(svg.length).toBeLessThan(1200);
  });

  it("escapes the card name", () => {
    const svg = mockImageSvg({ number: 1, name: '<b>&"x"' });
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;b&gt;&amp;&quot;x&quot;");
  });

  it("builds a deterministic data URL and varies the colors by number", () => {
    const a = mockImageDataUrl({ number: 1, name: "La Demo" });
    expect(a.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(a).toBe(mockImageDataUrl({ number: 1, name: "La Demo" }));
    expect(a.length).toBeLessThan(2000);
    expect(mockImageSvg({ number: 1 })).not.toBe(mockImageSvg({ number: 2 }));
  });

  it("tolerates a missing card", () => {
    expect(mockImageSvg()).toContain("mock #0");
  });
});

describe("mock audio", () => {
  it("writes a valid 8 kHz, 8-bit, mono PCM WAV", () => {
    const wav = mockWavBytes({ seed: 3 });
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(8);
    const dataSize = view.getUint32(40, true);
    expect(dataSize).toBe(4000); // 0.5 s
    expect(view.getUint32(4, true)).toBe(36 + dataSize);
    expect(wav.length).toBe(44 + dataSize);
  });

  it("has audible, centered samples within the 8-bit range", () => {
    const wav = mockWavBytes({ seed: 5 });
    const samples = wav.subarray(44);
    let min = 255, max = 0, sum = 0;
    for (const s of samples) {
      min = Math.min(min, s);
      max = Math.max(max, s);
      sum += s;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(255);
    expect(max - min).toBeGreaterThan(100);
    expect(Math.abs(sum / samples.length - 128)).toBeLessThan(2);
    expect(samples[0]).toBe(128); // fade in starts at silence
  });

  it("is deterministic per seed and differs between seeds", () => {
    expect(mockWavBytes({ seed: 1 })).toEqual(mockWavBytes({ seed: 1 }));
    expect(mockWavBytes({ seed: 1 })).not.toEqual(mockWavBytes({ seed: 2 }));
    expect(mockWavBytes({ seed: 1, seconds: 0.25 }).length).toBe(44 + 2000);
  });

  it("cycles the beep pitch over 8 values from 330 Hz", () => {
    expect(beepFrequency(0)).toBe(330);
    expect(beepFrequency(7)).toBe(715);
    expect(beepFrequency(8)).toBe(330);
    expect(beepFrequency(-3)).toBe(beepFrequency(3));
  });

  it("hashes text to a stable unsigned 32-bit number", () => {
    expect(hashText("¡Lotería!")).toBe(hashText("¡Lotería!"));
    expect(hashText("a")).not.toBe(hashText("b"));
    expect(hashText("")).toBe(5381);
    expect(hashText("x")).toBeGreaterThanOrEqual(0);
  });

  it("swaps the mp3 extension for wav", () => {
    expect(wavFilename("card-3.mp3")).toBe("card-3.wav");
    expect(wavFilename("speak.MP3")).toBe("speak.wav");
    expect(wavFilename("shout")).toBe("shout.wav");
  });
});

describe("resolveProviderName", () => {
  it("lists the two providers", () => {
    expect(PROVIDERS).toEqual(["base44", "mock", "openai"]);
  });

  it("lets an explicit value win, case-insensitively", () => {
    expect(resolveProviderName("mock", { requestUrl: "https://base44.app/api" })).toBe("mock");
    expect(resolveProviderName(" Base44 ", { requestUrl: "http://localhost:4400/api" })).toBe("base44");
  });

  it("ignores unknown explicit values so a typo cannot switch production to the mock", () => {
    expect(resolveProviderName("gpt", { requestUrl: "https://base44.app/api" })).toBe("base44");
    expect(resolveProviderName(null, { requestUrl: "https://base44.app/api" })).toBe("base44");
  });

  it("picks the mock on loopback hosts, which is where npx base44 dev runs", () => {
    for (const url of ["http://localhost:4400/x", "http://127.0.0.1:53317/f", "http://[::1]:4400/", "http://app.localhost/"]) {
      expect(isLoopbackUrl(url), url).toBe(true);
      expect(resolveProviderName(undefined, { requestUrl: url })).toBe("mock");
    }
  });

  it("prefers openai on loopback only when a key is configured, never elsewhere by itself", () => {
    expect(resolveProviderName(undefined, { requestUrl: "http://localhost:4400/x", openaiKey: "sk-test" })).toBe("openai");
    expect(resolveProviderName(undefined, { requestUrl: "http://localhost:4400/x", openaiKey: "" })).toBe("mock");
    expect(resolveProviderName("mock", { requestUrl: "http://localhost:4400/x", openaiKey: "sk-test" })).toBe("mock");
    expect(resolveProviderName(undefined, { requestUrl: "https://base44.app/x", openaiKey: "sk-test" })).toBe("base44");
    expect(resolveProviderName("openai", { requestUrl: "https://base44.app/x" })).toBe("openai");
  });

  it("picks base44 on other hosts and on unparsable URLs", () => {
    expect(resolveProviderName(undefined, { requestUrl: "https://loteria-tech-week-5cbc9957.base44.app/api" })).toBe("base44");
    expect(resolveProviderName(undefined, { requestUrl: "nonsense" })).toBe("base44");
    expect(resolveProviderName(undefined, {})).toBe("base44");
    expect(isLoopbackUrl("https://localhost.evil.com/")).toBe(false);
  });
});
