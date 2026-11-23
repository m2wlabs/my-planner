import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, Drawer, SocialButton, Spinner, Tag, useToast } from "@halo-ds/react";
import * as api from "../lib/api";
import type { AiSuggestedAction } from "../lib/api";
import {
  useAiDrawer,
  useAiMessages,
  useAiModels,
  useApplyAiAction,
  useGoogleAuth,
} from "../lib/hooks";
import ScrollArea from "../components/ScrollArea";
import {
  Alert,
  Button,
  Card,
  Icon,
  Input,
  PageHead,
  SelectField,
  Textarea,
} from "../components/ui";

const STARTERS = [
  {
    title: "Plan my day",
    subtitle: "Prioritize today's tasks and reschedule overdue work.",
    prompt:
      "Look at my overdue tasks, today's plan, and active goals. Recommend my top 3 priorities today and suggest concrete task reschedules or additions.",
    icon: "calendar",
  },
  {
    title: "Review this week",
    subtitle: "Audit tracked hours, completion rate, and monthly spending.",
    prompt:
      "Analyze my tasks, tracked time, and spending this month. What's working, what's drifting, and what 3 changes should I make this week?",
    icon: "chart",
  },
  {
    title: "Break down goals",
    subtitle: "Turn active goals into scheduled tasks for the next 5 days.",
    prompt:
      "Review my active goals and suggest concrete, bite-sized tasks for the next 5 days to make steady progress on them.",
    icon: "target",
  },
  {
    title: "Capture from notes",
    subtitle: "Convert rough notes into tasks, dates, and expenses.",
    prompt:
      "I want to turn rough notes into tasks and expenses. Ask me for my notes, or suggest what overdue items I should reschedule to tomorrow.",
    icon: "zap",
  },
];

function ActionBadge({ type }: { type: AiSuggestedAction["type"] }) {
  switch (type) {
    case "create_task":
      return (
        <Tag size="sm" color="blue" className="chip">
          New task
        </Tag>
      );
    case "complete_task":
      return (
        <Tag size="sm" color="green" className="chip">
          Complete
        </Tag>
      );
    case "reschedule_task":
      return (
        <Tag size="sm" color="orange" className="chip">
          Reschedule
        </Tag>
      );
    case "create_goal":
      return (
        <Tag size="sm" color="purple" className="chip">
          New goal
        </Tag>
      );
    case "create_money_entry":
      return (
        <Tag size="sm" color="green" className="chip">
          Money
        </Tag>
      );
    case "create_theme":
      return (
        <Tag size="sm" color="neutral" className="chip">
          Theme
        </Tag>
      );
    default:
      return (
        <Tag size="sm" color="neutral" className="chip">
          Action
        </Tag>
      );
  }
}

/** Lightweight, safe renderer for clean AI Markdown replies (headings, bullets, bold, code). */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const renderInline = (line: string) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((p, idx) => {
      if (p.startsWith("**") && p.endsWith("**")) {
        return <strong key={idx}>{p.slice(2, -2)}</strong>;
      }
      if (p.startsWith("`") && p.endsWith("`")) {
        return (
          <code key={idx} className="ai-inline-code">
            {p.slice(1, -1)}
          </code>
        );
      }
      return p;
    });
  };

  const flushList = (key: string) => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={key} className="ai-list">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) {
      flushList(`ul-${idx}`);
      return;
    }
    if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      listItems.push(line.replace(/^([-*•]|\d+\.)\s+/, ""));
      return;
    }
    flushList(`ul-${idx}`);
    if (line.startsWith("### ")) {
      blocks.push(
        <h4 key={idx} className="ai-h">
          {renderInline(line.slice(4))}
        </h4>,
      );
    } else if (line.startsWith("## ") || line.startsWith("# ")) {
      blocks.push(
        <h3 key={idx} className="ai-h">
          {renderInline(line.replace(/^#+\s+/, ""))}
        </h3>,
      );
    } else {
      blocks.push(
        <p key={idx} className="ai-p">
          {renderInline(line)}
        </p>,
      );
    }
  });
  flushList("ul-end");
  return <div className="ai-md">{blocks}</div>;
}

