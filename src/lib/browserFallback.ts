import type {
  AiConfig,
  AiSuggestedAction,
  AiUsageLogItem,
  AiUsageSummary,
  Row,
} from "./api";

const STORAGE_KEY = "my-planner-browser-preview-v2";
const DEFAULT_MONTHLY_BUDGET = 1_000_000;

interface Store {
  nextId: number;
  tables: Record<string, Row[]>;
  settings: Record<string, string>;
  aiConfig: AiConfig;
}

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDayOfIso(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function defaultAiConfig(): AiConfig {
  return {
    schemaVersion: 2,
    activeProviderId: "",
    monthlyTokenBudget: DEFAULT_MONTHLY_BUDGET,
    providers: [],
    voice: {
      ttsProvider: "browser",
      ttsProviderId: "",
      ttsModel: "",
      ttsVoice: "",
      ttsBaseUrl: "",
      ttsApiKey: "",
      ttsRate: 1.0,
      sttProvider: "browser",
      sttProviderId: "",
      sttModel: "",
      sttBaseUrl: "",
      sttApiKey: "",
      autoSpeakReplies: false,
      autoSendVoice: true,
    },
  };
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

  const routines: Row[] = [
    { id: 1, title: "Morning movement", time_of_day: "morning", color: "#E58A45", sort_order: 0, active: 1, created_at: new Date(Date.now() - 21 * 86400000).toISOString() },
    { id: 2, title: "Plan the day", time_of_day: "morning", color: "#5749F4", sort_order: 1, active: 1, created_at: new Date(Date.now() - 21 * 86400000).toISOString() },
    { id: 3, title: "Read for 20 minutes", time_of_day: "anytime", color: "#2D9D78", sort_order: 2, active: 1, created_at: new Date(Date.now() - 21 * 86400000).toISOString() },
    { id: 4, title: "Evening reset", time_of_day: "evening", color: "#A16CE0", sort_order: 3, active: 1, created_at: new Date(Date.now() - 21 * 86400000).toISOString() },
  ];
  const routine_logs: Row[] = [];
  for (let day = 21; day >= 1; day--) {
    routines.forEach((routine, index) => {
      if ((day * 7 + index * 11) % 9 !== 0) {
        routine_logs.push({
          id: 50 + routine_logs.length,
          routine_id: routine.id,
          date: isoDate(-day),
          completed_at: new Date(Date.now() - day * 86400000 + (index + 8) * 3600000).toISOString(),
        });
      }
    });
  }

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
          notes: "Polish core UX, fix DB migrations, and ship the multi-provider AI coach.",
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
          title: "Verify voice input and AI provider switching",
          goal_id: 1,
          theme_id: 1,
          planned_date: today,
          status: "planned",
          created_at: nowIso,
          notes: "Check mic capture, speech output, and provider failover.",
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
      time_entries: [{ id: 1, task_id: 2, start_utc: h1Start, end_utc: h1End }],
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
      ai_usage_logs: [],
      routines,
      routine_logs,
    },
    settings: {
      first_run_done: "1",
      wake_up_time: "07:00",
      review_time: "18:00",
      review_enabled: "1",
      backup_keep: "30",
      currency: "USD",
    },
    aiConfig: defaultAiConfig(),
  };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store> & { auth?: unknown; secrets?: unknown };
      const base = defaultStore();
      const cfg = (parsed.aiConfig ?? {}) as Partial<AiConfig>;
      const isV2 = (cfg.schemaVersion ?? 1) >= 2;
      const migratedProviders = isV2
        ? (cfg.providers ?? [])
        : (cfg.providers ?? [])
            .filter(
              (p) =>
                Boolean(p.apiKey?.trim()) ||
                Boolean(p.verifiedAt?.trim()) ||
                (p.kind === "openai-compatible" && p.enabled),
            )
            .map((p) => ({
              ...p,
              catalogId: p.catalogId ?? (p.kind === "openai-compatible" ? "custom" : p.kind),
              discoveredModels: p.discoveredModels ?? [],
            }));
      const activeExists = migratedProviders.some((p) => p.id === cfg.activeProviderId);
      const s: Store = {
        nextId: parsed.nextId ?? base.nextId,
        tables: { ...base.tables, ...(parsed.tables ?? {}) },
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        aiConfig: {
          ...defaultAiConfig(),
          ...cfg,
          schemaVersion: 2,
          providers: migratedProviders,
          activeProviderId: activeExists ? (cfg.activeProviderId ?? "") : (migratedProviders[0]?.id ?? ""),
          voice: { ...defaultAiConfig().voice, ...(cfg.voice ?? {}) },
        },
      };
      if (!isV2) save(s);
      if (!s.tables.ai_usage_logs) s.tables.ai_usage_logs = [];
      if (!s.tables.routines) s.tables.routines = base.tables.routines;
      if (!s.tables.routine_logs) s.tables.routine_logs = base.tables.routine_logs;
      return s;
    }
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

