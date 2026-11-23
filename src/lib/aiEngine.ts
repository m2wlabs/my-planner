import { generateText, streamText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import * as api from "./api";
import type { AiProviderConfig, AiProviderKind, AiSuggestedAction, AiTurnUsage } from "./api";
import { parseStructuredOutput } from "./aiParser";
import { findCatalogEntry } from "./providerCatalog";

export const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  anthropic: "Anthropic SDK",
  openai: "OpenAI SDK",
  google: "Google SDK",
  "openai-compatible": "OpenAI-Compatible",
};

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** True when a provider is enabled, has credentials/endpoint, and has a selected model. */
export function isProviderReady(provider?: AiProviderConfig | null): boolean {
  if (!provider || !provider.enabled) return false;
  if (!provider.model.trim()) return false;
  if (provider.kind === "openai-compatible") return Boolean(provider.baseUrl.trim());
  return Boolean(provider.apiKey.trim());
}

/** True when a provider has enough connection details to attempt live model discovery. */
export function canVerifyProvider(provider: Pick<AiProviderConfig, "kind" | "apiKey" | "baseUrl" | "catalogId">): boolean {
  const entry = findCatalogEntry(provider.catalogId, provider.kind);
  if (provider.kind === "openai-compatible") {
    if (!provider.baseUrl.trim()) return false;
    if (entry?.requiresApiKey) return Boolean(provider.apiKey.trim());
    return true;
  }
  return Boolean(provider.apiKey.trim());
}

export function createLanguageModel(provider: AiProviderConfig): LanguageModel {
  const model = provider.model.trim();
  if (!model) throw new Error("Verify this provider and choose a model first.");
  const baseURL = provider.baseUrl.trim() || undefined;

  switch (provider.kind) {
    case "anthropic": {
      if (!provider.apiKey.trim()) throw new Error("Add an Anthropic API key first.");
      return createAnthropic({
        apiKey: provider.apiKey.trim(),
        baseURL,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      })(model);
    }
    case "openai": {
      if (!provider.apiKey.trim()) throw new Error("Add an OpenAI API key first.");
      return createOpenAI({ apiKey: provider.apiKey.trim(), baseURL: baseURL ?? OPENAI_BASE_URL })(model);
    }
    case "google": {
      if (!provider.apiKey.trim()) throw new Error("Add a Google Gemini API key first.");
      return createGoogle({ apiKey: provider.apiKey.trim(), baseURL })(model);
    }
    case "openai-compatible": {
      if (!provider.baseUrl.trim()) throw new Error("Add the endpoint base URL for this provider.");
      return createOpenAICompatible({
        name: provider.name || "openai-compatible",
        baseURL: provider.baseUrl.trim(),
        apiKey: provider.apiKey.trim() || "not-needed",
      })(model);
    }
    default:
      throw new Error(`Unsupported provider kind: ${provider.kind}`);
  }
}

