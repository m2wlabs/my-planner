import type { AiProviderConfig, AiVoiceConfig, VoiceSttProvider, VoiceTtsProvider } from "./api";
import { findCatalogEntry } from "./providerCatalog";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type VoiceAudioAdapter =
  | "browser"
  | "google"
  | "minimax"
  | "xai"
  | "elevenlabs"
  | "openai";

export interface ResolvedVoiceTarget {
  adapter: VoiceAudioAdapter;
  providerKind: VoiceTtsProvider | VoiceSttProvider;
  /** Matched connected AI provider when inheriting credentials, or null for Browser / Custom standalone. */
  linkedProvider: AiProviderConfig | null;
  label: string;
  baseUrl: string;
  apiKey: string;
  inheritedKey: boolean;
  inheritedBaseUrl: boolean;
  supportsModelDiscovery: boolean;
  requiresModel: boolean;
}

/** Strips code fences, action blocks and markdown punctuation so speech sounds natural. */
export function prepareTextForSpeech(markdown: string): string {
  let text = markdown.replace(/```planner-actions[\s\S]*?(```|$)/g, " ");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*[-*•]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  text = text.replace(/[*_~]/g, "");
  text = text.replace(/^\s*[-=_]{3,}\s*$/gm, " ");
  text = text.replace(/\|/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

export function listBrowserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

/** Subscribes to async voice loading; returns an unsubscribe function. */
export function onBrowserVoicesChanged(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return () => {};
  const handler = () => cb(window.speechSynthesis.getVoices());
  window.speechSynthesis.addEventListener("voiceschanged", handler);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
}

/**
 * Normalizes a provider base URL by removing trailing slashes and accidental endpoint
 * suffixes (e.g. /audio/speech, /audio/transcriptions, /t2a_v2, /speech_to_text, /tts, /chat/completions).
 */
export function normalizeVoiceBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(audio\/speech|audio\/transcriptions|t2a_v2|speech_to_text|tts|chat\/completions|models)$/i, "")
    .replace(/\/+$/, "");
}

function defaultBaseFor(kind: VoiceTtsProvider | VoiceSttProvider, linked: AiProviderConfig | null): string {
  if (linked) {
    const entry = findCatalogEntry(linked.catalogId, linked.kind);
    if (entry?.defaultBaseUrl) return entry.defaultBaseUrl;
  }
  if (kind === "google") return GEMINI_BASE_URL;
  if (kind === "openai") return OPENAI_BASE_URL;
  return "";
}

/**
 * Hermes-style hierarchical credential & adapter resolver:
 * explicit voice override -> bound connected AI provider -> matching provider by kind -> fallback.
 * Never mixes an API key from one provider with the base URL of another.
 */