function QuickConnectCard({ onConnected }: { onConnected?: () => void }) {
  const { data: auth } = useGoogleAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const [error, setError] = useState("");

  const refreshAuth = async () => {
    await qc.invalidateQueries({ queryKey: ["google_auth"] });
    await qc.invalidateQueries({ queryKey: ["ai_models"] });
    onConnected?.();
  };

  const signInWithGoogle = async () => {
    if (!auth?.oauth_configured) {
      navigate({ to: "/settings", search: { section: "google" } });
      return;
    }
    setBusy(true);
    setOauthWaiting(true);
    setError("");
    try {
      await api.googleOauthSignIn();
      await refreshAuth();
      toast({ type: "success", title: "Signed in with Google" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setOauthWaiting(false);
    }
  };

  const connectAdc = async () => {
    setBusy(true);
    setError("");
    try {
      await api.googleImportAdc();
      await refreshAuth();
      toast({ type: "success", title: "Connected local Google Account" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.googleSaveApiKey(apiKeyInput.trim(), true);
      setApiKeyInput("");
      await refreshAuth();
      toast({ type: "success", title: "Connected Google AI Studio key" });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="ai-connect-card">
      <div className="card-body pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="ai-connect-icon">
            <Icon name="sparkles" size={20} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Connect your Google Account for AI</div>
            <div className="field-hint">
              Use Gemini 4 models directly on your local tasks, goals, time, and money.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <SocialButton
            provider="google"
            variant="outline"
            disabled={busy}
            onClick={signInWithGoogle}
          >
            {oauthWaiting
              ? "Waiting for Google sign-in…"
              : auth?.oauth_configured
                ? "Sign in with Google"
                : "Set up Google Sign-In"}
          </SocialButton>
          {oauthWaiting && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => api.googleOauthCancel()}
            >
              Cancel
            </Button>
          )}
          {auth?.adc_available && (
            <Button variant="secondary" disabled={busy} onClick={connectAdc}>
              <Icon name="user" size={15} /> Connect local Google CLI
            </Button>
          )}
        </div>

        <div className="ai-divider-label">
          <span>or use a Google AI Studio key directly</span>
        </div>

        <form onSubmit={saveKey} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px" }}>
            <Input
              type="password"
              placeholder="Paste Gemini API key (AIza…)"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
          </div>
          <Button variant="primary" type="submit" disabled={busy || !apiKeyInput.trim()}>
            Connect key
          </Button>
          <Button
            variant="ghost"
            onClick={() => api.googleOpenUrl("https://aistudio.google.com/apikey")}
          >
            <Icon name="external" size={14} /> Get key
          </Button>
        </form>

        {error && <span className="field-error">{error}</span>}
      </div>
    </Card>
  );
}

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
  const { data: auth } = useGoogleAuth();
  const { data: modelsRes } = useAiModels();
  const { data: messages = [] } = useAiMessages();
  const applyAction = useApplyAiAction();
  const qc = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [appliedKeys, setAppliedKeys] = useState<Record<string, boolean>>({});
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const consumedRef = useRef<string>("");

  const models = modelsRes?.models ?? [];
  const selectedModel = auth?.preferred_model || "gemini-4-hydrogen";

  const scrollBottom = () => {
    const el = scrollRegionRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    if (messages.length > 0 || sending) {
      scrollBottom();
    } else if (scrollRegionRef.current) {
      scrollRegionRef.current.scrollTop = 0;
    }
  }, [messages.length, sending]);

  const sendMessage = async (textOverride?: string, ctxOverride?: string) => {
    const promptText = (textOverride ?? input).trim();
    if (!promptText || sending) return;
    if (!auth?.connected) {
      setError("Connect your Google Account or AI Studio key first.");
      return;
    }
    setSending(true);
    setError("");
    if (!textOverride) setInput("");
    try {
      await api.aiChat({
        prompt: promptText,
        sessionId: "default",
        model: selectedModel,
        extraContext: ctxOverride,
      });
      await qc.invalidateQueries({ queryKey: ["ai_messages"] });
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  // Handle deep-linked prompts from Today / Goals / Reports ("Plan with AI", "Break down with AI", etc.)
  useEffect(() => {
    if (!initialPrompt) return;
    const key = `${initialPrompt}::${extraContext ?? ""}::${Boolean(autoSend)}`;
    if (consumedRef.current === key) return;
    consumedRef.current = key;
    if (autoSend && auth?.connected) {
      sendMessage(initialPrompt, extraContext);
    } else {
      setInput(initialPrompt);
    }
    onConsumeRequest?.();
  }, [initialPrompt, extraContext, autoSend, auth?.connected]);

  const changeModel = async (modelId: string) => {
    await api.googleSetPreferences({ preferredModel: modelId });
    qc.invalidateQueries({ queryKey: ["google_auth"] });
  };

  const clearHistory = async () => {
    await api.clearAiMessages("default");
    await qc.invalidateQueries({ queryKey: ["ai_messages"] });
    setAppliedKeys({});
    toast({ type: "success", title: "Started a fresh conversation" });
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

  const sessionMsgs = messages.filter((m) => String(m.session_id || "default") === "default");

  return (
    <div className={`ai-workspace${compact ? " ai-workspace--compact" : ""}`}>
      <div className="ai-toolbar">
        <div className="ai-toolbar-left">
          {auth?.connected ? (
            <div className="ai-account-pill">
              <Avatar
                src={auth.profile?.picture || undefined}
                initials={(auth.profile?.name || "G").slice(0, 2).toUpperCase()}
                size="xs"
                status="online"
              />
              <span>
                {auth.profile?.email ||
                  (auth.active_transport === "api_key" ? "Google AI Studio" : "Google Account")}
              </span>
            </div>
          ) : (
            <span className="chip chip-warning">Not connected</span>
          )}
        </div>
        <div className="ai-toolbar-right">
          <div style={{ width: compact ? 185 : 220 }}>
            <SelectField
              value={selectedModel}
              onChange={changeModel}
              ariaLabel="Gemini model"
              options={
                models.length > 0
                  ? models.map((m) => ({ value: m.id, label: m.label }))
                  : [{ value: selectedModel, label: selectedModel }]
              }
            />
          </div>
          {sessionMsgs.length > 0 && (
            <Button size="sm" variant="ghost" onClick={clearHistory} title="Clear conversation">
              <Icon name="refresh" size={14} /> New chat
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate({ to: "/settings", search: { section: "google" } })}
            title="Google Account & AI Settings"
          >
            <Icon name="settings" size={15} />
          </Button>
        </div>
      </div>

      <ScrollArea className="ai-thread-scroll" regionRef={scrollRegionRef}>
        <div className="ai-thread">
          {!auth?.connected && <QuickConnectCard />}

          {sessionMsgs.length === 0 ? (
            <div className="ai-empty-hero">
              <div className="ai-hero-badge">
                <Icon name="sparkles" size={18} />
                <span>Powered by Gemini</span>
              </div>
              <h2>Your private planning & money coach</h2>
              <p>
                Ask anything about your tasks, goals, tracked hours, or spending. Gemini sees your
                current workspace and proposes one-click actions you stay in control of.
              </p>
              <div className="ai-starter-grid">
                {STARTERS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    className="ai-starter-card"
                    disabled={sending}
                    onClick={() =>
                      auth?.connected ? sendMessage(s.prompt) : setInput(s.prompt)
                    }
                  >
                    <Icon name={s.icon} size={16} />
                    <strong>{s.title}</strong>
                    <span>{s.subtitle}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            sessionMsgs.map((m) => {
              const isUser = m.role === "user";
              let actions: AiSuggestedAction[] = [];
              if (m.actions_json) {
                try {
                  const parsed = JSON.parse(String(m.actions_json));
                  if (Array.isArray(parsed)) actions = parsed;
                } catch {
                  /* ignore */
                }
              }
              const remainingCount = actions.filter(
                (_, idx) => !appliedKeys[`${m.id}-${idx}`],
              ).length;

              return (
                <div
                  key={m.id}
                  className={`ai-msg ${isUser ? "ai-msg--user" : "ai-msg--assistant"}`}
                >
                  <div className="ai-msg-bubble">
                    {isUser ? (
                      <div className="ai-user-text">{String(m.content)}</div>
                    ) : (
                      <>
                        <MarkdownLite text={String(m.content)} />
                        {actions.length > 0 && (
                          <div className="ai-actions-box">
                            <div className="ai-actions-head">
                              <span className="field-label">
                                Proposed actions ({actions.length})
                              </span>
                              {remainingCount > 1 && (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  disabled={applyAction.isPending}
                                  onClick={() => runAllActions(Number(m.id), actions)}
                                >
                                  Apply all ({remainingCount})
                                </Button>
                              )}
                            </div>
                            <div className="ai-actions-list">
                              {actions.map((act, idx) => {
                                const done = Boolean(appliedKeys[`${m.id}-${idx}`]);
                                return (
                                  <div className="ai-action-row" key={idx}>
                                    <div className="ai-action-meta">
                                      <ActionBadge type={act.type} />
                                      <div className="ai-action-copy">
                                        <strong>{act.label || act.title || act.category}</strong>
                                        <span>
                                          {[
                                            act.planned_date || act.date,
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
                                      onClick={() => runAction(Number(m.id), idx, act)}
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
                        {m.model && (
                          <div className="ai-msg-foot">{String(m.model)}</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {sending && (
            <div className="ai-msg ai-msg--assistant">
              <div className="ai-msg-bubble ai-thinking">
                <Spinner size="sm" />
                <span>Thinking with {selectedModel}…</span>
              </div>
            </div>
          )}

          {error && (
            <Alert type="error" variant="soft" title="AI request failed" description={error} />
          )}
        </div>
      </ScrollArea>

      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
      >
        <Textarea
          rows={compact ? 2 : 2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={
            auth?.connected
              ? "Ask Gemini to plan your day, break down a goal, or log expenses… (Enter to send)"
              : "Connect Google Account above to chat directly with Gemini…"
          }
          disabled={sending}
        />
        <Button
          variant="primary"
          type="submit"
          disabled={sending || !input.trim() || !auth?.connected}
        >
          <Icon name="send" size={15} /> Send
        </Button>
      </form>
    </div>
  );
}

export function AiPage() {
  return (
    <section className="page ai-page">
      <PageHead
        title="AI Coach"
        subtitle="Direct Gemini AI connected to your Google Account — private, action-ready, and grounded in your planner"
      />
      <div className="page-section" style={{ marginTop: 18 }}>
        <Card className="ai-page-card">
          <AiWorkspace />
        </Card>
      </div>
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
      description="Ask Gemini about your tasks, goals, time, and money"
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
