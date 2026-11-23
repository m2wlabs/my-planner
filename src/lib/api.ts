import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { browserFallbackInvoke } from "./browserFallback";

export type Row = Record<string, string | number | null>;

export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    return browserFallbackInvoke<T>(cmd, args);
  }
  return tauriInvoke<T>(cmd, args);
}

/* ----------------------------------------------------------- domain types */

export interface BackupItem {
  name: string;
  bytes: number;
  modified: string;
  encrypted?: boolean;
}

export type AiProviderKind = "anthropic" | "openai" | "google" | "openai-compatible";

export interface AiProviderConfig {
  id: string;
  catalogId?: string;
  kind: AiProviderKind;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  discoveredModels?: string[];
  verifiedAt?: string;
  enabled: boolean;
}

export type VoiceTtsProvider = "browser" | "openai" | "google" | "openai-compatible";
export type VoiceSttProvider = "browser" | "openai" | "openai-compatible";

export interface AiVoiceConfig {
  ttsProvider: VoiceTtsProvider;
  ttsModel: string;
  ttsVoice: string;
  ttsBaseUrl: string;
  ttsApiKey: string;
  ttsRate: number;
  sttProvider: VoiceSttProvider;
  sttModel: string;
  sttBaseUrl: string;
  sttApiKey: string;
  autoSpeakReplies: boolean;
  autoSendVoice: boolean;
}

export interface AiConfig {
  schemaVersion?: number;
  activeProviderId: string;
  providers: AiProviderConfig[];
  monthlyTokenBudget: number;
  voice: AiVoiceConfig;
}

export interface AiUsageDailyPoint {
  date: string;
  requests: number;
  total_tokens: number;
}

export interface AiUsageModelRow {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  total_tokens: number;
}

export interface AiUsageLogItem {
  id: number;
  created_at: string;
  model: string;
  transport: string;
  feature: string;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: string;
  error_code: string;
}

export interface AiUsageSummary {
  today: {
    requests: number;
    input_tokens: number;
    output_tokens: number;
    thought_tokens: number;
    cached_tokens: number;
    total_tokens: number;
    avg_latency_ms: number;
  };
  month: {
    requests: number;
    input_tokens: number;
    output_tokens: number;
    thought_tokens: number;
    cached_tokens: number;
    total_tokens: number;
    errors: number;
    rate_limits: number;
  };
  all_time: {
    requests: number;
    input_tokens: number;
    output_tokens: number;
    thought_tokens: number;
    total_tokens: number;
  };
  daily_7d: AiUsageDailyPoint[];
  by_model: AiUsageModelRow[];
  recent: AiUsageLogItem[];
  monthly_token_budget: number;
}

export interface AiSuggestedAction {
  type:
    | "create_task"
    | "complete_task"
    | "reschedule_task"
    | "create_goal"
    | "create_money_entry"
    | "create_theme"
    | "create_routine";
  label: string;
  title?: string;
  notes?: string;
  task_id?: number;
  theme_id?: number;
  theme_name?: string;
  goal_id?: number;
  planned_date?: string;
  estimate_mins?: number;
  priority?: "low" | "normal" | "high";
  horizon?: "week" | "month" | "year";
  deadline?: string;
  direction?: "in" | "out";
  amount_usd?: number;
  category?: string;
  date?: string;
  color?: string;
  time_of_day?: "morning" | "afternoon" | "evening" | "anytime";
}

export interface AiTurnUsage {
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  latency_ms?: number;
}

/* ------------------------------------------------------------- DB & timer */

export const listTable = (table: string) => invoke<Row[]>("list_table", { table });
export const insertRow = (table: string, row: Row) => invoke<{ id: number }>("insert_row", { table, row });
export const updateRow = (table: string, id: number, row: Row) => invoke<{ ok: boolean }>("update_row", { table, id, row });
export const deleteRow = (table: string, id: number) => invoke<{ ok: boolean }>("delete_row", { table, id });
export const deleteTheme = (id: number, reassignToId: number | null = null) =>
  invoke<{ ok: boolean; reassigned_tasks: number; reassigned_goals: number }>("delete_theme", {
    id,
    reassignToId,
  });