function buildPlannerContext(s: Store) {
  const today = isoDate(0);
  const month = today.slice(0, 7);
  const since = isoDate(-30);
  return {
    today_local: today,
    display_currency: s.settings.currency ?? "USD",
    base_currency_note: "money_entries.amount_minor is stored in USD cents (100 = $1.00).",
    themes: s.tables.themes ?? [],
    goals: s.tables.goals ?? [],
    tasks: (s.tables.tasks ?? []).slice(-120),
    recent_time_entries: (s.tables.time_entries ?? []).slice(-80),
    this_month_money_entries: (s.tables.money_entries ?? []).filter((m) => String(m.date ?? "").startsWith(month)),
    routines: s.tables.routines ?? [],
    routine_logs_last_30_days: (s.tables.routine_logs ?? []).filter((row) => String(row.date ?? "") >= since),
  };
}

function buildUsageSummary(s: Store): AiUsageSummary {
  const rows = (s.tables.ai_usage_logs ?? []) as unknown as AiUsageLogItem[];
  const todayStr = isoDate(0);
  const curMonth = todayStr.slice(0, 7);

  let todayReq = 0,
    todayIn = 0,
    todayOut = 0,
    todayThought = 0,
    todayCached = 0,
    todayTotal = 0,
    todayLatency = 0;
  let monthReq = 0,
    monthIn = 0,
    monthOut = 0,
    monthThought = 0,
    monthCached = 0,
    monthTotal = 0,
    monthErrors = 0,
    monthRateLimits = 0;
  let allReq = 0,
    allIn = 0,
    allOut = 0,
    allThought = 0,
    allTotal = 0;

  const dailyMap = new Map<string, { requests: number; total_tokens: number }>();
  for (let offset = -6; offset <= 0; offset++) {
    dailyMap.set(isoDate(offset), { requests: 0, total_tokens: 0 });
  }
  const modelMap = new Map<
    string,
    { requests: number; input_tokens: number; output_tokens: number; thought_tokens: number; total_tokens: number }
  >();

  for (const r of rows) {
    const day = localDayOfIso(String(r.created_at ?? ""));
    const model = String(r.model || "unknown");
    const inp = Number(r.input_tokens || 0);
    const outp = Number(r.output_tokens || 0);
    const thought = Number(r.thought_tokens || 0);
    const cached = Number(r.cached_tokens || 0);
    const total = Number(r.total_tokens || 0);
    const latency = Number(r.latency_ms || 0);

    allReq++;
    allIn += inp;
    allOut += outp;
    allThought += thought;
    allTotal += total;

    if (day === todayStr) {
      todayReq++;
      todayIn += inp;
      todayOut += outp;
      todayThought += thought;
      todayCached += cached;
      todayTotal += total;
      todayLatency += latency;
    }
    if (day.startsWith(curMonth)) {
      monthReq++;
      monthIn += inp;
      monthOut += outp;
      monthThought += thought;
      monthCached += cached;
      monthTotal += total;
      if (r.status !== "ok") monthErrors++;
      if (String(r.error_code ?? "").includes("429")) monthRateLimits++;
    }
    const bucket = dailyMap.get(day);
    if (bucket) {
      bucket.requests++;
      bucket.total_tokens += total;
    }
    const cur = modelMap.get(model) ?? {
      requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      thought_tokens: 0,
      total_tokens: 0,
    };
    cur.requests++;
    cur.input_tokens += inp;
    cur.output_tokens += outp;
    cur.thought_tokens += thought;
    cur.total_tokens += total;
    modelMap.set(model, cur);
  }

  return {
    today: {
      requests: todayReq,
      input_tokens: todayIn,
      output_tokens: todayOut,
      thought_tokens: todayThought,
      cached_tokens: todayCached,
      total_tokens: todayTotal,
      avg_latency_ms: todayReq > 0 ? Math.round(todayLatency / todayReq) : 0,
    },
    month: {
      requests: monthReq,
      input_tokens: monthIn,
      output_tokens: monthOut,
      thought_tokens: monthThought,
      cached_tokens: monthCached,
      total_tokens: monthTotal,
      errors: monthErrors,
      rate_limits: monthRateLimits,
    },
    all_time: {
      requests: allReq,
      input_tokens: allIn,
      output_tokens: allOut,
      thought_tokens: allThought,
      total_tokens: allTotal,
    },
    daily_7d: Array.from(dailyMap.entries()).map(([date, v]) => ({
      date,
      requests: v.requests,
      total_tokens: v.total_tokens,
    })),
    by_model: Array.from(modelMap.entries())
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.total_tokens - a.total_tokens),
    recent: [...rows].reverse().slice(0, 20),
    monthly_token_budget: s.aiConfig.monthlyTokenBudget || DEFAULT_MONTHLY_BUDGET,
  };
}

