import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SegmentedControl, useToast } from "@halo-ds/react";
import { addDays, mondayOf, todayLocal, type Row } from "../lib/api";
import ScrollArea from "../components/ScrollArea";
import {
  useAiDrawer,
  useDeleteTheme,
  useGoalMut,
  useGoals,
  useMoney,
  useRescheduleOverdue,
  useSettings,
  useTaskMut,
  useTasks,
  useThemeMut,
  useThemes,
  useTimeEntries,
  useTimer,
} from "../lib/hooks";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EditTime,
  GoalForm,
  Icon,
  Input,
  Modal,
  Money,
  PageHead,
  Progress,
  QuickTask,
  SelectField,
  StateChip,
  TabsWrap,
  TaskEdit,
  TaskRow,
  ThemeChip,
  TimeToday,
  currentMonth,
  entryMinutes,
  fmtDateLong,
  fmtDateShort,
  fmtHours,
  fmtMonth,
  localDay,
  shiftMonth,
  taskMinutes,
  useRunning,
} from "../components/ui";

const SWATCHES = ["#5749F4", "#A1E5A1", "#FFD9B2", "#C9D6F0", "#F7C9DC", "#D9D9DB", "#F59E0B", "#14B8A6"];

function greetingTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function useClock(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

function elapsedLabel(startUtc: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(startUtc).getTime()) / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function TimerCard({
  nextTask,
  onEdit,
}: {
  nextTask?: Row;
  onEdit: (t: Row) => void;
}) {
  const { running, task } = useRunning();
  useClock(Boolean(running));
  const { data: themes = [] } = useThemes();
  const { start, stop } = useTimer();
  return (
    <Card>
      <div className="card-head plain">
        <Icon
          name="timer"
          size={18}
          style={{ color: running ? "var(--destructive)" : "var(--muted-foreground)" }}
        />
        <span className="card-title">Running timer</span>
      </div>
      <div className="card-body pad">
        {running ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <span className="timer-value">{elapsedLabel(String(running.start_utc))}</span>
              <span className="timer-caption">{task ? String(task.title) : "Task"}</span>
            </div>
            {task && <ThemeChip themeId={task.theme_id as number | null} themes={themes} />}
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="danger" className="grow" onClick={() => stop.mutate()}>
                <Icon name="square" size={14} /> Stop
              </Button>
              <Button
                variant="secondary"
                className="grow"
                disabled={!task}
                onClick={() => task && onEdit(task)}
              >
                <Icon name="edit" size={14} /> Open
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span className="timer-value" style={{ color: "var(--muted-foreground)" }}>
              00:00:00
            </span>
            <span className="field-hint">
              Start a timer from any task. It keeps running if you close the app.
            </span>
            {nextTask && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => start.mutate(Number(nextTask.id))}
              >
                <Icon name="play" size={13} /> Start "{String(nextTask.title).slice(0, 26)}"
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- Today Page */

export function TodayPage() {
  const { data: tasks = [] } = useTasks();
  const { data: entries = [] } = useTimeEntries();
  const { data: themes = [] } = useThemes();
  const { data: goals = [] } = useGoals();
  const { data: money = [] } = useMoney();
  const { data: settings = {} } = useSettings();
  const rescheduleOverdue = useRescheduleOverdue();
  const { openAi } = useAiDrawer();
  const navigate = useNavigate();

  const [editing, setEditing] = useState<Row | null>(null);
  const [editingEntry, setEditingEntry] = useState<Row | null>(null);
  const [detailGoalId, setDetailGoalId] = useState<number | null>(null);
  const [filterTheme, setFilterTheme] = useState<string>("all");
  const [search, setSearch] = useState("");

  const today = todayLocal();
  const matchesFilter = (t: Row) => {
    if (filterTheme !== "all" && String(t.theme_id) !== filterTheme) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const titleHit = String(t.title).toLowerCase().includes(q);
      const notesHit = String(t.notes ?? "").toLowerCase().includes(q);
      if (!titleHit && !notesHit) return false;
    }
    return true;
  };

  const todaysAll = tasks.filter((t) => String(t.planned_date) === today);
  const completedAll = todaysAll.filter((t) => t.status === "done");
  const overdueAll = tasks.filter((t) => String(t.planned_date) < today && t.status !== "done");

  const planned = todaysAll.filter((t) => t.status !== "done" && matchesFilter(t));
  const completed = completedAll.filter(matchesFilter);
  const overdue = overdueAll.filter(matchesFilter);

  const trackedToday = entries
    .filter((e) => localDay(String(e.start_utc)) === today)
    .reduce((s, e) => s + entryMinutes(e), 0);
  const donePct = todaysAll.length ? Math.round((completedAll.length / todaysAll.length) * 100) : 0;
  const tomorrowCount = tasks.filter(
    (t) => String(t.planned_date) === addDays(today, 1) && t.status !== "done",
  ).length;

  const reviewEnabled = (settings.review_enabled ?? "1") !== "0";
  const reviewTime = settings.review_time ?? "18:00";
  const [rh = 18, rm = 0] = reviewTime.split(":").map(Number);
  const reviewLabel = new Date(2020, 0, 1, rh, rm).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const detailGoal = detailGoalId ? goals.find((g) => Number(g.id) === detailGoalId) ?? null : null;
  const openTask = (t: Row) => setEditing(t);

  return (
    <section className="page">
      <PageHead
        title="Today"
        subtitle={fmtDateLong(today)}
        stats={[
          { label: "Planned", value: `${todaysAll.length} ${todaysAll.length === 1 ? "task" : "tasks"}` },
          { label: "Completed", value: `${completedAll.length} of ${todaysAll.length}` },
          { label: "Tracked", value: greetingTime(trackedToday) },
        ]}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              openAi({
                prompt:
                  "Look at my tasks for today, any overdue items, and my active goals. Recommend the best focus order for today and suggest any concrete schedule tweaks.",
                extraContext: `Current screen: Today (${today}). Overdue count: ${overdueAll.length}, Planned today: ${todaysAll.length - completedAll.length}.`,
                autoSend: true,
              })
            }
          >
            <Icon name="sparkles" size={14} /> Plan with AI
          </Button>
        }
      />

      <QuickTask plannedDate={today} />

      {(todaysAll.length > 0 || overdueAll.length > 0) && (
        <div className="filter-strip">
          <div className="filter-search">
            <Icon name="search" size={15} className="filter-search-icon" />
            <Input
              placeholder="Filter today's tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filter-pills">
            <button
              type="button"
              className={`filter-pill${filterTheme === "all" ? " active" : ""}`}
              onClick={() => setFilterTheme("all")}
            >
              All themes
            </button>
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`filter-pill${filterTheme === String(t.id) ? " active" : ""}`}
                onClick={() => setFilterTheme(filterTheme === String(t.id) ? "all" : String(t.id))}
              >
                <span className="filter-dot" style={{ background: String(t.color) }} />
                {String(t.name)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="body-grid">
        <div className="ledger">
          {overdue.length > 0 && (
            <Card>
              <div className="card-head">
                <span className="card-title">Overdue</span>
                <span className="count">{overdue.length}</span>
                <span className="spacer" />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={rescheduleOverdue.isPending}
                  onClick={() => rescheduleOverdue.mutate(today)}
                >
                  Move all to today
                </Button>
              </div>
              <div className="card-body tight">
                {overdue.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    themes={themes}
                    goals={goals}
                    entries={entries}
                    onEdit={openTask}
                  />
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="card-head">
              <span className="card-title">Planned for today</span>
              <span className="count">{planned.length}</span>
            </div>
            <div className="card-body tight">
              {planned.length === 0 ? (
                <div className="empty empty-soft" style={{ marginBottom: 4 }}>
                  <Icon name="calendarPlus" size={22} />
                  <div className="empty-title">
                    {todaysAll.length > 0 && completedAll.length === todaysAll.length
                      ? "All tasks for today are done"
                      : search || filterTheme !== "all"
                        ? "No matching tasks"
                        : "Nothing planned yet"}
                  </div>
                  <div>
                    {search || filterTheme !== "all"
                      ? "Try clearing your search or theme filter."
                      : "Add a task above, or plan tomorrow tonight."}
                  </div>
                </div>
              ) : (
                planned.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    themes={themes}
                    goals={goals}
                    entries={entries}
                    onEdit={openTask}
                  />
                ))
              )}
            </div>
          </Card>

          {completed.length > 0 && (
            <Card>
              <div className="card-head">
                <span className="card-title">Completed</span>
                <span className="count">{completed.length}</span>
              </div>
              <div className="card-body tight">
                {completed.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    themes={themes}
                    goals={goals}
                    entries={entries}
                    onEdit={openTask}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="rail">
          <TimerCard nextTask={planned[0] ?? overdue[0]} onEdit={openTask} />

          <Card>
            <div className="card-body pad" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Icon
                name="calendarPlus"
                size={18}
                className="icon-muted"
                style={{ color: "var(--muted-foreground)" }}
              />
              <span style={{ flex: 1, fontSize: 13 }}>
                {tomorrowCount} {tomorrowCount === 1 ? "task" : "tasks"} planned for tomorrow
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => navigate({ to: "/goals", search: { tab: "tomorrow" } })}
              >
                Open
              </Button>
            </div>
          </Card>

          <Card>
            <div className="card-head plain">
              <Icon name="target" size={20} className="icon-muted" />
              <span className="card-title">Today</span>
            </div>
            <div className="card-body pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <span className="hero-figure">{donePct}%</span>
                <span className="hero-caption">of the plan done</span>
              </div>
              <Progress value={donePct} success={donePct === 100 && todaysAll.length > 0} />
              <div style={{ display: "flex", alignItems: "center", fontSize: 14, paddingTop: 2 }}>
                <span style={{ color: "var(--muted-foreground)" }}>Overdue</span>
                <span style={{ flex: 1 }} />
                <span
                  style={{
                    color: overdueAll.length ? "var(--error-foreground)" : "var(--muted-foreground)",
                    fontWeight: 600,
                  }}
                >
                  {overdueAll.length}
                </span>
              </div>
            </div>
          </Card>

          <Alert
            type="information"
            variant="soft"
            title="Weekly review"
            description={
              reviewEnabled
                ? `Sundays at ${reviewLabel}. Shown as an in-app banner.`
                : "Off — enable it in Settings."
            }
          />

          <Card>
            <div className="card-head plain">
              <Icon name="folder" size={20} className="icon-muted" />
              <span className="card-title">Goals</span>
              <span className="spacer" />
              <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/goals" })}>
                All
              </Button>
            </div>
            <div className="card-body tight">
              {goals.length === 0 && (
                <div className="field-hint">No goals yet. Add one on the Goals page.</div>
              )}
              {goals.slice(0, 4).map((g) => {
                const linked = tasks.filter((t) => Number(t.goal_id) === Number(g.id));
                const done = linked.filter((t) => t.status === "done").length;
                const mins = linked.reduce((s, t) => s + taskMinutes(Number(t.id), entries), 0);
                const st =
                  g.status === "done"
                    ? "Done"
                    : linked.length && done === linked.length
                      ? "Done"
                      : "On track";
                return (
                  <button
                    key={g.id}
                    type="button"
                    className="rail-goal-row"
                    onClick={() => setDetailGoalId(Number(g.id))}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{String(g.title)}</div>
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                        {done}/{linked.length} {linked.length === 1 ? "task" : "tasks"}
                      </div>
                    </div>
                    <StateChip status={st === "Done" ? "done" : "active"} label={st} />
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--muted-foreground)",
                        width: 52,
                        textAlign: "right",
                      }}
                    >
                      {mins ? fmtHours(mins) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <TimeToday entries={entries} tasks={tasks} onEdit={setEditingEntry} />
        </div>
      </div>

      {editing && <TaskEdit task={editing} onClose={() => setEditing(null)} />}
      {editingEntry && <EditTime entry={editingEntry} onClose={() => setEditingEntry(null)} />}
      {detailGoal && (
        <GoalDetail
          goal={detailGoal}
          tasks={tasks}
          entries={entries}
          themes={themes}
          money={money}
          onClose={() => setDetailGoalId(null)}
          onEditTask={setEditing}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ goals */

function GoalCard({
  goal,
  tasks,
  entries,
  themes,
  money,
  onOpen,
}: {
  goal: Row;
  tasks: Row[];
  entries: Row[];
  themes: Row[];
  money: Row[];
  onOpen: () => void;
}) {
  const linked = tasks.filter((t) => Number(t.goal_id) === Number(goal.id));
  const done = linked.filter((t) => t.status === "done").length;
  const pct = linked.length ? Math.round((done / linked.length) * 100) : goal.status === "done" ? 100 : 0;
  const mins = linked.reduce((s, t) => s + taskMinutes(Number(t.id), entries), 0);
  const spent = money
    .filter(
      (e) =>
        e.direction === "out" &&
        (Number(e.goal_id) === Number(goal.id) ||
          (e.task_id && linked.some((t) => Number(t.id) === Number(e.task_id)))),
    )
    .reduce((s, e) => s + Number(e.amount_minor), 0);
  const completed = goal.status === "done" || (linked.length > 0 && done === linked.length);
  const overdue = !completed && goal.deadline && String(goal.deadline) < todayLocal();

  return (
    <Card className="goal-card" onClick={onOpen}>
      <div className="goal-top">
        <ThemeChip themeId={goal.theme_id as number | null} themes={themes} />
        <span style={{ fontSize: 12, color: "var(--muted-foreground)", textTransform: "capitalize" }}>
          {String(goal.horizon)}
        </span>
        <span className="status" style={overdue ? { color: "var(--destructive)", fontWeight: 600 } : undefined}>
          {completed ? "Completed" : overdue ? "Past due" : "In progress"}
        </span>
      </div>
      <div className="goal-title">{String(goal.title)}</div>
      {goal.notes && String(goal.notes).trim() && (
        <div className="goal-notes-preview">{String(goal.notes)}</div>
      )}
      <div className="goal-due">
        <Icon name="calendar" size={14} />{" "}
        {goal.deadline ? `Due ${fmtDateShort(String(goal.deadline))}` : "No deadline"}
      </div>
      <Progress value={pct} success={completed} />
      <div className="goal-foot">
        <span>
          {done}/{linked.length} tasks
        </span>
        <span>{pct}%</span>
      </div>
      <div className="goal-foot">
        <span className="metric">
          <Icon name="clock" size={14} /> {mins ? fmtHours(mins) : "—"}
        </span>
        <span className="metric">
          <Icon name="wallet" size={14} /> {spent ? <><Money minor={spent} /> spent</> : "—"}
        </span>
      </div>
    </Card>
  );
}

export function GoalDetail({
  goal,
  tasks,
  entries,
  themes,
  money,
  onClose,
  onEditTask,
}: {
  goal: Row;
  tasks: Row[];
  entries: Row[];
  themes: Row[];
  money: Row[];
  onClose: () => void;
  onEditTask: (task: Row) => void;
}) {
  const goalMut = useGoalMut();
  const taskMut = useTaskMut();
  const { openAi } = useAiDrawer();
  const { toast } = useToast();
  const [editingGoal, setEditingGoal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const linked = tasks.filter((t) => Number(t.goal_id) === Number(goal.id));
  const done = linked.filter((t) => t.status === "done").length;
  const mins = linked.reduce((s, t) => s + taskMinutes(Number(t.id), entries), 0);
  const out = money
    .filter(
      (e) =>
        e.direction === "out" &&
        (Number(e.goal_id) === Number(goal.id) ||
          (e.task_id && linked.some((t) => Number(t.id) === Number(e.task_id)))),
    )
    .reduce((s, e) => s + Number(e.amount_minor), 0);
  const inn = money
    .filter((e) => e.direction === "in" && Number(e.goal_id) === Number(goal.id))
    .reduce((s, e) => s + Number(e.amount_minor), 0);
  const isDone = goal.status === "done";
  const pct = linked.length ? Math.round((done / linked.length) * 100) : isDone ? 100 : 0;

  if (editingGoal) {
    return <GoalForm goal={goal} onClose={() => setEditingGoal(false)} />;
  }

  const toggleGoalStatus = async () => {
    const next = isDone ? "active" : "done";
    await goalMut.update.mutateAsync({ id: Number(goal.id), row: { status: next } });
    toast({ type: "success", title: next === "done" ? "Goal marked completed" : "Goal reopened" });
  };

  const deleteGoal = async () => {
    await goalMut.remove.mutateAsync(Number(goal.id));
    toast({ type: "success", title: "Goal deleted" });
    onClose();
  };

  return (
    <Modal
      title={String(goal.title)}
      label="Goal"
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={14} /> Delete
          </Button>
          <span className="spacer" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onClose();
              openAi({
                prompt: `Break down my goal "${String(goal.title)}" (id: ${goal.id}, horizon: ${String(goal.horizon)}${goal.deadline ? `, deadline: ${String(goal.deadline)}` : ""}) into 4 to 6 concrete, scheduled tasks starting from today.`,
                extraContext: `Goal notes: ${String(goal.notes ?? "")}`,
                autoSend: true,
              });
            }}
          >
            <Icon name="sparkles" size={14} /> Break down with AI
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditingGoal(true)}>
            <Icon name="edit" size={14} /> Edit
          </Button>
          <Button variant="primary" size="sm" onClick={toggleGoalStatus}>
            <Icon name="check" size={14} /> {isDone ? "Reopen" : "Complete"}
          </Button>
        </>
      }
    >
      <div className="goal-top">
        <ThemeChip themeId={goal.theme_id as number | null} themes={themes} />
        <span style={{ fontSize: 13, color: "var(--muted-foreground)", textTransform: "capitalize" }}>
          {String(goal.horizon)}
        </span>
        {goal.deadline && (
          <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            · Due {fmtDateShort(String(goal.deadline))}
          </span>
        )}
        <span className="status">{isDone ? "Completed" : "In progress"}</span>
      </div>

      {goal.notes && String(goal.notes).trim() && (
        <div className="goal-detail-notes">{String(goal.notes)}</div>
      )}

      <div style={{ display: "flex", gap: 20, fontSize: 13, flexWrap: "wrap" }}>
        <span>
          <strong>{done}/{linked.length}</strong> tasks done
        </span>
        <span>
          <strong>{mins ? fmtHours(mins) : "0m"}</strong> tracked
        </span>
        <span>
          <Money minor={inn} /> in · <Money minor={out} /> out
        </span>
      </div>

      <Progress value={pct} success={isDone} />

      <div>
        <div className="field-label" style={{ marginBottom: 8 }}>
          Add a task to this goal
        </div>
        <QuickTask compact defaultGoalId={String(goal.id)} plannedDate={todayLocal()} />
      </div>

      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          Linked tasks ({linked.length})
        </div>
        {linked.length === 0 && (
          <div className="field-hint">No tasks linked yet. Add one above or use AI breakdown.</div>
        )}
        {linked.map((t) => {
          const tDone = t.status === "done";
          return (
            <div className="snapshot" key={t.id}>
              <Checkbox
                checked={tDone}
                label={tDone ? "Mark not done" : "Mark done"}
                onChange={() =>
                  taskMut.update.mutate({
                    id: Number(t.id),
                    row: { status: tDone ? "planned" : "done" },
                  })
                }
              />
              <button
                type="button"
                className="item-main"
                onClick={() => {
                  onClose();
                  onEditTask(t);
                }}
              >
                <span className={`meta${tDone ? " done-text" : ""}`}>
                  {String(t.title)} · {fmtDateShort(String(t.planned_date))}
                </span>
              </button>
              <StateChip status={String(t.status)} />
            </div>
          );
        })}
      </div>

      {confirmDelete && (
        <Alert
          type="warning"
          variant="soft"
          title="Delete this goal?"
          description="Linked tasks and money entries stay intact, just unlinked from this goal."
          actions={
            <>
              <Button size="sm" variant="danger" onClick={deleteGoal}>
                Delete goal
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </>
          }
        />
      )}
    </Modal>
  );
}

/* --------------------------------------------------------- Theme Manager */

function ThemeManager() {
  const { data: themes = [] } = useThemes();
  const { data: tasks = [] } = useTasks();
  const { data: goals = [] } = useGoals();
  const mut = useThemeMut();
  const deleteTheme = useDeleteTheme();
  const { toast } = useToast();

  const [openAdd, setOpenAdd] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);

  const [editing, setEditing] = useState<Row | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(SWATCHES[0]);

  const [deleting, setDeleting] = useState<Row | null>(null);
  const [reassignId, setReassignId] = useState("");

  const startEdit = (t: Row) => {
    setDeleting(null);
    setOpenAdd(false);
    setEditing(t);
    setEditName(String(t.name));
    setEditColor(String(t.color || SWATCHES[0]));
  };

  const requestDelete = (t: Row) => {
    setEditing(null);
    const id = Number(t.id);
    const usedByTasks = tasks.filter((x) => Number(x.theme_id) === id).length;
    const usedByGoals = goals.filter((x) => Number(x.theme_id) === id).length;
    if (usedByTasks === 0 && usedByGoals === 0) {
      deleteTheme.mutate({ id, reassignToId: null });
      return;
    }
    const others = themes.filter((x) => Number(x.id) !== id);
    setDeleting(t);
    setReassignId(others[0] ? String(others[0].id) : "");
  };

  const addTheme = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await mut.insert.mutateAsync({ name: trimmed, color });
    toast({ type: "success", title: `Added theme "${trimmed}"` });
    setName("");
    setOpenAdd(false);
  };

  const saveEdit = async () => {
    const trimmed = editName.trim();
    if (!editing || !trimmed) return;
    await mut.update.mutateAsync({
      id: Number(editing.id),
      row: { name: trimmed, color: editColor },
    });
    toast({ type: "success", title: "Theme updated" });
    setEditing(null);
  };

  const confirmDeleteTheme = async () => {
    if (!deleting) return;
    await deleteTheme.mutateAsync({
      id: Number(deleting.id),
      reassignToId: reassignId ? Number(reassignId) : null,
    });
    setDeleting(null);
  };

  const othersForDelete = deleting
    ? themes.filter((t) => Number(t.id) !== Number(deleting.id))
    : [];

  return (
    <Card>
      <div className="card-head plain">
        <Icon name="palette" size={18} className="icon-muted" />
        <span className="card-title">Themes</span>
        <span className="spacer" />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setEditing(null);
            setDeleting(null);
            setOpenAdd((o) => !o);
          }}
        >
          <Icon name="plus" size={14} /> Add theme
        </Button>
      </div>
      <div className="card-body tight">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {themes.map((t) => (
            <span key={t.id} className="theme-pill-group">
              <ThemeChip themeId={Number(t.id)} themes={themes} />
              <Button
                variant="ghost"
                size="sm"
                className="icon-btn"
                aria-label={`Edit ${String(t.name)}`}
                onClick={() => startEdit(t)}
              >
                <Icon name="edit" size={12} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="icon-btn"
                aria-label={`Delete ${String(t.name)}`}
                onClick={() => requestDelete(t)}
              >
                <Icon name="x" size={13} />
              </Button>
            </span>
          ))}
          {themes.length === 0 && (
            <span className="field-hint">Every task needs a theme. Add one to start planning.</span>
          )}
        </div>

        {openAdd && (
          <form
            className="theme-editor-row"
            onSubmit={(e) => {
              e.preventDefault();
              addTheme();
            }}
          >
            <div style={{ width: 220, maxWidth: "100%" }}>
              <Input
                placeholder="Theme name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="swatch-row">
              {SWATCHES.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`swatch ${s === color ? "active" : ""}`}
                  style={{ background: s }}
                  aria-label={`Colour ${s}`}
                  onClick={() => setColor(s)}
                />
              ))}
            </div>
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            <Button
              size="sm"
              variant="primary"
              type="button"
              disabled={!name.trim() || mut.insert.isPending}
              onClick={addTheme}
            >
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpenAdd(false)}>
              Cancel
            </Button>
          </form>
        )}

        {editing && (
          <form
            className="theme-editor-row"
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
          >
            <span className="field-label">Edit:</span>
            <div style={{ width: 200, maxWidth: "100%" }}>
              <Input
                placeholder="Theme name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="swatch-row">
              {SWATCHES.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`swatch ${s === editColor ? "active" : ""}`}
                  style={{ background: s }}
                  aria-label={`Colour ${s}`}
                  onClick={() => setEditColor(s)}
                />
              ))}
            </div>
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            <Button
              size="sm"
              variant="primary"
              type="button"
              disabled={!editName.trim() || mut.update.isPending}
              onClick={saveEdit}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </form>
        )}

        {deleting && (
          <div style={{ marginTop: 12 }}>
            <Alert
              type="warning"
              variant="soft"
              title={`Reassign items before deleting "${String(deleting.name)}"`}
              description={
                othersForDelete.length > 0
                  ? "Existing tasks and goals using this theme will move to the replacement theme below."
                  : "Add another theme first so existing tasks and goals have a theme to move to."
              }
              actions={
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {othersForDelete.length > 0 && (
                    <div style={{ width: 200 }}>
                      <SelectField
                        value={reassignId}
                        onChange={setReassignId}
                        ariaLabel="Replacement theme"
                        options={othersForDelete.map((t) => ({
                          value: String(t.id),
                          label: String(t.name),
                        }))}
                      />
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!reassignId}
                    onClick={confirmDeleteTheme}
                  >
                    Reassign & delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                    Cancel
                  </Button>
                </div>
              }
            />
          </div>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- Goals Page */

const HORIZON_HINT: Record<string, string> = {
  tomorrow: "Plan the night before — tasks land on Tomorrow automatically",
  week: "Monday to Sunday — click + on any day to add a task",
  month: "Full month view — click any day to add or edit tasks",
  year: "Your goals and progress across the horizon",
};

const WEEKDAYS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function GoalsPage({ tab }: { tab?: string }) {
  const { data: goals = [] } = useGoals();
  const { data: tasks = [] } = useTasks();
  const { data: themes = [] } = useThemes();
  const { data: entries = [] } = useTimeEntries();
  const { data: money = [] } = useMoney();
  const taskMut = useTaskMut();
  const navigate = useNavigate();
  const { openAi } = useAiDrawer();

  const [showGoal, setShowGoal] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const [active, setActive] = useState(tab ?? "tomorrow");
  const [weekOffset, setWeekOffset] = useState(0);
  const [calMonth, setCalMonth] = useState(currentMonth());
  const [monthMode, setMonthMode] = useState<"calendar" | "agenda">("calendar");
  const [yearFilter, setYearFilter] = useState<"all" | "active" | "done">("all");
  const tomorrowInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (tab && ["tomorrow", "week", "month", "year"].includes(tab)) {
      setActive(tab);
    }
  }, [tab]);

  const switchTab = (next: string) => {
    setActive(next);
    navigate({ to: "/goals", search: { tab: next }, replace: true });
  };

  const today = todayLocal();
  const tomorrow = addDays(today, 1);
  const detail = detailId ? goals.find((g) => Number(g.id) === detailId) ?? null : null;
  const dated = (from: string, to: string) =>
    tasks.filter((t) => String(t.planned_date) >= from && String(t.planned_date) <= to);

  const GroupedTasks = ({ list }: { list: Row[] }) => {
    const groups = [
      ...goals.map((g) => ({
        goal: g,
        items: list.filter((t) => Number(t.goal_id) === Number(g.id)),
      })),
      {
        goal: null,
        items: list.filter(
          (t) => !t.goal_id || !goals.some((g) => Number(g.id) === Number(t.goal_id)),
        ),
      },
    ].filter((g) => g.items.length > 0);
    if (!groups.length) {
      return (
        <div className="empty empty-soft">
          <Icon name="calendarPlus" size={22} />
          <div className="empty-title">Nothing planned</div>
          <div>Plan the night before so tomorrow starts itself.</div>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {groups.map(({ goal, items }) => (
          <div key={goal ? String(goal.id) : "unaligned"}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              {goal ? (
                <>
                  <Icon name="target" size={16} className="icon-muted" />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{String(goal.title)}</span>
                  <ThemeChip themeId={goal.theme_id as number | null} themes={themes} />
                </>
              ) : (
                <>
                  <Icon name="alert" size={15} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Unaligned</span>
                  <span className="field-hint">No goal — still counted in Reports.</span>
                </>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                {items.length} {items.length === 1 ? "task" : "tasks"}
              </span>
            </div>
            <Card>
              <div className="card-body tight">
                {items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    themes={themes}
                    goals={goals}
                    entries={entries}
                    onEdit={setEditing}
                  />
                ))}
              </div>
            </Card>
          </div>
        ))}
      </div>
    );
  };

  /* Week planner: true Monday-to-Sunday with Prev/This/Next and per-day quick add */
  const weekStart = addDays(mondayOf(today), weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const renderWeek = () => (
    <>
      <div className="planner-subhead">
        <div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            {fmtDateShort(weekDays[0])} – {fmtDateShort(weekDays[6])}
          </span>
          <span className="field-hint" style={{ marginLeft: 10 }}>
            {HORIZON_HINT.week}
          </span>
        </div>
        <div className="period-picker">
          <Button
            variant="ghost"
            size="sm"
            className="icon-btn"
            aria-label="Previous week"
            onClick={() => setWeekOffset((w) => w - 1)}
          >
            <Icon name="chevronLeft" size={16} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
            This week
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="icon-btn"
            aria-label="Next week"
            onClick={() => setWeekOffset((w) => w + 1)}
          >
            <Icon name="chevronRight" size={16} />
          </Button>
        </div>
      </div>

      <ScrollArea className="week-scroll" pan>
        <div className="week-grid">
          {weekDays.map((d, idx) => {
            const list = tasks.filter((t) => String(t.planned_date) === d);
            const isToday = d === today;
            return (
              <div className={`day-col${isToday ? " day-col--today" : ""}`} key={d} data-date={d}>
                <div className="day-head">
                  <span className="day-name">
                    {WEEKDAYS_MON[idx]}{" "}
                    <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}>
                      {fmtDateShort(d)}
                    </span>
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {isToday && <span className="today-dot" title="Today" />}
                    <span className="day-speck">{list.length}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="icon-btn"
                      aria-label={`Add task on ${d}`}
                      onClick={() => setQuickAddDate(d)}
                    >
                      <Icon name="plus" size={14} />
                    </Button>
                  </div>
                </div>
                <div className="day-tasks">
                  {list.length === 0 && <div className="day-empty">Nothing planned</div>}
                  {list.map((t) => {
                    const done = t.status === "done";
                    const g = goals.find((x) => Number(x.id) === Number(t.goal_id));
                    return (
                      <div key={t.id} className="day-task">
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <Checkbox
                            checked={done}
                            label={done ? "Mark not done" : "Mark done"}
                            onChange={() =>
                              taskMut.update.mutate({
                                id: Number(t.id),
                                row: { status: done ? "planned" : "done" },
                              })
                            }
                          />
                          <button
                            type="button"
                            className="day-task-btn"
                            onClick={() => setEditing(t)}
                          >
                            <span
                              className="item-title"
                              style={{
                                textDecoration: done ? "line-through" : "none",
                                color: done ? "var(--muted-foreground)" : undefined,
                              }}
                            >
                              {String(t.title)}
                            </span>
                          </button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <ThemeChip themeId={t.theme_id as number | null} themes={themes} />
                          <span className="text">{g ? String(g.title) : "No goal"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );

  /* Month planner: full Monday-first calendar grid + agenda toggle */
  const renderMonth = () => {
    const [y, m] = calMonth.split("-").map(Number);
    const firstOfMonth = `${calMonth}-01`;
    const gridStart = mondayOf(firstOfMonth);
    const lastDayNum = new Date(y, m, 0).getDate();
    const lastOfMonth = `${calMonth}-${String(lastDayNum).padStart(2, "0")}`;
    const totalCells = (() => {
      const startDate = new Date(gridStart + "T12:00:00");
      const endDate = new Date(lastOfMonth + "T12:00:00");
      const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
      return Math.ceil(diff / 7) * 7;
    })();
    const cells = Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i));
    const agendaDays = Array.from({ length: lastDayNum }, (_, i) =>
      `${calMonth}-${String(i + 1).padStart(2, "0")}`,
    ).filter((d) => tasks.some((t) => String(t.planned_date) === d));

    return (
      <>
        <div className="planner-subhead">
          <div>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{fmtMonth(firstOfMonth)}</span>
            <span className="field-hint" style={{ marginLeft: 10 }}>
              {HORIZON_HINT.month}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <SegmentedControl
              aria-label="Month layout"
              value={monthMode}
              onValueChange={(v) => setMonthMode(v as "calendar" | "agenda")}
              options={[
                { value: "calendar", label: "Calendar" },
                { value: "agenda", label: "Agenda" },
              ]}
            />
            <div className="period-picker">
              <Button
                variant="ghost"
                size="sm"
                className="icon-btn"
                aria-label="Previous month"
                onClick={() => setCalMonth(shiftMonth(calMonth, -1))}
              >
                <Icon name="chevronLeft" size={16} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCalMonth(currentMonth())}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="icon-btn"
                aria-label="Next month"
                onClick={() => setCalMonth(shiftMonth(calMonth, 1))}
              >
                <Icon name="chevronRight" size={16} />
              </Button>
            </div>
          </div>
        </div>

        {monthMode === "calendar" ? (
          <div className="cal-grid">
            {WEEKDAYS_MON.map((w) => (
              <div className="cal-weekday" key={w}>
                {w}
              </div>
            ))}
            {cells.map((d) => {
              const inMonth = d.startsWith(calMonth);
              const isToday = d === today;
              const dayTasks = tasks.filter((t) => String(t.planned_date) === d);
              return (
                <div
                  key={d}
                  className={`cal-cell${inMonth ? "" : " cal-cell--out"}${isToday ? " cal-cell--today" : ""}`}
                >
                  <div className="cal-cell-head">
                    <span className="cal-day-num">{Number(d.slice(8, 10))}</span>
                    <button
                      type="button"
                      className="cal-add-btn"
                      aria-label={`Add task on ${d}`}
                      onClick={() => setQuickAddDate(d)}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                  </div>
                  <div className="cal-tasks">
                    {dayTasks.slice(0, 3).map((t) => {
                      const th = themes.find((x) => Number(x.id) === Number(t.theme_id));
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`cal-task-pill${t.status === "done" ? " is-done" : ""}`}
                          onClick={() => setEditing(t)}
                          title={String(t.title)}
                        >
                          <span
                            className="cal-task-dot"
                            style={{ background: String(th?.color || "var(--primary)") }}
                          />
                          <span>{String(t.title)}</span>
                        </button>
                      );
                    })}
                    {dayTasks.length > 3 && (
                      <span className="cal-more">+{dayTasks.length - 3} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : agendaDays.length === 0 ? (
          <GroupedTasks list={[]} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
            {agendaDays.map((d) => {
              const dayTasks = tasks.filter((t) => String(t.planned_date) === d);
              return (
                <div className="day-col" key={d} style={{ minWidth: 0 }}>
                  <div className="day-head">
                    <span className="day-name">{fmtDateShort(d)}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span className="day-speck">{dayTasks.length}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="icon-btn"
                        aria-label={`Add task on ${d}`}
                        onClick={() => setQuickAddDate(d)}
                      >
                        <Icon name="plus" size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="day-tasks">
                    {dayTasks.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="day-task day-task-btn"
                        onClick={() => setEditing(t)}
                      >
                        <span
                          className="item-title"
                          style={{ textDecoration: t.status === "done" ? "line-through" : "none" }}
                        >
                          {String(t.title)}
                        </span>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <ThemeChip themeId={t.theme_id as number | null} themes={themes} />
                          <span className="text">
                            {goals.find((g) => Number(g.id) === Number(t.goal_id))?.title
                              ? String(goals.find((g) => Number(g.id) === Number(t.goal_id))?.title)
                              : "No goal"}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  const filteredYearGoals = goals.filter((g) => {
    if (yearFilter === "active") return g.status !== "done";
    if (yearFilter === "done") return g.status === "done";
    return true;
  });

  return (
    <section className="page">
      <PageHead
        title="Goals & planning"
        subtitle={
          active === "year"
            ? `Goals across ${today.slice(0, 4)} — click any goal to edit or break down`
            : "Decide here, execute on Today"
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                openAi({
                  prompt:
                    "Review my active goals and suggest missing milestones or concrete tasks for the next 7 days.",
                  autoSend: true,
                })
              }
            >
              <Icon name="sparkles" size={15} /> AI coach
            </Button>
            <Button variant="primary" onClick={() => setShowGoal(true)}>
              <Icon name="plus" size={16} /> New goal
            </Button>
          </>
        }
      />

      {goals.length > 0 ? (
        <div style={{ padding: "20px 32px 0" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Goals</span>
            <span style={{ marginLeft: 10, fontSize: 13, color: "var(--muted-foreground)" }}>
              {goals.length}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              Click any goal to edit, add tasks, or break down with AI
            </span>
          </div>
          <div className="goal-grid">
            {goals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                tasks={tasks}
                entries={entries}
                themes={themes}
                money={money}
                onOpen={() => setDetailId(Number(g.id))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: "20px 32px 0" }}>
          <Card>
            <div className="empty" style={{ padding: "32px 24px" }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 999,
                  background: "var(--muted)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Icon name="target" size={22} />
              </div>
              <div className="empty-title" style={{ fontSize: 16 }}>
                No goals yet
              </div>
              <div style={{ maxWidth: 420, lineHeight: 1.5 }}>
                A goal is a horizon you commit to — a month of building, a year of running. Add one,
                then plan the tasks that move it.
              </div>
              <Button variant="primary" onClick={() => setShowGoal(true)}>
                <Icon name="plus" size={16} /> Create your first goal
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div style={{ padding: "16px 32px 0" }}>
        <Card>
          <div className="card-head plain" style={{ paddingTop: 20 }}>
            <span className="card-title">Planner</span>
            <span className="spacer" />
            <Button
              variant="primary"
              onClick={() => {
                switchTab("tomorrow");
                setTimeout(() => tomorrowInputRef.current?.focus(), 60);
              }}
            >
              <Icon name="calendarPlus" size={16} /> Plan tomorrow
            </Button>
          </div>
          <div style={{ padding: "16px 24px 24px" }}>
            <TabsWrap.Tabs value={active} onValueChange={switchTab} variant="pill" className="tabs">
              <TabsWrap.TabList aria-label="Planning horizon">
                <TabsWrap.Tab value="tomorrow">Tomorrow</TabsWrap.Tab>
                <TabsWrap.Tab value="week">Week</TabsWrap.Tab>
                <TabsWrap.Tab value="month">Month</TabsWrap.Tab>
                <TabsWrap.Tab value="year">Year</TabsWrap.Tab>
              </TabsWrap.TabList>
            </TabsWrap.Tabs>

            <div id="planner-body" style={{ marginTop: 20 }}>
              {active === "tomorrow" && (
                <>
                  <div className="planner-subhead">
                    <div>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>
                        {fmtDateLong(tomorrow).replace(/, \d{4}$/, "")}
                      </span>
                      <span className="field-hint" style={{ marginLeft: 10 }}>
                        {HORIZON_HINT.tomorrow}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          openAi({
                            prompt: `Help me plan tomorrow (${tomorrow}) based on my active goals and remaining unfinished tasks.`,
                            autoSend: true,
                          })
                        }
                      >
                        <Icon name="sparkles" size={14} /> Suggest plan
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => tomorrowInputRef.current?.focus()}
                      >
                        <Icon name="plus" size={14} /> Focus input
                      </Button>
                    </div>
                  </div>
                  <QuickTask compact plannedDate={tomorrow} inputRef={tomorrowInputRef} />
                  <div style={{ marginTop: 14 }}>
                    <GroupedTasks list={dated(tomorrow, tomorrow)} />
                  </div>
                </>
              )}

              {active === "week" && renderWeek()}
              {active === "month" && renderMonth()}

              {active === "year" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="planner-subhead" style={{ marginBottom: 4 }}>
                    <span className="field-hint">{HORIZON_HINT.year}</span>
                    <SegmentedControl
                      aria-label="Filter goals"
                      value={yearFilter}
                      onValueChange={(v) => setYearFilter(v as "all" | "active" | "done")}
                      options={[
                        { value: "all", label: "All" },
                        { value: "active", label: "In progress" },
                        { value: "done", label: "Completed" },
                      ]}
                    />
                  </div>
                  {filteredYearGoals.map((g) => {
                    const linked = tasks.filter((t) => Number(t.goal_id) === Number(g.id));
                    const done = linked.filter((t) => t.status === "done").length;
                    const pct = linked.length
                      ? Math.round((done / linked.length) * 100)
                      : g.status === "done"
                        ? 100
                        : 0;
                    return (
                      <button
                        type="button"
                        className="year-row year-row-btn"
                        key={g.id}
                        onClick={() => setDetailId(Number(g.id))}
                      >
                        <Icon
                          name="target"
                          size={18}
                          className="icon-muted"
                          style={{ color: "var(--muted-foreground)" }}
                        />
                        <span className="year-title" style={{ flex: 1 }}>
                          {String(g.title)}
                        </span>
                        <ThemeChip themeId={g.theme_id as number | null} themes={themes} />
                        <span
                          style={{
                            fontSize: 13,
                            color: "var(--muted-foreground)",
                            textTransform: "capitalize",
                            width: 60,
                          }}
                        >
                          {String(g.horizon)}
                        </span>
                        <span className="year-due">
                          {g.deadline ? `Due ${fmtDateShort(String(g.deadline))}` : "No deadline"}
                        </span>
                        <div className="year-progress">
                          <Progress value={pct} success={g.status === "done"} />
                        </div>
                        <span style={{ fontSize: 12, color: "var(--muted-foreground)", width: 42, textAlign: "right" }}>
                          {done}/{linked.length}
                        </span>
                      </button>
                    );
                  })}
                  {filteredYearGoals.length === 0 && (
                    <div className="empty empty-soft">
                      <Icon name="target" size={22} />
                      <div className="empty-title">No goals match this filter</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div style={{ padding: "16px 32px 0" }}>
        <ThemeManager />
      </div>

      {showGoal && <GoalForm onClose={() => setShowGoal(false)} />}
      {editing && <TaskEdit task={editing} onClose={() => setEditing(null)} />}
      {detail && (
        <GoalDetail
          goal={detail}
          tasks={tasks}
          entries={entries}
          themes={themes}
          money={money}
          onClose={() => setDetailId(null)}
          onEditTask={setEditing}
        />
      )}
      {quickAddDate && (
        <Modal
          title={`Plan for ${fmtDateLong(quickAddDate)}`}
          label="Quick add"
          onClose={() => setQuickAddDate(null)}
        >
          <QuickTask
            compact
            plannedDate={quickAddDate}
            onDone={() => setQuickAddDate(null)}
          />
        </Modal>
      )}
    </section>
  );
}
