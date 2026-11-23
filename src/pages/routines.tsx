import { useMemo, useState } from "react";
import { SegmentedControl, useToast } from "@halo-ds/react";
import { addDays, localDayOfIso, mondayOf, todayLocal, type Row } from "../lib/api";
import {
  useAiDrawer,
  useRoutineLogs,
  useRoutineMut,
  useRoutines,
  useToggleRoutineLog,
} from "../lib/hooks";
import {
  Button,
  Card,
  Checkbox,
  Field,
  Icon,
  Input,
  Modal,
  PageHead,
  SelectField,
} from "../components/ui";

const SWATCHES = ["#5749F4", "#2D9D78", "#E58A45", "#A16CE0", "#D9534F", "#3B82F6", "#EAB308"];

const TIME_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  anytime: "Anytime",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function createdDay(routine: Row) {
  const raw = String(routine.created_at ?? "");
  if (!raw) return "";
  return raw.length === 10 ? raw : localDayOfIso(raw);
}

function levelFor(pct: number, done: number, total: number) {
  if (!total) return 0;
  if (pct >= 100) return 4;
  if (pct >= 67) return 3;
  if (pct >= 34) return 2;
  if (done > 0) return 1;
  return 0;
}

function monthLabel(day: string) {
  return new Date(day + "T12:00:00").toLocaleDateString(undefined, { month: "short" });
}