function applyAction(s: Store, act: AiSuggestedAction) {
  const today = isoDate(0);
  const resolveThemeId = () => {
    if (act.theme_id && (s.tables.themes ?? []).some((t) => Number(t.id) === act.theme_id)) {
      return act.theme_id;
    }
    if (act.theme_name?.trim()) {
      const found = (s.tables.themes ?? []).find(
        (t) => String(t.name).toLowerCase() === act.theme_name!.trim().toLowerCase(),
      );
      if (found) return Number(found.id);
      const id = s.nextId++;
      s.tables.themes.push({ id, name: act.theme_name.trim(), color: "#5749F4" });
      return id;
    }
    return Number((s.tables.themes ?? [])[0]?.id ?? 1);
  };

  if (act.type === "create_theme") {
    const name = (act.title || act.theme_name || "").trim();
    if (!name) throw new Error("Theme name is required");
    const id = s.nextId++;
    s.tables.themes.push({ id, name, color: act.color || "#5749F4" });
    save(s);
    return { ok: true, id, summary: `Created theme "${name}"` };
  }
  if (act.type === "create_goal") {
    const title = (act.title || "").trim();
    if (!title) throw new Error("Goal title is required");
    const id = s.nextId++;
    s.tables.goals.push({
      id,
      title,
      horizon: act.horizon || "month",
      deadline: act.deadline || null,
      theme_id: resolveThemeId(),
      status: "active",
      notes: act.notes || "",
    });
    save(s);
    return { ok: true, id, summary: `Created goal "${title}"` };
  }
  if (act.type === "create_task") {
    const title = (act.title || "").trim();
    if (!title) throw new Error("Task title is required");
    const id = s.nextId++;
    s.tables.tasks.push({
      id,
      title,
      goal_id: act.goal_id ?? null,
      theme_id: resolveThemeId(),
      planned_date: act.planned_date || today,
      status: "planned",
      created_at: new Date().toISOString(),
      notes: act.notes || "",
      estimate_mins: act.estimate_mins ?? null,
      priority: act.priority || "normal",
    });
    save(s);
    return { ok: true, id, summary: `Added task "${title}" for ${act.planned_date || today}` };
  }
  if (act.type === "complete_task" && act.task_id) {
    s.tables.tasks = s.tables.tasks.map((t) =>
      Number(t.id) === act.task_id ? { ...t, status: "done" } : t,
    );
    save(s);
    return { ok: true, summary: `Marked task #${act.task_id} done` };
  }
  if (act.type === "reschedule_task" && act.task_id) {
    const to = act.planned_date || today;
    s.tables.tasks = s.tables.tasks.map((t) =>
      Number(t.id) === act.task_id ? { ...t, planned_date: to } : t,
    );
    save(s);
    return { ok: true, summary: `Rescheduled task #${act.task_id} to ${to}` };
  }
  if (act.type === "create_money_entry") {
    const amountMinor = Math.max(1, Math.round(Math.abs(Number(act.amount_usd || 0)) * 100));
    const id = s.nextId++;
    s.tables.money_entries.push({
      id,
      amount_minor: amountMinor,
      direction: act.direction === "in" ? "in" : "out",
      category: act.category || "General",
      date: act.date || today,
      task_id: act.task_id ?? null,
      goal_id: act.goal_id ?? null,
      note: act.notes || "",
    });
    save(s);
    return { ok: true, id, summary: `Logged $${(amountMinor / 100).toFixed(2)} (${act.category || "General"})` };
  }
  if (act.type === "create_routine") {
    const title = (act.title || "").trim();
    if (!title) throw new Error("Routine title is required");
    const id = s.nextId++;
    const sortOrder = (s.tables.routines ?? []).reduce(
      (max, row) => Math.max(max, Number(row.sort_order ?? 0)),
      -1,
    ) + 1;
    s.tables.routines.push({
      id,
      title,
      time_of_day: act.time_of_day || "anytime",
      color: act.color || "#5749F4",
      sort_order: sortOrder,
      active: 1,
      created_at: new Date().toISOString(),
    });
    save(s);
    return { ok: true, id, summary: `Created non-negotiable "${title}"` };
  }
  throw new Error(`Unknown AI action type: ${act.type}`);
}

