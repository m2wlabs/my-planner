import { invoke } from "@tauri-apps/api/core";

export type Row = Record<string, string | number | null>;

export const listTable = (table: string) => invoke<Row[]>("list_table", { table });
export const insertRow = (table: string, row: Row) => invoke<{ id: number }>("insert_row", { table, row });
export const updateRow = (table: string, id: number, row: Row) => invoke("update_row", { table, id, row });
export const deleteRow = (table: string, id: number) => invoke("delete_row", { table, id });
export const startTimer = (taskId: number) => invoke("start_timer", { taskId });
export const stopTimer = () => invoke("stop_timer");
export const getSettings = () => invoke<Record<string, string>>("get_settings");
export const setSettings = (values: Record<string, string>) => invoke("set_settings", { values });
export const initDb = () => invoke<{ running_timer: Row | null }>("init_db");
export const saveWeeklyReport = (weekStart: string, snapshot: unknown) =>
  invoke("save_weekly_report", { weekStart, snapshot });
export const backupNow = () => invoke<{ file: string; at: string }>("backup_now");
export const scheduleBackup = () => invoke("schedule_backup").catch(() => {});
export const listBackups = () =>
  invoke<{ name: string; bytes: number; modified: string }[]>("list_backups");
export const restoreBackup = (name: string, passphrase: string) =>
  invoke<{ ok: boolean; safety_copy: string }>("restore_backup", { name, passphrase });
export const pickBackupFolder = () => invoke<{ path: string | null }>("pick_backup_folder");
export const backupStatus = () =>
  invoke<{ folder: string; last_backup_at: string; keep: string; encrypted: boolean }>("backup_status");

export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const addDays = (dateStr: string, days: number) => {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const fmtHours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;
export const fmtMoney = (minor: number) => (minor / 100).toFixed(2);
