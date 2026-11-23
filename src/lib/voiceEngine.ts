import type { AiProviderConfig, AiVoiceConfig } from "./api";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

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

/** Resolves an API key for a provider kind, preferring enabled entries but falling back to any saved key. */
function providerKey(providers: AiProviderConfig[], kind: AiProviderConfig["kind"]): string {
  const enabledMatch = providers.find((p) => p.kind === kind && p.enabled && p.apiKey.trim());
  if (enabledMatch) return enabledMatch.apiKey.trim();
  const anyMatch = providers.find((p) => p.kind === kind && p.apiKey.trim());
  return anyMatch?.apiKey.trim() ?? "";
}

function speechBaseUrl(voice: AiVoiceConfig, providers: AiProviderConfig[]): string {
  if (voice.ttsBaseUrl.trim()) return voice.ttsBaseUrl.trim().replace(/\/$/, "");
  const enabledMatch = providers.find((p) => p.kind === voice.ttsProvider && p.enabled && p.baseUrl.trim());
  if (enabledMatch) return enabledMatch.baseUrl.trim().replace(/\/$/, "");
  const anyMatch = providers.find((p) => p.kind === voice.ttsProvider && p.baseUrl.trim());
  if (anyMatch) return anyMatch.baseUrl.trim().replace(/\/$/, "");
  return OPENAI_BASE_URL;
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
    if (voiceConfig.ttsProvider === "browser" && typeof window !== "undefined" && "speechSynthesis" in window) {
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

  if (voiceConfig.ttsProvider === "browser") {
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
    if (voiceConfig.ttsProvider === "google") {
      const apiKey = voiceConfig.ttsApiKey.trim() || providerKey(providers, "google");
      if (!apiKey) {
        throw new Error("Add a Google Gemini API key in Settings → AI Providers or Voice settings.");
      }
      const model = voiceConfig.ttsModel.trim();
      if (!model) {
        throw new Error("Click 'Load voice models' in Settings → Voice to choose a Gemini TTS model.");
      }
      const res = await fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: spoken }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceConfig.ttsVoice || "Kore" },
              },
            },
          },
        }),
      });
      if (!res.ok) throw new Error(`Gemini speech failed (HTTP ${res.status}).`);
      const payload = (await res.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
      };
      const inline = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new Error("Gemini returned no audio.");
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
    } else {
      const apiKey =
        voiceConfig.ttsApiKey.trim() ||
        providerKey(providers, voiceConfig.ttsProvider === "openai" ? "openai" : "openai-compatible");
      if (voiceConfig.ttsProvider === "openai" && !apiKey) {
        throw new Error("Add an OpenAI API key in Settings → AI Providers or Voice settings.");
      }
      const ttsModel = voiceConfig.ttsModel.trim();
      if (!ttsModel) {
        throw new Error("Click 'Load voice models' in Settings → Voice to choose a TTS model.");
      }
      const base = speechBaseUrl(voiceConfig, providers);
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: ttsModel,
          input: spoken,
          voice: voiceConfig.ttsVoice || "alloy",
          response_format: "mp3",
          speed: Math.min(2, Math.max(0.5, voiceConfig.ttsRate || 1)),
        }),
      });
      if (!res.ok) throw new Error(`Speech request failed (HTTP ${res.status}).`);
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

function sttBaseUrl(voice: AiVoiceConfig, providers: AiProviderConfig[]): string {
  if (voice.sttBaseUrl.trim()) return voice.sttBaseUrl.trim().replace(/\/$/, "");
  const enabledMatch = providers.find((p) => p.kind === voice.sttProvider && p.enabled && p.baseUrl.trim());
  if (enabledMatch) return enabledMatch.baseUrl.trim().replace(/\/$/, "");
  const anyMatch = providers.find((p) => p.kind === voice.sttProvider && p.baseUrl.trim());
  if (anyMatch) return anyMatch.baseUrl.trim().replace(/\/$/, "");
  return OPENAI_BASE_URL;
}

export function startListening(
  voiceConfig: AiVoiceConfig,
  providers: AiProviderConfig[],
  callbacks: ListenCallbacks = {},
): ListenHandle {
  if (voiceConfig.sttProvider === "browser") {
    const recognition = browserRecognition();
    if (!recognition) {
      callbacks.onError?.(
        "Speech recognition is not available in this WebView. Choose OpenAI or an OpenAI-Compatible STT provider in Settings → Voice.",
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

  const apiKey =
    voiceConfig.sttApiKey.trim() ||
    providerKey(providers, voiceConfig.sttProvider === "openai" ? "openai" : "openai-compatible");
  if (voiceConfig.sttProvider === "openai" && !apiKey) {
    callbacks.onError?.("Add an OpenAI API key in Settings → AI Providers or Voice settings.");
    return { stop: async () => "", cancel: () => {} };
  }

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
          const sttModel = voiceConfig.sttModel.trim();
          if (!sttModel) {
            throw new Error("Click 'Load STT models' in Settings → Voice to choose a transcription model.");
          }
          const form = new FormData();
          form.append("file", blob, `voice.${ext}`);
          form.append("model", sttModel);
          const res = await fetch(`${sttBaseUrl(voiceConfig, providers)}/audio/transcriptions`, {
            method: "POST",
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            body: form,
          });
          if (!res.ok) throw new Error(`Transcription failed (HTTP ${res.status}).`);
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