export const rescheduleOverdue = (toDate: string) =>
  invoke<{ moved: number }>("reschedule_overdue", { toDate });
export const clearAiMessages = (sessionId?: string) =>
  invoke<{ ok: boolean }>("clear_ai_messages", { sessionId: sessionId ?? null });
export const clearAiUsage = () => invoke<{ ok: boolean }>("clear_ai_usage");
export const startTimer = (taskId: number) => invoke<{ id: number; start_utc: string }>("start_timer", { taskId });
export const stopTimer = () => invoke<{ ok: boolean }>("stop_timer");
export const getSettings = () => invoke<Record<string, string>>("get_settings");
export const setSettings = (values: Record<string, string>) => invoke<{ ok: boolean }>("set_settings", { values });
export const initDb = () => invoke<{ running_timer: Row | null }>("init_db");
export const saveWeeklyReport = (weekStart: string, snapshot: unknown) =>
  invoke<{ ok: boolean }>("save_weekly_report", { weekStart, snapshot });
export const exportAllData = () => invoke<Record<string, unknown>>("export_all_data");
export const toggleRoutineLog = (routineId: number, date: string) =>
  invoke<{ completed: boolean }>("toggle_routine_log", { routineId, date });

/* ---------------------------------------------------------------- backups */

export const backupNow = () => invoke<{ file: string; at: string }>("backup_now");
export const scheduleBackup = () => invoke("schedule_backup").catch(() => {});
export const listBackups = () => invoke<BackupItem[]>("list_backups");
export const restoreBackup = (name: string, passphrase: string) =>
  invoke<{ ok: boolean; safety_copy: string }>("restore_backup", { name, passphrase });
export const pickBackupFolder = () => invoke<{ path: string | null }>("pick_backup_folder");
export const backupStatus = () =>
  invoke<{ folder: string; last_backup_at: string; keep: string; encrypted: boolean }>("backup_status");

/* ------------------------------------------------------------ AI & Voice */

export const aiGetConfig = () => invoke<AiConfig>("ai_get_config");
export const aiSaveConfig = (config: AiConfig) => invoke<AiConfig>("ai_save_config", { config });
export const openExternalUrl = (url: string) => invoke<{ ok: boolean }>("open_external_url", { url });
export const getPlannerContext = () => invoke<Record<string, unknown>>("get_planner_context");
export const saveAiTurn = (params: {
  sessionId: string;
  userContent: string;
  assistantContent: string;
  model: string;
  actions: AiSuggestedAction[];
  usage: AiTurnUsage;
}) =>
  invoke<{ id: number }>("save_ai_turn", {
    sessionId: params.sessionId,
    userContent: params.userContent,
    assistantContent: params.assistantContent,
    model: params.model,
    actions: params.actions,
    usage: params.usage,
  });
export const logAiUsageEvent = (entry: {
  model: string;
  transport: string;
  feature: string;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: "ok" | "error";
  error_code: string;
}) => invoke<{ ok: boolean }>("log_ai_usage_event", { entry });
export const aiUsageSummary = () => invoke<AiUsageSummary>("ai_usage_summary");
export const aiApplyAction = (action: AiSuggestedAction) =>
  invoke<{ ok: boolean; id?: number; summary: string }>("ai_apply_action", { action });

/* ----------------------------------------------------------- date helpers */

export const dateToIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const todayLocal = () => dateToIso(new Date());

export const addDays = (dateStr: string, days: number) => {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return dateToIso(d);
};

export const mondayOf = (dateStr: string) => {
  const d = new Date(dateStr + "T12:00:00");
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return dateToIso(d);
};

export const localDayOfIso = (iso: string) => dateToIso(new Date(iso));

export const fmtHours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;
export const fmtMoney = (minor: number) => (minor / 100).toFixed(2);
