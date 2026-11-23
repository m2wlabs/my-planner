import type { AiModelInfo, GoogleAuthStatus, Row } from "./api";

const STORAGE_KEY = "my-planner-browser-preview-v2";

interface Store {
  nextId: number;
  tables: Record<string, Row[]>;
  settings: Record<string, string>;
  auth: GoogleAuthStatus;
}

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultStore(): Store {
  const today = isoDate(0);
  const yesterday = isoDate(-1);
  const tomorrow = isoDate(1);
  const in2 = isoDate(2);
  const in5 = isoDate(5);
  const nowIso = new Date().toISOString();
  const h1Start = new Date(Date.now() - 95 * 60_000).toISOString();
  const h1End = new Date(Date.now() - 40 * 60_000).toISOString();

  return {
    nextId: 100,
    tables: {
      themes: [
        { id: 1, name: "Product", color: "#5749F4" },
        { id: 2, name: "Health", color: "#A1E5A1" },
        { id: 3, name: "Finance", color: "#FFD9B2" },
      ],
      goals: [
        {
          id: 1,
          title: "Launch My Planner v1",
          horizon: "month",
          deadline: isoDate(18),
          theme_id: 1,
          status: "active",
          notes: "Polish core UX, fix DB migrations, and ship Google AI integration.",
        },
        {
          id: 2,
          title: "Consistent morning training",
          horizon: "week",
          deadline: isoDate(6),
          theme_id: 2,
          status: "active",
          notes: "4 sessions this week.",
        },
      ],
      tasks: [
        {
          id: 1,
          title: "Review overdue roadmap items",
          goal_id: 1,
          theme_id: 1,
          planned_date: yesterday,
          status: "planned",
          created_at: nowIso,
          notes: "Prioritize top 3 fixes before release.",
          estimate_mins: 30,
          priority: "high",
        },
        {
          id: 2,
          title: "Ship Google Account OAuth & Gemini Coach",
          goal_id: 1,
          theme_id: 1,
          planned_date: today,
          status: "planned",
          created_at: nowIso,
          notes: "Verify loopback sign-in, token refresh, and structured actions.",
          estimate_mins: 90,
          priority: "high",
        },
        {
          id: 3,
          title: "45-minute strength workout",
          goal_id: 2,
          theme_id: 2,
          planned_date: today,
          status: "done",
          created_at: nowIso,
          notes: "",
          estimate_mins: 45,
          priority: "normal",
        },
        {
          id: 4,
          title: "Draft weekly budget & reconcile subscriptions",
          goal_id: null,
          theme_id: 3,
          planned_date: tomorrow,
          status: "planned",
          created_at: nowIso,
          notes: "",
          estimate_mins: 30,
          priority: "normal",
        },
        {
          id: 5,
          title: "Write release notes and QA checklist",
          goal_id: 1,
          theme_id: 1,
          planned_date: in2,
          status: "planned",
          created_at: nowIso,
          notes: "",
          estimate_mins: 45,
          priority: "normal",
        },
        {
          id: 6,
          title: "Sunday mobility & recovery session",
          goal_id: 2,
          theme_id: 2,
          planned_date: in5,
          status: "planned",
          created_at: nowIso,
          notes: "",
          estimate_mins: 30,
          priority: "low",
        },
      ],
      time_entries: [
        { id: 1, task_id: 2, start_utc: h1Start, end_utc: h1End },
      ],
      money_entries: [
        {
          id: 1,
          amount_minor: 320000,
          direction: "in",
          category: "Salary",
          date: isoDate(-4),
          task_id: null,
          goal_id: null,
          note: "Monthly deposit",
        },
        {
          id: 2,
          amount_minor: 8450,
          direction: "out",
          category: "Groceries",
          date: isoDate(-2),
          task_id: null,
          goal_id: 2,
          note: "Weekly fresh market run",
        },
        {
          id: 3,
          amount_minor: 2900,
          direction: "out",
          category: "Software",
          date: today,
          task_id: 2,
          goal_id: 1,
          note: "Cloud tools",
        },
      ],
      weekly_reports: [],
      ai_messages: [],
    },
    settings: {
      first_run_done: "1",
      wake_up_time: "07:00",
      review_time: "18:00",
      review_enabled: "1",
      backup_keep: "30",
      currency: "USD",
    },
    auth: {
      connected: false,
      has_oauth: false,
      has_api_key: false,
      api_key_preview: "",
      auth_method: "",
      active_transport: "none",
      prefer_api_key: false,
      profile: null,
      oauth_configured: false,
      oauth_client_id: "",
      has_oauth_client_secret: false,
      quota_project_id: "",
      preferred_model: "gemini-4-hydrogen",
      adc_available: false,
      scopes: [],
    },
  };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* ignore */
  }
  const init = defaultStore();
  save(init);
  return init;
}

