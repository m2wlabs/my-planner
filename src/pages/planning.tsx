import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Tabs, Tab, TabList, TabPanel } from "@halo-ds/react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { addDays, todayLocal, type Row } from "../lib/api";
import { useGoals, useGoalMut, useTasks, useTaskMut, useThemes, useThemeMut, useTimeEntries, useTimeMut } from "../lib/hooks";
import { Page, QuickTask, TaskCard, ThemeChip } from "../components/ui";

function todayEntries(entries: Row[]) {
  const today = todayLocal();
  return entries.filter((e) => {
    const local = new Date(String(e.start_utc));
    const d = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    return d === today;
  });
}

function minutes(entry: Row) {
  const end = entry.end_utc ? new Date(String(entry.end_utc)).getTime() : Date.now();
  return Math.max(0, (end - new Date(String(entry.start_utc)).getTime()) / 60000);
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function EditTime({ entry, onClose }: { entry: Row; onClose: () => void }) {
  const mut = useTimeMut();
  const [start, setStart] = useState(toLocalInput(String(entry.start_utc)));
  const [end, setEnd] = useState(entry.end_utc ? toLocalInput(String(entry.end_utc)) : "");
  const [error, setError] = useState("");
  const saveEntry = async () => {
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    if (isNaN(startDate.getTime())) return setError("Start time is not valid");
    if (endDate && endDate.getTime() <= startDate.getTime()) return setError("End must be after start");
    await mut.update.mutateAsync({
      id: Number(entry.id),
      row: { start_utc: startDate.toISOString(), end_utc: endDate ? endDate.toISOString() : null },
    });
    onClose();
  };
  return (
    <Modal open title="Edit time entry" onClose={onClose}>
      <div className="stack">
        <Field label="Start" error={error || undefined}>
          {() => <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}
        </Field>
        <Field label="End" hint="Leave empty only if this timer is still running.">
          {() => <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />}
        </Field>
        <div className="row gap">
          <Button variant="primary" onClick={saveEntry}>Save</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

function TimeToday() {
  const { data: entries = [] } = useTimeEntries();
  const { data: tasks = [] } = useTasks();
  const [editing, setEditing] = useState<Row | null>(null);
  const list = todayEntries(entries);
  const total = list.reduce((s, e) => s + minutes(e), 0);
  return (
    <Card>
      <div className="row-between">
        <h3 style={{ margin: 0 }}>Time today</h3>
        <Badge color="neutral">{(total / 60).toFixed(1)}h</Badge>
      </div>
      {list.length === 0 && <p>No time tracked yet today. Start a timer on any task.</p>}
      <div className="stack">
        {list.map((e) => {
          const task = tasks.find((t) => t.id === e.task_id);
          return (
            <div key={e.id} className="row-between">
              <span>
                {task ? String(task.title) : "Task"} · {toLocalInput(String(e.start_utc)).slice(11)} →{" "}
                {e.end_utc ? toLocalInput(String(e.end_utc)).slice(11) : "running"} · {(minutes(e) / 60).toFixed(2)}h
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button>
            </div>
          );
        })}
      </div>
      {editing && <EditTime entry={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

export function TodayPage() {
  const { data: tasks = [] } = useTasks();
  const navigate = useNavigate();
  const today = todayLocal();
  const todays = tasks.filter((t) => t.planned_date === today);
  const overdue = tasks.filter((t) => String(t.planned_date) < today && t.status !== "done");
  return (
    <Page title="Today">
      <QuickTask plannedDate={today} />
      <h2>Planned today ({todays.length})</h2>
      {todays.length === 0 && (
        <EmptyState title="Nothing planned" description="Add a task above, or plan tomorrow on the Goals page." />
      )}
      <div className="stack">{todays.map((t) => <TaskCard key={t.id} task={t} />)}</div>
      <TimeToday />
      <h2>Overdue ({overdue.length})</h2>
      {overdue.length === 0 && <p>Nothing overdue.</p>}
      <div className="stack">{overdue.map((t) => <TaskCard key={t.id} task={t} />)}</div>
      <Button variant="secondary" onClick={() => navigate({ to: "/goals", search: { tab: "tomorrow" } })}>
        Plan tomorrow
      </Button>
    </Page>
  );
}

function ThemeManager() {
  const { data: themes = [] } = useThemes();
  const mut = useThemeMut();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  return (
    <Card>
      <h3>Themes</h3>
      <div className="row gap wrap">
        {themes.map((t) => (
          <span key={t.id} className="row gap">
            <ThemeChip themeId={Number(t.id)} themes={themes} />
            <Button size="sm" variant="ghost" onClick={() => mut.remove.mutate(Number(t.id))}>Delete</Button>
          </span>
        ))}
        {themes.length === 0 && <span>Every task needs a theme — create one below.</span>}
      </div>
      <div className="row gap" style={{ marginTop: 12 }}>
        <Input placeholder="Theme name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input type="color" aria-label="Theme colour" value={color} onChange={(e) => setColor(e.target.value)} />
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => { await mut.insert.mutateAsync({ name: name.trim(), color }); setName(""); }}
        >
          Add theme
        </Button>
      </div>
    </Card>
  );
}

function GoalForm({ onClose }: { onClose: () => void }) {
  const { data: themes = [] } = useThemes();
  const mut = useGoalMut();
  const [title, setTitle] = useState("");
  const [horizon, setHorizon] = useState("month");
  const [deadline, setDeadline] = useState("");
  const [themeId, setThemeId] = useState("");
  return (
    <Modal open title="New goal" onClose={onClose}>
      <div className="stack">
        <Field label="Title" required>{() => <Input value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Horizon" hint="Week, month or year.">{() => (
          <Select
            options={["week", "month", "year"].map((h) => ({ value: h, label: h }))}
            value={horizon}
            onValueChange={setHorizon}
          />
        )}</Field>
        <Field label="Deadline (optional)">{() => <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}</Field>
        <Field label="Theme" required>{() => (
          <Select
            options={themes.map((t) => ({ value: String(t.id), label: String(t.name) }))}
            value={themeId}
            onValueChange={setThemeId}
            placeholder="Theme"
          />
        )}</Field>
        <Button
          variant="primary"
          disabled={!title.trim() || !themeId}
          onClick={async () => {
            await mut.insert.mutateAsync({
              title: title.trim(),
              horizon,
              deadline: deadline || null,
              theme_id: Number(themeId),
              status: "active",
            });
            onClose();
          }}
        >
          Create goal
        </Button>
      </div>
    </Modal>
  );
}

function TaskEdit({ task, onClose }: { task: Row; onClose: () => void }) {
  const { data: themes = [] } = useThemes();
  const { data: goals = [] } = useGoals();
  const { data: entries = [] } = useTimeEntries();
  const mut = useTaskMut();
  const [title, setTitle] = useState(String(task.title));
  const [themeId, setThemeId] = useState(String(task.theme_id));
  const [goalId, setGoalId] = useState(task.goal_id ? String(task.goal_id) : "");
  const [planned, setPlanned] = useState(String(task.planned_date));
  const [editingEntry, setEditingEntry] = useState<Row | null>(null);
  return (
    <Modal open title="Edit task" onClose={onClose}>
      <div className="stack">
        <Field label="Title" required>{() => <Input value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Theme" required>{() => (
          <Select
            options={themes.map((t) => ({ value: String(t.id), label: String(t.name) }))}
            value={themeId}
            onValueChange={setThemeId}
          />
        )}</Field>
        <Field label="Goal (optional)">{() => (
          <Select
            options={[{ value: "", label: "No goal" }, ...goals.map((g) => ({ value: String(g.id), label: String(g.title) }))]}
            value={goalId}
            onValueChange={setGoalId}
          />
        )}</Field>
        <Field label="Planned date">{() => <Input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} />}</Field>
        <div className="row gap">
          <Button
            variant="primary"
            disabled={!title.trim() || !themeId}
            onClick={async () => {
              await mut.update.mutateAsync({
                id: Number(task.id),
                row: { title: title.trim(), theme_id: Number(themeId), goal_id: goalId ? Number(goalId) : null, planned_date: planned },
              });
              onClose();
            }}
          >
            Save
          </Button>
          <Button
            variant="destructive"
            onClick={async () => { await mut.remove.mutateAsync(Number(task.id)); onClose(); }}
          >
            Delete
          </Button>
        </div>
        <h4>Time entries</h4>
        {entries.filter((e) => e.task_id === task.id).map((e) => (
          <div key={e.id} className="row-between">
            <span>{toLocalInput(String(e.start_utc))} → {e.end_utc ? toLocalInput(String(e.end_utc)) : "running"}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditingEntry(e)}>Edit</Button>
          </div>
        ))}
        {entries.filter((e) => e.task_id === task.id).length === 0 && <p>No time tracked yet.</p>}
      </div>
      {editingEntry && <EditTime entry={editingEntry} onClose={() => setEditingEntry(null)} />}
    </Modal>
  );
}

export function GoalsPage({ tab }: { tab?: string }) {
  const { data: goals = [] } = useGoals();
  const { data: tasks = [] } = useTasks();
  const { data: themes = [] } = useThemes();
  const { data: entries = [] } = useTimeEntries();
  const goalMut = useGoalMut();
  const [showGoal, setShowGoal] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [activeTab, setActiveTab] = useState(tab ?? "tomorrow");
  const today = todayLocal();

  const minutesForGoal = (goalId: number) => {
    const taskIds = new Set(tasks.filter((t) => t.goal_id === goalId).map((t) => Number(t.id)));
    return entries.filter((e) => taskIds.has(Number(e.task_id))).reduce((sum, e) => sum + minutes(e), 0);
  };

  const rangeFor = (tabName: string): [string, string] | null => {
    if (tabName === "tomorrow") { const d = addDays(today, 1); return [d, d]; }
    if (tabName === "week") return [today, addDays(today, 6)];
    if (tabName === "month") return [today, addDays(today, 29)];
    return null;
  };

  const renderTasks = (tabName: string) => {
    const range = rangeFor(tabName);
    if (!range) return null;
    const list = tasks.filter((t) => String(t.planned_date) >= range[0] && String(t.planned_date) <= range[1]);
    return (
      <div className="stack">
        <QuickTask plannedDate={range[0]} />
        {list.length === 0 && <EmptyState title="No tasks in this range" description="Add one above." />}
        {list.map((t) => <TaskCard key={t.id} task={t} onEdit={setEditing} />)}
      </div>
    );
  };

  return (
    <Page title="Goals">
      <div className="row gap">
        <Button variant="primary" onClick={() => setShowGoal(true)}>New goal</Button>
        <Button
          variant="secondary"
          onClick={() => { setActiveTab("tomorrow"); document.getElementById("planner")?.scrollIntoView({ behavior: "smooth" }); }}
        >
          Plan tomorrow
        </Button>
      </div>
      {showGoal && <GoalForm onClose={() => setShowGoal(false)} />}
      <ThemeManager />
      <h2>Goals</h2>
      <div className="stack">
        {goals.map((g) => {
          const linked = tasks.filter((t) => t.goal_id === g.id);
          const pct = linked.length ? Math.round((linked.filter((t) => t.status === "done").length / linked.length) * 100) : 0;
          return (
            <Card key={g.id}>
              <div className="row-between">
                <div>
                  <strong>{String(g.title)}</strong>
                  <div className="row gap wrap" style={{ marginTop: 6 }}>
                    <ThemeChip themeId={Number(g.theme_id)} themes={themes} />
                    <Badge color="neutral">{String(g.horizon)}</Badge>
                    {g.deadline && <Badge color="warning">due {String(g.deadline)}</Badge>}
                    <Badge color={g.status === "done" ? "success" : "brand"}>{String(g.status)}</Badge>
                    <span>{pct}% done · {(minutesForGoal(Number(g.id)) / 60).toFixed(1)}h</span>
                  </div>
                </div>
                <div className="row gap">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => goalMut.update.mutate({ id: Number(g.id), row: { status: g.status === "done" ? "active" : "done" } })}
                  >
                    {g.status === "done" ? "Reopen" : "Complete"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => goalMut.remove.mutate(Number(g.id))}>Delete</Button>
                </div>
              </div>
            </Card>
          );
        })}
        {goals.length === 0 && <EmptyState title="No goals yet" description="Create your first goal to start planning." />}
      </div>
      <h2 id="planner">Planner</h2>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabList aria-label="Planner range">
          <Tab value="tomorrow">Tomorrow</Tab>
          <Tab value="week">Week</Tab>
          <Tab value="month">Month</Tab>
          <Tab value="year">Year</Tab>
        </TabList>
        <TabPanel value="tomorrow">{renderTasks("tomorrow")}</TabPanel>
        <TabPanel value="week">{renderTasks("week")}</TabPanel>
        <TabPanel value="month">{renderTasks("month")}</TabPanel>
        <TabPanel value="year">
          <div className="stack">
            {goals.map((g) => (
              <Card key={g.id}>
                <strong>{String(g.title)}</strong> — {String(g.horizon)}{g.deadline ? ` · due ${String(g.deadline)}` : ""}
              </Card>
            ))}
            {goals.length === 0 && <EmptyState title="Year view" description="Your goals will appear here." />}
          </div>
        </TabPanel>
      </Tabs>
      {editing && <TaskEdit task={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}
