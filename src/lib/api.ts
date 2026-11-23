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

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

export interface GoogleAuthStatus {
  connected: boolean;
  has_oauth: boolean;
  has_api_key: boolean;
  api_key_preview: string;
  auth_method: string;
  active_transport: "oauth" | "adc" | "api_key" | "none";
  prefer_api_key: boolean;
  profile: GoogleProfile | null;
  oauth_configured: boolean;
  oauth_client_id: string;
  has_oauth_client_secret: boolean;
  quota_project_id: string;
  preferred_model: string;
  adc_available: boolean;
  scopes: string[];
}

export interface AiModelInfo {
  id: string;
  label: string;
  description: string;
  badge: string;
  discovered: boolean;
}

export interface AiSuggestedAction {
  type:
    | "create_task"
    | "complete_task"
    | "reschedule_task"
    | "create_goal"
    | "create_money_entry"
    | "create_theme";
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
}

export interface AiChatResponse {
  id?: number;
  reply: string;
  suggested_actions: AiSuggestedAction[];
  model: string;
  usage?: Record<string, unknown> | null;
  created_at?: string;
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
export const startTimer = (taskId: number) => invoke<{ id: number; start_utc: string }>("start_timer", { taskId });
export const stopTimer = () => invoke<{ ok: boolean }>("stop_timer");
export const getSettings = () => invoke<Record<string, string>>("get_settings");
export const setSettings = (values: Record<string, string>) => invoke<{ ok: boolean }>("set_settings", { values });
export const initDb = () => invoke<{ running_timer: Row | null }>("init_db");
export const saveWeeklyReport = (weekStart: string, snapshot: unknown) =>
  invoke<{ ok: boolean }>("save_weekly_report", { weekStart, snapshot });
export const exportAllData = () => invoke<Record<string, unknown>>("export_all_data");

/* ---------------------------------------------------------------- backups */

export const backupNow = () => invoke<{ file: string; at: string }>("backup_now");
export const scheduleBackup = () => invoke("schedule_backup").catch(() => {});
export const listBackups = () => invoke<BackupItem[]>("list_backups");
export const restoreBackup = (name: string, passphrase: string) =>
  invoke<{ ok: boolean; safety_copy: string }>("restore_backup", { name, passphrase });
export const pickBackupFolder = () => invoke<{ path: string | null }>("pick_backup_folder");
export const backupStatus = () =>
  invoke<{ folder: string; last_backup_at: string; keep: string; encrypted: boolean }>("backup_status");

/* ---------------------------------------------------- Google Account & AI */

export const googleAuthStatus = () => invoke<GoogleAuthStatus>("google_auth_status");
export const googleOpenUrl = (url: string) => invoke<{ ok: boolean }>("google_open_url", { url });
export const googleSaveOauthConfig = (
  clientId: string,
  clientSecret: string,
  quotaProjectId?: string,
) =>
  invoke<GoogleAuthStatus>("google_save_oauth_config", {
    clientId,
    clientSecret,
    quotaProjectId: quotaProjectId ?? null,
  });
export const googleImportClientJson = (jsonText: string) =>
  invoke<GoogleAuthStatus>("google_import_client_json", { jsonText });
export const googlePickClientJson = () =>
  invoke<{ cancelled: boolean; status?: GoogleAuthStatus }>("google_pick_client_json");
export const googleSaveApiKey = (apiKey: string, preferApiKey?: boolean) =>
  invoke<GoogleAuthStatus>("google_save_api_key", {
    apiKey,
    preferApiKey: preferApiKey ?? null,
  });
export const googleSetPreferences = (prefs: {
  preferredModel?: string;
  preferApiKey?: boolean;
  quotaProjectId?: string;
}) =>
  invoke<GoogleAuthStatus>("google_set_preferences", {
    preferredModel: prefs.preferredModel ?? null,
    preferApiKey: prefs.preferApiKey ?? null,
    quotaProjectId: prefs.quotaProjectId ?? null,
  });
export const googleOauthSignIn = () => invoke<GoogleAuthStatus>("google_oauth_sign_in");
export const googleOauthCancel = () => invoke<{ ok: boolean }>("google_oauth_cancel");
export const googleImportAdc = () => invoke<GoogleAuthStatus>("google_import_adc");
export const googleSignOut = (clearApiKey = false) =>
  invoke<GoogleAuthStatus>("google_sign_out", { clearApiKey });
export const googleListModels = () =>
  invoke<{ models: AiModelInfo[]; live: boolean }>("google_list_models");
export const googleTestConnection = () =>
  invoke<{ ok: boolean; model: string; transport: string; reply: string }>("google_test_connection");

export const aiChat = (params: {
  prompt: string;
  sessionId?: string;
  model?: string;
  extraContext?: string;
}) =>
  invoke<AiChatResponse>("ai_chat", {
    prompt: params.prompt,
    sessionId: params.sessionId ?? "default",
    model: params.model ?? null,
    extraContext: params.extraContext ?? null,
  });

export const aiQuickPrompt = (params: {
  prompt: string;
  model?: string;
  extraContext?: string;
}) =>
  invoke<AiChatResponse>("ai_quick_prompt", {
    prompt: params.prompt,
    model: params.model ?? null,
    extraContext: params.extraContext ?? null,
  });

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