export async function browserFallbackInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
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
      if (table === "routines" && !String((args.row as Row).title ?? "").trim()) {
        throw new Error("Routine title cannot be empty.");
      }
      s.tables[table] = [...(s.tables[table] ?? []), row];
      save(s);
      return { id } as T;
    }
    case "update_row": {
      const id = Number(args.id);
      const patch = args.row as Row;
      if (table === "routines" && "title" in patch && !String(patch.title ?? "").trim()) {
        throw new Error("Routine title cannot be empty.");
      }
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
      if (table === "routines") {
        s.tables.routine_logs = (s.tables.routine_logs ?? []).filter((r) => Number(r.routine_id) !== id);
      }
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
    case "toggle_routine_log": {
      const routineId = Number(args.routineId);
      const date = String(args.date ?? "");
      const existing = (s.tables.routine_logs ?? []).find(
        (row) => Number(row.routine_id) === routineId && row.date === date,
      );
      if (existing) {
        s.tables.routine_logs = s.tables.routine_logs.filter((row) => row !== existing);
        save(s);
        return { completed: false } as T;
      }
      if (!(s.tables.routines ?? []).some((row) => Number(row.id) === routineId)) {
        throw new Error("Routine not found.");
      }
      s.tables.routine_logs.push({
        id: s.nextId++,
        routine_id: routineId,
        date,
        completed_at: new Date().toISOString(),
      });
      save(s);
      return { completed: true } as T;
    }
    case "clear_ai_messages": {
      const sid = args.sessionId as string | undefined;
      s.tables.ai_messages = sid
        ? (s.tables.ai_messages ?? []).filter((m) => m.session_id !== sid)
        : [];
      save(s);
      return { ok: true } as T;
    }
    case "clear_ai_usage": {
      s.tables.ai_usage_logs = [];
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
      return { exported_at: new Date().toISOString(), version: 4, ...s.tables } as T;
    case "list_backups":
      return [] as T;
    case "backup_status":
      return {
        folder: s.settings.backup_folder ?? "",
        last_backup_at: s.settings.last_backup_at ?? "",
        keep: s.settings.backup_keep ?? "30",
        encrypted: Boolean(s.settings.backup_passphrase),
      } as T;
    case "backup_now":
    case "schedule_backup":
      throw new Error("Backups run inside the Tauri desktop app.");
    case "pick_backup_folder":
      return { path: null } as T;

    /* ---------------------------------------------------------- AI & Voice */

    case "ai_get_config":
      return s.aiConfig as T;
    case "ai_save_config": {
      s.aiConfig = args.config as AiConfig;
      save(s);
      return s.aiConfig as T;
    }
    case "open_external_url": {
      const url = String(args.url ?? "");
      if (url.startsWith("https://") || url.startsWith("http://")) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return { ok: true } as T;
    }
    case "get_planner_context":
      return buildPlannerContext(s) as T;
    case "save_ai_turn": {
      const now = new Date().toISOString();
      s.tables.ai_messages.push({
        id: s.nextId++,
        session_id: String(args.sessionId ?? "default"),
        role: "user",
        content: String(args.userContent ?? ""),
        model: "",
        actions_json: null,
        usage_json: null,
        created_at: now,
      });
      const id = s.nextId++;
      s.tables.ai_messages.push({
        id,
        session_id: String(args.sessionId ?? "default"),
        role: "assistant",
        content: String(args.assistantContent ?? ""),
        model: String(args.model ?? ""),
        actions_json: JSON.stringify(args.actions ?? []),
        usage_json: JSON.stringify(args.usage ?? {}),
        created_at: new Date().toISOString(),
      });
      save(s);
      return { id } as T;
    }
    case "log_ai_usage_event": {
      const entry = (args.entry ?? {}) as Record<string, unknown>;
      s.tables.ai_usage_logs = [
        ...(s.tables.ai_usage_logs ?? []),
        {
          id: s.nextId++,
          created_at: new Date().toISOString(),
          model: String(entry.model ?? ""),
          transport: String(entry.transport ?? ""),
          feature: String(entry.feature ?? "chat"),
          input_tokens: Number(entry.input_tokens ?? 0),
          output_tokens: Number(entry.output_tokens ?? 0),
          thought_tokens: Number(entry.thought_tokens ?? 0),
          cached_tokens: Number(entry.cached_tokens ?? 0),
          total_tokens: Number(entry.total_tokens ?? 0),
          latency_ms: Number(entry.latency_ms ?? 0),
          status: String(entry.status ?? "ok"),
          error_code: String(entry.error_code ?? ""),
        },
      ];
      save(s);
      return { ok: true } as T;
    }
    case "ai_usage_summary":
      return buildUsageSummary(s) as T;
    case "ai_apply_action":
      return applyAction(s, args.action as AiSuggestedAction) as T;
    default:
      throw new Error(`Command "${cmd}" requires the Tauri desktop shell.`);
  }
}