async function readHttpError(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    try {
      const parsed = JSON.parse(raw) as {
        error?: { message?: string } | string;
        message?: string;
        detail?: string;
      };
      const msg =
        (typeof parsed.error === "object" ? parsed.error?.message : parsed.error) ||
        parsed.message ||
        parsed.detail;
      if (msg) return `HTTP ${res.status}: ${msg}`;
    } catch {
      if (raw.trim()) return `HTTP ${res.status}: ${raw.trim().slice(0, 180)}`;
    }
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status} ${res.statusText || "Request failed"}`;
}

function isNonChatOpenAiModel(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes("embedding") ||
    lower.includes("whisper") ||
    lower.includes("tts") ||
    lower.includes("transcribe") ||
    lower.includes("dall-e") ||
    lower.includes("moderation") ||
    lower.includes("sora") ||
    lower.includes("realtime") ||
    lower.includes("audio-preview") ||
    lower.startsWith("babbage") ||
    lower.startsWith("davinci") ||
    lower.startsWith("text-")
  );
}

export interface DiscoverModelsResult {
  models: string[];
  latency_ms: number;
  verifiedAt: string;
}

/**
 * Verifies the provider's API key / base URL and returns ONLY the live models
 * exposed by that endpoint. Never returns hardcoded models.
 */
export async function discoverProviderModels(
  provider: Pick<AiProviderConfig, "kind" | "catalogId" | "apiKey" | "baseUrl" | "name">,
): Promise<DiscoverModelsResult> {
  const started = performance.now();
  const key = provider.apiKey.trim();
  const entry = findCatalogEntry(provider.catalogId, provider.kind);

  if (provider.kind === "anthropic") {
    if (!key) throw new Error("Enter your Anthropic API key before verifying.");
    const base = (provider.baseUrl.trim() || ANTHROPIC_BASE_URL).replace(/\/$/, "");
    const res = await fetch(`${base}/models?limit=100`, {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    if (!res.ok) throw new Error(await readHttpError(res));
    const body = (await res.json()) as { data?: { id?: string }[] };
    const models = [...new Set((body.data ?? []).map((m) => String(m.id ?? "").trim()).filter(Boolean))];
    if (!models.length) throw new Error("Connected to Anthropic, but no models were returned.");
    return { models, latency_ms: Math.round(performance.now() - started), verifiedAt: new Date().toISOString() };
  }

  if (provider.kind === "google") {
    if (!key) throw new Error("Enter your Google Gemini API key before verifying.");
    const base = (provider.baseUrl.trim() || GOOGLE_BASE_URL).replace(/\/$/, "");
    const res = await fetch(`${base}/models?pageSize=200`, {
      headers: { "x-goog-api-key": key },
    });
    if (!res.ok) throw new Error(await readHttpError(res));
    const body = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    const models = [
      ...new Set(
        (body.models ?? [])
          .filter((m) => {
            const methods = m.supportedGenerationMethods;
            if (Array.isArray(methods) && methods.length > 0 && !methods.includes("generateContent")) {
              return false;
            }
            const id = String(m.name ?? "").replace(/^models\//, "").toLowerCase();
            return Boolean(id) && !id.includes("embedding") && !id.includes("aqa") && !id.includes("imagen") && !id.includes("veo");
          })
          .map((m) => String(m.name ?? "").replace(/^models\//, "").trim())
          .filter(Boolean),
      ),
    ];
    if (!models.length) throw new Error("Connected to Google API, but no generative models were returned.");
    return { models, latency_ms: Math.round(performance.now() - started), verifiedAt: new Date().toISOString() };
  }

  // OpenAI & OpenAI-Compatible endpoints
  const base = (provider.baseUrl.trim() || entry?.defaultBaseUrl || OPENAI_BASE_URL).replace(/\/$/, "");
  if (!base) throw new Error("Enter the endpoint Base URL before verifying.");
  if ((provider.kind === "openai" || entry?.requiresApiKey) && !key) {
    throw new Error(`Enter your ${provider.name || "API"} key before verifying.`);
  }

  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${base}/models`, { headers });

  // Ollama fallback: older Ollama instances expose /api/tags instead of /v1/models
  if (!res.ok && (provider.catalogId === "ollama" || base.includes("11434"))) {
    const root = base.replace(/\/v1$/i, "");
    const ollamaRes = await fetch(`${root}/api/tags`);
    if (ollamaRes.ok) {
      const payload = (await ollamaRes.json()) as { models?: { name?: string; model?: string }[] };
      const models = [
        ...new Set(
          (payload.models ?? [])
            .map((m) => String(m.name ?? m.model ?? "").trim())
            .filter(Boolean),
        ),
      ];
      if (!models.length) {
        throw new Error("Connected to Ollama, but no local models are installed yet (run `ollama pull <model>`).");
      }
      return { models, latency_ms: Math.round(performance.now() - started), verifiedAt: new Date().toISOString() };
    }
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `Endpoint responded HTTP 404 on ${base}/models — verify the Base URL (most OpenAI-compatible APIs end in /v1).`,
      );
    }
    throw new Error(await readHttpError(res));
  }

  const body = (await res.json()) as {
    data?: { id?: string }[];
    models?: { id?: string; name?: string }[];
  };
  const rawList = Array.isArray(body.data)
    ? body.data.map((m) => String(m.id ?? "").trim())
    : Array.isArray(body.models)
      ? body.models.map((m) => String(m.id ?? m.name ?? "").trim())
      : [];

  let models = [...new Set(rawList.filter(Boolean))];
  if (provider.kind === "openai" && (!provider.baseUrl.trim() || base === OPENAI_BASE_URL)) {
    const filtered = models.filter((id) => !isNonChatOpenAiModel(id));
    if (filtered.length) models = filtered;
  }
  models.sort((a, b) => a.localeCompare(b));

  if (!models.length) {
    throw new Error(`Connected to ${base}, but no models were returned by /models.`);
  }

  return {
    models,
    latency_ms: Math.round(performance.now() - started),
    verifiedAt: new Date().toISOString(),
  };
}