function save(s: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const PREVIEW_MODELS: AiModelInfo[] = [
  { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", description: "Fast, balanced frontier model — great for daily planning and coaching.", badge: "Recommended", discovered: false },
  { id: "gemini-4-argon", label: "Gemini 4 Argon", description: "Efficient frontier reasoning for goal breakdowns and schedules.", badge: "Balanced", discovered: false },
  { id: "gemini-4-neon", label: "Gemini 4 Neon", description: "Frontier intelligence with fast end-to-end analysis and reviews.", badge: "Pro", discovered: false },
  { id: "gemini-4-carbon", label: "Gemini 4 Carbon", description: "Strongest reasoning model for deep long-horizon strategy.", badge: "Deep", discovered: false },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", description: "Fastest, lowest-cost model for instant note capture and parsing.", badge: "Fast", discovered: false },
];

export async function browserFallbackInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const s = load();
  const table = String(args.table ?? "");

  switch (cmd) {
    case "init_db": {
      const running = (s.tables.time_entries ?? []).find((e) => e.end_utc == null) ?? null;
      return { running_timer: running } as T;
    }
    case "list_table":
      return (s.tables[table] ?? []) as T;
    case "insert_row": {
      const id = s.nextId++;
      const row = { id, ...(args.row as Row) };
      s.tables[table] = [...(s.tables[table] ?? []), row];
      save(s);
      return { id } as T;
    }
    case "update_row": {
      const id = Number(args.id);
      const patch = args.row as Row;
      s.tables[table] = (s.tables[table] ?? []).map((r) => (Number(r.id) === id ? { ...r, ...patch } : r));
      if (table === "tasks" && patch.status === "done") {
        const now = new Date().toISOString();
        s.tables.time_entries = (s.tables.time_entries ?? []).map((e) =>
          Number(e.task_id) === id && e.end_utc == null ? { ...e, end_utc: now } : e,
        );
      }
      save(s);
      return { ok: true } as T;
    }
    case "delete_row": {
      const id = Number(args.id);
      if (table === "themes") return browserFallbackInvoke<T>("delete_theme", { id, reassignToId: null });
      s.tables[table] = (s.tables[table] ?? []).filter((r) => Number(r.id) !== id);
      if (table === "tasks") {
        s.tables.time_entries = (s.tables.time_entries ?? []).filter((e) => Number(e.task_id) !== id);
        s.tables.money_entries = (s.tables.money_entries ?? []).map((m) =>
          Number(m.task_id) === id ? { ...m, task_id: null } : m,
        );
      }
      if (table === "goals") {
        s.tables.tasks = (s.tables.tasks ?? []).map((t) => (Number(t.goal_id) === id ? { ...t, goal_id: null } : t));
        s.tables.money_entries = (s.tables.money_entries ?? []).map((m) =>
          Number(m.goal_id) === id ? { ...m, goal_id: null } : m,
        );
      }
      save(s);
      return { ok: true } as T;
    }
    case "delete_theme": {
      const id = Number(args.id);
      const reassignTo = args.reassignToId != null ? Number(args.reassignToId) : null;
      const tCount = (s.tables.tasks ?? []).filter((t) => Number(t.theme_id) === id).length;
      const gCount = (s.tables.goals ?? []).filter((g) => Number(g.theme_id) === id).length;
      if (tCount > 0 || gCount > 0) {
        if (!reassignTo || reassignTo === id) {
          throw new Error(`Theme is in use by ${tCount} task(s) and ${gCount} goal(s). Reassign them first.`);
        }
        s.tables.tasks = (s.tables.tasks ?? []).map((t) => (Number(t.theme_id) === id ? { ...t, theme_id: reassignTo } : t));
        s.tables.goals = (s.tables.goals ?? []).map((g) => (Number(g.theme_id) === id ? { ...g, theme_id: reassignTo } : g));
      }
      s.tables.themes = (s.tables.themes ?? []).filter((t) => Number(t.id) !== id);
      save(s);
      return { ok: true, reassigned_tasks: tCount, reassigned_goals: gCount } as T;
    }
    case "reschedule_overdue": {
      const toDate = String(args.toDate);
      let moved = 0;
      s.tables.tasks = (s.tables.tasks ?? []).map((t) => {
        if (String(t.planned_date) < toDate && t.status !== "done") {
          moved++;
          return { ...t, planned_date: toDate };
        }
        return t;
      });
      save(s);
      return { moved } as T;
    }
    case "clear_ai_messages": {
      const sid = args.sessionId as string | undefined;
      s.tables.ai_messages = sid
        ? (s.tables.ai_messages ?? []).filter((m) => m.session_id !== sid)
        : [];
      save(s);
      return { ok: true } as T;
    }
    case "start_timer": {
      const taskId = Number(args.taskId);
      const now = new Date().toISOString();
      s.tables.time_entries = (s.tables.time_entries ?? []).map((e) => (e.end_utc == null ? { ...e, end_utc: now } : e));
      const id = s.nextId++;
      s.tables.time_entries.push({ id, task_id: taskId, start_utc: now, end_utc: null });
      save(s);
      return { id, start_utc: now } as T;
    }
    case "stop_timer": {
      const now = new Date().toISOString();
      s.tables.time_entries = (s.tables.time_entries ?? []).map((e) => (e.end_utc == null ? { ...e, end_utc: now } : e));
      save(s);
      return { ok: true } as T;
    }
    case "get_settings":
      return s.settings as T;
    case "set_settings": {
      s.settings = { ...s.settings, ...(args.values as Record<string, string>) };
      save(s);
      return { ok: true } as T;
    }
    case "save_weekly_report": {
      const weekStart = String(args.weekStart);
      const snapshot_json = JSON.stringify(args.snapshot);
      const existing = (s.tables.weekly_reports ?? []).find((r) => r.week_start === weekStart);
      if (existing) {
        existing.snapshot_json = snapshot_json;
      } else {
        s.tables.weekly_reports.push({ id: s.nextId++, week_start: weekStart, snapshot_json });
      }
      save(s);
      return { ok: true } as T;
    }
    case "export_all_data":
      return { exported_at: new Date().toISOString(), version: 2, ...s.tables } as T;
    case "list_backups":
      return [] as T;
    case "backup_status":
      return { folder: s.settings.backup_folder ?? "", last_backup_at: s.settings.last_backup_at ?? "", keep: s.settings.backup_keep ?? "30", encrypted: Boolean(s.settings.backup_passphrase) } as T;
    case "backup_now":
    case "schedule_backup":
      throw new Error("Backups run inside the Tauri desktop app.");
    case "pick_backup_folder":
      return { path: null } as T;
    case "google_auth_status":
      return s.auth as T;
    case "google_list_models":
      return { models: PREVIEW_MODELS, live: false } as T;
    case "google_open_url": {
      window.open(String(args.url), "_blank", "noopener,noreferrer");
      return { ok: true } as T;
    }
    case "google_set_preferences": {
      if (typeof args.preferredModel === "string") s.auth.preferred_model = args.preferredModel;
      if (typeof args.preferApiKey === "boolean") s.auth.prefer_api_key = args.preferApiKey;
      if (typeof args.quotaProjectId === "string") s.auth.quota_project_id = args.quotaProjectId;
      save(s);
      return s.auth as T;
    }
    case "google_save_oauth_config": {
      s.auth.oauth_client_id = String(args.clientId ?? "").trim();
      s.auth.oauth_configured = Boolean(s.auth.oauth_client_id);
      if (String(args.clientSecret ?? "").trim()) s.auth.has_oauth_client_secret = true;
      if (typeof args.quotaProjectId === "string") s.auth.quota_project_id = args.quotaProjectId.trim();
      save(s);
      return s.auth as T;
    }
    case "google_save_api_key": {
      const k = String(args.apiKey ?? "").trim();
      s.auth.has_api_key = Boolean(k);
      s.auth.api_key_preview = k.length >= 10 ? `${k.slice(0, 6)}…${k.slice(-4)}` : k ? "••••••••" : "";
      s.auth.connected = s.auth.has_oauth || s.auth.has_api_key;
      s.auth.active_transport = s.auth.has_api_key ? "api_key" : s.auth.has_oauth ? "oauth" : "none";
      save(s);
      return s.auth as T;
    }
    case "google_sign_out": {
      s.auth.has_oauth = false;
      s.auth.profile = null;
      if (args.clearApiKey) {
        s.auth.has_api_key = false;
        s.auth.api_key_preview = "";
      }
      s.auth.connected = s.auth.has_api_key;
      s.auth.active_transport = s.auth.has_api_key ? "api_key" : "none";
      save(s);
      return s.auth as T;
    }
    default:
      throw new Error(`Command "${cmd}" requires the Tauri desktop shell.`);
  }
}
