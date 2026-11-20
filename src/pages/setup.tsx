import { Button, Card, Field, Input, Switch } from "@halo-ds/react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as api from "../lib/api";
import { useDebouncedSettings, useSettings, useThemeMut, useGoalMut } from "../lib/hooks";
import { Page } from "../components/ui";

export function SettingsPage() {
  const { data: settings = {} } = useSettings();
  const save = useDebouncedSettings();
  const [status, setStatus] = useState<string>("");
  const [backups, setBackups] = useState<{ name: string; bytes: number; modified: string }[]>([]);
  const [restorePass, setRestorePass] = useState("");
  const [warn, setWarn] = useState("");

  const refreshBackups = () => api.listBackups().then(setBackups).catch((e) => setStatus(String(e)));
  useEffect(() => { refreshBackups(); }, []);

  const pickFolder = async () => {
    const { path } = await api.pickBackupFolder();
    if (path) { save({ backup_folder: path }); setStatus(`Backup folder: ${path}`); }
  };

  return (
    <Page title="Settings">
      <Card>
        <h3>Schedule</h3>
        <Field label="Wake-up time">{() => (
          <Input type="time" value={settings.wake_up_time ?? "07:00"} onChange={(e) => save({ wake_up_time: e.target.value })} />
        )}</Field>
        <Field label="Weekly review time">{() => (
          <Input type="time" value={settings.review_time ?? "18:00"} onChange={(e) => save({ review_time: e.target.value })} />
        )}</Field>
        <Field label="Backup retention (snapshots)">{() => (
          <Input type="number" value={settings.backup_keep ?? "30"} onChange={(e) => save({ backup_keep: e.target.value })} />
        )}</Field>
      </Card>
      <Card>
        <h3>Backup</h3>
        <p>Folder: {settings.backup_folder || "not chosen"}</p>
        <p>Last backup: {settings.last_backup_at || "never"}</p>
        <div className="row gap">
          <Button variant="secondary" onClick={pickFolder}>Choose backup folder…</Button>
          <Button variant="primary" onClick={async () => {
            const r = await api.backupNow();
            setStatus(`Backed up: ${r.file} at ${r.at}`);
            refreshBackups();
          }}>Back up now</Button>
        </div>
        <Field label="Snapshot passphrase (optional, leave empty for none)">{() => (
          <Input type="password" value={settings.backup_passphrase ?? ""} onChange={(e) => save({ backup_passphrase: e.target.value })} />
        )}</Field>
        {status && <p>{status}</p>}
        <h4>Snapshots</h4>
        <div className="stack">
          {backups.map((b) => (
            <div key={b.name} className="row-between">
              <span>{b.name} · {(b.bytes / 1024).toFixed(0)} KB · {b.modified.slice(0, 19)}</span>
              <span className="row gap">
                <Input placeholder="Passphrase if encrypted" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />
                <Button size="sm" variant="destructive" onClick={() => setWarn(b.name)}>Restore…</Button>
              </span>
            </div>
          ))}
        </div>
        {warn && (
          <Card>
            <p><strong>Warning:</strong> restoring <code>{warn}</code> replaces all current data. A safety copy of the current database is kept in the backup folder first.</p>
            <div className="row gap">
              <Button variant="destructive" onClick={async () => {
                const r = await api.restoreBackup(warn, restorePass);
                setStatus(`Restored. Safety copy: ${r.safety_copy}`);
                setWarn("");
              }}>Yes, restore</Button>
              <Button variant="ghost" onClick={() => setWarn("")}>Cancel</Button>
            </div>
          </Card>
        )}
      </Card>
      <Card>
        <h3>Weekly review</h3>
        <p>At your review time you get a native notification that opens the weekly report. Snooze from the notification; dismiss to skip.</p>
        <Switch label="Enable weekly review notifications" checked={(settings.review_enabled ?? "1") === "1"}
          onCheckedChange={(c) => save({ review_enabled: c ? "1" : "0" })} />
      </Card>
    </Page>
  );
}

export function FirstRunPage() {
  const { data: settings = {} } = useSettings();
  const save = useDebouncedSettings();
  const navigate = useNavigate();
  const themeMut = useThemeMut();
  const goalMut = useGoalMut();
  const [folder, setFolder] = useState("");
  const [wake, setWake] = useState("07:00");
  const [review, setReview] = useState("18:00");
  const [theme, setTheme] = useState("");
  const [goal, setGoal] = useState("");
  const [done, setDone] = useState(false);

  const finish = async () => {
    if (theme.trim()) {
      const { id } = await themeMut.insert.mutateAsync({ name: theme.trim(), color: "#6366f1" });
      if (goal.trim()) await goalMut.insert.mutateAsync({ title: goal.trim(), horizon: "month", deadline: null, theme_id: id, status: "active" });
    }
    await api.setSettings({
      backup_folder: folder,
      wake_up_time: wake,
      review_time: review,
      first_run_done: "1",
    });
    setDone(true);
    navigate({ to: "/today" });
  };

  return (
    <Page title="Welcome to My Planner">
      <p>Quick setup — under two minutes, and you can skip it.</p>
      <Card>
        <div className="stack">
          <Field label="Backup folder (e.g. a Google Drive / OneDrive / Dropbox folder)">{() => (
            <span className="row gap">
              <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\you\Drive\MyPlanner-backups" />
              <Button variant="secondary" onClick={async () => { const r = await api.pickBackupFolder(); if (r.path) setFolder(r.path); }}>Choose…</Button>
            </span>
          )}</Field>
          <Field label="Wake-up time">{() => <Input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />}</Field>
          <Field label="Weekly review time">{() => <Input type="time" value={review} onChange={(e) => setReview(e.target.value)} />}</Field>
          <Field label="First theme">{() => <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. Health" />}</Field>
          <Field label="First goal (optional)">{() => <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Run 3× a week" />}</Field>
          <div className="row gap">
            <Button variant="primary" onClick={finish}>Finish setup</Button>
            <Button variant="ghost" onClick={async () => { await api.setSettings({ first_run_done: "1" }); navigate({ to: "/today" }); }}>Skip</Button>
          </div>
          {done && <p>Done!</p>}
        </div>
      </Card>
    </Page>
  );
}
