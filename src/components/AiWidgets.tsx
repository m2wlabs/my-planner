import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@halo-ds/react";
import * as api from "../lib/api";
import type { AiConfig, AiProviderConfig, AiVoiceConfig } from "../lib/api";
import { useAiConfig, useAiUsage, useSaveAiConfig } from "../lib/hooks";
import {
  canVerifyProvider,
  discoverProviderModels,
  discoverVoiceModels,
  isProviderReady,
  PROVIDER_LABELS,
  testProviderConnection,
} from "../lib/aiEngine";
import {
  findCatalogEntry,
  PROVIDER_CATALOG,
  PROVIDER_CATEGORIES,
  type ProviderCatalogEntry,
  type ProviderCategory,
} from "../lib/providerCatalog";
import {
  listBrowserVoices,
  onBrowserVoicesChanged,
  resolveVoiceTarget,
  speakText,
  startListening,
  type ListenHandle,
  type SpeakHandle,
  type VoiceAudioAdapter,
} from "../lib/voiceEngine";
import { ProviderLogo } from "./ProviderLogo";
import {
  Button,
  Card,
  ComboboxField,
  Field,
  Icon,
  Input,
  Modal,
  Progress,
  SelectField,
  Switch,
} from "./ui";

export function fmtTokens(n: number) {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function fmtLatency(ms: number) {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const OPENAI_VOICES = ["alloy", "ash", "coral", "echo", "nova", "onyx", "sage", "shimmer"];
const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede"];
const XAI_VOICES = ["eve", "ara", "rex", "sal", "leo"];

const QUICK_ADD_IDS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "xai",
  "deepseek",
  "minimax",
  "ollama",
];

export function defaultVoiceForAdapter(adapter: VoiceAudioAdapter): string {
  switch (adapter) {
    case "google":
      return "Kore";
    case "xai":
      return "eve";
    case "minimax":
      return "English_Graceful_Lady";
    case "openai":
      return "nova";
    default:
      return "";
  }
}

export function buildVoiceProviderOptions(
  providers: AiProviderConfig[],
): { value: string; label: string }[] {
  const connected = providers.filter((p) => p.kind !== "anthropic");
  const hasOpenAi = connected.some((p) => p.kind === "openai");
  const hasGoogle = connected.some((p) => p.kind === "google");
  const options: { value: string; label: string }[] = [
    { value: "browser", label: "Browser Native (System)" },
    ...connected.map((p) => ({
      value: `provider:${p.id}`,
      label: `${p.name} (connected)`,
    })),
  ];
  if (!hasOpenAi) options.push({ value: "custom:openai", label: "OpenAI (standalone)" });
  if (!hasGoogle) options.push({ value: "custom:google", label: "Google Gemini (standalone)" });
  options.push({ value: "custom:openai-compatible", label: "Custom OpenAI-Compatible" });
  return options;
}

export function selectedVoiceOptionValue(
  voice: AiVoiceConfig,
  providers: AiProviderConfig[],
  mode: "tts" | "stt",
  activeProviderId?: string,
): string {
  const target = resolveVoiceTarget(voice, providers, mode, activeProviderId);
  if (target.adapter === "browser") return "browser";
  if (target.linkedProvider) return `provider:${target.linkedProvider.id}`;
  return `custom:${target.providerKind}`;
}

export function voicePatchForSelection(
  selection: string,
  providers: AiProviderConfig[],
  mode: "tts" | "stt",
): Partial<AiVoiceConfig> {
  if (selection === "browser") {
    return mode === "tts"
      ? {
          ttsProvider: "browser",
          ttsProviderId: "",
          ttsModel: "",
          ttsVoice: "",
          ttsBaseUrl: "",
          ttsApiKey: "",
        }
      : {
          sttProvider: "browser",
          sttProviderId: "",
          sttModel: "",
          sttBaseUrl: "",
          sttApiKey: "",
        };
  }

  if (selection.startsWith("provider:")) {
    const id = selection.slice("provider:".length);
    const provider = providers.find((p) => p.id === id);
    const kind =
      provider?.kind === "google"
        ? "google"
        : provider?.kind === "openai"
          ? "openai"
          : "openai-compatible";
    const previewVoice: AiVoiceConfig = {
      ttsProvider: kind,
      ttsProviderId: id,
      ttsModel: "",
      ttsVoice: "",
      ttsBaseUrl: "",
      ttsApiKey: "",
      ttsRate: 1,
      sttProvider: kind,
      sttProviderId: id,
      sttModel: "",
      sttBaseUrl: "",
      sttApiKey: "",
      autoSpeakReplies: false,
      autoSendVoice: true,
    };
    const adapter = resolveVoiceTarget(previewVoice, providers, mode).adapter;
    return mode === "tts"
      ? {
          ttsProvider: kind,
          ttsProviderId: id,
          ttsModel: "",
          ttsVoice: defaultVoiceForAdapter(adapter),
          ttsBaseUrl: "",
          ttsApiKey: "",
        }
      : {
          sttProvider: kind,
          sttProviderId: id,
          sttModel: "",
          sttBaseUrl: "",
          sttApiKey: "",
        };
  }

  const customKind = selection.slice("custom:".length) as "openai" | "google" | "openai-compatible";
  const safeKind =
    customKind === "google" || customKind === "openai" ? customKind : "openai-compatible";
  return mode === "tts"
    ? {
        ttsProvider: safeKind,
        ttsProviderId: "",
        ttsModel: "",
        ttsVoice:
          safeKind === "google" ? "Kore" : safeKind === "openai" ? "nova" : "alloy",
      }
    : {
        sttProvider: safeKind,
        sttProviderId: "",
        sttModel: "",
      };
}

function adapterEndpointHint(adapter: VoiceAudioAdapter, mode: "tts" | "stt"): string {
  if (adapter === "google") return "Gemini generateContent";
  if (adapter === "minimax") return mode === "tts" ? "MiniMax /v1/t2a_v2" : "MiniMax /v1/speech_to_text";
  if (adapter === "xai") return mode === "tts" ? "xAI /v1/tts" : "/audio/transcriptions";
  if (adapter === "elevenlabs") return "ElevenLabs /text-to-speech";
  return mode === "tts" ? "/audio/speech" : "/audio/transcriptions";
}

function DeferredInput({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  type?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft !== value) onCommit(draft);
      }}
    />
  );
}

function KeyInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="ai-key-row">
      <Input
        type="password"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft !== value) onCommit(draft);
        }}
      />
      {draft && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Clear API key"
          onClick={() => {
            setDraft("");
            onCommit("");
          }}
        >
          <Icon name="x" size={13} />
        </Button>
      )}
    </div>
  );
}

function statusChip(ok: boolean | null, text: string) {
  return (
    <span className={`chip ${ok === null ? "chip-neutral" : ok ? "chip-success" : "chip-danger"}`}>
      {text}
    </span>
  );
}

/* ------------------------------------------------------------ usage card */

export function AiUsageCard({ compact = false }: { compact?: boolean }) {
  const { data: usage } = useAiUsage();
  const { data: config } = useAiConfig();
  const save = useSaveAiConfig();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [budget, setBudget] = useState("");
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (config) setBudget(String(config.monthlyTokenBudget || 1_000_000));
  }, [config?.monthlyTokenBudget]);

  const saveBudget = () => {
    if (!config) return;
    const next = Math.max(1000, Number(budget) || 1_000_000);
    setBudget(String(next));
    save.mutate({ ...config, monthlyTokenBudget: next });
    toast({ type: "success", title: "Monthly token budget saved" });
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      await api.clearAiUsage();
      await qc.invalidateQueries({ queryKey: ["ai_usage"] });
      toast({ type: "success", title: "AI usage history cleared" });
    } finally {
      setClearing(false);
    }
  };

  const maxDaily = Math.max(1, ...(usage?.daily_7d ?? []).map((d) => d.total_tokens));
  const monthPct = usage?.monthly_token_budget
    ? Math.min(100, Math.round((usage.month.total_tokens / usage.monthly_token_budget) * 100))
    : 0;

  return (
    <Card id="section-ai-usage" className="ai-usage-card">
      <div className="card-head plain">
        <Icon name="chart" size={18} className="icon-muted" />
        <span className="card-title">AI usage</span>
        <span className="spacer" />
        <span className="field-hint">{usage?.month.requests ?? 0} requests this month</span>
        {!compact && (usage?.recent.length ?? 0) > 0 && (
          <Button size="sm" variant="ghost" disabled={clearing} onClick={() => void clearHistory()}>
            <Icon name="trash" size={13} /> Clear
          </Button>
        )}
      </div>
      <div className="card-body pad">
        <div className="ai-usage-stats">
          <div className="ai-usage-stat">
            <span className="stat-label">Today</span>
            <strong>{fmtTokens(usage?.today.total_tokens ?? 0)}</strong>
            <span className="field-hint">{usage?.today.requests ?? 0} calls</span>
          </div>
          <div className="ai-usage-stat">
            <span className="stat-label">This month</span>
            <strong>{fmtTokens(usage?.month.total_tokens ?? 0)}</strong>
            <span className="field-hint">{usage?.month.errors ?? 0} errors</span>
          </div>
          <div className="ai-usage-stat">
            <span className="stat-label">Avg latency</span>
            <strong>{fmtLatency(usage?.today.avg_latency_ms ?? 0)}</strong>
            <span className="field-hint">today</span>
          </div>
        </div>

        <div className="ai-budget-row">
          <div style={{ flex: 1 }}>
            <Progress value={monthPct} slim success={monthPct < 80} />
            <span className="field-hint">
              {monthPct}% of {fmtTokens(usage?.monthly_token_budget ?? 0)} monthly token budget
            </span>
          </div>
          <div className="ai-budget-input">
            <Input
              inputMode="numeric"
              value={budget}
              aria-label="Monthly token budget"
              onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={saveBudget}
            />
            <Button size="sm" variant="secondary" onClick={saveBudget}>
              Save
            </Button>
          </div>
        </div>

        <div className="ai-spark-chart" aria-label="Tokens used over the last 7 days">
          {(usage?.daily_7d ?? []).map((day) => (
            <div className="ai-spark-col" key={day.date}>
              <div className="ai-spark-bar-wrap">
                <div
                  className="ai-spark-bar"
                  style={{ height: `${Math.max(3, Math.round((day.total_tokens / maxDaily) * 100))}%` }}
                  title={`${day.date}: ${day.total_tokens.toLocaleString()} tokens · ${day.requests} calls`}
                />
              </div>
              <span className="ai-spark-label">{day.date.slice(8)}</span>
            </div>
          ))}
        </div>

        {!compact && (usage?.by_model.length ?? 0) > 0 && (
          <div className="ai-model-breakdown">
            <span className="field-label">By model</span>
            {usage!.by_model.map((row) => (
              <div className="ai-model-row" key={row.model}>
                <span className="ai-model-name">{row.model}</span>
                <span className="field-hint">{row.requests} calls</span>
                <strong>{fmtTokens(row.total_tokens)}</strong>
              </div>
            ))}
          </div>
        )}

        {!compact && (usage?.recent.length ?? 0) > 0 && (
          <div className="ai-usage-log">
            <span className="field-label">Recent calls</span>
            <div className="ai-usage-log-rows">
              {usage!.recent.slice(0, 8).map((row) => (
                <div className="ai-usage-log-row" key={row.id}>
                  <span className={`ai-log-dot${row.status === "ok" ? " is-ok" : " is-error"}`} />
                  <span className="ai-log-model">{row.model || "unknown"}</span>
                  <span className="field-hint">{row.feature}</span>
                  <span className="field-hint">{fmtTokens(row.total_tokens)} tok</span>
                  <span className="field-hint">{fmtLatency(row.latency_ms)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------- add provider modal */

export function AddProviderModal({
  open,
  initialCatalogId,
  onClose,
  onConnected,
}: {
  open: boolean;
  initialCatalogId?: string | null;
  onClose: () => void;
  onConnected?: () => void;
}) {
  const { data: config } = useAiConfig();
  const save = useSaveAiConfig();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | ProviderCategory>("all");
  const [selected, setSelected] = useState<ProviderCatalogEntry | null>(null);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [verifiedAt, setVerifiedAt] = useState("");
  const [verifyMeta, setVerifyMeta] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  const selectEntry = (entry: ProviderCatalogEntry) => {
    setSelected(entry);
    setName(entry.name);
    setApiKey("");
    setBaseUrl(entry.defaultBaseUrl);
    setDiscovered([]);
    setSelectedModel("");
    setVerifiedAt("");
    setVerifyMeta("");
    setError("");
  };

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setCategory("all");
    setError("");
    if (initialCatalogId) {
      const entry = findCatalogEntry(initialCatalogId);
      if (entry) {
        selectEntry(entry);
        return;
      }
    }
    setSelected(null);
  }, [open, initialCatalogId]);

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PROVIDER_CATALOG.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (!q) return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.catalogId.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q)
      );
    });
  }, [search, category]);

  if (!open || !config) return null;

  const configuredCatalogIds = new Set(config.providers.map((p) => p.catalogId || p.kind));

  const verifyAndDiscover = async () => {
    if (!selected) return;
    setVerifying(true);
    setError("");
    try {
      const res = await discoverProviderModels({
        kind: selected.kind,
        catalogId: selected.catalogId,
        name: name.trim() || selected.name,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
      });
      setDiscovered(res.models);
      setVerifiedAt(res.verifiedAt);
      setVerifyMeta(`Verified in ${fmtLatency(res.latency_ms)} · ${res.models.length} models available`);
      setSelectedModel((prev) => (prev && res.models.includes(prev) ? prev : res.models[0] ?? ""));
    } catch (err) {
      setDiscovered([]);
      setSelectedModel("");
      setVerifiedAt("");
      setVerifyMeta("");
      setError(String((err as Error)?.message ?? err));
    } finally {
      setVerifying(false);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    if (!discovered.length || !selectedModel.trim()) {
      setError("Verify your API key or base URL first to load available models.");
      return;
    }
    const id = `${selected.catalogId}-${Date.now()}`;
    const nextProvider: AiProviderConfig = {
      id,
      catalogId: selected.catalogId,
      kind: selected.kind,
      name: name.trim() || selected.name,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: selectedModel.trim(),
      discoveredModels: discovered,
      verifiedAt: verifiedAt || new Date().toISOString(),
      enabled: true,
    };
    try {
      await save.mutateAsync({
        ...config,
        schemaVersion: 2,
        activeProviderId: id,
        providers: [...config.providers, nextProvider],
      });
      toast({
        type: "success",
        title: `Added ${nextProvider.name}`,
        description: `Active model: ${nextProvider.model}`,
      });
      onConnected?.();
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  const modelOptions = discovered.map((m) => ({ value: m, label: m }));

  return (
    <Modal
      title={selected ? `Connect ${selected.name}` : "Add an AI provider"}
      label={selected ? PROVIDER_LABELS[selected.kind] : `${PROVIDER_CATALOG.length} providers supported`}
      onClose={onClose}
      footer={
        selected ? (
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              <Icon name="chevronLeft" size={14} /> All providers
            </Button>
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              disabled={save.isPending || !selectedModel || discovered.length === 0}
            >
              {save.isPending ? "Saving…" : "Save & Activate"}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {!selected ? (
        <div className="provider-picker-step">
          <div className="provider-picker-sticky">
            <div className="provider-picker-search">
              <Input
                value={search}
                placeholder="Search providers (Anthropic, OpenAI, MiniMax, OpenRouter, Ollama…)"
                aria-label="Search providers"
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="provider-category-pills">
              {PROVIDER_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`filter-pill${category === cat.id ? " active" : ""}`}
                  onClick={() => setCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
          <div className="provider-catalog-grid">
            {filteredCatalog.map((entry) => {
              const already = configuredCatalogIds.has(entry.catalogId);
              return (
                <button
                  key={entry.catalogId}
                  type="button"
                  className="provider-catalog-tile"
                  onClick={() => selectEntry(entry)}
                >
                  <ProviderLogo catalogId={entry.catalogId} kind={entry.kind} size={18} />
                  <div className="provider-catalog-copy">
                    <div className="provider-catalog-title-row">
                      <strong>{entry.name}</strong>
                      {already && <span className="chip chip-neutral">Added</span>}
                    </div>
                    <span>{entry.description}</span>
                  </div>
                </button>
              );
            })}
            {filteredCatalog.length === 0 && (
              <div className="field-hint" style={{ gridColumn: "1 / -1", padding: "12px 4px" }}>
                No matching provider. Choose <strong>Custom OpenAI-Compatible</strong> to connect any /v1 server.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="provider-connect-step">
          <div className="provider-connect-hero">
            <ProviderLogo catalogId={selected.catalogId} kind={selected.kind} size={20} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{selected.name}</strong>
              <div className="field-hint">{selected.description}</div>
            </div>
            {selected.docsUrl && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void api.openExternalUrl(selected.docsUrl!)}
              >
                <Icon name="external" size={13} /> Get key
              </Button>
            )}
          </div>

          <div className="modal-grid">
            <Field label="Display name">
              <Input
                value={name}
                placeholder={selected.name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label={selected.requiresApiKey ? "API key" : "API key (optional)"}
              hint="Encrypted locally outside SQLite backups"
            >
              <Input
                type="password"
                value={apiKey}
                placeholder={selected.keyPlaceholder}
                autoFocus={selected.requiresApiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (discovered.length) {
                    setDiscovered([]);
                    setSelectedModel("");
                    setVerifyMeta("");
                  }
                }}
              />
            </Field>
          </div>

          <Field
            label="Base URL"
            hint={
              selected.defaultBaseUrl
                ? `Default: ${selected.defaultBaseUrl}`
                : "Enter your OpenAI-compatible server URL (typically ends with /v1)"
            }
          >
            <Input
              value={baseUrl}
              placeholder={selected.defaultBaseUrl || "https://your-endpoint.example/v1"}
              autoFocus={!selected.requiresApiKey}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                if (discovered.length) {
                  setDiscovered([]);
                  setSelectedModel("");
                  setVerifyMeta("");
                }
              }}
            />
          </Field>

          <div className="provider-verify-bar">
            <Button
              variant={discovered.length ? "secondary" : "primary"}
              size="sm"
              disabled={
                verifying ||
                !canVerifyProvider({
                  kind: selected.kind,
                  catalogId: selected.catalogId,
                  apiKey,
                  baseUrl,
                })
              }
              onClick={() => void verifyAndDiscover()}
            >
              <Icon name="zap" size={14} />{" "}
              {verifying
                ? "Verifying & loading models…"
                : discovered.length
                  ? "Re-verify & refresh models"
                  : "Verify & load models"}
            </Button>
            {verifyMeta && <span className="chip chip-success">{verifyMeta}</span>}
          </div>

          {discovered.length > 0 ? (
            <Field
              label={`Available models (${discovered.length})`}
              hint="Live models returned by this provider's API"
            >
              <ComboboxField
                value={selectedModel}
                onChange={setSelectedModel}
                options={modelOptions}
                placeholder="Search and choose a model…"
                ariaLabel="Available models"
              />
            </Field>
          ) : (
            <div className="provider-empty-models-hint">
              <Icon name="shield" size={14} />
              <span>
                Models appear here only after testing your API key or base URL against the provider.
              </span>
            </div>
          )}

          {error && <div className="field-error">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------- providers card */

export function AiProvidersCard() {
  const { data: config } = useAiConfig();
  const save = useSaveAiConfig();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [quickCatalogId, setQuickCatalogId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [statusMap, setStatusMap] = useState<Record<string, { ok: boolean; text: string }>>({});

  if (!config) return null;

  const update = (next: AiConfig) => save.mutate({ ...next, schemaVersion: 2 });

  const patchProvider = (id: string, patch: Partial<AiProviderConfig>) =>
    update({
      ...config,
      providers: config.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });

  const removeProvider = (id: string) => {
    const remaining = config.providers.filter((p) => p.id !== id);
    const nextVoice: AiVoiceConfig = {
      ...config.voice,
      ...(config.voice.ttsProviderId === id ? { ttsProviderId: "" } : {}),
      ...(config.voice.sttProviderId === id ? { sttProviderId: "" } : {}),
    };
    update({
      ...config,
      providers: remaining,
      voice: nextVoice,
      activeProviderId:
        config.activeProviderId === id
          ? remaining.find((p) => isProviderReady(p))?.id ?? remaining[0]?.id ?? ""
          : config.activeProviderId,
    });
  };

  const verifyProvider = async (provider: AiProviderConfig) => {
    setVerifying((prev) => ({ ...prev, [provider.id]: true }));
    try {
      const res = await discoverProviderModels(provider);
      const nextModel =
        provider.model && res.models.includes(provider.model)
          ? provider.model
          : res.models[0] ?? "";
      patchProvider(provider.id, {
        discoveredModels: res.models,
        verifiedAt: res.verifiedAt,
        model: nextModel,
      });
      setStatusMap((prev) => ({
        ...prev,
        [provider.id]: {
          ok: true,
          text: `Verified in ${fmtLatency(res.latency_ms)} · ${res.models.length} models`,
        },
      }));
      toast({
        type: "success",
        title: `${provider.name} verified`,
        description: `Loaded ${res.models.length} live model${res.models.length === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      setStatusMap((prev) => ({ ...prev, [provider.id]: { ok: false, text: msg } }));
      toast({ type: "error", title: `Could not verify ${provider.name}`, description: msg });
    } finally {
      setVerifying((prev) => ({ ...prev, [provider.id]: false }));
    }
  };

  const runChatTest = async (provider: AiProviderConfig) => {
    setTesting((prev) => ({ ...prev, [provider.id]: true }));
    try {
      const result = await testProviderConnection(provider);
      setStatusMap((prev) => ({
        ...prev,
        [provider.id]: {
          ok: true,
          text: `Chat OK in ${fmtLatency(result.latency_ms)} · "${result.reply.slice(0, 36)}"`,
        },
      }));
    } catch (err) {
      setStatusMap((prev) => ({
        ...prev,
        [provider.id]: { ok: false, text: String((err as Error)?.message ?? err) },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [provider.id]: false }));
    }
  };

  const openPickerFor = (catalogId: string | null) => {
    setQuickCatalogId(catalogId);
    setAddOpen(true);
  };

  const quickEntries = QUICK_ADD_IDS.map((id) => findCatalogEntry(id)).filter(
    (e): e is ProviderCatalogEntry => Boolean(e),
  );

  return (
    <Card id="section-ai-providers" className="ai-providers-card">
      <div className="card-head plain">
        <Icon name="sparkles" size={18} className="icon-muted" />
        <span className="card-title">AI providers</span>
        {config.providers.length > 0 && <span className="count">{config.providers.length}</span>}
        <span className="spacer" />
        <Button size="sm" variant="primary" onClick={() => openPickerFor(null)}>
          <Icon name="plus" size={14} /> Add provider
        </Button>
      </div>

      <div className="card-body pad">
        {config.providers.length === 0 ? (
          <div className="provider-empty-state">
            <div className="provider-empty-copy">
              <strong>Choose an AI provider to connect</strong>
              <span>
                Add only the providers you want to use. Models are discovered live after verifying
                your API key or base URL — nothing is hardcoded.
              </span>
            </div>
            <div className="provider-quick-grid">
              {quickEntries.map((entry) => (
                <button
                  key={entry.catalogId}
                  type="button"
                  className="provider-quick-tile"
                  onClick={() => openPickerFor(entry.catalogId)}
                >
                  <ProviderLogo catalogId={entry.catalogId} kind={entry.kind} size={18} />
                  <span>{entry.name}</span>
                </button>
              ))}
            </div>
            <div>
              <Button size="sm" variant="secondary" onClick={() => openPickerFor(null)}>
                Browse all {PROVIDER_CATALOG.length} providers
              </Button>
            </div>
          </div>
        ) : (
          <div className="ai-provider-list">
            {config.providers.map((provider) => {
              const entry = findCatalogEntry(provider.catalogId, provider.kind);
              const isActive = config.activeProviderId === provider.id;
              const liveModels = provider.discoveredModels ?? [];
              const hasModels = liveModels.length > 0;
              const ready = isProviderReady(provider);
              const status = statusMap[provider.id];

              return (
                <div
                  key={provider.id}
                  className={`ai-provider-card${isActive ? " is-active" : ""}`}
                >
                  <div className="ai-provider-head">
                    <div className="ai-provider-title">
                      <ProviderLogo catalogId={provider.catalogId} kind={provider.kind} size={18} />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <strong>{provider.name}</strong>
                          {isActive && ready && <span className="chip chip-success">Active</span>}
                          {hasModels ? (
                            <span className="chip chip-neutral">{liveModels.length} models</span>
                          ) : (
                            <span className="chip chip-warning">Verify to load models</span>
                          )}
                        </div>
                        <span className="field-hint">{PROVIDER_LABELS[provider.kind]}</span>
                      </div>
                    </div>
                    <div className="ai-provider-actions">
                      {!isActive && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!ready}
                          onClick={() => update({ ...config, activeProviderId: provider.id })}
                        >
                          Set active
                        </Button>
                      )}
                      <Switch
                        checked={provider.enabled}
                        onChange={(enabled) => patchProvider(provider.id, { enabled })}
                        label={`${provider.name} enabled`}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${provider.name}`}
                        onClick={() => removeProvider(provider.id)}
                      >
                        <Icon name="trash" size={14} />
                      </Button>
                    </div>
                  </div>

                  <div className="ai-provider-grid">
                    <Field
                      label={entry?.requiresApiKey ? "API key" : "API key (optional)"}
                      hint="Encrypted outside backups"
                    >
                      <KeyInput
                        value={provider.apiKey}
                        placeholder={entry?.keyPlaceholder ?? "Paste API key"}
                        onCommit={(apiKey) =>
                          patchProvider(provider.id, {
                            apiKey: apiKey.trim(),
                            discoveredModels: [],
                            model: "",
                            verifiedAt: "",
                          })
                        }
                      />
                    </Field>
                    <Field label="Base URL" hint={entry?.defaultBaseUrl ? `Default: ${entry.defaultBaseUrl}` : undefined}>
                      <DeferredInput
                        value={provider.baseUrl}
                        placeholder={entry?.defaultBaseUrl || "https://…/v1"}
                        onCommit={(baseUrl) =>
                          patchProvider(provider.id, {
                            baseUrl: baseUrl.trim(),
                            discoveredModels: [],
                            model: "",
                            verifiedAt: "",
                          })
                        }
                      />
                    </Field>
                  </div>

                  {hasModels ? (
                    <div className="ai-provider-model-row">
                      <Field label="Active model" className="grow">
                        <ComboboxField
                          value={provider.model}
                          onChange={(model) => patchProvider(provider.id, { model })}
                          options={liveModels.map((m) => ({ value: m, label: m }))}
                          placeholder="Search discovered models…"
                          ariaLabel={`${provider.name} model`}
                        />
                      </Field>
                    </div>
                  ) : (
                    <div className="provider-empty-models-hint">
                      <Icon name="zap" size={14} />
                      <span>
                        Click <strong>Verify &amp; load models</strong> to test your credentials and
                        fetch the models available on this endpoint.
                      </span>
                    </div>
                  )}

                  <div className="ai-provider-foot">
                    <Button
                      size="sm"
                      variant={hasModels ? "secondary" : "primary"}
                      disabled={verifying[provider.id] || !canVerifyProvider(provider)}
                      onClick={() => void verifyProvider(provider)}
                    >
                      <Icon name="refresh" size={13} />{" "}
                      {verifying[provider.id]
                        ? "Verifying…"
                        : hasModels
                          ? "Refresh models"
                          : "Verify & load models"}
                    </Button>
                    {hasModels && provider.model && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={testing[provider.id]}
                        onClick={() => void runChatTest(provider)}
                      >
                        <Icon name="zap" size={13} />{" "}
                        {testing[provider.id] ? "Testing…" : "Test model"}
                      </Button>
                    )}
                    {entry?.docsUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void api.openExternalUrl(entry.docsUrl!)}
                      >
                        <Icon name="external" size={13} /> API keys
                      </Button>
                    )}
                    {status && statusChip(status.ok, status.text)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AddProviderModal
        open={addOpen}
        initialCatalogId={quickCatalogId}
        onClose={() => {
          setAddOpen(false);
          setQuickCatalogId(null);
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------- voice card */

function VoiceSettingsCardInner({ config }: { config: AiConfig }) {
  const save = useSaveAiConfig();
  const { toast } = useToast();

  // Synchronized live draft eliminates stale-closure races between typing and clicking Load/Test.
  const [draft, setDraft] = useState<AiVoiceConfig>(() => config.voice);
  const draftRef = useRef<AiVoiceConfig>(config.voice);
  const configRef = useRef<AiConfig>(config);
  configRef.current = config;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => listBrowserVoices());
  const [ttsModels, setTtsModels] = useState<string[]>([]);
  const [sttModels, setSttModels] = useState<string[]>([]);
  const [loadingTts, setLoadingTts] = useState(false);
  const [loadingStt, setLoadingStt] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingMic, setTestingMic] = useState(false);
  const [transcribingMic, setTranscribingMic] = useState(false);
  const [micResult, setMicResult] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [showTtsOverrides, setShowTtsOverrides] = useState(false);
  const [showSttOverrides, setShowSttOverrides] = useState(false);
  const speakRef = useRef<SpeakHandle | null>(null);
  const listenRef = useRef<ListenHandle | null>(null);

  useEffect(() => {
    if (!dirtyRef.current) {
      draftRef.current = config.voice;
      setDraft(config.voice);
    }
  }, [config.voice]);

  useEffect(() => {
    setVoices(listBrowserVoices());
    return onBrowserVoicesChanged(setVoices);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      speakRef.current?.stop();
      listenRef.current?.cancel();
    };
  }, []);

  const persistNow = (nextVoice: AiVoiceConfig) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyRef.current = false;
    save.mutate({ ...configRef.current, schemaVersion: 2, voice: nextVoice });
  };

  const updateVoice = (patch: Partial<AiVoiceConfig>, immediate = false) => {
    const next: AiVoiceConfig = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setVoiceError("");
    if (immediate) {
      persistNow(next);
      return;
    }
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistNow(draftRef.current), 280);
  };

  const flushDraft = (): AiVoiceConfig => {
    if (dirtyRef.current) persistNow(draftRef.current);
    return draftRef.current;
  };

  const providerOptions = useMemo(
    () => buildVoiceProviderOptions(config.providers),
    [config.providers],
  );

  const ttsTarget = useMemo(
    () => resolveVoiceTarget(draft, config.providers, "tts", config.activeProviderId),
    [draft, config.providers, config.activeProviderId],
  );
  const sttTarget = useMemo(
    () => resolveVoiceTarget(draft, config.providers, "stt", config.activeProviderId),
    [draft, config.providers, config.activeProviderId],
  );

  const ttsSelection = selectedVoiceOptionValue(
    draft,
    config.providers,
    "tts",
    config.activeProviderId,
  );
  const sttSelection = selectedVoiceOptionValue(
    draft,
    config.providers,
    "stt",
    config.activeProviderId,
  );

  const ttsOverridesVisible =
    ttsTarget.adapter !== "browser" &&
    (!ttsTarget.linkedProvider ||
      showTtsOverrides ||
      Boolean(draft.ttsBaseUrl.trim() || draft.ttsApiKey.trim()));

  const sttOverridesVisible =
    sttTarget.adapter !== "browser" &&
    (!sttTarget.linkedProvider ||
      showSttOverrides ||
      Boolean(draft.sttBaseUrl.trim() || draft.sttApiKey.trim()));

  const loadTtsModels = async () => {
    const live = flushDraft();
    const target = resolveVoiceTarget(live, config.providers, "tts", config.activeProviderId);
    if (target.adapter === "browser" || !target.supportsModelDiscovery) return;
    setLoadingTts(true);
    setVoiceError("");
    try {
      const found = await discoverVoiceModels({
        provider: target.providerKind === "google" ? "google" : target.providerKind === "openai" ? "openai" : "openai-compatible",
        mode: "tts",
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
      });
      setTtsModels(found);
      if (!live.ttsModel.trim() && found[0]) {
        updateVoice({ ttsModel: found[0] }, true);
      }
      toast({ type: "success", title: `Loaded ${found.length} TTS model(s)` });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      setVoiceError(msg);
      toast({ type: "error", title: "Could not load TTS models", description: msg });
    } finally {
      setLoadingTts(false);
    }
  };

  const loadSttModels = async () => {
    const live = flushDraft();
    const target = resolveVoiceTarget(live, config.providers, "stt", config.activeProviderId);
    if (target.adapter === "browser" || !target.supportsModelDiscovery) return;
    setLoadingStt(true);
    setVoiceError("");
    try {
      const found = await discoverVoiceModels({
        provider: target.providerKind === "google" ? "google" : target.providerKind === "openai" ? "openai" : "openai-compatible",
        mode: "stt",
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
      });
      setSttModels(found);
      if (!live.sttModel.trim() && found[0]) {
        updateVoice({ sttModel: found[0] }, true);
      }
      toast({ type: "success", title: `Loaded ${found.length} STT model(s)` });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      setVoiceError(msg);
      toast({ type: "error", title: "Could not load STT models", description: msg });
    } finally {
      setLoadingStt(false);
    }
  };

  const browserVoiceOptions = useMemo(
    () => [
      { value: "", label: "System default" },
      ...voices.map((v) => ({ value: v.name, label: `${v.name} (${v.lang})` })),
    ],
    [voices],
  );

  const presetVoiceOptions =
    ttsTarget.adapter === "browser"
      ? browserVoiceOptions
      : ttsTarget.adapter === "google"
        ? GEMINI_VOICES.map((v) => ({ value: v, label: v }))
        : ttsTarget.adapter === "xai"
          ? XAI_VOICES.map((v) => ({ value: v, label: v }))
          : ttsTarget.providerKind === "openai" && !draft.ttsBaseUrl.trim()
            ? OPENAI_VOICES.map((v) => ({ value: v, label: v }))
            : null;

  const testVoice = () => {
    if (testing) {
      speakRef.current?.stop();
      speakRef.current = null;
      setTesting(false);
      return;
    }
    const live = flushDraft();
    setVoiceError("");
    setTesting(true);
    speakRef.current = speakText(
      "This is how your AI Coach will sound when it reads replies aloud.",
      live,
      config.providers,
      {
        onEnd: () => {
          speakRef.current = null;
          setTesting(false);
        },
        onError: (message) => {
          speakRef.current = null;
          setTesting(false);
          setVoiceError(message);
          toast({ type: "error", title: "Voice test failed", description: message });
        },
      },
    );
  };

  const testMic = async () => {
    if (testingMic) {
      setTestingMic(false);
      setTranscribingMic(true);
      try {
        const text = await listenRef.current?.stop();
        listenRef.current = null;
        setTranscribingMic(false);
        if (text?.trim()) {
          setMicResult(text.trim());
          toast({ type: "success", title: "STT test succeeded", description: text.trim().slice(0, 120) });
        } else {
          setMicResult("(No speech detected)");
        }
      } catch (err) {
        listenRef.current = null;
        setTranscribingMic(false);
        const msg = String((err as Error)?.message ?? err);
        setVoiceError(msg);
        toast({ type: "error", title: "STT test failed", description: msg });
      }
      return;
    }
    const live = flushDraft();
    setVoiceError("");
    setMicResult("");
    listenRef.current = startListening(live, config.providers, {
      onStart: () => setTestingMic(true),
      onInterim: (text) => setMicResult(text),
      onAutoEnd: (text) => {
        listenRef.current = null;
        setTestingMic(false);
        if (text.trim()) setMicResult(text.trim());
      },
      onError: (message) => {
        listenRef.current = null;
        setTestingMic(false);
        setTranscribingMic(false);
        setVoiceError(message);
        toast({ type: "error", title: "STT test failed", description: message });
      },
    });
  };

  return (
    <>
      <div className="card-head plain">
        <Icon name="volume" size={18} className="icon-muted" />
        <span className="card-title">Voice</span>
        <span className="spacer" />
        <Button
          size="sm"
          variant={testingMic ? "primary" : "secondary"}
          disabled={transcribingMic}
          onClick={() => void testMic()}
        >
          <Icon name={testingMic ? "square" : "mic"} size={13} />{" "}
          {transcribingMic ? "Transcribing…" : testingMic ? "Stop mic" : "Test mic"}
        </Button>
        <Button size="sm" variant={testing ? "primary" : "secondary"} onClick={testVoice}>
          <Icon name={testing ? "square" : "volume"} size={13} />{" "}
          {testing ? "Stop test" : "Test voice"}
        </Button>
      </div>
      <div className="card-body pad">
        <div className="voice-section-head">
          <span className="field-label">Text to speech</span>
          {ttsTarget.supportsModelDiscovery && (
            <Button size="sm" variant="ghost" disabled={loadingTts} onClick={() => void loadTtsModels()}>
              <Icon name="refresh" size={13} /> {loadingTts ? "Loading…" : "Load models"}
            </Button>
          )}
        </div>

        {ttsTarget.linkedProvider && (
          <div className="voice-inherited-bar">
            <ProviderLogo
              catalogId={ttsTarget.linkedProvider.catalogId}
              kind={ttsTarget.linkedProvider.kind}
              size={14}
              framed={false}
            />
            <span className="voice-inherited-copy">
              Inheriting {ttsTarget.inheritedKey ? "API key & " : ""}endpoint from{" "}
              <strong>{ttsTarget.linkedProvider.name}</strong>
              {ttsTarget.baseUrl ? ` · ${ttsTarget.baseUrl}` : ""} (
              {adapterEndpointHint(ttsTarget.adapter, "tts")})
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowTtsOverrides((v) => !v)}
            >
              {ttsOverridesVisible ? "Hide overrides" : "Override key / URL"}
            </Button>
          </div>
        )}

        <div className="voice-grid">
          <Field label="TTS provider">
            <SelectField
              value={ttsSelection}
              onChange={(selection) => {
                setTtsModels([]);
                setShowTtsOverrides(false);
                updateVoice(voicePatchForSelection(selection, config.providers, "tts"), true);
              }}
              ariaLabel="TTS provider"
              options={providerOptions}
            />
          </Field>

          {ttsTarget.adapter !== "browser" && (
            <Field
              label={ttsTarget.requiresModel ? "TTS model ID" : "TTS model ID (optional)"}
              hint={
                ttsTarget.adapter === "xai"
                  ? "Optional — xAI /v1/tts works with just a voice ID"
                  : ttsTarget.adapter === "minimax"
                    ? "Enter model ID directly (not exposed on /models)"
                    : "Type any model ID directly — discovery is optional"
              }
            >
              <Input
                value={draft.ttsModel}
                placeholder={
                  ttsTarget.adapter === "xai"
                    ? "Optional"
                    : "Enter model ID directly"
                }
                aria-label="TTS model ID"
                onChange={(e) => updateVoice({ ttsModel: e.target.value })}
                onBlur={() => flushDraft()}
              />
            </Field>
          )}

          {ttsModels.length > 0 && ttsTarget.adapter !== "browser" && (
            <Field label={`Discovered models (${ttsModels.length})`}>
              <ComboboxField
                value={ttsModels.includes(draft.ttsModel) ? draft.ttsModel : ""}
                onChange={(ttsModel) => updateVoice({ ttsModel }, true)}
                options={ttsModels.map((m) => ({ value: m, label: m }))}
                placeholder="Quick-pick a discovered model…"
                ariaLabel="Discovered TTS models"
              />
            </Field>
          )}

          <Field label={ttsTarget.adapter === "elevenlabs" ? "Voice ID" : "Voice"}>
            {presetVoiceOptions ? (
              <SelectField
                value={draft.ttsVoice}
                onChange={(ttsVoice) => updateVoice({ ttsVoice }, true)}
                ariaLabel="TTS voice"
                options={presetVoiceOptions}
              />
            ) : (
              <Input
                value={draft.ttsVoice}
                placeholder={
                  ttsTarget.adapter === "minimax"
                    ? "e.g. English_Graceful_Lady"
                    : ttsTarget.adapter === "elevenlabs"
                      ? "ElevenLabs voice ID"
                      : "e.g. alloy"
                }
                aria-label="TTS voice"
                onChange={(e) => updateVoice({ ttsVoice: e.target.value })}
                onBlur={() => flushDraft()}
              />
            )}
          </Field>

          <Field label={`Speech speed · ${draft.ttsRate.toFixed(1)}×`}>
            <Input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={draft.ttsRate}
              aria-label="Speech speed"
              onChange={(e) => updateVoice({ ttsRate: Number(e.target.value) })}
              onMouseUp={() => flushDraft()}
              onTouchEnd={() => flushDraft()}
            />
          </Field>

          {ttsOverridesVisible && (
            <>
              <Field
                label={ttsTarget.linkedProvider ? "Override base URL" : "Base URL"}
                hint={
                  ttsTarget.linkedProvider
                    ? `Leave blank to inherit ${ttsTarget.linkedProvider.name}`
                    : "Provider base URL (e.g. https://api.openai.com/v1)"
                }
              >
                <Input
                  value={draft.ttsBaseUrl}
                  placeholder={ttsTarget.baseUrl || "https://…/v1"}
                  onChange={(e) => updateVoice({ ttsBaseUrl: e.target.value })}
                  onBlur={() => flushDraft()}
                />
              </Field>
              <Field
                label={ttsTarget.linkedProvider ? "Override API key" : "API key"}
                hint={
                  ttsTarget.linkedProvider
                    ? `Leave blank to inherit ${ttsTarget.linkedProvider.name}`
                    : "Encrypted locally outside SQLite backups"
                }
              >
                <Input
                  type="password"
                  value={draft.ttsApiKey}
                  placeholder={ttsTarget.inheritedKey ? "Inherited from provider" : "Paste API key"}
                  onChange={(e) => updateVoice({ ttsApiKey: e.target.value })}
                  onBlur={() => flushDraft()}
                />
              </Field>
            </>
          )}
        </div>

        <div className="voice-section-head" style={{ marginTop: 10 }}>
          <span className="field-label">Speech to text</span>
          {sttTarget.supportsModelDiscovery && (
            <Button size="sm" variant="ghost" disabled={loadingStt} onClick={() => void loadSttModels()}>
              <Icon name="refresh" size={13} /> {loadingStt ? "Loading…" : "Load models"}
            </Button>
          )}
        </div>

        {sttTarget.linkedProvider && (
          <div className="voice-inherited-bar">
            <ProviderLogo
              catalogId={sttTarget.linkedProvider.catalogId}
              kind={sttTarget.linkedProvider.kind}
              size={14}
              framed={false}
            />
            <span className="voice-inherited-copy">
              Inheriting {sttTarget.inheritedKey ? "API key & " : ""}endpoint from{" "}
              <strong>{sttTarget.linkedProvider.name}</strong>
              {sttTarget.baseUrl ? ` · ${sttTarget.baseUrl}` : ""} (
              {adapterEndpointHint(sttTarget.adapter, "stt")})
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSttOverrides((v) => !v)}
            >
              {sttOverridesVisible ? "Hide overrides" : "Override key / URL"}
            </Button>
          </div>
        )}

        <div className="voice-grid">
          <Field label="STT provider">
            <SelectField
              value={sttSelection}
              onChange={(selection) => {
                setSttModels([]);
                setShowSttOverrides(false);
                updateVoice(voicePatchForSelection(selection, config.providers, "stt"), true);
              }}
              ariaLabel="STT provider"
              options={providerOptions}
            />
          </Field>

          {sttTarget.adapter !== "browser" && (
            <Field
              label="STT model ID"
              hint={
                sttTarget.adapter === "minimax"
                  ? "Enter MiniMax ASR model ID directly (uses /v1/speech_to_text)"
                  : "Type any transcription model ID directly — discovery is optional"
              }
            >
              <Input
                value={draft.sttModel}
                placeholder="Enter transcription model ID"
                aria-label="STT model ID"
                onChange={(e) => updateVoice({ sttModel: e.target.value })}
                onBlur={() => flushDraft()}
              />
            </Field>
          )}

          {sttModels.length > 0 && sttTarget.adapter !== "browser" && (
            <Field label={`Discovered models (${sttModels.length})`}>
              <ComboboxField
                value={sttModels.includes(draft.sttModel) ? draft.sttModel : ""}
                onChange={(sttModel) => updateVoice({ sttModel }, true)}
                options={sttModels.map((m) => ({ value: m, label: m }))}
                placeholder="Quick-pick a discovered model…"
                ariaLabel="Discovered STT models"
              />
            </Field>
          )}

          {sttOverridesVisible && (
            <>
              <Field
                label={sttTarget.linkedProvider ? "Override base URL" : "Base URL"}
                hint={
                  sttTarget.linkedProvider
                    ? `Leave blank to inherit ${sttTarget.linkedProvider.name}`
                    : "Provider base URL (e.g. https://api.groq.com/openai/v1)"
                }
              >
                <Input
                  value={draft.sttBaseUrl}
                  placeholder={sttTarget.baseUrl || "https://…/v1"}
                  onChange={(e) => updateVoice({ sttBaseUrl: e.target.value })}
                  onBlur={() => flushDraft()}
                />
              </Field>
              <Field
                label={sttTarget.linkedProvider ? "Override API key" : "API key"}
                hint={
                  sttTarget.linkedProvider
                    ? `Leave blank to inherit ${sttTarget.linkedProvider.name}`
                    : "Encrypted locally outside SQLite backups"
                }
              >
                <Input
                  type="password"
                  value={draft.sttApiKey}
                  placeholder={sttTarget.inheritedKey ? "Inherited from provider" : "Paste API key"}
                  onChange={(e) => updateVoice({ sttApiKey: e.target.value })}
                  onBlur={() => flushDraft()}
                />
              </Field>
            </>
          )}
        </div>

        {micResult && (
          <div className="voice-inherited-bar">
            <Icon name="mic" size={13} />
            <span className="voice-inherited-copy">
              <strong>Transcript:</strong> {micResult}
            </span>
          </div>
        )}
        {voiceError && <div className="field-error">{voiceError}</div>}

        <div className="voice-toggles">
          <div className="setting-row">
            <div className="setting-copy">
              <strong>Auto-speak AI replies</strong>
              <span>Read every finished reply aloud with the chosen voice.</span>
            </div>
            <Switch
              checked={draft.autoSpeakReplies}
              onChange={(autoSpeakReplies) => updateVoice({ autoSpeakReplies }, true)}
              label="Auto-speak AI replies"
            />
          </div>
          <div className="setting-row">
            <div className="setting-copy">
              <strong>Auto-send after voice input</strong>
              <span>Send the transcript as soon as you stop recording.</span>
            </div>
            <Switch
              checked={draft.autoSendVoice}
              onChange={(autoSendVoice) => updateVoice({ autoSendVoice }, true)}
              label="Auto-send after voice input"
            />
          </div>
        </div>
      </div>
    </>
  );
}

export function VoiceSettingsCard() {
  const { data: config } = useAiConfig();
  if (!config) return null;
  return (
    <Card id="section-ai-voice" className="ai-voice-card">
      <VoiceSettingsCardInner config={config} />
    </Card>
  );
}