export function resolveVoiceTarget(
  voice: AiVoiceConfig,
  providers: AiProviderConfig[],
  mode: "tts" | "stt",
  activeProviderId?: string,
): ResolvedVoiceTarget {
  const providerKind = mode === "tts" ? voice.ttsProvider : voice.sttProvider;
  const rawProviderId = mode === "tts" ? voice.ttsProviderId : voice.sttProviderId;
  const providerId = rawProviderId?.trim() ?? "";
  const overrideBase = (mode === "tts" ? voice.ttsBaseUrl : voice.sttBaseUrl).trim();
  const overrideKey = (mode === "tts" ? voice.ttsApiKey : voice.sttApiKey).trim();

  if (providerKind === "browser") {
    return {
      adapter: "browser",
      providerKind: "browser",
      linkedProvider: null,
      label: "Browser Native (System)",
      baseUrl: "",
      apiKey: "",
      inheritedKey: false,
      inheritedBaseUrl: false,
      supportsModelDiscovery: false,
      requiresModel: false,
    };
  }

  let linked: AiProviderConfig | null = null;
  if (providerId) {
    linked = providers.find((p) => p.id === providerId) ?? null;
  } else if (rawProviderId === undefined && !overrideBase) {
    // Legacy config compatibility (before ttsProviderId/sttProviderId existed):
    // infer a single coherent provider matching this kind. Explicit "" means Custom/Standalone.
    const candidates = providers.filter((p) => p.kind === providerKind);
    linked =
      candidates.find((p) => p.id === activeProviderId && p.enabled) ??
      candidates.find((p) => p.enabled && (p.apiKey.trim() || p.baseUrl.trim())) ??
      candidates.find((p) => p.apiKey.trim() || p.baseUrl.trim()) ??
      candidates[0] ??
      null;
  }

  const effectiveKind: VoiceTtsProvider | VoiceSttProvider = linked
    ? linked.kind === "google"
      ? "google"
      : linked.kind === "openai"
        ? "openai"
        : "openai-compatible"
    : providerKind;

  const inheritedBase = !overrideBase && Boolean(linked);
  const rawBase = overrideBase || linked?.baseUrl?.trim() || defaultBaseFor(effectiveKind, linked);
  const baseUrl = normalizeVoiceBaseUrl(rawBase);

  const inheritedKey = !overrideKey && Boolean(linked?.apiKey?.trim());
  const apiKey = overrideKey || linked?.apiKey?.trim() || "";

  let adapter: VoiceAudioAdapter = "openai";
  if (effectiveKind === "google" || /generativelanguage\.googleapis\.com/i.test(baseUrl)) {
    adapter = "google";
  } else if (linked?.catalogId === "minimax" || /minimax(i)?\.(io|com|chat)/i.test(baseUrl)) {
    adapter = "minimax";
  } else if (
    mode === "tts" &&
    (linked?.catalogId === "xai" || /api\.x\.ai/i.test(baseUrl))
  ) {
    adapter = "xai";
  } else if (mode === "tts" && /elevenlabs\.io/i.test(baseUrl)) {
    adapter = "elevenlabs";
  }

  const label = linked
    ? linked.name
    : effectiveKind === "google"
      ? "Google Gemini"
      : effectiveKind === "openai"
        ? "OpenAI"
        : "Custom endpoint";

  const supportsModelDiscovery =
    adapter === "google" || adapter === "openai";
  const requiresModel =
    adapter !== "xai" && adapter !== "elevenlabs";

  return {
    adapter,
    providerKind: effectiveKind,
    linkedProvider: linked,
    label,
    baseUrl,
    apiKey,
    inheritedKey,
    inheritedBaseUrl: inheritedBase,
    supportsModelDiscovery,
    requiresModel,
  };
}