function fmtDay(day: string) {
  return new Date(day + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function RoutinesPage() {
  const { data: routines = [] } = useRoutines();
  const { data: logs = [] } = useRoutineLogs();
  const routineMut = useRoutineMut();
  const toggle = useToggleRoutineLog();
  const { openAi } = useAiDrawer();
  const { toast } = useToast();

  const today = todayLocal();
  const [view, setView] = useState<"year" | "month">("year");
  const [habitId, setHabitId] = useState<number | "all">("all");
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const sorted = useMemo(
    () =>
      [...routines].sort(
        (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || Number(a.id) - Number(b.id),
      ),
    [routines],
  );
  const activeRoutines = sorted.filter((r) => Number(r.active) === 1);
  const archivedRoutines = sorted.filter((r) => Number(r.active) !== 1);

  const logIndex = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const log of logs) {
      const date = String(log.date ?? "");
      const set = map.get(date) ?? new Set<number>();
      set.add(Number(log.routine_id));
      map.set(date, set);
    }
    return map;
  }, [logs]);

  const isDone = (routineId: number, date: string) =>
    logIndex.get(date)?.has(routineId) ?? false;

  const routinesForDay = (date: string) =>
    sorted.filter(
      (r) =>
        createdDay(r) <= date &&
        (Number(r.active) === 1 || isDone(Number(r.id), date)),
    );

  const dayStats = (date: string) => {
    const list = routinesForDay(date);
    const done = list.filter((r) => isDone(Number(r.id), date)).length;
    return {
      total: list.length,
      done,
      pct: list.length ? Math.round((done / list.length) * 100) : 0,
    };
  };

  const todayStats = dayStats(today);
  const last30 = useMemo(() => {
    let done = 0;
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const stats = dayStats(addDays(today, -i));
      done += stats.done;
      total += stats.total;
    }
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [today, sorted, logIndex]);

  const currentStreak = useMemo(() => {
    let streak = 0;
    let cursor = today;
    const startToday = dayStats(today);
    if (startToday.total > 0 && startToday.pct < 100) cursor = addDays(today, -1);
    for (let i = 0; i < 400; i++) {
      const stats = dayStats(cursor);
      if (stats.total === 0) break;
      if (stats.pct < 100) break;
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }, [today, sorted, logIndex]);

  const bestStreak = useMemo(() => {
    let best = 0;
    let run = 0;
    for (let i = 400; i >= 0; i--) {
      const stats = dayStats(addDays(today, -i));
      if (stats.total > 0 && stats.pct === 100) {
        run++;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    return best;
  }, [today, sorted, logIndex]);

  const routineStats = (routine: Row) => {
    const id = Number(routine.id);
    const created = createdDay(routine);
    let streak = 0;
    let cursor = today;
    if (!isDone(id, today)) cursor = addDays(today, -1);
    for (let i = 0; i < 400; i++) {
      if (cursor < created) break;
      if (!isDone(id, cursor)) break;
      streak++;
      cursor = addDays(cursor, -1);
    }
    let done = 0;
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const day = addDays(today, -i);
      if (day < created) continue;
      if (Number(routine.active) !== 1 && !isDone(id, day)) continue;
      total++;
      if (isDone(id, day)) done++;
    }
    return { streak, done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  };

  const filteredHabit = habitId === "all" ? null : sorted.find((r) => Number(r.id) === habitId);

  const cellFor = (date: string) => {
    if (date > today) return { level: 0, label: "", stats: { total: 0, done: 0, pct: 0 } };
    if (filteredHabit) {
      const id = Number(filteredHabit.id);
      const created = createdDay(filteredHabit);
      const exists = date >= created && (Number(filteredHabit.active) === 1 || isDone(id, date));
      const done = isDone(id, date);
      return {
        level: exists && done ? 4 : 0,
        label: exists ? `${done ? "Done" : "Missed"} · ${fmtDay(date)}` : `${fmtDay(date)} · no habit yet`,
        stats: { total: exists ? 1 : 0, done: done ? 1 : 0, pct: exists && done ? 100 : 0 },
      };
    }
    const stats = dayStats(date);
    return {
      level: levelFor(stats.pct, stats.done, stats.total),
      label: stats.total
        ? `${fmtDay(date)} · ${stats.done}/${stats.total} (${stats.pct}%)`
        : `${fmtDay(date)} · no non-negotiables`,
      stats,
    };
  };

  const yearColumns = useMemo(() => {
    const lastMonday = mondayOf(today);
    const start = addDays(lastMonday, -51 * 7);
    return Array.from({ length: 52 }, (_, week) =>
      Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
    );
  }, [today]);

  const monthGrid = useMemo(() => {
    const first = `${month}-01`;
    const days: (string | null)[] = [];
    const [y, m] = month.split("-").map(Number);
    const total = new Date(y, m, 0).getDate();
    const offset = (new Date(first + "T12:00:00").getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) days.push(null);
    for (let d = 1; d <= total; d++) days.push(`${month}-${String(d).padStart(2, "0")}`);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [month]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const move = async (routine: Row, delta: number) => {
    const ordered = [...activeRoutines];
    const index = ordered.findIndex((r) => Number(r.id) === Number(routine.id));
    const targetIndex = index + delta;
    const target = ordered[targetIndex];
    if (!target) return;
    let a = Number(routine.sort_order ?? index);
    let b = Number(target.sort_order ?? targetIndex);
    if (a === b) {
      // Normalize sequential sort_order when two items share the same value
      ordered.splice(index, 1);
      ordered.splice(targetIndex, 0, routine);
      await Promise.all(
        ordered.map((item, idx) =>
          routineMut.update.mutateAsync({ id: Number(item.id), row: { sort_order: idx } }),
        ),
      );
      return;
    }
    await routineMut.update.mutateAsync({ id: Number(routine.id), row: { sort_order: b } });
    await routineMut.update.mutateAsync({ id: Number(target.id), row: { sort_order: a } });
  };

  const archive = async (routine: Row) => {
    await routineMut.update.mutateAsync({ id: Number(routine.id), row: { active: 0 } });
    toast({ type: "success", title: `Archived "${String(routine.title)}"`, description: "Past check-ins stay in the heatmap." });
  };

  const restore = async (routine: Row) => {
    await routineMut.update.mutateAsync({ id: Number(routine.id), row: { active: 1 } });
    toast({ type: "success", title: `Restored "${String(routine.title)}"` });
  };

  const remove = async (routine: Row) => {
    await routineMut.remove.mutateAsync(Number(routine.id));
    toast({ type: "success", title: `Deleted "${String(routine.title)}"` });
  };

  const inspectStats = inspecting ? dayStats(inspecting) : null;

  return (
    <section className="page">
      <PageHead
        title="Routines"
        subtitle="Daily non-negotiables, streaks and long-run consistency"
        stats={[
          { label: "Today", value: `${todayStats.done} / ${todayStats.total}` },
          { label: "Current streak", value: `${currentStreak}d` },
          { label: "Best streak", value: `${bestStreak}d` },
          { label: "30-day consistency", value: `${last30.pct}%` },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                openAi({
                  prompt:
                    "Audit my daily non-negotiables and their recent check-ins. Which habits are slipping, what patterns do you see, and what concrete change would protect my streaks?",
                  extraContext: `Today: ${todayStats.done}/${todayStats.total} non-negotiables. Current streak ${currentStreak} days, best ${bestStreak}, 30-day consistency ${last30.pct}%.`,
                  autoSend: true,
                })
              }
            >
              <Icon name="sparkles" size={14} /> Ask AI
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> New non-negotiable
            </Button>
          </>
        }
      />

      <div className="routines-body">
        <Card className="routine-heatmap-card">
        <div className="card-head">
          <span className="card-title">Consistency</span>
          <span className="spacer" />
          <SegmentedControl
            aria-label="Heatmap view"
            value={view}
            onValueChange={(v) => setView(v as "year" | "month")}
            options={[
              { value: "year", label: "Year" },
              { value: "month", label: "Monthly" },
            ]}
          />
        </div>

        <div className="card-body pad">
          <div className="habit-filter-pills">
            <button
              type="button"
              className={`filter-pill${habitId === "all" ? " active" : ""}`}
              onClick={() => setHabitId("all")}
            >
              All non-negotiables
            </button>
            {sorted.map((routine) => (
              <button
                key={routine.id}
                type="button"
                className={`filter-pill${habitId === Number(routine.id) ? " active" : ""}`}
                onClick={() => setHabitId(Number(routine.id))}
              >
                <span className="filter-dot" style={{ background: String(routine.color) }} />
                {String(routine.title)}
                {Number(routine.active) !== 1 && <span className="field-hint"> (archived)</span>}
              </button>
            ))}
          </div>

          {filteredHabit && (
            <div className="habit-summary">
              <strong>{String(filteredHabit.title)}</strong>
              <span className="field-hint">
                {routineStats(filteredHabit).streak}d streak · {routineStats(filteredHabit).pct}% over
                30 days
              </span>
            </div>
          )}

          {view === "year" ? (
            <div className="heatmap-year">
              <div className="heatmap-months">
                {yearColumns.map((week, i) => {
                  const first = week.find(Boolean) as string;
                  const prev = i > 0 ? (yearColumns[i - 1].find(Boolean) as string) : null;
                  const show = !prev || monthLabel(prev) !== monthLabel(first);
                  return (
                    <span key={i} className="heatmap-month-label">
                      {show ? monthLabel(first) : ""}
                    </span>
                  );
                })}
              </div>
              <div className="heatmap-body">
                <div className="heatmap-day-labels">
                  {DAY_LABELS.map((d, i) => (
                    <span key={d} className="heatmap-day-label">
                      {i % 2 === 0 ? d : ""}
                    </span>
                  ))}
                </div>
                <div className="heatmap-grid">
                  {yearColumns.map((week, w) =>
                    week.map((date, d) => {
                      const cell = cellFor(date);
                      const future = date > today;
                      return (
                        <button
                          key={`${w}-${d}`}
                          type="button"
                          className={`heatmap-cell level-${cell.level}${future ? " is-future" : ""}`}
                          style={{
                            gridColumn: w + 1,
                            gridRow: d + 1,
                            ["--habit-color" as string]:
                              filteredHabit && cell.level > 0 ? String(filteredHabit.color) : undefined,
                          }}
                          title={cell.label}
                          aria-label={cell.label}
                          disabled={future}
                          onClick={() => setInspecting(date)}
                        />
                      );
                    }),
                  )}
                </div>
              </div>
              <div className="heatmap-legend">
                <span>Less</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <span key={level} className={`heatmap-cell level-${level}`} />
                ))}
                <span>More</span>
              </div>
            </div>
          ) : (
            <div className="heatmap-month-view">
              <div className="heatmap-month-head">
                <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                  <Icon name="chevronLeft" size={15} />
                </Button>
                <strong>
                  {new Date(month + "-01T12:00:00").toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </strong>
                <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shiftMonth(1)}>
                  <Icon name="chevronRight" size={15} />
                </Button>
              </div>
              <div className="heatmap-month-grid">
                {DAY_LABELS.map((d) => (
                  <span key={d} className="heatmap-day-label">
                    {d}
                  </span>
                ))}
                {monthGrid.map((date, i) => {
                  if (!date) return <span key={`blank-${i}`} />;
                  const cell = cellFor(date);
                  return (
                    <button
                      key={date}
                      type="button"
                      className={`heatmap-month-cell level-${cell.level}${date > today ? " is-future" : ""}`}
                      style={{
                        ["--habit-color" as string]:
                          filteredHabit && cell.level > 0 ? String(filteredHabit.color) : undefined,
                      }}
                      title={cell.label}
                      aria-label={cell.label}
                      disabled={date > today}
                      onClick={() => setInspecting(date)}
                    >
                      <span>{Number(date.slice(8))}</span>
                      <span className="heatmap-month-ratio">
                        {cell.stats.total ? `${cell.stats.done}/${cell.stats.total}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="routine-manager-card">
        <div className="card-head">
          <span className="card-title">Non-negotiables</span>
          <span className="count">{activeRoutines.length}</span>
          <span className="spacer" />
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> Add
          </Button>
        </div>
        <div className="card-body tight">
          {activeRoutines.length === 0 && (
            <div className="empty empty-soft">
              <Icon name="repeat" size={22} />
              <div className="empty-title">No non-negotiables yet</div>
              <div>Add 2–4 daily habits you want to protect no matter what.</div>
            </div>
          )}
          {activeRoutines.map((routine, index) => {
            const stats = routineStats(routine);
            return (
              <div className="routine-row" key={routine.id}>
                <button
                  type="button"
                  className="routine-check"
                  aria-label={`Toggle ${String(routine.title)} for today`}
                  onClick={() =>
                    toggle.mutate({ routineId: Number(routine.id), date: today })
                  }
                >
                  <span
                    className={`routine-dot${isDone(Number(routine.id), today) ? " is-done" : ""}`}
                    style={{ background: String(routine.color) }}
                  >
                    {isDone(Number(routine.id), today) && <Icon name="check" size={12} />}
                  </span>
                </button>
                <div className="routine-copy">
                  <strong>{String(routine.title)}</strong>
                  <span className="field-hint">
                    {TIME_LABELS[String(routine.time_of_day)] ?? "Anytime"} · {stats.streak}d streak ·{" "}
                    {stats.pct}% / 30d
                  </span>
                </div>
                <div className="routine-row-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => void move(routine, -1)}
                  >
                    <Icon name="arrowUp" size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={index === activeRoutines.length - 1}
                    onClick={() => void move(routine, 1)}
                  >
                    <Icon name="arrowDown" size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(routine)}>
                    <Icon name="edit" size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Archive" onClick={() => void archive(routine)}>
                    <Icon name="folder" size={13} />
                  </Button>
                </div>
              </div>
            );
          })}

          {archivedRoutines.length > 0 && (
            <div className="routine-archived">
              <button
                type="button"
                className="routine-archived-toggle"
                onClick={() => setShowArchived((v) => !v)}
              >
                <Icon name={showArchived ? "chevronLeft" : "chevronRight"} size={13} />
                Archived ({archivedRoutines.length})
              </button>
              {showArchived &&
                archivedRoutines.map((routine) => (
                  <div className="routine-row is-archived" key={routine.id}>
                    <span className="routine-dot" style={{ background: String(routine.color) }} />
                    <div className="routine-copy">
                      <strong>{String(routine.title)}</strong>
                      <span className="field-hint">Archived · history preserved</span>
                    </div>
                    <div className="routine-row-actions">
                      <Button size="sm" variant="secondary" onClick={() => void restore(routine)}>
                        Restore
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete permanently"
                        onClick={() => void remove(routine)}
                      >
                        <Icon name="trash" size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Card>
      </div>

      {inspecting && (
        <Modal
          title={fmtDay(inspecting)}
          label="Day inspector"
          onClose={() => setInspecting(null)}
          footer={
            <>
              <span className="field-hint">
                {inspectStats?.done ?? 0} / {inspectStats?.total ?? 0} completed
              </span>
              <span className="spacer" />
              <Button variant="primary" onClick={() => setInspecting(null)}>
                Done
              </Button>
            </>
          }
        >
          <div className="routine-today-list">
            {routinesForDay(inspecting).map((routine) => (
              <label className="routine-today-item" key={routine.id}>
                <Checkbox
                  checked={isDone(Number(routine.id), inspecting)}
                  onChange={() =>
                    toggle.mutate({ routineId: Number(routine.id), date: inspecting })
                  }
                  label={String(routine.title)}
                />
                <span
                  className={`routine-today-title${isDone(Number(routine.id), inspecting) ? " is-done" : ""}`}
                >
                  {String(routine.title)}
                </span>
                <span className="chip chip-neutral">
                  {TIME_LABELS[String(routine.time_of_day)] ?? "Anytime"}
                </span>
              </label>
            ))}
            {inspectStats?.total === 0 && (
              <div className="field-hint">No non-negotiables existed on this date.</div>
            )}
          </div>
        </Modal>
      )}

      {(creating || editing) && (
        <RoutineForm
          routine={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function RoutineForm({ routine, onClose }: { routine: Row | null; onClose: () => void }) {
  const routineMut = useRoutineMut();
  const { toast } = useToast();
  const [title, setTitle] = useState(routine ? String(routine.title) : "");
  const [timeOfDay, setTimeOfDay] = useState(
    routine ? String(routine.time_of_day ?? "anytime") : "anytime",
  );
  const [color, setColor] = useState(routine ? String(routine.color ?? SWATCHES[0]) : SWATCHES[0]);
  const [error, setError] = useState("");

  const save = async () => {
    if (!title.trim()) return setError("Give this non-negotiable a name.");
    try {
      if (routine) {
        await routineMut.update.mutateAsync({
          id: Number(routine.id),
          row: { title: title.trim(), time_of_day: timeOfDay, color },
        });
        toast({ type: "success", title: "Non-negotiable updated" });
      } else {
        await routineMut.insert.mutateAsync({
          title: title.trim(),
          time_of_day: timeOfDay,
          color,
          sort_order: Date.now(),
          active: 1,
          created_at: new Date().toISOString(),
        });
        toast({ type: "success", title: "Non-negotiable added" });
      }
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Modal
      title={routine ? "Edit non-negotiable" : "New non-negotiable"}
      label="Daily routine"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {routine ? "Save changes" : "Add non-negotiable"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Morning walk, Read 20 minutes…"
            autoFocus
          />
        </Field>
        <Field label="Time of day">
          <SelectField
            value={timeOfDay}
            onChange={setTimeOfDay}
            ariaLabel="Time of day"
            options={[
              { value: "morning", label: "Morning" },
              { value: "afternoon", label: "Afternoon" },
              { value: "evening", label: "Evening" },
              { value: "anytime", label: "Anytime" },
            ]}
          />
        </Field>
        <Field label="Colour">
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
        </Field>
        {error && <div className="field-error">{error}</div>}
      </div>
    </Modal>
  );
}
