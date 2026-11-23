import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@halo-ds/react";
import * as api from "./api";
import {
  BASE_CURRENCY,
  currencyDigits,
  fetchRates,
  formatDisplayParts,
  formatMoney,
  formatMoneyParts,
  ratesAreStale,
  readRates,
  toBaseMinor,
  toDisplayAmount,
} from "./currency";

let backupTimer: ReturnType<typeof setTimeout> | null = null;
export function queueBackup() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => api.scheduleBackup(), 5000);
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}

function useTable(table: string) {
  return useQuery({ queryKey: [table], queryFn: () => api.listTable(table) });
}

export const useThemes = () => useTable("themes");
export const useGoals = () => useTable("goals");
export const useTasks = () => useTable("tasks");
export const useTimeEntries = () => useTable("time_entries");
export const useMoney = () => useTable("money_entries");
export const useWeeklyReports = () => useTable("weekly_reports");
export const useAiMessages = () => useTable("ai_messages");
export const useRoutines = () => useTable("routines");
export const useRoutineLogs = () => useTable("routine_logs");

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
}

export function useAiConfig() {
  return useQuery({ queryKey: ["ai_config"], queryFn: api.aiGetConfig, staleTime: 5 * 60_000 });
}

export function useSaveAiConfig() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (config: api.AiConfig) => api.aiSaveConfig(config),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["ai_config"] });
      const previous = qc.getQueryData<api.AiConfig>(["ai_config"]);
      qc.setQueryData(["ai_config"], next);
      return { previous };
    },
    onSuccess: (config) => {
      qc.setQueryData(["ai_config"], config);
      qc.invalidateQueries({ queryKey: ["ai_usage"] });
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["ai_config"], ctx.previous);
      toast({ type: "error", title: "Could not save AI settings", description: errorMessage(err) });
    },
  });
}

export function useAiUsage() {
  return useQuery({ queryKey: ["ai_usage"], queryFn: api.aiUsageSummary });
}

export const useRoutineMut = () => useMutate("routines");

export function useToggleRoutineLog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ routineId, date }: { routineId: number; date: string }) =>
      api.toggleRoutineLog(routineId, date),
    onMutate: async ({ routineId, date }) => {
      await qc.cancelQueries({ queryKey: ["routine_logs"] });
      const previous = qc.getQueryData<api.Row[]>(["routine_logs"]) ?? [];
      const existing = previous.find(
        (row) => Number(row.routine_id) === routineId && row.date === date,
      );
      qc.setQueryData<api.Row[]>(
        ["routine_logs"],
        existing
          ? previous.filter((row) => row !== existing)
          : [
              ...previous,
              {
                id: -Date.now(),
                routine_id: routineId,
                date,
                completed_at: new Date().toISOString(),
              },
            ],
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["routine_logs"], context.previous);
      toast({ type: "error", title: "Could not update check-in", description: errorMessage(err) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["routine_logs"] });
      queueBackup();
    },
  });
}

function useMutate(table: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [table] });
    if (table === "tasks") {
      qc.invalidateQueries({ queryKey: ["time_entries"] });
      qc.invalidateQueries({ queryKey: ["money_entries"] });
    }
    if (table === "goals") {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["money_entries"] });
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
    queueBackup();
  };
  const onError = (err: unknown) => {
    toast({ type: "error", title: "Could not save change", description: errorMessage(err) });
  };
  return {
    insert: useMutation({
      mutationFn: (row: api.Row) => api.insertRow(table, row),
      onSuccess: invalidate,
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, row }: { id: number; row: api.Row }) => api.updateRow(table, id, row),
      onSuccess: invalidate,
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.deleteRow(table, id),
      onSuccess: invalidate,
      onError,
    }),
  };
}

export const useThemeMut = () => useMutate("themes");
export const useGoalMut = () => useMutate("goals");
export const useTaskMut = () => useMutate("tasks");
export const useTimeMut = () => useMutate("time_entries");
export const useMoneyMut = () => useMutate("money_entries");

export function useDeleteTheme() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, reassignToId }: { id: number; reassignToId?: number | null }) =>
      api.deleteTheme(id, reassignToId ?? null),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["themes"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      queueBackup();
      const extra =
        res.reassigned_tasks || res.reassigned_goals
          ? ` Reassigned ${res.reassigned_tasks} task(s) and ${res.reassigned_goals} goal(s).`
          : "";
      toast({ type: "success", title: "Theme deleted", description: extra || undefined });
    },
    onError: (err) => {
      toast({ type: "error", title: "Cannot delete theme", description: errorMessage(err) });
    },
  });
}

export function useRescheduleOverdue() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (toDate: string) => api.rescheduleOverdue(toDate),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      queueBackup();
      toast({
        type: "success",
        title: `Moved ${res.moved} ${res.moved === 1 ? "task" : "tasks"} to today`,
      });
    },
    onError: (err) => {
      toast({ type: "error", title: "Could not reschedule overdue tasks", description: errorMessage(err) });
    },
  });
}

export function useApplyAiAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (action: api.AiSuggestedAction) => api.aiApplyAction(action),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["themes"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["time_entries"] });
      qc.invalidateQueries({ queryKey: ["money_entries"] });
      qc.invalidateQueries({ queryKey: ["routines"] });
      qc.invalidateQueries({ queryKey: ["routine_logs"] });
      queueBackup();
      toast({ type: "success", title: res.summary });
    },
    onError: (err) => {
      toast({ type: "error", title: "Could not apply AI action", description: errorMessage(err) });
    },
  });
}