/** Formats full HTTP error bodies from voice providers, including the called endpoint on 404. */
async function readVoiceHttpError(res: Response, endpoint: string, providerLabel: string): Promise<string> {
  let detail = "";
  try {
    const raw = await res.text();
    try {
      const parsed = JSON.parse(raw) as {
        error?: { message?: string; code?: string } | string;
        message?: string;
        detail?: string | { message?: string };
        base_resp?: { status_code?: number; status_msg?: string };
      };
      const errObj = typeof parsed.error === "object" ? parsed.error : undefined;
      const detailObj = typeof parsed.detail === "object" ? parsed.detail : undefined;
      detail =
        errObj?.message ||
        (typeof parsed.error === "string" ? parsed.error : "") ||
        parsed.message ||
        detailObj?.message ||
        (typeof parsed.detail === "string" ? parsed.detail : "") ||
        parsed.base_resp?.status_msg ||
        "";
    } catch {
      detail = raw.trim().slice(0, 200);
    }
  } catch {
    /* ignore */
  }

  if (res.status === 404) {
    const hint = detail
      ? `${detail} (endpoint: ${endpoint})`
      : `${endpoint} returned 404 — check that the model ID is valid and that ${providerLabel} supports this audio endpoint.`;
    return `HTTP 404: ${hint}`;
  }
  return detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status} ${res.statusText || "Request failed"} (${endpoint})`;
}

export interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export interface SpeakHandle {
  stop: () => void;
}

function pcm16ToWav(pcm: Uint8Array, sampleRate = 24000): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm.length, true);
  return new Blob([header, pcm as unknown as BlobPart], { type: "audio/wav" });
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not encode audio."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Decodes a MediaRecorder audio blob (typically webm/opus) into a universally accepted
 * 16 kHz mono 16-bit PCM WAV file for ASR endpoints like MiniMax /v1/speech_to_text.
 */
async function blobToWav16k(blob: Blob): Promise<{ blob: Blob; filename: string }> {
  try {
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return { blob, filename: "voice.webm" };
    const ctx = new Ctor();
    try {
      const arrayBuf = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      const targetRate = 16000;
      const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offline = new OfflineAudioContext(1, length, targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      const channel = rendered.getChannelData(0);
      const pcm = new Uint8Array(channel.length * 2);
      const view = new DataView(pcm.buffer);
      for (let i = 0; i < channel.length; i++) {
        const s = Math.max(-1, Math.min(1, channel[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return { blob: pcm16ToWav(pcm, targetRate), filename: "voice.wav" };
    } finally {
      void ctx.close().catch(() => {});
    }
  } catch {
    const mime = blob.type || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
    return { blob, filename: `voice.${ext}` };
  }
}

export function speakText(
  text: string,
  voiceConfig: AiVoiceConfig,
  providers: AiProviderConfig[],
  callbacks: SpeakCallbacks = {},
): SpeakHandle {
  const spoken = prepareTextForSpeech(text);
  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let finished = false;
  const controller = new AbortController();
  const target = resolveVoiceTarget(voiceConfig, providers, "tts");

  const finish = () => {
    if (finished) return;
    finished = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    callbacks.onEnd?.();
  };

  const stop = () => {
    stopped = true;
    controller.abort();
    if (target.adapter === "browser" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (audio) {
      audio.pause();
      audio.src = "";
      audio = null;
    }
    finish();
  };

  if (!spoken) {
    queueMicrotask(finish);
    return { stop };
  }

  if (target.adapter === "browser") {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      callbacks.onError?.("Speech playback is not supported in this WebView.");
      queueMicrotask(finish);
      return { stop };
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.rate = Math.min(2, Math.max(0.5, voiceConfig.ttsRate || 1));
    const voices = listBrowserVoices();
    const chosen = voiceConfig.ttsVoice
      ? voices.find((v) => v.voiceURI === voiceConfig.ttsVoice || v.name === voiceConfig.ttsVoice)
      : undefined;
    if (chosen) utterance.voice = chosen;
    utterance.onstart = () => callbacks.onStart?.();
    utterance.onend = finish;
    utterance.onerror = (event) => {
      if (!stopped && event.error !== "canceled" && event.error !== "interrupted") {
        callbacks.onError?.(`Speech playback failed: ${event.error}`);
      }
      finish();
    };
    window.speechSynthesis.speak(utterance);
    return { stop };
  }

  const run = async () => {
    callbacks.onStart?.();
    let blob: Blob;
    const model = voiceConfig.ttsModel.trim();
    const speed = Math.min(2, Math.max(0.5, voiceConfig.ttsRate || 1));

    if (target.adapter === "google") {
      if (!target.apiKey) {
        throw new Error("Add a Google Gemini API key in AI Providers or Voice credentials override.");
      }
      if (!model) {
        throw new Error("Enter a Gemini TTS model ID (or click Load models to pick one).");
      }
      const base = target.baseUrl || GEMINI_BASE_URL;
      const endpoint = `${base}/models/${encodeURIComponent(model)}:generateContent`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": target.apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: spoken }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceConfig.ttsVoice.trim() || "Kore" },
              },
            },
          },
        }),
      });
      if (!res.ok) throw new Error(await readVoiceHttpError(res, endpoint, target.label));
      const payload = (await res.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
      };
      const inline = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new Error("Gemini returned no audio data for this model.");
      const binary = atob(inline.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const mime = inline.mimeType ?? "";
      if (mime.includes("L16") || mime.includes("pcm")) {
        const rateMatch = /rate=(\d+)/i.exec(mime);
        const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
        blob = pcm16ToWav(bytes, sampleRate);
      } else {
        blob = new Blob([bytes], { type: mime || "audio/wav" });
      }
    } else if (target.adapter === "minimax") {
      if (!target.apiKey) {
        throw new Error("Add a MiniMax API key in AI Providers or Voice credentials override.");
      }
      if (!model) {
        throw new Error("Enter a MiniMax TTS model ID (for example speech-2.8-hd or speech-2.8-turbo).");
      }
      const base = /\/v1$/i.test(target.baseUrl)
        ? target.baseUrl
        : `${target.baseUrl || "https://api.minimax.io"}/v1`;
      const endpoint = `${base}/t2a_v2`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          text: spoken,
          stream: false,
          voice_setting: {
            voice_id: voiceConfig.ttsVoice.trim() || "English_Graceful_Lady",
            speed,
            vol: 1,
            pitch: 0,
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1,
          },
        }),
      });
      if (!res.ok) throw new Error(await readVoiceHttpError(res, endpoint, target.label));
      const payload = (await res.json()) as {
        data?: { audio?: string };
        base_resp?: { status_code?: number; status_msg?: string };
      };
      if (payload.base_resp?.status_code && payload.base_resp.status_code !== 0) {
        throw new Error(
          `MiniMax speech error (${payload.base_resp.status_code}): ${payload.base_resp.status_msg || "Request rejected"}`,
        );
      }
      const hex = payload.data?.audio?.trim();
      if (!hex) throw new Error("MiniMax returned no audio payload.");
      blob = new Blob([hexToBytes(hex) as unknown as BlobPart], { type: "audio/mpeg" });
    } else if (target.adapter === "xai") {
      if (!target.apiKey) {
        throw new Error("Add an xAI API key in AI Providers or Voice credentials override.");
      }
      const base = target.baseUrl || "https://api.x.ai/v1";
      const endpoint = `${base}/tts`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          text: spoken,
          voice_id: voiceConfig.ttsVoice.trim() || "eve",
          language: "auto",
          ...(model ? { model } : {}),
        }),
      });
      if (!res.ok) throw new Error(await readVoiceHttpError(res, endpoint, target.label));
      blob = await res.blob();
    } else if (target.adapter === "elevenlabs") {
      if (!target.apiKey) {
        throw new Error("Add an ElevenLabs API key in Voice credentials override.");
      }
      const voiceId = voiceConfig.ttsVoice.trim();
      if (!voiceId) throw new Error("Enter an ElevenLabs Voice ID.");
      const base = target.baseUrl || "https://api.elevenlabs.io/v1";
      const endpoint = `${base}/text-to-speech/${encodeURIComponent(voiceId)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": target.apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          text: spoken,
          ...(model ? { model_id: model } : {}),
        }),
      });
      if (!res.ok) throw new Error(await readVoiceHttpError(res, endpoint, target.label));
      blob = await res.blob();
    } else {
      if (target.providerKind === "openai" && !target.apiKey) {
        throw new Error("Add an OpenAI API key in AI Providers or Voice credentials override.");
      }
      if (!target.baseUrl) {
        throw new Error("Select a connected AI provider or enter a custom Base URL for TTS.");
      }
      if (!model) {
        throw new Error("Enter a TTS model ID (you can type it directly or click Load models).");
      }
      const endpoint = `${target.baseUrl}/audio/speech`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          input: spoken,
          voice: voiceConfig.ttsVoice.trim() || "alloy",
          response_format: "mp3",
          speed,
        }),
      });
      if (!res.ok) throw new Error(await readVoiceHttpError(res, endpoint, target.label));
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const textBody = await res.text();
        throw new Error(`Endpoint returned JSON instead of audio: ${textBody.slice(0, 180)}`);
      }
      blob = await res.blob();
    }

    if (stopped) {
      finish();
      return;
    }
    objectUrl = URL.createObjectURL(blob);
    audio = new Audio(objectUrl);
    audio.onended = finish;
    audio.onerror = () => {
      if (!stopped) callbacks.onError?.("Could not play the generated audio.");
      finish();
    };
    await audio.play();
  };

  void run().catch((err) => {
    if (!stopped && (err as Error)?.name !== "AbortError") {
      callbacks.onError?.(String((err as Error)?.message ?? err));
    }
    finish();
  });

  return { stop };
}