/** Dynamically discovers live TTS or STT audio models from the chosen voice endpoint. */
export async function discoverVoiceModels(params: {
  provider: "openai" | "google" | "openai-compatible";
  mode: "tts" | "stt";
  baseUrl?: string;
  apiKey?: string;
}): Promise<string[]> {
  const key = params.apiKey?.trim() ?? "";

  if (params.provider === "google") {
    if (!key) throw new Error("Add a Google Gemini API key to load Gemini voice models.");
    const base = (params.baseUrl?.trim() || GOOGLE_BASE_URL).replace(/\/$/, "");
    const res = await fetch(`${base}/models?pageSize=200`, {
      headers: { "x-goog-api-key": key },
    });
    if (!res.ok) throw new Error(await readHttpError(res));
    const body = (await res.json()) as { models?: { name?: string }[] };
    const all = (body.models ?? []).map((m) => String(m.name ?? "").replace(/^models\//, "").trim()).filter(Boolean);
    const ttsOnly = all.filter((id) => id.toLowerCase().includes("tts"));
    const models = [...new Set(ttsOnly.length ? ttsOnly : all)];
    if (!models.length) throw new Error("No Gemini audio models returned.");
    return models;
  }

  const base = (params.baseUrl?.trim() || OPENAI_BASE_URL).replace(/\/$/, "");
  if (params.provider === "openai" && !key) {
    throw new Error("Add an OpenAI API key to load audio models.");
  }
  const res = await fetch(`${base}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) throw new Error(await readHttpError(res));
  const body = (await res.json()) as { data?: { id?: string }[] };
  const all = [...new Set((body.data ?? []).map((m) => String(m.id ?? "").trim()).filter(Boolean))];
  const filtered =
    params.mode === "tts"
      ? all.filter((id) => /tts|speech|kokoro|audio/i.test(id))
      : all.filter((id) => /whisper|transcribe|stt|asr/i.test(id));
  const result = (filtered.length ? filtered : all).sort((a, b) => a.localeCompare(b));
  if (!result.length) throw new Error("No audio models returned by this endpoint.");
  return result;
}

function usageFrom(raw: unknown): Omit<AiTurnUsage, "latency_ms"> {
  const u = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
  const input_tokens = num(u.inputTokens ?? u.promptTokens);
  const output_tokens = num(u.outputTokens ?? u.completionTokens);
  const thought_tokens = num(u.reasoningTokens ?? u.thoughtTokens);
  const details = (u.inputTokenDetails ?? {}) as Record<string, unknown>;
  const cached_tokens = num(details.cacheReadTokens ?? u.cachedInputTokens);
  const total_tokens = num(u.totalTokens) || input_tokens + output_tokens + thought_tokens;
  return { input_tokens, output_tokens, thought_tokens, cached_tokens, total_tokens };
}

function errorCode(err: unknown): string {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const status = e?.statusCode ?? e?.status;
  if (status) return `HTTP_${status}`;
  return String(e?.message ?? err).slice(0, 80);
}

export function buildPlannerSystemPrompt(snapshot: unknown, extraContext?: string): string {
  return `You are My Planner AI — a sharp, warm, concise personal planning, time-tracking, money, and habit coach.
Rules:
- Reply directly in clean, natural Markdown (short paragraphs, bold highlights, bullet/numbered lists). NEVER wrap your conversational reply in JSON.
- Stay strictly grounded in the user's real workspace data below. Never invent task IDs or goal IDs.
- All dates must use YYYY-MM-DD format relative to today_local.
- Non-negotiables ("routines") are daily habits; routine_logs_last_30_days shows completed check-ins.
- If the user is just greeting or chatting casually, answer briefly and naturally — do NOT dump repetitive summaries or JSON.
- ONLY when proposing concrete planner changes, append ONE fenced block at the very end:
\`\`\`planner-actions
[{"type":"reschedule_task","label":"Move task to today","task_id":3,"planned_date":"YYYY-MM-DD"}]
\`\`\`
- Supported action types: create_task, complete_task, reschedule_task, create_goal, create_money_entry, create_theme, create_routine.
- create_routine uses title, label, optional color and optional time_of_day ("morning" | "afternoon" | "evening" | "anytime").

CURRENT WORKSPACE SNAPSHOT:
${JSON.stringify(snapshot)}${extraContext ? `\n\nEXTRA VIEW CONTEXT:\n${extraContext}` : ""}`;
}

export interface StreamPlannerChatParams {
  prompt: string;
  sessionId: string;
  provider: AiProviderConfig;
  history: { role: "user" | "assistant"; content: string }[];
  extraContext?: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
}

export interface PlannerChatResult {
  reply: string;
  actions: AiSuggestedAction[];
  model: string;
  usage: AiTurnUsage;
}

export async function streamPlannerChat(params: StreamPlannerChatParams): Promise<PlannerChatResult> {
  const { prompt, sessionId, provider, history, extraContext, signal, onDelta, onReasoning } = params;
  const model = provider.model.trim();
  const transport = provider.catalogId || provider.kind;
  const started = performance.now();

  const snapshot = await api.getPlannerContext().catch(() => ({}));
  const messages = [
    ...history.slice(-12).map((h) => ({
      role: h.role,
      content: h.role === "assistant" ? parseStructuredOutput(h.content).reply : h.content,
    })),
    { role: "user" as const, content: prompt },
  ];

  try {
    const result = streamText({
      model: createLanguageModel(provider),
      system: buildPlannerSystemPrompt(snapshot, extraContext),
      messages,
      maxOutputTokens: 8192,
      abortSignal: signal,
    });

    let raw = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        raw += part.text;
        onDelta?.(part.text);
      } else if (part.type === "reasoning-delta") {
        onReasoning?.(part.text);
      } else if (part.type === "error") {
        throw part.error;
      }
    }

    const finalText = raw || (await result.text);
    if (!finalText.trim()) throw new Error("The provider returned an empty response.");
    const usageRaw = await result.usage;
    const usage: AiTurnUsage = {
      ...usageFrom(usageRaw),
      latency_ms: Math.round(performance.now() - started),
    };
    const { reply, actions } = parseStructuredOutput(finalText);

    await api.saveAiTurn({
      sessionId,
      userContent: prompt,
      assistantContent: finalText,
      model,
      actions,
      usage,
    });
    await api.logAiUsageEvent({
      model,
      transport,
      feature: "chat",
      ...usageFrom(usageRaw),
      latency_ms: usage.latency_ms ?? 0,
      status: "ok",
      error_code: "",
    });

    return { reply, actions, model, usage };
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === "AbortError") {
      throw new Error("Generation stopped.");
    }
    const latency = Math.round(performance.now() - started);
    await api
      .logAiUsageEvent({
        model,
        transport,
        feature: "chat",
        input_tokens: 0,
        output_tokens: 0,
        thought_tokens: 0,
        cached_tokens: 0,
        total_tokens: 0,
        latency_ms: latency,
        status: "error",
        error_code: errorCode(err),
      })
      .catch(() => {});
    throw err;
  }
}

