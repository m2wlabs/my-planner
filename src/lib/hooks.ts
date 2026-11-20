import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import * as api from "./api";

let backupTimer: ReturnType<typeof setTimeout> | null = null;
export function queueBackup() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => api.scheduleBackup(), 5000);
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

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
}

function useMutate(table: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [table] });
    qc.invalidateQueries({ queryKey: ["settings"] });
    queueBackup();
  };
  return {
    insert: useMutation({
      mutationFn: (row: api.Row) => api.insertRow(table, row),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, row }: { id: number; row: api.Row }) => api.updateRow(table, id, row),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.deleteRow(table, id),
      onSuccess: invalidate,
    }),
  };
}

export const useThemeMut = () => useMutate("themes");
export const useGoalMut = () => useMutate("goals");
export const useTaskMut = () => useMutate("tasks");
export const useTimeMut = () => useMutate("time_entries");
export const useMoneyMut = () => useMutate("money_entries");

export function useTimer() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["time_entries"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    queueBackup();
  };
  const start = useMutation({ mutationFn: (taskId: number) => api.startTimer(taskId), onSuccess: refresh });
  const stop = useMutation({ mutationFn: () => api.stopTimer(), onSuccess: refresh });
  return { start, stop };
}

export function useDebouncedSettings() {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (values: Record<string, string>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await api.setSettings(values);
      qc.invalidateQueries({ queryKey: ["settings"] });
      queueBackup();
    }, 400);
  };
}
