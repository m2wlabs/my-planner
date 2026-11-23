import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Drawer, Popover, useToast } from "@halo-ds/react";
import * as api from "../lib/api";
import type { AiProviderConfig, AiSuggestedAction, AiVoiceConfig } from "../lib/api";
import { parseStructuredOutput } from "../lib/aiParser";
import { isProviderReady, streamPlannerChat } from "../lib/aiEngine";
import {
  listBrowserVoices,
  onBrowserVoicesChanged,
  speakText,
  startListening,
  type ListenHandle,
  type SpeakHandle,
} from "../lib/voiceEngine";
import {
  useAiConfig,
  useAiDrawer,
  useAiMessages,
  useAiUsage,
  useApplyAiAction,
  useGoals,
  useSaveAiConfig,
  useTasks,
} from "../lib/hooks";
import { AddProviderModal, defaultVoiceForProvider, fmtLatency, fmtTokens } from "../components/AiWidgets";
import { ProviderLogo } from "../components/ProviderLogo";
import ScrollArea from "../components/ScrollArea";
import { Alert, Button, ComboboxField, Icon, Input, SelectField, Switch } from "../components/ui";

const STARTERS = [
  {
    title: "Plan my day",
    subtitle: "Prioritize today's tasks and reschedule overdue work.",
    prompt:
      "Look at my overdue tasks, today's plan, and active goals. Recommend my top 3 priorities today and propose concrete task reschedules or additions.",
    icon: "calendar",
  },
  {
    title: "Audit this week",
    subtitle: "Review tracked hours, completion rate, and spending.",
    prompt:
      "Analyze my tasks, tracked time, and spending this month. What's working, what's drifting, and what 3 changes should I make this week?",
    icon: "chart",
  },
  {
    title: "Break down a goal",
    subtitle: "Turn active goals into scheduled tasks for the next 5 days.",
    prompt:
      "Review my active goals and suggest concrete, bite-sized tasks for the next 5 days to make steady progress on them.",
    icon: "target",
  },
  {
    title: "Check my non-negotiables",
    subtitle: "Audit daily routines and streak consistency.",
    prompt:
      "Review my daily non-negotiables and their recent check-ins. Which habits are slipping, and what is the smallest change that would protect my streak?",
    icon: "repeat",
  },
];