export interface ListenCallbacks {
  onInterim?: (text: string) => void;
  onStart?: () => void;
  /** Fires if browser speech recognition finishes automatically after a pause. */
  onAutoEnd?: (finalText: string) => void;
  onError?: (message: string) => void;
}

export interface ListenHandle {
  stop: () => Promise<string>;
  cancel: () => void;
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function browserRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function startListening(
  voiceConfig: AiVoiceConfig,
  providers: AiProviderConfig[],
  callbacks: ListenCallbacks = {},
): ListenHandle {
  const target = resolveVoiceTarget(voiceConfig, providers, "stt");

  if (target.adapter === "browser") {
    const recognition = browserRecognition();
    if (!recognition) {
      callbacks.onError?.(
        "Speech recognition is not available in this WebView. Choose a connected AI provider or custom STT endpoint in Settings → Voice.",
      );
      return { stop: async () => "", cancel: () => {} };
    }
    let finalText = "";
    let latestInterim = "";
    let cancelled = false;
    let ended = false;
    let stopRequested = false;
    let resolveStop: ((text: string) => void) | null = null;

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    recognition.onresult = (event: unknown) => {
      const resultEvent = event as {
        resultIndex: number;
        results: { isFinal: boolean; 0: { transcript: string } }[];
      };
      let interim = "";
      for (let i = resultEvent.resultIndex; i < resultEvent.results.length; i++) {
        const result = resultEvent.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      latestInterim = interim;
      const preview = `${finalText}${interim}`.trim();
      if (preview) callbacks.onInterim?.(preview);
    };
    recognition.onerror = (event: unknown) => {
      const error = (event as { error?: string }).error ?? "unknown";
      if (!cancelled && error !== "aborted" && error !== "no-speech") {
        callbacks.onError?.(`Microphone error: ${error}`);
      }
    };
    recognition.onend = () => {
      ended = true;
      const transcript = (finalText || latestInterim).trim();
      if (resolveStop) {
        const res = resolveStop;
        resolveStop = null;
        res(transcript);
      } else if (!cancelled && !stopRequested) {
        callbacks.onAutoEnd?.(transcript);
      }
    };

    try {
      recognition.start();
      callbacks.onStart?.();
    } catch {
      ended = true;
      callbacks.onError?.("Could not start listening. Check microphone permissions.");
    }
    return {
      stop: () =>
        new Promise<string>((resolve) => {
          stopRequested = true;
          if (ended) {
            resolve((finalText || latestInterim).trim());
            return;
          }
          resolveStop = resolve;
          try {
            recognition.stop();
          } catch {
            resolveStop = null;
            resolve((finalText || latestInterim).trim());
          }
        }),
      cancel: () => {
        cancelled = true;
        if (resolveStop) {
          const res = resolveStop;
          resolveStop = null;
          res("");
        }
        try {
          recognition.abort();
        } catch {
          /* ignore */
        }
      },
    };
  }

  // Validate config upfront before opening the microphone
  const sttModel = voiceConfig.sttModel.trim();
  if (
    (target.providerKind === "openai" ||
      target.adapter === "google" ||
      target.adapter === "minimax") &&
    !target.apiKey
  ) {
    callbacks.onError?.(`Add a ${target.label} API key in Settings → AI Providers or Voice settings.`);
    return { stop: async () => "", cancel: () => {} };
  }
  if (!target.baseUrl) {
    callbacks.onError?.("Select a connected AI provider or enter a custom Base URL for Speech-to-Text.");
    return { stop: async () => "", cancel: () => {} };
  }
  if (!sttModel) {
    callbacks.onError?.("Enter an STT model ID in Settings → Voice (you can type it directly or click Load models).");
    return { stop: async () => "", cancel: () => {} };
  }

  let cancelled = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let resolveStop: (text: string) => void = () => {};
  let rejectStop: (err: Error) => void = () => {};

  const cleanupTracks = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const handle: ListenHandle = {
    stop: () =>
      new Promise<string>((resolve, reject) => {
        resolveStop = resolve;
        rejectStop = reject;
        if (!recorder || recorder.state === "inactive") {
          cleanupTracks();
          resolve("");
          return;
        }
        recorder.stop();
      }),
    cancel: () => {
      cancelled = true;
      cleanupTracks();
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
      rejectStop(new Error("Voice input cancelled."));
    },
  };

  void (async () => {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelled) {
        micStream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = micStream;
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        cleanupTracks();
        if (cancelled) return;
        try {
          const mime = recorder?.mimeType || "audio/webm";
          const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
          const blob = new Blob(chunks, { type: mime });

          if (target.adapter === "google") {
            const base = target.baseUrl || GEMINI_BASE_URL;
            const endpoint = `${base}/models/${encodeURIComponent(sttModel)}:generateContent`;
            const base64Audio = await blobToBase64(blob);
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": target.apiKey },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: "Transcribe this spoken audio accurately. Return only the transcript text with no extra commentary.",
                      },
                      {
                        inlineData: {
                          mimeType: mime.split(";")[0] || "audio/webm",
                          data: base64Audio,
                        },
                      },
                    ],
                  },
                ],
              }),
            });
            if (!res.ok) throw new Error(await readVoiceHttpError(res, endpoint, target.label));
            const payload = (await res.json()) as {
              candidates?: { content?: { parts?: { text?: string }[] } }[];
            };
            const transcript = (payload.candidates?.[0]?.content?.parts ?? [])
              .map((p) => p.text ?? "")
              .join("")
              .trim();
            resolveStop(transcript);
            return;
          }

          if (target.adapter === "minimax") {
            const base = /\/v1$/i.test(target.baseUrl)
              ? target.baseUrl
              : `${target.baseUrl || "https://api.minimax.io"}/v1`;
            const endpoint = `${base}/speech_to_text`;
            const converted = await blobToWav16k(blob);
            const form = new FormData();
            form.append("model", sttModel);
            form.append("file", converted.blob, converted.filename);
            form.append("response_format", "json");
            form.append("stream", "false");
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { Authorization: `Bearer ${target.apiKey}` },
              body: form,
            });
            if (!res.ok) throw new Error(await readVoiceHttpError(res, endpoint, target.label));
            const payload = (await res.json()) as {
              text?: string;
              data?: { text?: string };
              base_resp?: { status_code?: number; status_msg?: string };
            };
            if (payload.base_resp?.status_code && payload.base_resp.status_code !== 0) {
              throw new Error(
                `MiniMax STT error (${payload.base_resp.status_code}): ${payload.base_resp.status_msg || "Request rejected"}`,
              );
            }
            resolveStop((payload.text ?? payload.data?.text ?? "").trim());
            return;
          }

          const form = new FormData();
          form.append("file", blob, `voice.${ext}`);
          form.append("model", sttModel);
          const endpoint = `${target.baseUrl}/audio/transcriptions`;
          const res = await fetch(endpoint, {
            method: "POST",
            headers: target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {},
            body: form,
          });
          if (!res.ok) throw new Error(await readVoiceHttpError(res, endpoint, target.label));
          const payload = (await res.json()) as { text?: string };
          resolveStop((payload.text ?? "").trim());
        } catch (err) {
          rejectStop(err as Error);
        }
      };
      recorder.start();
      callbacks.onStart?.();
    } catch (err) {
      cleanupTracks();
      if (!cancelled) {
        callbacks.onError?.(
          `Could not access the microphone: ${String((err as Error)?.message ?? err)}`,
        );
      }
      rejectStop(err as Error);
    }
  })();

  return handle;
}
