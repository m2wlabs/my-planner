import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { SegmentedControl, useToast } from "@halo-ds/react";
import { localDayOfIso, mondayOf, todayLocal, type Row } from "../lib/api";
import {
  captureWeeklySnapshot,
  useAiDrawer,
  useCurrency,
  useGoals,
  useMoney,
  useMoneyMut,
  useRoutineLogs,
  useRoutines,
  useSettings,
  useTasks,
  useThemes,
  useTimeEntries,
  useWeeklyReports,
} from "../lib/hooks";
import {
  Alert,
  Button,
  Card,
  DateField,
  Field,
  Icon,
  Input,
  Modal,
  Money,
  PageHead,
  Progress,
  SelectField,
  Textarea,
  ThemeChip,
  currentMonth,
  entryMinutes,
  fmtDateShort,
  fmtHours,
  fmtMonth,
  localDay,
  shiftMonth,
} from "../components/ui";

function monthEntries(entries: Row[], month: string) {
  return entries.filter((e) => String(e.date).startsWith(month));
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------- Money Edit */

function MoneyEdit({
  entry,
  goals,
  tasks,
  onClose,
}: {
  entry: Row;
  goals: Row[];
  tasks: Row[];
  onClose: () => void;
}) {
  const { code, digits, display, toBase } = useCurrency();
  const mut = useMoneyMut();
  const { toast } = useToast();

  const initialDisplay = display(Number(entry.amount_minor));
  const [amount, setAmount] = useState(
    digits > 0 ? initialDisplay.toFixed(digits) : String(Math.round(initialDisplay)),
  );
  const [direction, setDirection] = useState(String(entry.direction || "out"));
  const [category, setCategory] = useState(String(entry.category || ""));
  const [note, setNote] = useState(String(entry.note ?? ""));
  const [date, setDate] = useState(String(entry.date || todayLocal()));
  const [link, setLink] = useState(
    entry.goal_id ? `goal:${entry.goal_id}` : entry.task_id ? `task:${entry.task_id}` : "",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const linkOptions = [
    { value: "", label: "No link" },
    ...goals.map((g) => ({ value: `goal:${g.id}`, label: `Goal · ${String(g.title)}` })),
    ...tasks.slice(-40).map((t) => ({ value: `task:${t.id}`, label: `Task · ${String(t.title)}` })),
  ];

  const save = async () => {
    setError("");
    const parsed = parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    const minor = toBase(parsed);
    if (minor <= 0) {
      setError("Amount is too small to record.");
      return;
    }
    if (!category.trim()) {
      setError("Category is required.");
      return;
    }
    const [kind, id] = link ? link.split(":") : ["", ""];
    await mut.update.mutateAsync({
      id: Number(entry.id),
      row: {
        amount_minor: minor,
        direction,
        category: category.trim(),
        note: note.trim(),
        date: date || todayLocal(),
        task_id: kind === "task" ? Number(id) : null,
        goal_id: kind === "goal" ? Number(id) : null,
      },
    });
    toast({ type: "success", title: "Entry updated" });
    onClose();
  };

  const remove = async () => {
    await mut.remove.mutateAsync(Number(entry.id));
    toast({ type: "success", title: "Entry deleted" });
    onClose();
  };

  return (
    <Modal
      title="Edit money entry"
      label="Money"
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={14} /> Delete
          </Button>
          <span className="spacer" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="modal-scroll-inner"
      >
        <div className="modal-grid">
          <Field label={`Amount (${code})`}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Direction">
            <SegmentedControl
              aria-label="Money direction"
              value={direction}
              onValueChange={setDirection}
              options={[
                { value: "in", label: "Money in" },
                { value: "out", label: "Money out" },
              ]}
            />
          </Field>
        </div>

        <div className="modal-grid">
          <Field label="Category">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Date">
            <DateField value={date} onChange={setDate} ariaLabel="Date" />
          </Field>
        </div>

        <Field label="Linked goal or task">
          <SelectField value={link} onChange={setLink} options={linkOptions} ariaLabel="Link" />
        </Field>

        <Field label="Note">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional merchant, memo, or details…"
          />
        </Field>

        {error && <span className="field-error">{error}</span>}

        {confirmDelete && (
          <Alert
            type="warning"
            variant="soft"
            title="Delete this money entry?"
            description="This permanently removes it from your ledger and reports."
            actions={
              <>
                <Button size="sm" variant="danger" onClick={remove}>
                  Delete entry
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </>
            }
          />
        )}
      </form>
    </Modal>
  );
}

/* ----------------------------------------------------------- Money Page */

export function MoneyPage() {
  const { data: entries = [] } = useMoney();
  const { data: settings = {} } = useSettings();
  const { data: goals = [] } = useGoals();
  const { data: tasks = [] } = useTasks();
  const { code, digits, display, toBase } = useCurrency();
  const mut = useMoneyMut();
  const { openAi } = useAiDrawer();
  const { toast } = useToast();

  const [month, setMonth] = useState(currentMonth());
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("out");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [link, setLink] = useState("");
  const [formError, setFormError] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [filterDir, setFilterDir] = useState<"all" | "in" | "out">("all");
  const [search, setSearch] = useState("");

  // Keep entry date aligned with the viewed month so new entries appear immediately.
  useEffect(() => {
    const today = todayLocal();
    if (month === currentMonth()) {
      setDate(today);
    } else if (!date.startsWith(month)) {
      setDate(`${month}-01`);
    }
  }, [month]);

  const rows = monthEntries(entries, month);
  const filteredRows = rows.filter((e) => {
    if (filterDir !== "all" && e.direction !== filterDir) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const catHit = String(e.category).toLowerCase().includes(q);
      const noteHit = String(e.note ?? "").toLowerCase().includes(q);
      if (!catHit && !noteHit) return false;
    }
    return true;
  });

  const inTotal = rows
    .filter((e) => e.direction === "in")
    .reduce((s, e) => s + Number(e.amount_minor), 0);
  const outTotal = rows
    .filter((e) => e.direction === "out")
    .reduce((s, e) => s + Number(e.amount_minor), 0);
  const left = inTotal - outTotal;
  const kept = inTotal > 0 ? Math.max(0, (left / inTotal) * 100) : 0;
  const keptLabel = kept === 0 ? "0" : kept % 1 === 0 ? String(kept) : kept.toFixed(1);
  const inDisplay = rows
    .filter((e) => e.direction === "in")
    .reduce((s, e) => s + display(Number(e.amount_minor)), 0);
  const outDisplay = rows
    .filter((e) => e.direction === "out")
    .reduce((s, e) => s + display(Number(e.amount_minor)), 0);
  const leftDisplay = inDisplay - outDisplay;
  const keptAsAmount = settings.kept_display === "amount";

  const taskById = new Map(tasks.map((t) => [Number(t.id), t]));
  const goalById = new Map(goals.map((g) => [Number(g.id), g]));

  const resolveGoalId = (e: Row): number | null => {
    if (e.goal_id) return Number(e.goal_id);
    if (e.task_id) {
      const t = taskById.get(Number(e.task_id));
      if (t?.goal_id) return Number(t.goal_id);
    }
    return null;
  };

  const byCat = [
    ...rows
      .filter((e) => e.direction === "out")
      .reduce((m, e) => {
        const k = String(e.category);
        m.set(k, (m.get(k) ?? 0) + Number(e.amount_minor));
        return m;
      }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);
  const maxCat = byCat[0]?.[1] ?? 1;

  const byGoal = [
    ...rows.reduce((m, e) => {
      const gid = resolveGoalId(e);
      const key = gid ? String(goalById.get(gid)?.title ?? "Goal") : "No goal";
      const cur = m.get(key) ?? { in: 0, out: 0 };
      if (e.direction === "in") cur.in += Number(e.amount_minor);
      else cur.out += Number(e.amount_minor);
      m.set(key, cur);
      return m;
    }, new Map<string, { in: number; out: number }>()),
  ].sort((a, b) => b[1].out - a[1].out);

  // Recent distinct categories for quick one-click chips.
  const recentCategories = Array.from(
    new Set([
      ...entries.slice().reverse().map((e) => String(e.category)),
      ...(direction === "in" ? ["Salary", "Freelance", "Refund"] : ["Food", "Groceries", "Transport", "Software", "Rent"]),
    ]),
  ).slice(0, 6);

  const linkOptions = [
    { value: "", label: "No link" },
    ...goals.map((g) => ({ value: `goal:${g.id}`, label: `Goal · ${String(g.title)}` })),
    ...tasks.slice(-30).map((t) => ({ value: `task:${t.id}`, label: `Task · ${String(t.title)}` })),
  ];

  const add = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    setFormError("");
    const parsed = parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError("Enter a positive amount.");
      return;
    }
    const minor = toBase(parsed);
    if (minor <= 0) {
      setFormError("Amount is too small to record.");
      return;
    }
    if (!category.trim()) {
      setFormError("Category is required.");
      return;
    }
    const [kind, id] = link ? link.split(":") : ["", ""];
    const entryDate = date || todayLocal();
    await mut.insert.mutateAsync({
      amount_minor: minor,
      direction,
      category: category.trim(),
      note: note.trim(),
      date: entryDate,
      task_id: kind === "task" ? Number(id) : null,
      goal_id: kind === "goal" ? Number(id) : null,
    });
    setAmount("");
    setCategory("");
    setNote("");
    setLink("");
    if (!entryDate.startsWith(month)) {
      toast({
        type: "information",
        title: "Entry added",
        description: `Logged under ${fmtMonth(entryDate.slice(0, 7) + "-01")}.`,
      });
    } else {
      toast({ type: "success", title: "Money entry logged" });
    }
  };

  const exportCsv = () => {
    const header = ["Date", "Direction", "Category", `Amount (${code})`, "Goal", "Note"];
    const csvRows = [...rows]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((e) => {
        const gid = resolveGoalId(e);
        const goalTitle = gid ? String(goalById.get(gid)?.title ?? "") : "";
        const amt = display(Number(e.amount_minor)).toFixed(digits);
        return [
          String(e.date),
          String(e.direction),
          String(e.category),
          e.direction === "out" ? `-${amt}` : amt,
          goalTitle,
          String(e.note ?? ""),
        ]
          .map((cell) => `"${cell.replace(/"/g, '""')}"`)
          .join(",");
      });
    downloadFile(`my-planner-money-${month}.csv`, [header.join(","), ...csvRows].join("\n"), "text/csv;charset=utf-8");
    toast({ type: "success", title: `Exported ${rows.length} entries to CSV` });
  };

  const goalsTouched = new Set(rows.map(resolveGoalId).filter(Boolean).map(String)).size;

  return (
    <section className="page">
      <PageHead
        title={fmtMonth(month + "-01")}
        subtitle={`${rows.length} ${rows.length === 1 ? "entry" : "entries"} · ${goalsTouched} ${goalsTouched === 1 ? "goal" : "goals"} touched`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                openAi({
                  prompt: `Analyze my income and spending for ${fmtMonth(month + "-01")} and suggest 3 practical improvements.`,
                  extraContext: `Money month: ${month}, in: ${inDisplay} ${code}, out: ${outDisplay} ${code}, kept: ${keptLabel}%`,
                  autoSend: true,
                })
              }
            >
              <Icon name="sparkles" size={14} /> AI insights
            </Button>
            {rows.length > 0 && (
              <Button variant="secondary" size="sm" onClick={exportCsv}>
                <Icon name="download" size={14} /> CSV
              </Button>
            )}
            <div className="month-picker">
              <Button
                variant="ghost"
                size="sm"
                className="icon-btn"
                aria-label="Previous month"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <Icon name="chevronLeft" size={16} />
              </Button>
              <span className="label">{fmtMonth(month + "-01")}</span>
              <Button
                variant="ghost"
                size="sm"
                className="icon-btn"
                aria-label="Next month"
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <Icon name="chevronRight" size={16} />
              </Button>
            </div>
          </>
        }
      />

      <div className="command" style={{ paddingTop: 18 }}>
        <Card className="money-form-card">
          <form className="money-form" onSubmit={add}>
            <div className="field amount">
              <span className="field-label">Amount ({code})</span>
              <Input
                inputMode="decimal"
                placeholder={digits ? `0.${"0".repeat(digits)}` : "0"}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setFormError("");
                }}
              />
            </div>
            <div className="field">
              <span className="field-label">Type</span>
              <SegmentedControl
                aria-label="Money direction"
                value={direction}
                onValueChange={setDirection}
                options={[
                  { value: "in", label: "In" },
                  { value: "out", label: "Out" },
                ]}
                className="direction-seg"
              />
            </div>
            <div className="field desc">
              <span className="field-label">Category</span>
              <Input
                placeholder="Food, Salary…"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setFormError("");
                }}
              />
            </div>
            <div className="field goal">
              <span className="field-label">Goal / Task</span>
              <SelectField
                value={link}
                onChange={setLink}
                ariaLabel="Goal or task"
                options={linkOptions}
              />
            </div>
            <div className="field date">
              <span className="field-label">Date</span>
              <DateField value={date} onChange={setDate} ariaLabel="Date" />
            </div>
            <Button
              variant="primary"
              type="submit"
              disabled={!amount.trim() || !category.trim() || mut.insert.isPending}
              style={{ marginBottom: 0 }}
            >
              <Icon name="plus" size={16} /> Add
            </Button>
          </form>
          <div className="money-form-extra">
            <div style={{ flex: "1 1 220px", maxWidth: 360 }}>
              <Input
                placeholder="Optional note (merchant, details…)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="money-quick-cats">
              {recentCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`time-chip${category === cat ? " active" : ""}`}
                  onClick={() => setCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            {formError && <span className="field-error">{formError}</span>}
          </div>
        </Card>
      </div>

      <div className="strip-wrap">
        <div className="strip strip-3">
          <div className="strip-cell">
            <span className="stat-label">Money in</span>
            <div className="strip-value pos">
              <Money amount={inDisplay} />
            </div>
          </div>
          <div className="strip-cell">
            <span className="stat-label">Money out</span>
            <div className="strip-value neg">
              <Money amount={outDisplay} />
            </div>
          </div>
          <div className="strip-cell">
            <span className="stat-label">{keptAsAmount ? "Net kept" : "Kept"}</span>
            <div className={`strip-value${leftDisplay < 0 ? " neg" : leftDisplay > 0 ? " pos" : ""}`}>
              {keptAsAmount ? (
                <Money amount={leftDisplay} />
              ) : (
                `${keptLabel}%`
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="body-grid">
        <div className="ledger">
          <Card>
            <div className="card-head" style={{ flexWrap: "wrap", gap: 10 }}>
              <span className="card-title" style={{ textTransform: "none", letterSpacing: 0, fontSize: 15 }}>
                Entries
              </span>
              <span className="count">{filteredRows.length}</span>
              <span className="spacer" />
              <div style={{ width: 180 }}>
                <Input
                  placeholder="Search entries…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <SegmentedControl
                aria-label="Filter direction"
                value={filterDir}
                onValueChange={(v) => setFilterDir(v as "all" | "in" | "out")}
                options={[
                  { value: "all", label: "All" },
                  { value: "in", label: "In" },
                  { value: "out", label: "Out" },
                ]}
              />
            </div>
            <div className="card-body tight">
              {filteredRows.length === 0 && (
                <div className="empty">
                  <Icon name="wallet" size={22} />
                  <div className="empty-title">
                    {rows.length === 0 ? "No money logged this month" : "No matching entries"}
                  </div>
                  <div>
                    {rows.length === 0
                      ? "Add an entry above — it stays on this device."
                      : "Try clearing your search or direction filter."}
                  </div>
                </div>
              )}
              {[...filteredRows]
                .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id))
                .map((e) => {
                  const gid = resolveGoalId(e);
                  const goal = gid ? goalById.get(gid) : undefined;
                  const linkedTask = e.task_id ? taskById.get(Number(e.task_id)) : undefined;
                  return (
                    <div className="money-row" key={e.id}>
                      <span className="money-date">{fmtDateShort(String(e.date))}</span>
                      <button
                        type="button"
                        className="item-main money-main"
                        onClick={() => setEditing(e)}
                      >
                        <span className="item-title">{String(e.category)}</span>
                        {e.note && String(e.note).trim() && (
                          <span className="money-note">{String(e.note)}</span>
                        )}
                        <span className="item-meta">
                          <span className="chip chip-neutral">
                            {e.direction === "in" ? "Money in" : "Money out"}
                          </span>
                          <span className="text">
                            {goal
                              ? String(goal.title)
                              : linkedTask
                                ? String(linkedTask.title)
                                : "No goal"}
                          </span>
                        </span>
                      </button>
                      <div>
                        <div className={`money-amount ${e.direction === "in" ? "pos" : "neg"}`}>
                          <Money amount={display(Number(e.amount_minor))} />
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="icon-btn"
                        aria-label="Edit entry"
                        onClick={() => setEditing(e)}
                      >
                        <Icon name="edit" size={14} />
                      </Button>
                    </div>
                  );
                })}
            </div>
          </Card>
        </div>

        <div className="rail">
          <Card>
            <div className="card-head plain">
              <Icon name="pie" size={18} className="icon-muted" />
              <span className="card-title">Spending by category</span>
            </div>
            <div className="card-body tight">
              {byCat.length === 0 && <div className="field-hint">No spending this month.</div>}
              {byCat.map(([name, value]) => (
                <div className="cat-bar-row" key={name}>
                  <span className="name" title={name}>
                    {name}
                  </span>
                  <span className="bar">
                    <span style={{ width: `${Math.round((value / maxCat) * 100)}%` }} />
                  </span>
                  <span className="num neg">
                    <Money minor={value} />
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="card-head plain">
              <Icon name="folder" size={18} className="icon-muted" />
              <span className="card-title">By goal</span>
            </div>
            <div className="card-body tight">
              {byGoal.length === 0 && (
                <div className="field-hint">Link an entry to a goal to see it here.</div>
              )}
              {byGoal.map(([name, v]) => (
                <div key={name} style={{ padding: "8px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{name}</span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: v.in - v.out >= 0 ? "#1f7a1f" : "var(--destructive)",
                      }}
                    >
                      <Money minor={Math.abs(v.in - v.out)} />
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
                    <Money minor={v.in} /> in · <Money minor={v.out} /> out
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {editing && (
        <MoneyEdit
          entry={editing}
          goals={goals}
          tasks={tasks}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- reports */

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function bounds(mode: "week" | "month", offset: number) {
  const now = new Date();
  if (mode === "week") {
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - ((now.getDay() + 6) % 7) + offset * 7,
    );
    const end = new Date(monday);
    end.setDate(monday.getDate() + 6);
    const prev = new Date(monday);
    prev.setDate(monday.getDate() - 7);
    const prevEnd = new Date(prev);
    prevEnd.setDate(prev.getDate() + 6);
    return {
      start: iso(monday),
      end: iso(end),
      prevStart: iso(prev),
      prevEnd: iso(prevEnd),
    };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
  return {
    start: iso(start),
    end: iso(end),
    prevStart: iso(prev),
    prevEnd: iso(prevEnd),
  };
}

const rangeLabel = (mode: "week" | "month", start: string, end: string) =>
  mode === "week"
    ? `${fmtDateShort(start)} – ${fmtDateShort(end)}, ${end.slice(0, 4)}`
    : new Date(start + "T12:00:00").toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });

const inRange = (d: string, a: string, b: string) => d >= a && d <= b;

function SnapshotModal({ report, onClose }: { report: Row; onClose: () => void }) {
  let snap: { tasks?: Row[]; entries?: Row[]; money?: Row[]; at?: string } = {};
  try {
    snap = JSON.parse(String(report.snapshot_json));
  } catch {
    /* ignore */
  }
  const snapTasks = snap.tasks ?? [];
  const snapEntries = snap.entries ?? [];
  const snapMoney = snap.money ?? [];
  const doneCount = snapTasks.filter((t) => t.status === "done").length;
  const totalMins = snapEntries.reduce((s, e) => s + entryMinutes(e), 0);
  const inMinor = snapMoney
    .filter((m) => m.direction === "in")
    .reduce((s, m) => s + Number(m.amount_minor), 0);
  const outMinor = snapMoney
    .filter((m) => m.direction === "out")
    .reduce((s, m) => s + Number(m.amount_minor), 0);

  return (
    <Modal
      title={`Week of ${fmtDateShort(String(report.week_start))}`}
      label="Saved weekly snapshot"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {snap.at && (
        <div className="field-hint">
          Captured {new Date(snap.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </div>
      )}
      <div className="strip strip-3" style={{ borderRadius: 16, border: "1px solid var(--border)" }}>
        <div className="strip-cell" style={{ padding: "12px 16px" }}>
          <span className="stat-label">Tasks</span>
          <div className="strip-value" style={{ fontSize: 20 }}>
            {doneCount}/{snapTasks.length}
          </div>
        </div>
        <div className="strip-cell" style={{ padding: "12px 16px" }}>
          <span className="stat-label">Time</span>
          <div className="strip-value" style={{ fontSize: 20 }}>
            {fmtHours(totalMins)}
          </div>
        </div>
        <div className="strip-cell" style={{ padding: "12px 16px" }}>
          <span className="stat-label">Net</span>
          <div className={`strip-value ${inMinor - outMinor >= 0 ? "pos" : "neg"}`} style={{ fontSize: 20 }}>
            <Money minor={Math.abs(inMinor - outMinor)} />
          </div>
        </div>
      </div>

      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          Tasks in snapshot ({snapTasks.length})
        </div>
        {snapTasks.length === 0 && <div className="field-hint">No tasks recorded in this week.</div>}
        {snapTasks.slice(0, 20).map((t) => (
          <div className="snapshot" key={t.id}>
            <span className="meta">
              {String(t.title)} · {fmtDateShort(String(t.planned_date))}
            </span>
            <span className={`chip ${t.status === "done" ? "chip-success" : "chip-neutral"}`}>
              {t.status === "done" ? "Done" : "Planned"}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function ReportsPage() {
  const { display } = useCurrency();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { openAi } = useAiDrawer();

  const [mode, setMode] = useState<"week" | "month">("week");
  const [offset, setOffset] = useState(0);
  const [savingSnap, setSavingSnap] = useState(false);
  const [inspecting, setInspecting] = useState<Row | null>(null);

  const { data: tasks = [] } = useTasks();
  const { data: entries = [] } = useTimeEntries();
  const { data: moneyRows = [] } = useMoney();
  const { data: goals = [] } = useGoals();
  const { data: themes = [] } = useThemes();
  const { data: reports = [] } = useWeeklyReports();
  const { start, end, prevStart, prevEnd } = bounds(mode, offset);

  const current = tasks.filter((t) => inRange(String(t.planned_date), start, end));
  const done = current.filter((t) => t.status === "done").length;
  const taskById = new Map(tasks.map((t) => [Number(t.id), t]));

  // Use local day consistently with TodayPage, and include running entries cleanly.
  const entriesIn = (a: string, b: string) =>
    entries.filter((e) => inRange(localDay(String(e.start_utc)), a, b));
  const curEntries = entriesIn(start, end);
  const prevEntries = entriesIn(prevStart, prevEnd);
  const totalMins = curEntries.reduce((s, e) => s + entryMinutes(e), 0);
  const prevMins = prevEntries.reduce((s, e) => s + entryMinutes(e), 0);
  const monthStart = new Date(start + "T12:00:00");
  const days =
    mode === "week" ? 7 : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const deltaMins = totalMins - prevMins;

  const moneyIn = (a: string, b: string) =>
    moneyRows
      .filter((e) => e.direction === "in" && inRange(String(e.date), a, b))
      .reduce((s, e) => s + Number(e.amount_minor), 0);
  const moneyOut = (a: string, b: string) =>
    moneyRows
      .filter((e) => e.direction === "out" && inRange(String(e.date), a, b))
      .reduce((s, e) => s + Number(e.amount_minor), 0);
  const curIn = moneyIn(start, end);
  const curOut = moneyOut(start, end);
  const prevIn = moneyIn(prevStart, prevEnd);
  const prevOut = moneyOut(prevStart, prevEnd);
  const curRows = moneyRows.filter((e) => inRange(String(e.date), start, end));

  const themeForTask = (t?: Row) => themes.find((th) => Number(th.id) === Number(t?.theme_id));
  const themeName = (t?: Row) => (t ? String(themeForTask(t)?.name ?? "Unaligned") : "Unaligned");

  const timeByTheme = [
    ...curEntries.reduce((m, e) => {
      const k = themeName(taskById.get(Number(e.task_id)));
      m.set(k, (m.get(k) ?? 0) + entryMinutes(e));
      return m;
    }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);

  const moneyByTheme = [
    ...curRows
      .filter((e) => e.direction === "out")
      .reduce((m, e) => {
        const t = e.task_id ? taskById.get(Number(e.task_id)) : undefined;
        const goal = e.goal_id ? goals.find((g) => Number(g.id) === Number(e.goal_id)) : undefined;
        const th = themeForTask(t) ?? themes.find((x) => Number(x.id) === Number(goal?.theme_id));
        const k = th ? String(th.name) : "Unaligned";
        m.set(k, (m.get(k) ?? 0) + Number(e.amount_minor));
        return m;
      }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);

  const totalSpend = moneyByTheme.reduce((s, [, v]) => s + v, 0);
  const unalignedTime = timeByTheme.find(([k]) => k === "Unaligned")?.[1] ?? 0;
  const unalignedMoney = moneyByTheme.find(([k]) => k === "Unaligned")?.[1] ?? 0;
  const splitLabels = [
    ...themes.map((t) => String(t.name)),
    ...(unalignedTime > 0 || unalignedMoney > 0 ? ["Unaligned"] : []),
  ];
  const splitColor = (label: string) => {
    if (label === "Unaligned") return "#e59a5a";
    return String(themes.find((t) => String(t.name) === label)?.color ?? "var(--primary)");
  };

  const byGoal = [
    ...curEntries.reduce((m, e) => {
      const t = taskById.get(Number(e.task_id));
      const k = t?.goal_id
        ? String(goals.find((g) => Number(g.id) === Number(t.goal_id))?.title ?? "No goal")
        : "No goal";
      m.set(k, (m.get(k) ?? 0) + entryMinutes(e));
      return m;
    }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);

  const spendByGoal = [
    ...curRows
      .filter((e) => e.direction === "out")
      .reduce((m, e) => {
        const t = e.task_id ? taskById.get(Number(e.task_id)) : undefined;
        const gid = e.goal_id ?? t?.goal_id;
        const k = gid
          ? String(goals.find((g) => Number(g.id) === Number(gid))?.title ?? "No goal")
          : "No goal";
        m.set(k, (m.get(k) ?? 0) + Number(e.amount_minor));
        return m;
      }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);

  const buckets =
    mode === "week"
      ? Array.from({ length: 7 }, (_, i) => {
          const d = new Date(start + "T12:00:00");
          d.setDate(d.getDate() + i);
          const day = iso(d);
          const list = tasks.filter((t) => String(t.planned_date) === day);
          return {
            label: d.toLocaleDateString(undefined, { weekday: "short" }),
            planned: list.length,
            done: list.filter((t) => t.status === "done").length,
          };
        })
      : Array.from({ length: Math.ceil(days / 7) }, (_, i) => {
          const from = new Date(start + "T12:00:00");
          from.setDate(from.getDate() + i * 7);
          const to = new Date(from);
          to.setDate(from.getDate() + 6);
          const clampedTo = iso(to) > end ? end : iso(to);
          const list = tasks.filter((t) => inRange(String(t.planned_date), iso(from), clampedTo));
          return {
            label: `W${i + 1}`,
            planned: list.length,
            done: list.filter((t) => t.status === "done").length,
          };
        });
  const maxBucket = Math.max(1, ...buckets.map((b) => b.planned));

  // Show newest weekly snapshots first.
  const pastWeeks = [...reports]
    .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)))
    .slice(0, 8);

  const saveSnapshotNow = async () => {
    setSavingSnap(true);
    try {
      const targetWeek = mode === "week" ? start : mondayOf(todayLocal());
      await captureWeeklySnapshot(targetWeek);
      await qc.invalidateQueries({ queryKey: ["weekly_reports"] });
      toast({ type: "success", title: `Saved snapshot for week of ${fmtDateShort(targetWeek)}` });
    } catch (e) {
      toast({ type: "error", title: "Could not save snapshot", description: String(e) });
    } finally {
      setSavingSnap(false);
    }
  };

  return (
    <section className="page">
      <div className="report-head">
        <div>
          <h1 className="page-title">{rangeLabel(mode, start, end)}</h1>
          <div className="page-sub">
            {mode === "week" ? "Weekly" : "Monthly"} report · {done} of {current.length} tasks done
          </div>
        </div>
        <div className="controls" style={{ flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              openAi({
                prompt: `Give me an honest ${mode}ly review for ${rangeLabel(mode, start, end)}. Highlight wins, where time & money went, unaligned work, and 3 concrete priorities for next ${mode}.`,
                extraContext: `Period: ${start} to ${end}. Tasks done: ${done}/${current.length}. Time tracked: ${fmtHours(totalMins)} (${deltaMins >= 0 ? "+" : "-"}${fmtHours(Math.abs(deltaMins))} vs last ${mode}). Money in minor: ${curIn}, out minor: ${curOut}.`,
                autoSend: true,
              })
            }
          >
            <Icon name="sparkles" size={14} /> AI Review
          </Button>
          <Button variant="secondary" size="sm" disabled={savingSnap} onClick={saveSnapshotNow}>
            <Icon name="download" size={14} /> {savingSnap ? "Saving…" : "Save snapshot"}
          </Button>
          <SegmentedControl
            aria-label="Report period"
            value={mode}
            onValueChange={(v) => {
              setMode(v as "week" | "month");
              setOffset(0);
            }}
            options={[
              { value: "week", label: "Weekly" },
              { value: "month", label: "Monthly" },
            ]}
          />
          <div className="period-picker">
            <Button
              variant="ghost"
              size="sm"
              className="icon-btn"
              aria-label="Previous period"
              onClick={() => setOffset((o) => o - 1)}
            >
              <Icon name="chevronLeft" size={16} />
            </Button>
            <span className="label">{rangeLabel(mode, start, end)}</span>
            <Button
              variant="ghost"
              size="sm"
              className="icon-btn"
              aria-label="Next period"
              onClick={() => setOffset((o) => o + 1)}
              disabled={offset >= 0}
            >
              <Icon name="chevronRight" size={16} />
            </Button>
          </div>
        </div>
      </div>

      <div className="section-label">
        Time worked
        <span
          className={`chip ${deltaMins >= 0 ? "chip-success" : "chip-error"}`}
          style={{ marginLeft: 10, textTransform: "none", letterSpacing: 0 }}
        >
          {deltaMins >= 0 ? "+" : "−"}
          {fmtHours(Math.abs(deltaMins))} vs last {mode}
        </span>
      </div>
      <div className="hero-time">
        <span className="value">{fmtHours(totalMins)}</span>
      </div>
      <div className="report-track">
        <Progress value={Math.min(100, (totalMins / (days * 8 * 60)) * 100)} />
      </div>
      <div className="report-note">
        {fmtHours(totalMins / days)}/day avg · {goals.length} goals · {themes.length} themes
      </div>

      <div className="strip-wrap">
        <div className="strip">
          <div className="strip-cell">
            <span className="stat-label">Tasks done</span>
            <div className="strip-value">
              {done}/{current.length}
            </div>
            <div className="field-hint">{current.length - done} still open</div>
          </div>
          <div className="strip-cell">
            <span className="stat-label">Money in</span>
            <div className="strip-value pos">
              <Money amount={display(curIn)} />
            </div>
            <div className="field-hint">
              <Money amount={display(Math.abs(curIn - prevIn))} /> vs last {mode}
            </div>
          </div>
          <div className="strip-cell">
            <span className="stat-label">Money out</span>
            <div className="strip-value neg">
              <Money amount={display(curOut)} />
            </div>
            <div className="field-hint">
              {prevOut ? (
                <>
                  <Money amount={display(prevOut)} /> last {mode}
                </>
              ) : (
                "Nothing last period"
              )}
            </div>
          </div>
          <div className="strip-cell">
            <span className="stat-label">Left</span>
            <div
              className={`strip-value${display(curIn) - display(curOut) < 0 ? " neg" : ""}`}
            >
              <Money amount={display(curIn) - display(curOut)} />
            </div>
            <div className="field-hint">
              <Money amount={display(Math.abs(curIn - curOut - (prevIn - prevOut)))} /> vs last{" "}
              {mode}
            </div>
          </div>
        </div>
      </div>

      <div className="report-body">
        <div className="report-main">
          <RoutineConsistency start={start} end={end} />

          <Card>
            <div className="card-head plain">
              <Icon name="target" size={18} className="icon-muted" />
              <span className="card-title">Goal progress</span>
            </div>
            <div className="card-body tight">
              {goals.length === 0 && <div className="field-hint">No goals yet.</div>}
              {goals.map((g) => {
                const linked = tasks.filter((t) => Number(t.goal_id) === Number(g.id));
                const gDone = linked.filter((t) => t.status === "done").length;
                const gMins = linked.reduce(
                  (s, t) =>
                    s +
                    curEntries
                      .filter((e) => Number(e.task_id) === Number(t.id))
                      .reduce((x, e) => x + entryMinutes(e), 0),
                  0,
                );
                const pct = linked.length
                  ? Math.round((gDone / linked.length) * 100)
                  : g.status === "done"
                    ? 100
                    : 0;
                return (
                  <div className="goal-progress-row" key={g.id}>
                    <div className="goal-progress-name">
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{String(g.title)}</span>
                      <ThemeChip themeId={g.theme_id as number | null} themes={themes} />
                    </div>
                    <div className="goal-progress-track">
                      <Progress value={pct} success={g.status === "done"} />
                    </div>
                    <span className="goal-progress-fig">
                      {gDone}/{linked.length} · {gMins ? fmtHours(gMins) : "0m"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="card-head plain">
              <Icon name="clock" size={18} className="icon-muted" />
              <span className="card-title">Where your time and money went</span>
              <span className="spacer" />
              <span className="stat-label">This {mode}</span>
            </div>
            <div className="card-body pad">
              {splitLabels.length === 0 ? (
                <div className="field-hint">Add themes to see your time and spending breakdown.</div>
              ) : (
                <div className="split-table">
                  <div>
                    <div className="split-col-head">
                      <span>Time</span>
                      <span />
                    </div>
                    {splitLabels.map((label) => {
                      const row = timeByTheme.find(([k]) => k === label);
                      const mins = row?.[1] ?? 0;
                      const pct = totalMins ? Math.round((mins / totalMins) * 100) : 0;
                      return (
                        <div
                          className={`split-row ${label === "Unaligned" && mins > 0 ? "unaligned" : ""}`}
                          key={label}
                        >
                          <span className="name" title={label}>
                            {label}
                          </span>
                          <span className="bar">
                            <span style={{ width: `${pct}%`, background: splitColor(label) }} />
                          </span>
                          <span className="pct">{pct}%</span>
                          <span className="fig">{mins ? fmtHours(mins) : "0m"}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <div className="split-col-head">
                      <span>Money</span>
                      <span />
                    </div>
                    {splitLabels.map((label) => {
                      const row = moneyByTheme.find(([k]) => k === label);
                      const val = row?.[1] ?? 0;
                      const pct = totalSpend ? Math.round((val / totalSpend) * 100) : 0;
                      return (
                        <div
                          className={`split-row ${label === "Unaligned" && val > 0 ? "unaligned" : ""}`}
                          key={label}
                        >
                          <span className="name" title={label}>
                            {label}
                          </span>
                          <span className="bar">
                            <span
                              style={{
                                width: `${pct}%`,
                                background: label === "Unaligned" ? "#7a6f66" : splitColor(label),
                              }}
                            />
                          </span>
                          <span className="pct">{pct}%</span>
                          <span className="fig">{val ? <Money minor={val} /> : "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {(unalignedTime > 0 || unalignedMoney > 0) && (
                <Alert
                  className="inline-alert"
                  type="warning"
                  variant="soft"
                  title="Unaligned work or spending"
                  description="Link spending entries to a goal or task so your theme split stays honest."
                />
              )}
            </div>
          </Card>

          <Card>
            <div className="card-head plain">
              <span className="card-title">Completed vs planned</span>
              <span className="spacer" />
              <span className="legend">
                <i /> Done
              </span>
              <span className="legend" style={{ marginLeft: 8 }}>
                <i className="grey" /> Planned
              </span>
            </div>
            <div className="card-body pad">
              <div className="bars">
                {buckets.map((b) => (
                  <div
                    className="bar-day"
                    key={b.label}
                    title={`${b.label}: ${b.done} done / ${b.planned} planned`}
                  >
                    <div className="bar-pair">
                      <span
                        className="done"
                        style={{ height: `${Math.round((b.done / maxBucket) * 120)}px` }}
                      />
                      <span style={{ height: `${Math.round((b.planned / maxBucket) * 120)}px` }} />
                    </div>
                    <span className="bar-day-label">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div className="card-head plain">
              <span className="card-title">Time by goal</span>
              <span className="spacer" />
              <span className="field-hint">{fmtHours(totalMins)}</span>
            </div>
            <div className="card-body tight">
              {byGoal.length === 0 && (
                <div className="field-hint">No time tracked in this period.</div>
              )}
              {byGoal.map(([name, mins]) => (
                <div className="cat-bar-row" key={name}>
                  <span className="name" style={{ width: 130 }} title={name}>
                    {name}
                  </span>
                  <span className="bar">
                    <span
                      style={{
                        width: `${Math.round((mins / Math.max(1, byGoal[0][1])) * 100)}%`,
                        background: "var(--primary)",
                      }}
                    />
                  </span>
                  <span className="num" style={{ color: "var(--muted-foreground)" }}>
                    {fmtHours(mins)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="card-head plain">
              <span className="card-title">Spending per goal</span>
              <span className="spacer" />
              <span className="field-hint">
                <Money minor={totalSpend} />
              </span>
            </div>
            <div className="card-body tight">
              {spendByGoal.length === 0 && (
                <div className="field-hint">No spending in this period.</div>
              )}
              {spendByGoal.map(([name, val]) => (
                <div className="cat-bar-row" key={name}>
                  <span className="name" style={{ width: 130 }} title={name}>
                    {name}
                  </span>
                  <span className="bar">
                    <span
                      style={{ width: `${Math.round((val / Math.max(1, spendByGoal[0][1])) * 100)}%` }}
                    />
                  </span>
                  <span className="num neg">
                    <Money minor={val} />
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="rail">
          <Card>
            <div className="card-head plain">
              <span className="card-title">Time by theme</span>
            </div>
            <div className="card-body tight">
              {timeByTheme.length === 0 && <div className="field-hint">No time tracked yet.</div>}
              {timeByTheme.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    height: 8,
                    borderRadius: 999,
                    overflow: "hidden",
                    marginBottom: 14,
                  }}
                >
                  {timeByTheme.map(([name, mins]) => (
                    <span
                      key={name}
                      style={{
                        width: `${(mins / Math.max(0.001, totalMins)) * 100}%`,
                        background: splitColor(name),
                      }}
                    />
                  ))}
                </div>
              )}
              {timeByTheme.map(([name, mins]) => (
                <div className="past-week" key={name}>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: splitColor(name),
                        marginRight: 8,
                      }}
                    />
                    {name}
                  </span>
                  <span className="fig">{fmtHours(mins)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="card-head plain">
              <span className="card-title">Past weeks</span>
            </div>
            <div className="card-body tight">
              {pastWeeks.length === 0 && (
                <div className="field-hint">
                  Reports are saved each week, or click "Save snapshot" above anytime.
                </div>
              )}
              {pastWeeks.map((r) => {
                let snap: { tasks?: Row[]; entries?: Row[]; money?: Row[] } = {};
                try {
                  snap = JSON.parse(String(r.snapshot_json));
                } catch {
                  /* keep empty */
                }
                const doneTasks = (snap.tasks ?? []).filter((t) => t.status === "done").length;
                const totalTasks = (snap.tasks ?? []).length;
                const mins = (snap.entries ?? []).reduce((s, e) => s + entryMinutes(e), 0);
                const net = (snap.money ?? []).reduce(
                  (s, e) => s + (e.direction === "in" ? Number(e.amount_minor) : -Number(e.amount_minor)),
                  0,
                );
                return (
                  <button
                    type="button"
                    className="past-week past-week-btn"
                    key={r.id}
                    onClick={() => setInspecting(r)}
                  >
                    <div style={{ textAlign: "left" }}>
                      <div>Week of {fmtDateShort(String(r.week_start))}</div>
                      <div className="meta">
                        {doneTasks}/{totalTasks} done · {fmtHours(mins)}
                      </div>
                    </div>
                    <span className={`fig ${net >= 0 ? "pos" : "neg"}`}>
                      <Money minor={Math.abs(net)} />
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {inspecting && <SnapshotModal report={inspecting} onClose={() => setInspecting(null)} />}
    </section>
  );
}

/* ------------------------------------------------------ routine consistency */

function RoutineConsistency({ start, end }: { start: string; end: string }) {
  const { data: routines = [] } = useRoutines();
  const { data: logs = [] } = useRoutineLogs();
  const navigate = useNavigate();
  const today = todayLocal();

  const doneIndex = new Map<string, Set<number>>();
  for (const log of logs) {
    const day = String(log.date ?? "");
    const set = doneIndex.get(day) ?? new Set<number>();
    set.add(Number(log.routine_id));
    doneIndex.set(day, set);
  }

  const periodEnd = end > today ? today : end;
  const days: string[] = [];
  let cursor = start;
  while (cursor <= periodEnd && days.length < 62) {
    days.push(cursor);
    const next = new Date(cursor + "T12:00:00");
    next.setDate(next.getDate() + 1);
    cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }

  const createdDay = (r: Row) => {
    const raw = String(r.created_at ?? "");
    if (!raw) return "";
    return raw.length === 10 ? raw : localDayOfIso(raw);
  };

  const eligibleFor = (day: string) =>
    routines.filter(
      (r) =>
        createdDay(r) <= day &&
        (Number(r.active) === 1 || (doneIndex.get(day)?.has(Number(r.id)) ?? false)),
    );

  let doneTotal = 0;
  let eligibleTotal = 0;
  let perfectDays = 0;
  for (const day of days) {
    const eligible = eligibleFor(day);
    const set = doneIndex.get(day) ?? new Set<number>();
    const done = eligible.filter((r) => set.has(Number(r.id))).length;
    eligibleTotal += eligible.length;
    doneTotal += done;
    if (eligible.length > 0 && done === eligible.length) perfectDays++;
  }
  const pct = eligibleTotal ? Math.round((doneTotal / eligibleTotal) * 100) : 0;

  const perRoutine = routines
    .filter((r) => Number(r.active) === 1)
    .map((routine) => {
      const id = Number(routine.id);
      const created = createdDay(routine);
      const relevant = days.filter((d) => d >= created);
      const done = relevant.filter((d) => doneIndex.get(d)?.has(id)).length;
      return {
        routine,
        done,
        total: relevant.length,
        pct: relevant.length ? Math.round((done / relevant.length) * 100) : 0,
      };
    });

  return (
    <Card className="routine-report-card">
      <div className="card-head plain">
        <Icon name="repeat" size={18} className="icon-muted" />
        <span className="card-title">Routine consistency</span>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/routines" })}>
          Full heatmap <Icon name="arrowRight" size={13} />
        </Button>
      </div>
      <div className="card-body pad">
        {eligibleTotal === 0 ? (
          <div className="field-hint">No non-negotiables in this period yet.</div>
        ) : (
          <>
            <div className="routine-report-head">
              <strong className="hero-figure">{pct}%</strong>
              <span className="field-hint">
                {doneTotal}/{eligibleTotal} check-ins · {perfectDays} perfect {perfectDays === 1 ? "day" : "days"}
              </span>
            </div>
            <Progress value={pct} slim success={pct === 100} />
            <div className="routine-report-bars">
              {perRoutine.map(({ routine, done, total, pct: rowPct }) => (
                <div className="routine-report-row" key={routine.id}>
                  <span className="filter-dot" style={{ background: String(routine.color) }} />
                  <span className="routine-report-name">{String(routine.title)}</span>
                  <div className="routine-report-track">
                    <div
                      className="routine-report-fill"
                      style={{ width: `${rowPct}%`, background: String(routine.color) }}
                    />
                  </div>
                  <span className="field-hint">{done}/{total}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