export async function testProviderConnection(provider: AiProviderConfig): Promise<{
  ok: boolean;
  model: string;
  provider: string;
  reply: string;
  latency_ms: number;
}> {
  const started = performance.now();
  const model = provider.model.trim();
  if (!model) throw new Error("Verify this provider and select a model before running a chat test.");
  try {
    const result = await generateText({
      model: createLanguageModel(provider),
      prompt: "Reply with exactly: OK",
      maxOutputTokens: 32,
    });
    const latency_ms = Math.round(performance.now() - started);
    await api
      .logAiUsageEvent({
        model,
        transport: provider.catalogId || provider.kind,
        feature: "test",
        ...usageFrom(result.usage),
        latency_ms,
        status: "ok",
        error_code: "",
      })
      .catch(() => {});
    return {
      ok: true,
      model,
      provider: provider.name,
      reply: result.text.trim(),
      latency_ms,
    };
  } catch (err) {
    const latency_ms = Math.round(performance.now() - started);
    await api
      .logAiUsageEvent({
        model,
        transport: provider.catalogId || provider.kind,
        feature: "test",
        input_tokens: 0,
        output_tokens: 0,
        thought_tokens: 0,
        cached_tokens: 0,
        total_tokens: 0,
        latency_ms,
        status: "error",
        error_code: errorCode(err),
      })
      .catch(() => {});
    throw err;
  }
}
