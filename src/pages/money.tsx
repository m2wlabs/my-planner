import { Button, Card, EmptyState, Field, Input, Select, SegmentedControl, Statistic } from "@halo-ds/react";
import { useMemo, useState } from "react";
import { fmtMoney, todayLocal, type Row } from "../lib/api";
import { useGoals, useMoney, useMoneyMut, useTasks, useThemes, useTimeEntries, useWeeklyReports } from "../lib/hooks";
import { Page } from "../components/ui";

export function MoneyPage() {
  const { data: entries = [] } = useMoney();
  const { data: tasks = [] } = useTasks();
  const { data: goals = [] } = useGoals();
  const mut = useMoneyMut();
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("out");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [link, setLink] = useState("");
  const month = todayLocal().slice(0, 7);
  const thisMonth = entries.filter((e) => String(e.date).startsWith(month));
  const inTotal = thisMonth.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount_minor), 0);
  const outTotal = thisMonth.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount_minor), 0);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    thisMonth.filter((e) => e.direction === "out").forEach((e) => m.set(String(e.category), (m.get(String(e.category)) ?? 0) + Number(e.amount_minor)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [thisMonth]);

  const add = async () => {
    const minor = Math.round(parseFloat(amount) * 100);
    if (!amount || !category || isNaN(minor)) return;
    const [kind, id] = link ? link.split(":") : ["", ""];
    await mut.insert.mutateAsync({
      amount_minor: minor,
      direction,
      category: category.trim(),
      date,
      task_id: kind === "task" ? Number(id) : null,
      goal_id: kind === "goal" ? Number(id) : null,
    });
    setAmount(""); setCategory(""); setLink("");
  };

  return (
    <Page title="Money">
      <div className="stats">
        <Statistic label="In (this month)" value={fmtMoney(inTotal)} prefix="$" />
        <Statistic label="Out (this month)" value={fmtMoney(outTotal)} prefix="$" />
        <Statistic label="Left" value={fmtMoney(inTotal - outTotal)} prefix="$" />
      </div>
      <Card>
        <h3>Quick entry</h3>
        <div className="row gap wrap">
          <Field label="Amount">{() => <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Direction">{() => (
            <SegmentedControl aria-label="Direction" options={[{ value: "in", label: "In" }, { value: "out", label: "Out" }]} value={direction} onValueChange={setDirection} />
          )}</Field>
          <Field label="Category">{() => <Input placeholder="Food, Salary…" value={category} onChange={(e) => setCategory(e.target.value)} />}</Field>
          <Field label="Date">{() => <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Link (optional)">{() => (
            <Select
              options={[
                { value: "", label: "None" },
                ...tasks.map((t) => ({ value: `task:${t.id}`, label: `Task: ${String(t.title)}` })),
                ...goals.map((g) => ({ value: `goal:${g.id}`, label: `Goal: ${String(g.title)}` })),
              ]}
              value={link} onValueChange={setLink} placeholder="None"
            />
          )}</Field>
          <Button variant="primary" onClick={add}>Add entry</Button>
        </div>
      </Card>
      <h2>Spending by category</h2>
      {byCat.length === 0 && <EmptyState title="No spending this month" description="Add an entry above." />}
      <div className="stack">{byCat.map(([c, v]) => <Card key={c}><div className="row-between"><span>{c}</span><strong>{fmtMoney(v)}</strong></div></Card>)}</div>
      <h2>Recent entries</h2>
      <div className="stack">
        {[...entries].reverse().slice(0, 30).map((e) => (
          <Card key={e.id}>
            <div className="row-between">
              <span>{String(e.date)} · {String(e.category)} · {e.direction === "in" ? "+" : "−"}{fmtMoney(Number(e.amount_minor))}</span>
              <Button size="sm" variant="ghost" onClick={() => mut.remove.mutate(Number(e.id))}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
    </Page>
  );
}

function periodBounds(mode: string): [string, string, string, string] {
  const today = new Date();
  if (mode === "week") {
    const day = (today.getDay() + 6) % 7;
    const start = new Date(today); start.setDate(today.getDate() - day);
    const prev = new Date(start); prev.setDate(start.getDate() - 7);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return [iso(start), iso(end), iso(prev), iso(new Date(prev.getTime() + 6 * 86400000))];
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return [iso(start), iso(end), iso(prev), iso(prevEnd)];
}

export function ReportsPage() {
  const [mode, setMode] = useState("week");
  const { data: tasks = [] } = useTasks();
  const { data: entries = [] } = useTimeEntries();
  const { data: money = [] } = useMoney();
  const { data: goals = [] } = useGoals();
  const { data: themes = [] } = useThemes();
  const { data: reports = [] } = useWeeklyReports();
  const [start, end, pStart, pEnd] = periodBounds(mode);

  const inRange = (d: string, s: string, e: string) => d >= s && d <= e;
  const curTasks = tasks.filter((t) => inRange(String(t.planned_date), start, end));
  const prevTasks = tasks.filter((t) => inRange(String(t.planned_date), pStart, pEnd));
  const done = curTasks.filter((t) => t.status === "done").length;
  const prevDone = prevTasks.filter((t) => t.status === "done").length;
  const taskById = new Map(tasks.map((t) => [Number(t.id), t]));

  const minutesBy = (key: (t: Row) => string) => {
    const m = new Map<string, number>();
    entries.filter((e) => e.end_utc && inRange(String(e.start_utc).slice(0, 10), start, end)).forEach((e) => {
      const t = taskById.get(Number(e.task_id));
      if (!t) return;
      const mins = (new Date(String(e.end_utc)).getTime() - new Date(String(e.start_utc)).getTime()) / 60000;
      const k = key(t);
      m.set(k, (m.get(k) ?? 0) + mins);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byGoal = minutesBy((t) => (t.goal_id ? String(goals.find((g) => g.id === t.goal_id)?.title ?? `Goal ${t.goal_id}`) : "No goal"));
  const byTheme = minutesBy((t) => String(themes.find((th) => th.id === t.theme_id)?.name ?? "Unaligned"));
  const totalMins = byTheme.reduce((s, [, v]) => s + v, 0);

  const curMoneyIn = money.filter((e) => e.direction === "in" && inRange(String(e.date), start, end)).reduce((s, e) => s + Number(e.amount_minor), 0);
  const curMoneyOut = money.filter((e) => e.direction === "out" && inRange(String(e.date), start, end)).reduce((s, e) => s + Number(e.amount_minor), 0);
  const prevMoneyIn = money.filter((e) => e.direction === "in" && inRange(String(e.date), pStart, pEnd)).reduce((s, e) => s + Number(e.amount_minor), 0);
  const prevMoneyOut = money.filter((e) => e.direction === "out" && inRange(String(e.date), pStart, pEnd)).reduce((s, e) => s + Number(e.amount_minor), 0);

  const delta = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? "±0" : `+${cur}`) : `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}% vs prev`);

  const spendByGoal = useMemo(() => {
    const m = new Map<string, number>();
    money.filter((e) => e.direction === "out" && inRange(String(e.date), start, end)).forEach((e) => {
      const t = e.task_id ? taskById.get(Number(e.task_id)) : null;
      const gid = e.goal_id ?? t?.goal_id;
      const key = gid ? String(goals.find((g) => g.id === gid)?.title ?? `Goal ${gid}`) : "No goal";
      m.set(key, (m.get(key) ?? 0) + Number(e.amount_minor));
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [money, start, end, goals, taskById]);

  return (
    <Page title="Reports">
      <SegmentedControl aria-label="Period" options={[{ value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }]} value={mode} onValueChange={setMode} />
      <p>{start} → {end}</p>
      <h2>Goal progress</h2>
      <div className="stack">
        {goals.map((g) => {
          const linked = tasks.filter((t) => t.goal_id === g.id);
          const pct = linked.length ? Math.round((linked.filter((t) => t.status === "done").length / linked.length) * 100) : 0;
          return <Card key={g.id}><div className="row-between"><span>{String(g.title)}</span><strong>{pct}% tasks done</strong></div></Card>;
        })}
        {goals.length === 0 && <EmptyState title="No goals" description="Create goals on the Goals page." />}
      </div>
      <div className="stats">
        <Statistic label="Tasks done / planned" value={`${done} / ${curTasks.length}`} change={delta(done, prevDone)} />
        <Statistic label="Money in" value={fmtMoney(curMoneyIn)} prefix="$" change={delta(curMoneyIn, prevMoneyIn)} />
        <Statistic label="Money out" value={fmtMoney(curMoneyOut)} prefix="$" change={delta(curMoneyOut, prevMoneyOut)} />
        <Statistic label="Left" value={fmtMoney(curMoneyIn - curMoneyOut)} prefix="$" />
      </div>
      <h2>Time by goal</h2>
      <div className="stack">{byGoal.map(([k, v]) => <Card key={k}><div className="row-between"><span>{k}</span><strong>{(v / 60).toFixed(1)}h</strong></div></Card>)}</div>
      <h2>Where your time and money went</h2>
      <div className="stack">
        {byTheme.map(([k, v]) => (
          <Card key={k}><div className="row-between"><span>{k}{k === "Unaligned" ? " (no goal/theme)" : ""}</span><strong>{totalMins ? Math.round((v / totalMins) * 100) : 0}% · {(v / 60).toFixed(1)}h</strong></div></Card>
        ))}
        {spendByGoal.map(([k, v]) => <Card key={`spend-${k}`}><div className="row-between"><span>{k}</span><strong>{fmtMoney(v)} spent</strong></div></Card>)}
      </div>
      <h2>Past weekly reports</h2>
      <div className="stack">
        {reports.map((r) => <Card key={r.id}><span>Week of {String(r.week_start)}</span></Card>)}
        {reports.length === 0 && <p>No saved reports yet — they are saved each week.</p>}
      </div>
    </Page>
  );
}
