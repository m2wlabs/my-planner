import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { Badge, Button, Card, Field, Input, Select, Tag } from "@halo-ds/react";
import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import type { Row } from "../lib/api";
import { todayLocal } from "../lib/api";
import { useGoals, useSettings, useTaskMut, useTasks, useThemes, useTimeEntries, useTimer } from "../lib/hooks";

export function ThemeChip({ themeId, themes }: { themeId: number; themes: Row[] }) {
  const t = themes.find((x) => x.id === themeId);
  if (!t) return <Badge color="neutral">No theme</Badge>;
  return <Tag color={String(t.color)}>{String(t.name)}</Tag>;
}

export function Layout() {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">My Planner</div>
        <div className="nav-section">Workspace</div>
        <Link to="/today" className="nav-link" activeProps={{ className: "nav-link active" }}>Today</Link>
        <Link to="/goals" search={{ tab: undefined }} className="nav-link" activeProps={{ className: "nav-link active" }}>Goals</Link>
        <Link to="/money" className="nav-link" activeProps={{ className: "nav-link active" }}>Money</Link>
        <Link to="/reports" className="nav-link" activeProps={{ className: "nav-link active" }}>Reports</Link>
        <div className="nav-section">Manage</div>
        <Link to="/settings" className="nav-link" activeProps={{ className: "nav-link active" }}>Settings</Link>
        <Link to="/first-run" className="nav-link" activeProps={{ className: "nav-link active" }}>First run</Link>
      </nav>
      <main className="main">
        <Outlet />
      </main>
      <TimerBar />
    </div>
  );
}

function elapsed(startUtc: string) {
  const ms = Date.now() - new Date(startUtc).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function TimerBar() {
  const { data: entries = [] } = useTimeEntries();
  const { data: tasks = [] } = useTasks();
  const { stop } = useTimer();
  const running = entries.find((e) => e.end_utc == null);
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!running) return null;
  const task = tasks.find((t) => t.id === running.task_id);
  return (
    <div className="timer-bar">
      <span>▶ {task ? String(task.title) : "Timer running"}</span>
      <strong>{elapsed(String(running.start_utc))}</strong>
      <Button size="sm" variant="secondary" onClick={() => stop.mutate()}>Stop</Button>
    </div>
  );
}

export function TaskCard({ task, onEdit }: { task: Row; onEdit?: (t: Row) => void }) {
  const { data: themes = [] } = useThemes();
  const { data: goals = [] } = useGoals();
  const { data: entries = [] } = useTimeEntries();
  const { start } = useTimer();
  const taskMut = useTaskMut();
  const goal = goals.find((g) => g.id === task.goal_id);
  const running = entries.some((e) => e.task_id === task.id && e.end_utc == null);
  const toggleDone = () =>
    taskMut.update.mutate({ id: Number(task.id), row: { status: task.status === "done" ? "planned" : "done" } });
  return (
    <Card>
      <div className="row-between">
        <div>
          <strong>{String(task.title)}</strong>
          <div className="row gap">
            <ThemeChip themeId={Number(task.theme_id)} themes={themes} />
            {goal && <Badge color="information">{String(goal.title)}</Badge>}
            {running && <Badge color="success" dot>Timing</Badge>}
          </div>
        </div>
        <div className="row gap">
          <Button size="sm" variant="secondary" onClick={toggleDone}>
            {task.status === "done" ? "Reopen" : "Done"}
          </Button>
          <Button size="sm" variant={running ? "secondary" : "primary"} onClick={() => start.mutate(Number(task.id))} disabled={running}>
            {running ? "Running…" : "Start"}
          </Button>
          {onEdit && <Button size="sm" variant="ghost" onClick={() => onEdit(task)}>Edit</Button>}
        </div>
      </div>
    </Card>
  );
}

const taskSchema = z.object({ title: z.string().min(1, "Title required") });

export function QuickTask({ plannedDate, goalId, onDone }: { plannedDate?: string; goalId?: number; onDone?: () => void }) {
  const { data: themes = [] } = useThemes();
  const { data: goals = [] } = useGoals();
  const taskMut = useTaskMut();
  const form = useForm({
    defaultState: { values: { title: "", theme_id: "", goal_id: goalId ? String(goalId) : "" } },
    onSubmit: async ({ value }) => {
      const parsed = taskSchema.safeParse(value);
      if (!parsed.success || !value.theme_id) return;
      await taskMut.insert.mutateAsync({
        title: parsed.data.title,
        theme_id: Number(value.theme_id),
        goal_id: value.goal_id ? Number(value.goal_id) : null,
        planned_date: plannedDate ?? todayLocal(),
        status: "planned",
        created_at: new Date().toISOString(),
      });
      form.reset();
      onDone?.();
    },
  });
  if (themes.length === 0) return <p>Create a theme first (Goals page).</p>;
  return (
    <form
      className="row gap"
      onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
    >
      <form.Field name="title">
        {(f) => (
          <Field label="New task">
            {() => (
              <Input
                placeholder="Add a task…"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
                onBlur={f.handleBlur}
              />
            )}
          </Field>
        )}
      </form.Field>
      <form.Field name="theme_id">
        {(f) => (
          <Field label="Theme" required>
            {() => (
              <Select
                options={themes.map((t) => ({ value: String(t.id), label: String(t.name) }))}
                value={f.state.value}
                onValueChange={f.handleChange}
                placeholder="Theme"
              />
            )}
          </Field>
        )}
      </form.Field>
      <form.Field name="goal_id">
        {(f) => (
          <Field label="Goal (optional)">
            {() => (
              <Select
                options={[{ value: "", label: "No goal" }, ...goals.map((g) => ({ value: String(g.id), label: String(g.title) }))]}
                value={f.state.value}
                onValueChange={f.handleChange}
                placeholder="No goal"
              />
            )}
          </Field>
        )}
      </form.Field>
      <Button type="submit" variant="primary">Add</Button>
    </form>
  );
}

export function useFirstRunRedirect() {
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  useEffect(() => {
    if (settings && settings.first_run_done !== "1") navigate({ to: "/first-run" });
  }, [settings, navigate]);
}

import type { ReactNode } from "react";

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      {children}
    </section>
  );
}