export function useTimer() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["time_entries"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    queueBackup();
  };
  const onError = (err: unknown) => {
    qc.invalidateQueries({ queryKey: ["time_entries"] });
    toast({ type: "error", title: "Timer error", description: errorMessage(err) });
  };
  const start = useMutation({
    mutationFn: (taskId: number) => api.startTimer(taskId),
    onMutate: async (taskId: number) => {
      await qc.cancelQueries({ queryKey: ["time_entries"] });
      const now = new Date().toISOString();
      qc.setQueryData<api.Row[]>(["time_entries"], (prev = []) => [
        ...prev.map((e) => (e.end_utc == null ? { ...e, end_utc: now } : e)),
        { id: -Date.now(), task_id: taskId, start_utc: now, end_utc: null },
      ]);
    },
    onSuccess: refresh,
    onError,
  });
  const stop = useMutation({
    mutationFn: () => api.stopTimer(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["time_entries"] });
      const now = new Date().toISOString();
      qc.setQueryData<api.Row[]>(["time_entries"], (prev = []) =>
        prev.map((e) => (e.end_utc == null ? { ...e, end_utc: now } : e)),
      );
    },
    onSuccess: refresh,
    onError,
  });
  return { start, stop };
}

/** Captures a cleanly filtered weekly snapshot for the Monday..Sunday of `weekStart`. */
export async function captureWeeklySnapshot(weekStart: string) {
  const weekEnd = api.addDays(weekStart, 6);
  const [tasks, entries, money] = await Promise.all([
    api.listTable("tasks"),
    api.listTable("time_entries"),
    api.listTable("money_entries"),
  ]);
  const inRange = (d: string) => d >= weekStart && d <= weekEnd;
  const weekTasks = tasks.filter((t) => inRange(String(t.planned_date)));
  const weekEntries = entries.filter((e) => inRange(api.localDayOfIso(String(e.start_utc))));
  const weekMoney = money.filter((m) => inRange(String(m.date)));
  await api.saveWeeklyReport(weekStart, {
    week_start: weekStart,
    week_end: weekEnd,
    tasks: weekTasks,
    entries: weekEntries,
    money: weekMoney,
    at: new Date().toISOString(),
  });
}

/** Money formatting and entry conversion for the currency chosen in Settings. */
export function useCurrency() {
  const { data: settings } = useSettings();
  const raw = settings?.currency_rates;
  const table = useMemo(() => readRates(raw), [raw]);
  const stored = String(settings?.currency || BASE_CURRENCY).toUpperCase();
  const code = table.rates[stored] ? stored : BASE_CURRENCY;
  const rate = table.rates[code] ?? 1;
  return {
    code,
    rate,
    table,
    format: (minor: number) => formatMoney(minor, code, rate),
    parts: (minor: number) => formatMoneyParts(minor, code, rate),
    partsOf: (amount: number) => formatDisplayParts(amount, code),
    display: (minor: number) => toDisplayAmount(minor, code, rate),
    digits: currencyDigits(code),
    toBase: (value: number) => toBaseMinor(value, rate),
  };
}

/** Downloads fresh rates on demand (Settings → Currency → Refresh). */
export function useRefreshRates() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await fetchRates();
      await api.setSettings({ currency_rates: JSON.stringify(next) });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      queueBackup();
      toast({ type: "success", title: "Exchange rates updated" });
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast({ type: "error", title: "Could not refresh rates", description: msg });
    } finally {
      setBusy(false);
    }
  };
  return { refresh, busy, error };
}

export function useAutoRefreshRates() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const started = useRef(false);
  useEffect(() => {
    if (!settings || started.current) return;
    started.current = true;
    if (!ratesAreStale(readRates(settings.currency_rates))) return;
    fetchRates()
      .then(async (next) => {
        await api.setSettings({ currency_rates: JSON.stringify(next) });
        qc.invalidateQueries({ queryKey: ["settings"] });
      })
      .catch(() => {
        /* offline: keep the cached rates */
      });
  }, [settings, qc]);
}

/**
 * Optimistically updates the settings cache immediately so controlled inputs never drop
 * keystrokes, while batching SQLite writes with a 350ms debounce.
 */
export function useDebouncedSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, string>>({});

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (values: Record<string, string>) => {
    qc.setQueryData<Record<string, string>>(["settings"], (prev) => ({
      ...(prev ?? {}),
      ...values,
    }));
    pending.current = { ...pending.current, ...values };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const batch = pending.current;
      pending.current = {};
      try {
        await api.setSettings(batch);
        qc.invalidateQueries({ queryKey: ["settings"] });
        queueBackup();
      } catch (e) {
        toast({ type: "error", title: "Could not save setting", description: errorMessage(e) });
        qc.invalidateQueries({ queryKey: ["settings"] });
      }
    }, 350);
  };
}

/* ----------------------------------------------------- global AI drawer */

export interface AiDrawerRequest {
  prompt?: string;
  extraContext?: string;
  autoSend?: boolean;
}

interface AiDrawerContextValue {
  open: boolean;
  request: AiDrawerRequest | null;
  openAi: (req?: AiDrawerRequest) => void;
  closeAi: () => void;
  clearRequest: () => void;
}

export const AiDrawerContext = createContext<AiDrawerContextValue>({
  open: false,
  request: null,
  openAi: () => {},
  closeAi: () => {},
  clearRequest: () => {},
});

export function useAiDrawer() {
  return useContext(AiDrawerContext);
}