function greetingByTime() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function ActionBadge({ type }: { type: AiSuggestedAction["type"] }) {
  switch (type) {
    case "create_task":
      return (
        <span className="chip chip-blue">
          New task
        </span>
      );
    case "complete_task":
      return <span className="chip chip-success">Complete</span>;
    case "reschedule_task":
      return <span className="chip chip-warning">Reschedule</span>;
    case "create_goal":
      return <span className="chip chip-purple">New goal</span>;
    case "create_money_entry":
      return <span className="chip chip-success">Money</span>;
    case "create_theme":
      return <span className="chip chip-neutral">Theme</span>;
    case "create_routine":
      return <span className="chip chip-purple">Non-negotiable</span>;
    default:
      return <span className="chip chip-neutral">Action</span>;
  }
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="ai-code-block">
      <div className="ai-code-head">
        <span>{lang || "code"}</span>
        <button type="button" className="ai-code-copy" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={12} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Rich, safe Markdown renderer supporting headings, lists, code blocks, quotes and inline styling. */
function MarkdownRich({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let ulItems: string[] = [];
  let olItems: string[] = [];
  let quoteLines: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  const renderInline = (line: string): React.ReactNode[] => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
    return parts.map((p, idx) => {
      if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
        return <strong key={idx}>{p.slice(2, -2)}</strong>;
      }
      if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
        return (
          <code key={idx} className="ai-inline-code">
            {p.slice(1, -1)}
          </code>
        );
      }
      if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
        return <em key={idx}>{p.slice(1, -1)}</em>;
      }
      return p;
    });
  };

  const flushLists = (key: string) => {
    if (ulItems.length) {
      blocks.push(
        <ul key={`ul-${key}`} className="ai-list">
          {ulItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      ulItems = [];
    }
    if (olItems.length) {
      blocks.push(
        <ol key={`ol-${key}`} className="ai-list ai-list--ordered">
          {olItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      olItems = [];
    }
    if (quoteLines.length) {
      blocks.push(
        <blockquote key={`q-${key}`} className="ai-quote">
          {quoteLines.map((q, i) => (
            <p key={i}>{renderInline(q)}</p>
          ))}
        </blockquote>,
      );
      quoteLines = [];
    }
  };

  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();

    if (trimmed.startsWith("```")) {
      if (!inCode) {
        flushLists(`code-start-${idx}`);
        inCode = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
      } else {
        blocks.push(<CodeBlock key={`code-${idx}`} lang={codeLang} code={codeLines.join("\n")} />);
        inCode = false;
        codeLang = "";
        codeLines = [];
      }
      return;
    }

    if (inCode) {
      codeLines.push(raw);
      return;
    }

    if (!trimmed) {
      flushLists(`sp-${idx}`);
      return;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushLists(`hr-${idx}`);
      blocks.push(<hr key={`hr-${idx}`} className="ai-hr" />);
      return;
    }

    if (trimmed.startsWith("> ")) {
      if (ulItems.length || olItems.length) flushLists(`q-pre-${idx}`);
      quoteLines.push(trimmed.slice(2));
      return;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      if (olItems.length || quoteLines.length) flushLists(`ul-pre-${idx}`);
      ulItems.push(trimmed.replace(/^[-*•]\s+/, ""));
      return;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (ulItems.length || quoteLines.length) flushLists(`ol-pre-${idx}`);
      olItems.push(trimmed.replace(/^\d+\.\s+/, ""));
      return;
    }

    flushLists(`p-${idx}`);

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h4 key={idx} className="ai-h ai-h3">
          {renderInline(trimmed.slice(4))}
        </h4>,
      );
    } else if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
      blocks.push(
        <h3 key={idx} className="ai-h ai-h2">
          {renderInline(trimmed.replace(/^#+\s+/, ""))}
        </h3>,
      );
    } else {
      blocks.push(
        <p key={idx} className="ai-p">
          {renderInline(trimmed)}
        </p>,
      );
    }
  });

  if (inCode && codeLines.length) {
    blocks.push(<CodeBlock key="code-tail" lang={codeLang} code={codeLines.join("\n")} />);
  }
  flushLists("end");

  return <div className="ai-md">{blocks}</div>;
}

/* ------------------------------------------------------- voice quick switch */

function VoiceQuickSwitch({
  voice,
  providers,
  onSave,
}: {
  voice: AiVoiceConfig;
  providers: AiProviderConfig[];
  onSave: (patch: Partial<AiVoiceConfig>) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => listBrowserVoices());
  useEffect(() => {
    setVoices(listBrowserVoices());
    return onBrowserVoicesChanged(setVoices);
  }, []);

  const ttsVoiceOptions =
    voice.ttsProvider === "browser"
      ? [
          { value: "", label: "System default" },
          ...voices.map((v) => ({ value: v.name, label: v.name })),
        ]
      : voice.ttsProvider === "google"
        ? ["Kore", "Puck", "Charon", "Fenrir", "Aoede"].map((v) => ({ value: v, label: v }))
        : ["alloy", "ash", "coral", "echo", "nova", "onyx", "sage", "shimmer"].map((v) => ({
            value: v,
            label: v,
          }));

  return (
    <div className="voice-popover">
      <div className="voice-popover-grid">
        <label className="field">
          <span className="field-label">Speak with</span>
          <SelectField
            value={voice.ttsProvider}
            onChange={(nextProvider) => {
              const ttsProvider = nextProvider as AiVoiceConfig["ttsProvider"];
              onSave({ ttsProvider, ...defaultVoiceForProvider(ttsProvider) });
            }}
            ariaLabel="TTS provider"
            options={[
              { value: "browser", label: "Browser Native" },
              { value: "openai", label: "OpenAI" },
              { value: "google", label: "Google Gemini" },
              { value: "openai-compatible", label: "OpenAI-Compatible" },
            ]}
          />
        </label>
        <label className="field">
          <span className="field-label">Voice</span>
          {voice.ttsProvider === "openai-compatible" ? (
            <Input
              value={voice.ttsVoice}
              placeholder="alloy"
              onChange={(e) => onSave({ ttsVoice: e.target.value })}
            />
          ) : (
            <SelectField
              value={voice.ttsVoice}
              onChange={(ttsVoice) => onSave({ ttsVoice })}
              ariaLabel="TTS voice"
              options={ttsVoiceOptions}
            />
          )}
        </label>
        {voice.ttsProvider !== "browser" && (
          <label className="field">
            <span className="field-label">TTS model</span>
            <Input
              value={voice.ttsModel}
              placeholder="Load in Settings → Voice"
              onChange={(e) => onSave({ ttsModel: e.target.value })}
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">Listen with</span>
          <SelectField
            value={voice.sttProvider}
            onChange={(sttProvider) =>
              onSave({ sttProvider: sttProvider as AiVoiceConfig["sttProvider"] })
            }
            ariaLabel="STT provider"
            options={[
              { value: "browser", label: "Browser Native" },
              { value: "openai", label: "OpenAI" },
              { value: "openai-compatible", label: "OpenAI-Compatible" },
            ]}
          />
        </label>
        {voice.sttProvider !== "browser" && (
          <label className="field">
            <span className="field-label">STT model</span>
            <Input
              value={voice.sttModel}
              placeholder="Load in Settings → Voice"
              onChange={(e) => onSave({ sttModel: e.target.value })}
            />
          </label>
        )}
      </div>
      <div className="voice-popover-toggles">
        <span className="field-hint">Auto-speak replies</span>
        <Switch
          checked={voice.autoSpeakReplies}
          onChange={(autoSpeakReplies) => onSave({ autoSpeakReplies })}
          label="Auto-speak replies"
        />
        <span className="field-hint">Auto-send voice</span>
        <Switch
          checked={voice.autoSendVoice}
          onChange={(autoSendVoice) => onSave({ autoSendVoice })}
          label="Auto-send after voice input"
        />
      </div>
      <div className="field-hint">
        {providers.length} provider{providers.length === 1 ? "" : "s"} configured · full controls in
        Settings → AI &amp; Voice
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- workspace */

export function AiWorkspace({
  compact = false,
  initialPrompt,
  extraContext,
  autoSend,
  onConsumeRequest,
}: {
  compact?: boolean;
  initialPrompt?: string;
  extraContext?: string;
  autoSend?: boolean;
  onConsumeRequest?: () => void;
}) {
  const { data: config } = useAiConfig();
  const saveConfig = useSaveAiConfig();
  const { data: messages = [] } = useAiMessages();
  const { data: usage } = useAiUsage();
  const { data: tasks = [] } = useTasks();
  const { data: goals = [] } = useGoals();
  const applyAction = useApplyAiAction();
  const qc = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingUserPrompt, setPendingUserPrompt] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [streamThought, setStreamThought] = useState("");
  const [error, setError] = useState("");
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [appliedKeys, setAppliedKeys] = useState<Record<string, boolean>>({});
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem("my-planner-voice-mode") === "1");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "listening" | "thinking" | "speaking">(
    "idle",
  );

  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listenRef = useRef<ListenHandle | null>(null);
  const speakRef = useRef<SpeakHandle | null>(null);
  const consumedRef = useRef<string>("");

  const providers = config?.providers ?? [];
  const enabledProviders = providers.filter((p) => isProviderReady(p));
  const activeProvider =
    enabledProviders.find((p) => p.id === config?.activeProviderId) ?? enabledProviders[0];
  const connected = Boolean(activeProvider);
  const voice = config?.voice;

  useEffect(() => {
    localStorage.setItem("my-planner-voice-mode", voiceMode ? "1" : "0");
  }, [voiceMode]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(180, Math.max(24, ta.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      listenRef.current?.cancel();
      speakRef.current?.stop();
      abortRef.current?.abort();
    };
  }, []);

  const sessionMsgs = useMemo(
    () => messages.filter((m) => String(m.session_id || "default") === "default"),
    [messages],
  );

  const workspacePulse = useMemo(() => {
    const today = api.todayLocal();
    const overdue = tasks.filter((t) => t.status !== "done" && String(t.planned_date) < today).length;
    const todayOpen = tasks.filter((t) => t.status !== "done" && String(t.planned_date) === today).length;
    const activeGoals = goals.filter((g) => g.status !== "done").length;
    return { overdue, todayOpen, activeGoals };
  }, [tasks, goals]);

  const scrollBottom = () => {
    const el = scrollRegionRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    if (sessionMsgs.length > 0 || sending || pendingUserPrompt) scrollBottom();
  }, [sessionMsgs.length, sending, pendingUserPrompt, streamText, streamThought]);

  const stopSpeaking = () => {
    speakRef.current?.stop();
    speakRef.current = null;
    setSpeakingKey(null);
    setVoiceStatus((s) => (s === "speaking" ? "idle" : s));
  };

  const speak = (key: string, text: string) => {
    if (!voice) return;
    if (speakingKey === key) {
      stopSpeaking();
      return;
    }
    speakRef.current?.stop();
    setSpeakingKey(key);
    setVoiceStatus("speaking");
    speakRef.current = speakText(text, voice, providers, {
      onEnd: () => {
        setSpeakingKey((cur) => (cur === key ? null : cur));
        setVoiceStatus((s) => (s === "speaking" ? "idle" : s));
      },
      onError: (message) => {
        setSpeakingKey(null);
        setVoiceStatus("idle");
        toast({ type: "error", title: "Could not speak reply", description: message });
      },
    });
  };

  const sendMessage = async (textOverride?: string, ctxOverride?: string) => {
    const promptText = (textOverride ?? input).trim();
    if (!promptText || sending) return;
    if (!activeProvider) {
      setSetupOpen(true);
      return;
    }
    stopSpeaking();
    setSending(true);
    setError("");
    setLastFailedPrompt(null);
    setPendingUserPrompt(promptText);
    setStreamText("");
    setStreamThought("");
    setInterim("");
    if (!textOverride) setInput("");
    if (voiceMode) setVoiceStatus("thinking");

    const controller = new AbortController();
    abortRef.current = controller;
    const history = sessionMsgs
      .slice(-12)
      .map((m) => ({
        role: String(m.role) === "user" ? ("user" as const) : ("assistant" as const),
        content: String(m.content ?? ""),
      }));

    try {
      const result = await streamPlannerChat({
        prompt: promptText,
        sessionId: "default",
        provider: activeProvider,
        history,
        extraContext: ctxOverride,
        signal: controller.signal,
        onDelta: (text) => setStreamText((prev) => prev + text),
        onReasoning: (text) => setStreamThought((prev) => prev + text),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ai_messages"] }),
        qc.invalidateQueries({ queryKey: ["ai_usage"] }),
      ]);
      if (voice && (voice.autoSpeakReplies || voiceMode)) {
        speak(`live-${Date.now()}`, result.reply);
      } else if (voiceMode) {
        setVoiceStatus("idle");
      }
    } catch (e) {
      await qc.invalidateQueries({ queryKey: ["ai_usage"] });
      const msg = String(e).replace(/^Error:\s*/, "");
      if (msg !== "Generation stopped.") {
        setError(msg);
        setLastFailedPrompt(promptText);
      }
      setVoiceStatus("idle");
    } finally {
      abortRef.current = null;
      setSending(false);
      setPendingUserPrompt(null);
      setStreamText("");
      setStreamThought("");
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  useEffect(() => {
    if (!initialPrompt) return;
    const key = `${initialPrompt}::${extraContext ?? ""}::${Boolean(autoSend)}`;
    if (consumedRef.current === key) return;
    consumedRef.current = key;
    if (autoSend && connected) {
      void sendMessage(initialPrompt, extraContext);
    } else {
      setInput(initialPrompt);
    }
    onConsumeRequest?.();
  }, [initialPrompt, extraContext, autoSend, connected]);

  const updateConfig = (next: typeof config) => {
    if (next) saveConfig.mutate(next);
  };

  const setProvider = (id: string) => {
    if (!config) return;
    updateConfig({ ...config, activeProviderId: id });
  };

  const setModel = (model: string) => {
    if (!config || !activeProvider) return;
    updateConfig({
      ...config,
      providers: config.providers.map((p) => (p.id === activeProvider.id ? { ...p, model } : p)),
    });
  };

  const patchVoice = (patch: Partial<AiVoiceConfig>) => {
    if (!config) return;
    updateConfig({ ...config, voice: { ...config.voice, ...patch } });
  };

  const startVoiceInput = async () => {
    if (!voice) return;
    if (listening) {
      setListening(false);
      setTranscribing(true);
      try {
        const text = await listenRef.current?.stop();
        listenRef.current = null;
        setTranscribing(false);
        setVoiceStatus("idle");
        if (text?.trim()) {
          setInput(text.trim());
          if (voice.autoSendVoice) void sendMessage(text.trim());
        }
      } catch (e) {
        setTranscribing(false);
        setVoiceStatus("idle");
        setError(String((e as Error)?.message ?? e));
      }
      return;
    }
    stopSpeaking();
    setInterim("");
    listenRef.current = startListening(voice, providers, {
      onStart: () => {
        setListening(true);
        setVoiceStatus("listening");
      },
      onInterim: setInterim,
      onAutoEnd: (text) => {
        listenRef.current = null;
        setListening(false);
        setInterim("");
        setVoiceStatus("idle");
        if (text.trim()) {
          setInput(text.trim());
          if (voice.autoSendVoice) void sendMessage(text.trim());
        }
      },
      onError: (message) => {
        listenRef.current = null;
        setListening(false);
        setInterim("");
        setVoiceStatus("idle");
        setError(message);
      },
    });
  };

  const clearHistory = async () => {
    if (sending) stopGeneration();
    stopSpeaking();
    await api.clearAiMessages("default");
    await qc.invalidateQueries({ queryKey: ["ai_messages"] });
    setAppliedKeys({});
    setError("");
    setLastFailedPrompt(null);
    toast({ type: "success", title: "Started a new conversation" });
  };

  const copyReply = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(key);
      setTimeout(() => setCopiedMsgId((cur) => (cur === key ? null : cur)), 1600);
    } catch {
      /* ignore */
    }
  };

  const runAction = async (msgId: number | string, idx: number, action: AiSuggestedAction) => {
    const key = `${msgId}-${idx}`;
    if (appliedKeys[key]) return;
    await applyAction.mutateAsync(action);
    setAppliedKeys((prev) => ({ ...prev, [key]: true }));
  };

  const runAllActions = async (msgId: number | string, actions: AiSuggestedAction[]) => {
    for (let i = 0; i < actions.length; i++) {
      const key = `${msgId}-${i}`;
      if (!appliedKeys[key]) {
        await applyAction.mutateAsync(actions[i]);
        setAppliedKeys((prev) => ({ ...prev, [key]: true }));
      }
    }
  };

  const visibleStreamText = useMemo(() => {
    if (!streamText) return "";
    const fenceIdx = streamText.indexOf("```planner-actions");
    const rawVisible = fenceIdx !== -1 ? streamText.slice(0, fenceIdx) : streamText;
    return parseStructuredOutput(rawVisible).reply;
  }, [streamText]);

  const streamingHasActionsFence = streamText.includes("```planner-actions");
  const activeModel = activeProvider?.model ?? "no model";
  const activeName = activeProvider ? activeProvider.name : "No provider";

  const voiceBanner =
    voiceStatus === "listening"
      ? "Listening…"
      : voiceStatus === "thinking"
        ? "Thinking…"
        : voiceStatus === "speaking"
          ? "Speaking…"
          : "";

  return (
    <div className={`ai-workspace${compact ? " ai-workspace--compact" : ""}`}>
      <header className="ai-header">
        <div className="ai-header-left">
          {!compact && (
            <div className="ai-brand-lockup">
              <div className="ai-brand-dot">
                <Icon name="sparkles" size={14} />
              </div>
              <span className="ai-brand-title">AI Coach</span>
            </div>
          )}
          {connected && activeProvider ? (
            <div className="ai-account-chip">
              <ProviderLogo catalogId={activeProvider.catalogId} kind={activeProvider.kind} size={14} framed={false} />
              <span>
                {activeName} · {activeModel}
              </span>
            </div>
          ) : (
            <button type="button" className="ai-connect-chip" onClick={() => setSetupOpen(true)}>
              <span className="ai-status-dot is-off" />
              <span>Add AI provider</span>
            </button>
          )}
        </div>

        <div className="ai-header-right">
          <Popover
            side="bottom"
            align="end"
            showClose
            title="Voice model"
            description="Switch speech in and out without leaving AI Coach"
            trigger={
              <button type="button" className="ai-usage-pill" title="Voice model settings">
                <Icon name="volume" size={13} />
                <span>Voice</span>
              </button>
            }
          >
            {voice && (
              <VoiceQuickSwitch voice={voice} providers={providers} onSave={patchVoice} />
            )}
          </Popover>

          <button
            type="button"
            className={`ai-usage-pill${showUsage ? " is-active" : ""}`}
            onClick={() => setShowUsage((v) => !v)}
            title="Token usage and budget"
          >
            <Icon name="chart" size={13} />
            <span>
              {usage && usage.today.total_tokens > 0
                ? `${fmtTokens(usage.today.total_tokens)} today`
                : "Usage"}
            </span>
          </button>

          <button
            type="button"
            className={`ai-voice-toggle${voiceMode ? " is-active" : ""}`}
            onClick={() => {
              const next = !voiceMode;
              setVoiceMode(next);
              if (!next) {
                stopSpeaking();
                if (listening) {
                  listenRef.current?.cancel();
                  listenRef.current = null;
                  setListening(false);
                  setInterim("");
                }
                setVoiceStatus("idle");
              }
            }}
            title="Voice mode"
          >
            <Icon name={voiceMode ? "volume" : "volumeOff"} size={14} />
            <span>{voiceMode ? "Voice on" : "Voice mode"}</span>
          </button>

          {sessionMsgs.length > 0 && (
            <Button size="sm" variant="ghost" onClick={clearHistory} title="Start a new chat">
              <Icon name="plus" size={14} /> New chat
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="icon-btn"
            onClick={() => navigate({ to: "/settings", search: { section: "ai-providers" } })}
            title="AI & Voice settings"
            aria-label="AI & Voice settings"
          >
            <Icon name="settings" size={15} />
          </Button>
        </div>
      </header>

      {showUsage && (
        <ScrollArea className="ai-usage-drawer-panel">
          <div className="ai-usage-drawer-inner ai-centered-col">
            <AiUsageInline />
          </div>
        </ScrollArea>
      )}

      {voiceMode && voiceBanner && (
        <div className="voice-banner" role="status" aria-live="polite">
          <span className="voice-banner-dot" />
          <span>{voiceBanner}</span>
          {voiceStatus === "speaking" && (
            <Button size="sm" variant="secondary" onClick={stopSpeaking}>
              <Icon name="square" size={12} /> Stop speaking
            </Button>
          )}
        </div>
      )}

      <ScrollArea className="ai-thread-scroll" regionRef={scrollRegionRef}>
        <div className="ai-thread ai-centered-col">
          {!connected && (
            <div className="ai-connect-banner">
              <div className="ai-connect-banner-top">
                <div className="ai-connect-icon">
                  <Icon name="sparkles" size={18} />
                </div>
                <div className="ai-connect-copy">
                  <strong>Connect your AI provider to start chatting</strong>
                  <span>
                    Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint. Keys stay
                    encrypted on this device.
                  </span>
                </div>
                <Button variant="primary" size="sm" onClick={() => setSetupOpen(true)}>
                  <Icon name="key" size={14} /> Connect provider
                </Button>
              </div>
            </div>
          )}

          {sessionMsgs.length === 0 && !pendingUserPrompt ? (
            <div className="ai-empty-hero">
              <div className="ai-hero-icon">
                <Icon name="sparkles" size={22} />
              </div>
              <h2>{greetingByTime()}. What should we focus on?</h2>
              <p>
                Ask {connected ? activeName : "your AI coach"} about your schedule, goals, tracked
                time, spending, or daily non-negotiables. Changes are always proposed as one-click
                cards — nothing edits without your approval.
              </p>

              <div className="ai-pulse-strip">
                {workspacePulse.overdue > 0 && (
                  <button
                    type="button"
                    className="ai-pulse-chip is-warn"
                    onClick={() =>
                      connected
                        ? void sendMessage("Help me triage and reschedule my overdue tasks.")
                        : setInput("Help me triage and reschedule my overdue tasks.")
                    }
                  >
                    <span className="ai-pulse-dot" />
                    {workspacePulse.overdue} overdue {workspacePulse.overdue === 1 ? "task" : "tasks"}
                  </button>
                )}
                <button
                  type="button"
                  className="ai-pulse-chip is-indigo"
                  onClick={() =>
                    connected
                      ? void sendMessage("Walk me through what I have planned for today.")
                      : setInput("Walk me through what I have planned for today.")
                  }
                >
                  <span className="ai-pulse-dot" />
                  {workspacePulse.todayOpen} planned today
                </button>
                <button
                  type="button"
                  className="ai-pulse-chip is-green"
                  onClick={() =>
                    connected
                      ? void sendMessage("Check my active goals and suggest the highest-leverage next step.")
                      : setInput("Check my active goals and suggest the highest-leverage next step.")
                  }
                >
                  <span className="ai-pulse-dot" />
                  {workspacePulse.activeGoals} active {workspacePulse.activeGoals === 1 ? "goal" : "goals"}
                </button>
              </div>

              <div className="ai-starter-grid">
                {STARTERS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    className="ai-starter-card"
                    disabled={sending}
                    onClick={() => (connected ? void sendMessage(s.prompt) : setInput(s.prompt))}
                  >
                    <div className="ai-starter-head">
                      <span className="ai-starter-ic">
                        <Icon name={s.icon} size={15} />
                      </span>
                      <strong>{s.title}</strong>
                    </div>
                    <span>{s.subtitle}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ai-messages-list">
              {sessionMsgs.map((m, idx) => {
                const isUser = m.role === "user";
                const rawContent = String(m.content ?? "");
                const cleaned = isUser
                  ? { reply: rawContent, actions: [] as AiSuggestedAction[] }
                  : parseStructuredOutput(rawContent);
                let actions: AiSuggestedAction[] = cleaned.actions;
                if (!isUser && m.actions_json) {
                  try {
                    const parsed = JSON.parse(String(m.actions_json));
                    if (Array.isArray(parsed) && parsed.length > 0) actions = parsed;
                  } catch {
                    /* ignore */
                  }
                }
                const remainingCount = actions.filter(
                  (_, aIdx) => !appliedKeys[`${m.id}-${aIdx}`],
                ).length;

                const isLastAssistant = !isUser && idx === sessionMsgs.length - 1 && !sending;
                const prevUserText =
                  isLastAssistant && idx > 0 && sessionMsgs[idx - 1]?.role === "user"
                    ? String(sessionMsgs[idx - 1].content ?? "")
                    : null;

                let usageLabel = "";
                if (!isUser && m.usage_json) {
                  try {
                    const u = JSON.parse(String(m.usage_json)) as {
                      total_tokens?: number;
                      latency_ms?: number;
                    };
                    const parts: string[] = [];
                    if (u.total_tokens && u.total_tokens > 0) parts.push(`${fmtTokens(u.total_tokens)} tok`);
                    if (u.latency_ms && u.latency_ms > 0) parts.push(fmtLatency(u.latency_ms));
                    usageLabel = parts.join(" · ");
                  } catch {
                    /* ignore */
                  }
                }

                if (isUser) {
                  return (
                    <div key={m.id} className="ai-turn ai-turn--user">
                      <div className="ai-user-bubble">{rawContent}</div>
                    </div>
                  );
                }

                return (
                  <div key={m.id} className="ai-turn ai-turn--assistant">
                    <div className="ai-assistant-avatar" aria-hidden="true">
                      <Icon name="sparkles" size={14} />
                    </div>
                    <div className="ai-assistant-body">
                      <MarkdownRich text={cleaned.reply} />

                      {actions.length > 0 && (
                        <div className="ai-actions-box">
                          <div className="ai-actions-head">
                            <span className="ai-actions-title">
                              <Icon name="zap" size={13} />
                              Proposed planner updates ({actions.length})
                            </span>
                            {remainingCount > 1 && (
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={applyAction.isPending}
                                onClick={() => void runAllActions(Number(m.id), actions)}
                              >
                                Apply all ({remainingCount})
                              </Button>
                            )}
                          </div>
                          <div className="ai-actions-list">
                            {actions.map((act, aIdx) => {
                              const done = Boolean(appliedKeys[`${m.id}-${aIdx}`]);
                              return (
                                <div className="ai-action-row" key={aIdx}>
                                  <div className="ai-action-meta">
                                    <ActionBadge type={act.type} />
                                    <div className="ai-action-copy">
                                      <strong>{act.label || act.title || act.category}</strong>
                                      <span>
                                        {[
                                          act.planned_date || act.date,
                                          act.time_of_day,
                                          act.estimate_mins ? `${act.estimate_mins}m` : null,
                                          act.amount_usd != null
                                            ? `$${Number(act.amount_usd).toFixed(2)} ${act.direction ?? "out"}`
                                            : null,
                                          act.theme_name,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </span>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={done ? "ghost" : "secondary"}
                                    disabled={done || applyAction.isPending}
                                    onClick={() => void runAction(Number(m.id), aIdx, act)}
                                  >
                                    {done ? (
                                      <>
                                        <Icon name="check" size={13} /> Applied
                                      </>
                                    ) : (
                                      "Apply"
                                    )}
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="ai-msg-meta-bar">
                        <div className="ai-msg-meta-info">
                          {m.model && <span className="ai-model-tag">{String(m.model)}</span>}
                          {usageLabel && <span className="ai-meta-sep">{usageLabel}</span>}
                        </div>
                        <div className="ai-msg-meta-actions">
                          <button
                            type="button"
                            className="ai-msg-action-btn"
                            onClick={() => speak(String(m.id), cleaned.reply)}
                            title={speakingKey === String(m.id) ? "Stop speaking" : "Listen to reply"}
                          >
                            <Icon
                              name={speakingKey === String(m.id) ? "volumeOff" : "volume"}
                              size={13}
                            />
                            <span>{speakingKey === String(m.id) ? "Stop" : "Listen"}</span>
                          </button>
                          <button
                            type="button"
                            className="ai-msg-action-btn"
                            onClick={() => void copyReply(String(m.id), cleaned.reply)}
                            title="Copy reply"
                          >
                            <Icon name={copiedMsgId === String(m.id) ? "check" : "copy"} size={13} />
                            <span>{copiedMsgId === String(m.id) ? "Copied" : "Copy"}</span>
                          </button>
                          {prevUserText && (
                            <button
                              type="button"
                              className="ai-msg-action-btn"
                              onClick={() => void sendMessage(prevUserText)}
                              title="Regenerate response"
                            >
                              <Icon name="refresh" size={13} />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {pendingUserPrompt && (
                <>
                  <div className="ai-turn ai-turn--user">
                    <div className="ai-user-bubble">{pendingUserPrompt}</div>
                  </div>
                  <div className="ai-turn ai-turn--assistant">
                    <div className="ai-assistant-avatar is-streaming" aria-hidden="true">
                      <Icon name="sparkles" size={14} />
                    </div>
                    <div className="ai-assistant-body">
                      {streamThought && (
                        <details className="ai-thought-pill" open={!visibleStreamText}>
                          <summary>
                            <span className="ai-pulse-dot" />
                            <span>Reasoning summary</span>
                          </summary>
                          <ScrollArea className="ai-thought-scroll">
                            <div className="ai-thought-text">{streamThought}</div>
                          </ScrollArea>
                        </details>
                      )}

                      {visibleStreamText ? (
                        <div className="ai-streaming-prose">
                          <MarkdownRich text={visibleStreamText} />
                          <span className="ai-caret" aria-hidden="true" />
                        </div>
                      ) : (
                        <div className="ai-thinking-inline">
                          <span className="ai-thinking-dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span>Thinking with {activeModel}…</span>
                        </div>
                      )}

                      {streamingHasActionsFence && (
                        <div className="ai-preparing-actions">
                          <Icon name="zap" size={13} />
                          <span>Preparing one-click planner actions…</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {error && (
            <Alert
              type="error"
              variant="soft"
              title="Could not get a reply"
              description={error}
              actions={
                lastFailedPrompt ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void sendMessage(lastFailedPrompt)}
                  >
                    <Icon name="refresh" size={13} /> Retry
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      </ScrollArea>

      <div className="ai-composer-dock">
        <form
          className="ai-composer-box ai-centered-col"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
        >
          {(listening || interim) && (
            <div className="ai-interim-preview">
              <span className="recording-dot" />
              <span>{interim || "Listening… click the mic again to stop"}</span>
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="ai-composer-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={
              connected
                ? `Ask ${activeName} to plan your day, break down a goal, or check your habits…`
                : "Connect an AI provider above to start coaching…"
            }
            disabled={sending}
          />

          <div className="ai-composer-bar">
            <div className="ai-composer-controls">
              <div className="ai-model-select-wrap">
                <SelectField
                  value={activeProvider?.id ?? ""}
                  onChange={setProvider}
                  ariaLabel="AI provider"
                  options={
                    enabledProviders.length
                      ? enabledProviders.map((p) => ({
                          value: p.id,
                          label: `${p.name}`,
                        }))
                      : [{ value: "", label: "No provider configured" }]
                  }
                />
              </div>
              {activeProvider && (
                <div className="ai-model-select-wrap">
                  <ComboboxField
                    value={activeProvider.model}
                    onChange={setModel}
                    ariaLabel="Model"
                    placeholder="Select model"
                    options={[
                      ...new Set([
                        ...(activeProvider.discoveredModels ?? []),
                        activeProvider.model,
                      ]),
                    ]
                      .filter(Boolean)
                      .map((m) => ({ value: m, label: m }))}
                  />
                </div>
              )}
            </div>

            <div className="ai-composer-actions">
              <button
                type="button"
                className={`ai-mic-btn${listening ? " is-listening" : ""}${transcribing ? " is-busy" : ""}`}
                onClick={() => void startVoiceInput()}
                aria-label={listening ? "Stop recording" : "Start voice input"}
                title={listening ? "Stop recording" : "Speak to your coach"}
                disabled={transcribing}
              >
                <Icon name={listening ? "micOff" : "mic"} size={15} />
              </button>

              {sending ? (
                <button
                  type="button"
                  className="ai-send-circle is-stop"
                  onClick={stopGeneration}
                  aria-label="Stop generating"
                  title="Stop generating"
                >
                  <Icon name="square" size={13} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="ai-send-circle"
                  disabled={!input.trim() || !connected}
                  aria-label="Send message"
                  title="Send (Enter)"
                >
                  <Icon name="arrowUp" size={16} />
                </button>
              )}
            </div>
          </div>
        </form>
        {!compact && (
          <div className="ai-composer-foot ai-centered-col">
            {transcribing
              ? "Transcribing voice input…"
              : "Synced with your local tasks, goals, time, money & routines · Shift+Enter for new line"}
          </div>
        )}
      </div>

      <AddProviderModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onConnected={() => void qc.invalidateQueries({ queryKey: ["ai_config"] })}
      />
    </div>
  );
}

function AiUsageInline() {
  const { data: usage } = useAiUsage();
  const maxDaily = Math.max(1, ...(usage?.daily_7d ?? []).map((d) => d.total_tokens));
  return (
    <div className="ai-usage-inline">
      <div className="ai-usage-stats">
        <div className="ai-usage-stat">
          <span className="stat-label">Today</span>
          <strong>{fmtTokens(usage?.today.total_tokens ?? 0)}</strong>
          <span className="field-hint">{usage?.today.requests ?? 0} calls</span>
        </div>
        <div className="ai-usage-stat">
          <span className="stat-label">This month</span>
          <strong>{fmtTokens(usage?.month.total_tokens ?? 0)}</strong>
          <span className="field-hint">
            of {fmtTokens(usage?.monthly_token_budget ?? 0)} budget
          </span>
        </div>
      </div>
      <div className="ai-spark-chart" aria-label="Tokens used over the last 7 days">
        {(usage?.daily_7d ?? []).map((day) => (
          <div className="ai-spark-col" key={day.date}>
            <div className="ai-spark-bar-wrap">
              <div
                className="ai-spark-bar"
                style={{ height: `${Math.max(3, Math.round((day.total_tokens / maxDaily) * 100))}%` }}
                title={`${day.date}: ${day.total_tokens.toLocaleString()} tokens`}
              />
            </div>
            <span className="ai-spark-label">{day.date.slice(8)}</span>
          </div>
        ))}
      </div>
      {(usage?.by_model.length ?? 0) > 0 && (
        <div className="ai-model-breakdown">
          {usage!.by_model.map((row) => (
            <div className="ai-model-row" key={row.model}>
              <span className="ai-model-name">{row.model}</span>
              <span className="field-hint">{row.requests} calls</span>
              <strong>{fmtTokens(row.total_tokens)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AiPage() {
  return (
    <section className="ai-page-canvas">
      <AiWorkspace />
    </section>
  );
}

export function AiDrawer() {
  const { open, request, closeAi, clearRequest } = useAiDrawer();
  return (
    <Drawer
      open={open}
      onClose={closeAi}
      side="right"
      size="lg"
      showClose
      title="AI Coach"
      description="Grounded in your local workspace, powered by your own provider"
      className="ai-drawer"
    >
      <AiWorkspace
        compact
        initialPrompt={request?.prompt}
        extraContext={request?.extraContext}
        autoSend={request?.autoSend}
        onConsumeRequest={clearRequest}
      />
    </Drawer>
  );
}
