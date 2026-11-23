import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import {
  Alert,
  Avatar,
  Button as HaloButton,
  Card as HaloCard,
  Checkbox as HaloCheckbox,
  Combobox as HaloCombobox,
  DatePicker,
  Input as HaloInput,
  Modal as HaloModal,
  NavItem,
  Popover,
  ProgressBar,
  Select as HaloSelect,
  Sidebar,
  Switch as HaloSwitch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  Textarea as HaloTextarea,
  TimePicker,
  TopBar,
  useToast,
} from "@halo-ds/react";
import ScrollArea from "./ScrollArea";
import { ProviderLogo } from "./ProviderLogo";
import type { Row } from "../lib/api";
import { addDays, dateToIso as apiDateToIso, todayLocal } from "../lib/api";
import { isProviderReady } from "../lib/aiEngine";
import {
  useAiDrawer,
  useAiConfig,
  useAiUsage,
  useCurrency,
  useGoalMut,
  useGoals,
  useRescheduleOverdue,
  useSettings,
  useTaskMut,
  useTasks,
  useThemes,
  useTimeEntries,
  useTimeMut,
  useTimer,
} from "../lib/hooks";

/* ------------------------------------------------------------------ icons */

const PATHS: Record<string, string> = {
  panelLeft: "M4 4h16v16H4z M9 4v16",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8 M10.3 21a1.94 1.94 0 0 0 3.4 0",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  target: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0 M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
  wallet: "M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6 M16 13h.01",
  chart: "M3 3v18h18 M7 16v-4 M12 16V8 M17 16v-7",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 16.11 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 9v.09a1.65 1.65 0 0 0 1.51 1H22a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  timer: "M10 2h4 M12 14l3-3 M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  square: "M5 5h14v14H5z",
  pause: "M9 4v16 M15 4v16",
  play: "M6 4l14 8-14 8z",
  calendarPlus: "M8 2v4 M16 2v4 M3 10h18 M21 14V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8 M16 19h6 M19 16v6",
  calendar: "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  folder: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z",
  plus: "M12 5v14 M5 12h14",
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  database: "M12 8c4.42 0 8-1.34 8-3s-3.58-3-8-3-8 1.34-8 3 3.58 3 8 3z M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5 M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  alert: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z M12 9v4 M12 17h.01",
  palette: "M12 22a10 10 0 1 1 0-20c5.5 0 10 4.5 10 10 0 1.4-1.1 2.5-2.5 2.5H17a2 2 0 0 0-2 2c0 .5.2 1 .5 1.4.4.4.5.9.5 1.4 0 1.5-1.1 2.7-2.5 2.7z M13.5 6.5h.01 M17.5 10.5h.01 M8.5 7.5h.01 M6.5 12.5h.01",
  tag: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z M7 7h.01",
  check: "m20 6-11 11-5-5",
  x: "M18 6 6 18 M6 6l12 12",
  trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v6 M14 11v6",
  dots: "M12 12h.01 M19 12h.01 M5 12h.01",
  pie: "M21.21 15.89A10 10 0 1 1 8 2.83 M22 12A10 10 0 0 0 12 2v10z",
  refresh: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  coins: "M12 5c4.42 0 8-1.34 8-3s-3.58-3-8-3-8 1.34-8 3 3.58 3 8 3z M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5",
  sparkles: "m12 3 1.9 5.8L20 10.7l-5.1 3.7L16 20l-4-3-4 3 1.1-5.6L4 10.7l6.1-1.9z",
  edit: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  send: "m22 2-7 20-4-9-9-4Z M22 2 11 13",
  search: "M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M21 21l-4.3-4.3",
  key: "M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z M16.5 7.5h.01",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M12 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  external: "M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  arrowRight: "M5 12h14 m-7-7 7 7-7 7",
  arrowUp: "M12 19V5 m-6 6 6-6 6 6",
  copy: "M9 9h11v11H9z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  fileText: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z M19 11a7 7 0 0 1-14 0 M12 18v4 M8 22h8",
  micOff: "M3 3l18 18 M9 9v2a3 3 0 0 0 5.1 2.1 M15 10V5a3 3 0 0 0-5.7-1.3 M19 11a7 7 0 0 1-11.3 5.6 M12 18v4 M8 22h8",
  volume: "M11 5 6 9H2v6h4l5 4z M15.5 8.5a5 5 0 0 1 0 7 M19 5a9 9 0 0 1 0 14",
  volumeOff: "M11 5 6 9H2v6h4l5 4z M22 9l-6 6 M16 9l6 6",
  repeat: "m17 2 4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3",
  flame: "M12 2c2 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3 1-6 1-9z",
  arrowDown: "M12 5v14 m-6-6 6 6 6-6",
  sliders: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
};

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? PATHS.grid} />
    </svg>
  );
}

/* --------------------------------------------------------------- helpers */

export const fmtHours = (mins: number) => {
  if (!mins || mins <= 0) return "0m";
  if (mins < 1) return "<1m";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (m === 60) return `${h + 1}h`;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const entryMinutes = (e: Row) => {
  const end = e.end_utc ? new Date(String(e.end_utc)).getTime() : Date.now();
  return Math.max(0, (end - new Date(String(e.start_utc)).getTime()) / 60000);
};

export function fmtDateLong(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
export function fmtDateShort(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export function fmtMonth(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
export function currentMonth() {
  return todayLocal().slice(0, 7);
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export const dateToIso = apiDateToIso;
function isoToDate(value: string) {
  return value ? new Date(value + "T12:00:00") : null;
}

/* ------------------------------------------------------------- primitives */

export function Button({
  children,
  variant = "secondary",
  size,
  className = "",
  type = "button",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm";
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const haloVariant = variant === "danger" ? "destructive" : variant;
  return (
    <HaloButton
      type={type}
      variant={haloVariant}
      size={size === "sm" ? "sm" : "md"}
      className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${className}`}
      classNames={{ label: "btn-label" }}
      {...props}
    >
      {children}
    </HaloButton>
  );
}

export function Input(props: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { inputRef?: RefObject<HTMLInputElement | null> }) {
  const { inputRef, ...rest } = props;
  return <HaloInput ref={inputRef} {...rest} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <HaloTextarea className={`textarea-control ${props.className ?? ""}`} {...props} />;
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <HaloSelect
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={`input-control ${className}`}
    />
  );
}

export function ComboboxField({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <HaloCombobox
      value={value}
      onValueChange={(next) => {
        if (next != null) onChange(next);
      }}
      options={options}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={`input-control ${className}`}
    />
  );
}

export function DateField({
  value,
  onChange,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <DatePicker
      value={isoToDate(value)}
      onValueChange={(date) => onChange(date ? dateToIso(date) : "")}
      format={(date) =>
        date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      }
      aria-label={ariaLabel}
      className={`input-control ${className}`}
    />
  );
}

export function TimeField({
  value,
  onChange,
  ariaLabel,
  className = "",
  step = 15,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  step?: number;
}) {
  return (
    <TimePicker
      value={value || undefined}
      onValueChange={onChange}
      step={step}
      hourCycle={12}
      aria-label={ariaLabel}
      className={`input-control ${className}`}
    />
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <HaloCheckbox
      checked={checked}
      onCheckedChange={() => onChange()}
      aria-label={label}
      classNames={{ control: "task-check" }}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <HaloSwitch
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      size="md"
      className="switch-control"
    />
  );
}

const READABLE = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#1c221c" : "#ffffff";
};

export function ThemeChip({ themeId, themes }: { themeId: number | null; themes: Row[] }) {
  const t = themes.find((x) => Number(x.id) === Number(themeId));
  if (!t) {
    return (
      <Tag color="orange" size="sm" className="chip">
        Unaligned
      </Tag>
    );
  }
  const color = String(t.color || "#D9D9DB");
  return (
    <Tag
      size="sm"
      color={color}
      className="chip"
      styles={{ root: { background: color, color: READABLE(color) } }}
    >
      {String(t.name)}
    </Tag>
  );
}

const STATE_COLOR: Record<string, "neutral" | "green" | "red" | "blue" | "purple" | "orange"> = {
  planned: "neutral",
  done: "green",
  complete: "green",
  overdue: "red",
  active: "blue",
  high: "orange",
};

export function StateChip({ status, label }: { status: string; label?: string }) {
  return (
    <Tag size="sm" color={STATE_COLOR[status] ?? "neutral"} className="chip">
      {label ?? status}
    </Tag>
  );
}

export function Progress({
  value,
  success = false,
  slim = false,
}: {
  value: number;
  success?: boolean;
  slim?: boolean;
}) {
  return (
    <ProgressBar
      value={Math.max(0, Math.min(100, value))}
      status={success ? "success" : "default"}
      size="md"
      valueLabel={false}
      className={`progress ${slim ? "progress-slim" : ""}`}
    />
  );
}

/** An amount with the currency symbol set smaller, so the digits carry the weight. */
export function Money({
  minor,
  amount,
  className,
}: {
  minor?: number;
  amount?: number;
  className?: string;
}) {
  const { parts, partsOf } = useCurrency();
  const { symbol, value, symbolLast } =
    amount === undefined ? parts(minor ?? 0) : partsOf(amount);
  const mark = symbol ? <span className="currency-symbol">{symbol}</span> : null;
  return (
    <span className={className}>
      {symbolLast ? (
        <>
          {value}
          {mark}
        </>
      ) : (
        <>
          {mark}
          {value}
        </>
      )}
    </span>
  );
}

export function Card({
  className = "",
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  id?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <HaloCard className={`card ${className}`} styles={{ content: { padding: 0 } }} {...rest}>
      {children}
    </HaloCard>
  );
}

export function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`page-section ${className}`}>{children}</div>;
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function PageHead({
  title,
  subtitle,
  stats,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  stats?: { label: string; value: string }[];
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      <div className="page-head-right">
        {stats && (
          <div className="page-stats">
            {stats.map((s) => (
              <div className="page-stat" key={s.label}>
                <span className="stat-label">{s.label}</span>
                <span className="stat-value">{s.value}</span>
              </div>
            ))}
          </div>
        )}
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

const NAV = [
  { to: "/today", label: "Today", icon: "grid" },
  { to: "/routines", label: "Routines", icon: "repeat" },
  { to: "/goals", label: "Goals", icon: "target" },
  { to: "/money", label: "Money", icon: "wallet" },
  { to: "/reports", label: "Reports", icon: "chart" },
  { to: "/ai", label: "AI Coach", icon: "sparkles" },
] as const;

const TITLES: Record<string, string> = {
  "/": "Today",
  "/today": "Today",
  "/routines": "Routines",
  "/goals": "Goals",
  "/money": "Money",
  "/reports": "Reports",
  "/ai": "AI Coach",
  "/settings": "Settings",
  "/first-run": "First run",
};

function initialsFrom(name?: string | null, email?: string | null) {
  const src = (name || email || "MP").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { openAi } = useAiDrawer();
  const { running } = useRunning();
  const { data: aiConfig } = useAiConfig();
  const { data: aiUsage } = useAiUsage();
  const { data: tasks = [] } = useTasks();
  const { data: goals = [] } = useGoals();
  const { data: settings = {} } = useSettings();
  const reschedule = useRescheduleOverdue();

  const current = TITLES[location.pathname] ?? "Today";
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "1");
  const [notifOpen, setNotifOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Reset main scroll position cleanly whenever navigating to another page.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Global keyboard shortcut Ctrl+K / Cmd+K opens AI Coach drawer.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openAi();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openAi]);

  const today = todayLocal();
  const overdueTasks = tasks.filter((t) => String(t.planned_date) < today && t.status !== "done");
  const nextWeek = addDays(today, 7);
  const upcomingGoals = goals.filter(
    (g) => g.status !== "done" && g.deadline && String(g.deadline) >= today && String(g.deadline) <= nextWeek,
  );
  const alertCount = overdueTasks.length + upcomingGoals.length;

  const go = (to: string) => (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    navigate({ to });
  };

  const navItem = (to: string, label: string, icon: string) => {
    const isSelected = location.pathname === to || (to === "/today" && location.pathname === "/");
    return (
      <NavItem
        key={to}
        href={to}
        selected={isSelected}
        onClick={go(to)}
        icon={<Icon name={icon} size={22} />}
        className="nav-item"
      >
        {label}
      </NavItem>
    );
  };

  const enabledProviders = (aiConfig?.providers ?? []).filter((p) => isProviderReady(p));
  const activeProvider =
    enabledProviders.find((p) => p.id === aiConfig?.activeProviderId) ?? enabledProviders[0];
  const displayName = activeProvider?.name || "No AI provider";
  const displayMeta = activeProvider?.model || "Add an AI provider";
  const avatarInitials = initialsFrom(activeProvider?.name, activeProvider?.model);

  return (
    <div
      className={`shell${collapsed ? " shell--collapsed" : ""}${running ? " shell--timer" : ""}`}
    >
      <Sidebar
        className="sidebar"
        aria-label="Main"
        collapsed={collapsed}
        header={
          <div className="brand" onClick={() => navigate({ to: "/today" })} style={{ cursor: "pointer" }}>
            <img className="brand-mark" src="/my-planner-mark.svg" alt="" aria-hidden="true" />
            <span className="brand-name">MY PLANNER</span>
          </div>
        }
        user={
          <button
            type="button"
            className="side-user side-user-btn"
            onClick={() => navigate({ to: "/settings", search: { section: "ai-providers" } })}
            title={activeProvider ? `${displayName} (${displayMeta})` : "Connect an AI provider"}
          >
            {activeProvider ? (
              <ProviderLogo catalogId={activeProvider.catalogId} kind={activeProvider.kind} size={16} />
            ) : (
              <Avatar
                initials={avatarInitials}
                size="sm"
                className="avatar"
              />
            )}
            <div className="side-user-copy">
              <div className="side-user-name">{displayName}</div>
              <div className="side-user-meta">{displayMeta}</div>
            </div>
            <span className="side-user-action" aria-hidden="true">
              <Icon name="chevronRight" size={16} />
            </span>
          </button>
        }
      >
        <div className="nav-section">Workspace</div>
        {NAV.map((item) => navItem(item.to, item.label, item.icon))}
        <div className="nav-section">Manage</div>
        {navItem("/settings", "Settings", "settings")}
      </Sidebar>

      <main className="main">
        <TopBar
          className="topbar"
          aria-label="Top"
          logo={
            <>
              <HaloButton
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="topbar-toggle"
                onClick={() => setCollapsed((c) => !c)}
              >
                <Icon name="panelLeft" size={19} />
              </HaloButton>
              <div className="crumbs">
                <span>My Planner</span>
                <Icon name="chevronRight" size={14} />
                <span className="current">{current}</span>
              </div>
            </>
          }
          actions={
            <>
              <button
                type="button"
                className={`ai-pill-btn${activeProvider ? " is-live" : ""}`}
                onClick={() => openAi()}
                title="Open AI Coach (Ctrl+K)"
              >
                <Icon name="sparkles" size={14} />
                <span>Ask AI</span>
                <kbd>Ctrl+K</kbd>
              </button>

              <Popover
                open={notifOpen}
                onOpenChange={setNotifOpen}
                side="bottom"
                align="end"
                title="Workspace pulse"
                description="Overdue tasks, upcoming deadlines, and backup status"
                showClose
                trigger={
                  <HaloButton
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label="Notifications"
                    className="icon-btn notif-trigger"
                  >
                    <Icon name="bell" size={19} />
                    {alertCount > 0 && <span className="notif-dot" aria-hidden="true" />}
                  </HaloButton>
                }
              >
                <div className="popover-stack">
                  {overdueTasks.length > 0 ? (
                    <div className="popover-item">
                      <div className="popover-item-copy">
                        <strong>
                          {overdueTasks.length} overdue {overdueTasks.length === 1 ? "task" : "tasks"}
                        </strong>
                        <span>Carry them forward to today or review on Today.</span>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          reschedule.mutate(today);
                          setNotifOpen(false);
                        }}
                      >
                        Move to today
                      </Button>
                    </div>
                  ) : (
                    <div className="popover-item muted">
                      <Icon name="check" size={16} />
                      <span>Zero overdue tasks — you're caught up.</span>
                    </div>
                  )}

                  {upcomingGoals.length > 0 && (
                    <div className="popover-section">
                      <div className="popover-label">Deadlines this week</div>
                      {upcomingGoals.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          className="popover-link"
                          onClick={() => {
                            setNotifOpen(false);
                            navigate({ to: "/goals" });
                          }}
                        >
                          <span>{String(g.title)}</span>
                          <span className="field-hint">Due {fmtDateShort(String(g.deadline))}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="popover-foot">
                    <span className="field-hint">
                      Backup: {settings.last_backup_at ? new Date(settings.last_backup_at).toLocaleDateString() : "Not configured"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setNotifOpen(false);
                        navigate({ to: "/reports" });
                      }}
                    >
                      Open reports
                    </Button>
                  </div>
                </div>
              </Popover>

              <Popover
                open={acctOpen}
                onOpenChange={setAcctOpen}
                side="bottom"
                align="end"
                showClose
                title={displayName}
                description={displayMeta}
                trigger={
                  <button type="button" className="avatar-btn" aria-label="Account and AI status">
                    <Avatar
                      initials={avatarInitials}
                      size="xs"
                      status={activeProvider ? "online" : undefined}
                      className="avatar"
                    />
                  </button>
                }
              >
                <div className="popover-stack">
                  <div className="popover-status-row">
                    <span className={`chip ${activeProvider ? "chip-success" : "chip-neutral"}`}>
                      {activeProvider ? activeProvider.name : "AI not connected"}
                    </span>
                    {activeProvider && <span className="field-hint">{activeProvider.model}</span>}
                  </div>
                  <div className="popover-ai-summary">
                    <div className="popover-ai-row">
                      <span className="field-hint">Today's AI usage</span>
                      <strong style={{ fontSize: 12 }}>
                        {(aiUsage?.today.total_tokens ?? 0).toLocaleString()} tok ·{" "}
                        {aiUsage?.today.requests ?? 0} calls
                      </strong>
                    </div>
                  </div>
                  <div className="popover-actions-col">
                    <Button
                      size="sm"
                      variant="primary"
                      className="btn-block"
                      onClick={() => {
                        setAcctOpen(false);
                        navigate({ to: "/ai" });
                      }}
                    >
                      <Icon name="sparkles" size={14} /> Open AI Coach
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="btn-block"
                      onClick={() => {
                        setAcctOpen(false);
                        navigate({
                          to: "/settings",
                          search: { section: "ai-providers" },
                        });
                      }}
                    >
                      <Icon name="sliders" size={14} /> AI &amp; Voice Settings
                    </Button>
                  </div>
                </div>
              </Popover>
            </>
          }
        />
        <ScrollArea className="content" regionRef={contentRef}>
          <Outlet />
        </ScrollArea>
      </main>
      <TimerBar />
    </div>
  );
}

function elapsed(startUtc: string) {
  const ms = Date.now() - new Date(startUtc).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function useRunning() {
  const { data: entries = [] } = useTimeEntries();
  const { data: tasks = [] } = useTasks();
  const running = entries.find((e) => e.end_utc == null);
  return {
    running,
    task: running ? tasks.find((t) => Number(t.id) === Number(running.task_id)) : undefined,
  };
}

export function TimerBar() {
  const { running, task } = useRunning();
  const { stop } = useTimer();
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!running) return null;
  return (
    <div className="timer-bar" role="status" aria-live="polite">
      <Icon name="timer" size={18} />
      <span className="timer-bar-title">{task ? String(task.title) : "Timer running"}</span>
      <strong>{elapsed(String(running.start_utc))}</strong>
      <Button size="sm" variant="secondary" onClick={() => stop.mutate()}>
        <Icon name="square" size={13} /> Stop
      </Button>
    </div>
  );
}

export function useFirstRunRedirect() {
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (settings && settings.first_run_done !== "1" && location.pathname !== "/first-run") {
      navigate({ to: "/first-run" });
    }
  }, [settings, navigate, location.pathname]);
}

/* ------------------------------------------------------------------ tasks */

export function taskMinutes(taskId: number, entries: Row[]) {
  return entries
    .filter((e) => Number(e.task_id) === taskId)
    .reduce((sum, e) => sum + entryMinutes(e), 0);
}

export function TaskRow({
  task,
  themes,
  goals,
  entries,
  onEdit,
}: {
  task: Row;
  themes: Row[];
  goals: Row[];
  entries: Row[];
  onEdit?: (task: Row) => void;
}) {
  const { start, stop } = useTimer();
  const mut = useTaskMut();
  const { toast } = useToast();
  const { running } = useRunning();
  const goal = goals.find((g) => Number(g.id) === Number(task.goal_id));
  const mins = taskMinutes(Number(task.id), entries);
  const isRunning = Boolean(running && Number(running.task_id) === Number(task.id));
  const done = task.status === "done";
  const today = todayLocal();
  const overdue = !done && String(task.planned_date) < today;
  const est = task.estimate_mins ? Number(task.estimate_mins) : 0;
  const priority = String(task.priority ?? "normal");
  const hasNotes = Boolean(task.notes && String(task.notes).trim());

  const toggleDone = () => {
    mut.update.mutate({
      id: Number(task.id),
      row: { status: done ? "planned" : "done" },
    });
  };

  const moveToday = () => {
    mut.update.mutate(
      { id: Number(task.id), row: { planned_date: today } },
      { onSuccess: () => toast({ type: "success", title: "Moved task to today" }) },
    );
  };

  return (
    <div className={`row-item${isRunning ? " row-item--running" : ""}`}>
      <Checkbox
        checked={done}
        label={done ? "Mark not done" : "Mark done"}
        onChange={toggleDone}
      />
      <button type="button" className="item-main" onClick={() => onEdit?.(task)}>
        <span className={`item-title ${done ? "done" : ""}`}>
          {String(task.title)}
          {hasNotes && <Icon name="fileText" size={13} className="note-dot" />}
        </span>
        <span className="item-meta">
          <ThemeChip themeId={task.theme_id as number | null} themes={themes} />
          {priority === "high" && !done && <StateChip status="high" label="High" />}
          <span className="text">{goal ? String(goal.title) : "No goal"}</span>
          <span className="text">
            {overdue
              ? `Due ${fmtDateShort(String(task.planned_date))}`
              : String(task.planned_date) === today
                ? "Today"
                : fmtDateShort(String(task.planned_date))}
          </span>
          {est > 0 && <span className="text">Est {fmtHours(est)}</span>}
          <Tag size="sm" color={done ? "green" : overdue ? "red" : "neutral"} className="chip">
            {done ? "Done" : overdue ? "Overdue" : "Planned"}
          </Tag>
        </span>
      </button>
      {overdue && (
        <Button
          variant="ghost"
          size="sm"
          className="row-reschedule"
          title="Reschedule to today"
          onClick={moveToday}
        >
          Today
        </Button>
      )}
      {!done && (
        <Button
          variant={isRunning ? "danger" : "ghost"}
          size="sm"
          className={`row-play${isRunning ? " is-running" : ""}`}
          aria-label={isRunning ? "Stop timer" : "Start timer"}
          title={isRunning ? "Stop timer" : "Start timer"}
          onClick={(e) => {
            e.stopPropagation();
            if (isRunning) stop.mutate();
            else start.mutate(Number(task.id));
          }}
        >
          <Icon name={isRunning ? "square" : "play"} size={isRunning ? 13 : 16} />
        </Button>
      )}
      <span className="item-figure">{mins > 0 ? fmtHours(mins) : "—"}</span>
    </div>
  );
}

export function QuickTask({
  plannedDate,
  defaultGoalId,
  onDone,
  inputRef,
  compact = false,
}: {
  plannedDate?: string;
  defaultGoalId?: string;
  onDone?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  compact?: boolean;
}) {
  const { data: themes = [] } = useThemes();
  const { data: goals = [] } = useGoals();
  const taskMut = useTaskMut();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [themeId, setThemeId] = useState("");
  const [goalId, setGoalId] = useState(defaultGoalId ?? "");

  // Keep a valid theme selected whenever themes load or change.
  useEffect(() => {
    if (themes.length === 0) {
      setThemeId("");
      return;
    }
    const stillExists = themes.some((t) => String(t.id) === themeId);
    if (!stillExists) {
      if (defaultGoalId) {
        const g = goals.find((x) => String(x.id) === defaultGoalId);
        if (g?.theme_id) {
          setThemeId(String(g.theme_id));
          return;
        }
      }
      setThemeId(String(themes[0].id));
    }
  }, [themes, themeId, defaultGoalId, goals]);

  const handleGoalChange = (nextGoalId: string) => {
    setGoalId(nextGoalId);
    if (nextGoalId) {
      const g = goals.find((x) => String(x.id) === nextGoalId);
      if (g?.theme_id) setThemeId(String(g.theme_id));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    const effectiveTheme = themeId || (themes[0] ? String(themes[0].id) : "");
    if (!trimmed || !effectiveTheme) return;
    await taskMut.insert.mutateAsync({
      title: trimmed,
      theme_id: Number(effectiveTheme),
      goal_id: goalId ? Number(goalId) : null,
      planned_date: plannedDate ?? todayLocal(),
      status: "planned",
      created_at: new Date().toISOString(),
      notes: "",
      estimate_mins: null,
      priority: "normal",
    });
    setTitle("");
    if (!defaultGoalId) setGoalId("");
    toast({ type: "success", title: "Task added" });
    onDone?.();
  };

  const activeGoals = goals.filter((g) => g.status !== "done" || String(g.id) === goalId);

  return (
    <div className={compact ? "command-compact" : "command"}>
      <form className="command-form" onSubmit={handleSubmit}>
        <HaloInput
          ref={inputRef}
          classNames={{ root: "quick-title" }}
          placeholder={themes.length === 0 ? "Create a theme on Goals first…" : "Add a task and press Enter"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={themes.length === 0}
        />
        <SelectField
          className="theme-select"
          value={themeId}
          onChange={setThemeId}
          placeholder="Theme"
          ariaLabel="Theme"
          options={themes.map((t) => ({ value: String(t.id), label: String(t.name) }))}
        />
        {!defaultGoalId && (
          <SelectField
            className="theme-select"
            value={goalId}
            onChange={handleGoalChange}
            placeholder="No goal"
            ariaLabel="Goal"
            options={[
              { value: "", label: "No goal" },
              ...activeGoals.map((g) => ({ value: String(g.id), label: String(g.title) })),
            ]}
          />
        )}
        <Button
          variant="primary"
          type="submit"
          disabled={!title.trim() || themes.length === 0 || taskMut.insert.isPending}
        >
          <Icon name="plus" size={16} /> Add
        </Button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------- time edit */

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function Modal({
  title,
  label,
  onClose,
  children,
  footer,
}: {
  title: string;
  label?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <HaloModal
      open
      onClose={onClose}
      title={
        <>
          {label && <span className="modal-label">{label}</span>}
          <span className="modal-title">{title}</span>
        </>
      }
      icon={false}
      showClose
      layout="horizontal"
      actions={footer}
      className="modal-card"
      classNames={{
        overlay: "modal-overlay",
        header: "modal-header",
        title: "modal-title-holder",
        content: "modal-body",
        actions: "modal-actions",
        close: "modal-close",
      }}
    >
      <ScrollArea className="modal-scroll">
        <div className="modal-scroll-inner">{children}</div>
      </ScrollArea>
    </HaloModal>
  );
}

export function EditTime({ entry, onClose }: { entry: Row; onClose: () => void }) {
  const mut = useTimeMut();
  const { toast } = useToast();
  const [start, setStart] = useState(toLocalInput(String(entry.start_utc)));
  const [end, setEnd] = useState(entry.end_utc ? toLocalInput(String(entry.end_utc)) : "");
  const [error, setError] = useState("");
  const [sDate, sTime = "09:00"] = start.split("T");
  const [eDate = "", eTime = ""] = end ? end.split("T") : ["", ""];

  const save = async () => {
    setError("");
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    if (isNaN(startDate.getTime())) return setError("Start time is not valid.");
    if (endDate && isNaN(endDate.getTime())) return setError("End time is not valid.");
    if (endDate && endDate.getTime() <= startDate.getTime()) return setError("End must be after start.");
    await mut.update.mutateAsync({
      id: Number(entry.id),
      row: { start_utc: startDate.toISOString(), end_utc: endDate ? endDate.toISOString() : null },
    });
    toast({ type: "success", title: "Time entry updated" });
    onClose();
  };

  const remove = async () => {
    await mut.remove.mutateAsync(Number(entry.id));
    toast({ type: "success", title: "Time entry removed" });
    onClose();
  };

  return (
    <Modal
      title="Edit time entry"
      label="Time"
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" onClick={remove}>
            <Icon name="trash" size={14} /> Delete
          </Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="modal-grid">
        <Field label="Start">
          <div className="datetime-grid">
            <DateField value={sDate} onChange={(d) => setStart(`${d}T${sTime || "09:00"}`)} ariaLabel="Start date" />
            <TimeField step={5} value={sTime} onChange={(t) => setStart(`${sDate}T${t}`)} ariaLabel="Start time" />
          </div>
        </Field>
        <Field label="End" hint="Leave empty only if still running.">
          <div className="datetime-grid">
            <DateField
              value={eDate}
              onChange={(d) => setEnd(d ? `${d}T${eTime || sTime || "09:00"}` : "")}
              ariaLabel="End date"
            />
            <TimeField
              step={5}
              value={eTime}
              onChange={(t) => setEnd(`${eDate || sDate}T${t}`)}
              ariaLabel="End time"
            />
          </div>
        </Field>
      </div>
      <div className="time-chips">
        <Button size="sm" variant="secondary" onClick={() => setEnd(toLocalInput(new Date().toISOString()))}>
          Set end to now
        </Button>
        {end && (
          <Button size="sm" variant="ghost" onClick={() => setEnd("")}>
            Mark still running
          </Button>
        )}
      </div>
      {error && <span className="field-error">{error}</span>}
    </Modal>
  );
}

/* --------------------------------------------------------------- time list */

export function TimeToday({
  entries,
  tasks,
  onEdit,
}: {
  entries: Row[];
  tasks: Row[];
  onEdit: (e: Row) => void;
}) {
  const list = entries
    .filter((e) => localDay(String(e.start_utc)) === todayLocal())
    .sort((a, b) => String(b.start_utc).localeCompare(String(a.start_utc)));
  const total = list.reduce((s, e) => s + entryMinutes(e), 0);
  return (
    <Card>
      <div className="card-head plain">
        <Icon name="clock" size={18} className="icon-muted" />
        <span className="card-title">Time today</span>
        <span className="spacer" />
        <span className="count">{fmtHours(total)}</span>
      </div>
      <div className="card-body tight">
        {list.length === 0 && (
          <div className="field-hint">No time tracked yet. Start a timer from any task.</div>
        )}
        {list.map((e) => {
          const task = tasks.find((t) => Number(t.id) === Number(e.task_id));
          return (
            <div className="snapshot" key={e.id}>
              <span className="meta">
                {task ? String(task.title) : "Task"} · {fmtHours(entryMinutes(e))}
                {!e.end_utc && " · running"}
              </span>
              <Button variant="ghost" size="sm" aria-label="Edit time" onClick={() => onEdit(e)}>
                <Icon name="edit" size={14} />
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- task edit */

export function TaskEdit({ task, onClose }: { task: Row; onClose: () => void }) {
  const { data: themes = [] } = useThemes();
  const { data: goals = [] } = useGoals();
  const { data: entries = [] } = useTimeEntries();
  const mut = useTaskMut();
  const timeMut = useTimeMut();
  const { toast } = useToast();

  const [title, setTitle] = useState(String(task.title));
  const [notes, setNotes] = useState(String(task.notes ?? ""));
  const [themeId, setThemeId] = useState(String(task.theme_id));
  const [goalId, setGoalId] = useState(task.goal_id ? String(task.goal_id) : "");
  const [planned, setPlanned] = useState(String(task.planned_date));
  const [status, setStatus] = useState(String(task.status || "planned"));
  const [priority, setPriority] = useState(String(task.priority || "normal"));
  const [estimate, setEstimate] = useState(task.estimate_mins ? String(task.estimate_mins) : "");
  const [customMins, setCustomMins] = useState("");
  const [editingEntry, setEditingEntry] = useState<Row | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const mine = entries.filter((e) => Number(e.task_id) === Number(task.id));
  const total = taskMinutes(Number(task.id), entries);
  const today = todayLocal();

  const addMinutes = async (mins: number) => {
    if (!Number.isFinite(mins) || mins <= 0) return;
    const end = new Date();
    const start = new Date(end.getTime() - mins * 60000);
    await timeMut.insert.mutateAsync({
      task_id: Number(task.id),
      start_utc: start.toISOString(),
      end_utc: end.toISOString(),
    });
    toast({ type: "success", title: `Added ${fmtHours(mins)}` });
  };

  const clearTime = async () => {
    await Promise.all(mine.map((e) => timeMut.remove.mutateAsync(Number(e.id))));
    toast({ type: "success", title: "Cleared tracked time" });
  };

  const save = async () => {
    if (!title.trim() || !themeId) return;
    const estNum = estimate.trim() ? Math.round(Number(estimate)) : null;
    await mut.update.mutateAsync({
      id: Number(task.id),
      row: {
        title: title.trim(),
        notes: notes.trim(),
        theme_id: Number(themeId),
        goal_id: goalId ? Number(goalId) : null,
        planned_date: planned || today,
        status,
        priority,
        estimate_mins: estNum && estNum > 0 ? estNum : null,
      },
    });
    toast({ type: "success", title: "Task saved" });
    onClose();
  };

  const removeTask = async () => {
    await mut.remove.mutateAsync(Number(task.id));
    toast({ type: "success", title: "Task deleted" });
    onClose();
  };

  return (
    <>
      <Modal
        title="Edit task"
        label="Task"
        onClose={onClose}
        footer={
          <>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={15} /> Delete
            </Button>
            <span className="spacer" />
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={!title.trim() || !themeId}>
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
          <Field label="Title">
            <HaloInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <Field label="Notes">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context, checklist, or links…"
            />
          </Field>

          <div className="modal-grid">
            <Field label="Theme">
              <SelectField
                value={themeId}
                onChange={setThemeId}
                options={themes.map((t) => ({ value: String(t.id), label: String(t.name) }))}
              />
            </Field>
            <Field label="Planned date">
              <DateField value={planned} onChange={setPlanned} ariaLabel="Date" />
            </Field>
          </div>

          <div className="time-chips">
            <Button size="sm" variant="ghost" onClick={() => setPlanned(today)}>
              Today
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPlanned(addDays(today, 1))}>
              Tomorrow
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPlanned(addDays(today, 7))}>
              Next week
            </Button>
          </div>

          <div className="modal-grid">
            <Field label="Status">
              <SelectField
                value={status}
                onChange={setStatus}
                options={[
                  { value: "planned", label: "Planned" },
                  { value: "done", label: "Done" },
                ]}
              />
            </Field>
            <Field label="Priority">
              <SelectField
                value={priority}
                onChange={setPriority}
                options={[
                  { value: "low", label: "Low" },
                  { value: "normal", label: "Normal" },
                  { value: "high", label: "High" },
                ]}
              />
            </Field>
          </div>

          <div className="modal-grid">
            <Field label="Goal">
              <SelectField
                value={goalId}
                onChange={setGoalId}
                options={[
                  { value: "", label: "No goal" },
                  ...goals.map((g) => ({ value: String(g.id), label: String(g.title) })),
                ]}
              />
            </Field>
            <Field label="Estimate (minutes)">
              <HaloInput
                inputMode="numeric"
                placeholder="e.g. 45"
                value={estimate}
                onChange={(e) => setEstimate(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
          </div>

          <div className="field">
            <span className="field-label">Time tracked</span>
            <div className="time-chips">
              <Tag size="sm" color="neutral" className="chip">
                {fmtHours(total)}
              </Tag>
              <Button size="sm" variant="secondary" onClick={() => addMinutes(15)}>
                +15m
              </Button>
              <Button size="sm" variant="secondary" onClick={() => addMinutes(30)}>
                +30m
              </Button>
              <Button size="sm" variant="secondary" onClick={() => addMinutes(60)}>
                +1h
              </Button>
              <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <div style={{ width: 82 }}>
                  <HaloInput
                    inputMode="numeric"
                    placeholder="mins"
                    value={customMins}
                    onChange={(e) => setCustomMins(e.target.value.replace(/[^\d]/g, ""))}
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!customMins || Number(customMins) <= 0}
                  onClick={() => {
                    addMinutes(Number(customMins));
                    setCustomMins("");
                  }}
                >
                  Log
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={clearTime} disabled={mine.length === 0}>
                Clear all
              </Button>
            </div>
          </div>

          {mine.length > 0 && (
            <div>
              {mine.map((e) => (
                <div className="snapshot" key={e.id}>
                  <span className="meta">
                    {fmtDateShort(localDay(String(e.start_utc)))} ·{" "}
                    {toLocalInput(String(e.start_utc)).slice(11)} →{" "}
                    {e.end_utc ? toLocalInput(String(e.end_utc)).slice(11) : "running"} ·{" "}
                    {fmtHours(entryMinutes(e))}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Edit entry"
                    onClick={() => setEditingEntry(e)}
                  >
                    <Icon name="edit" size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete entry"
                    onClick={() => timeMut.remove.mutate(Number(e.id))}
                  >
                    <Icon name="x" size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {confirmDelete && (
            <Alert
              type="warning"
              variant="soft"
              title="Delete this task?"
              description={
                mine.length > 0
                  ? `This permanently deletes the task and its ${mine.length} time ${mine.length === 1 ? "entry" : "entries"}. Any linked money entries will remain unlinked.`
                  : "This permanently removes the task from every view."
              }
              actions={
                <>
                  <Button size="sm" variant="danger" onClick={removeTask}>
                    Delete task
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
      {editingEntry && <EditTime entry={editingEntry} onClose={() => setEditingEntry(null)} />}
    </>
  );
}

/* -------------------------------------------------------------- goal form */

export function GoalForm({
  goal,
  onClose,
}: {
  goal?: Row;
  onClose: () => void;
}) {
  const { data: themes = [] } = useThemes();
  const mut = useGoalMut();
  const { toast } = useToast();
  const isEdit = Boolean(goal);

  const [title, setTitle] = useState(goal ? String(goal.title) : "");
  const [notes, setNotes] = useState(goal ? String(goal.notes ?? "") : "");
  const [horizon, setHorizon] = useState(goal ? String(goal.horizon || "month") : "month");
  const [deadline, setDeadline] = useState(goal?.deadline ? String(goal.deadline) : "");
  const [status, setStatus] = useState(goal ? String(goal.status || "active") : "active");
  const [themeId, setThemeId] = useState(
    goal ? String(goal.theme_id) : themes[0] ? String(themes[0].id) : "",
  );

  useEffect(() => {
    if (!themeId && themes[0]) setThemeId(String(themes[0].id));
  }, [themes, themeId]);

  const submit = async () => {
    if (!title.trim() || !themeId) return;
    if (isEdit && goal) {
      await mut.update.mutateAsync({
        id: Number(goal.id),
        row: {
          title: title.trim(),
          notes: notes.trim(),
          horizon,
          deadline: deadline || null,
          theme_id: Number(themeId),
          status,
        },
      });
      toast({ type: "success", title: "Goal updated" });
    } else {
      await mut.insert.mutateAsync({
        title: title.trim(),
        notes: notes.trim(),
        horizon,
        deadline: deadline || null,
        theme_id: Number(themeId),
        status: "active",
      });
      toast({ type: "success", title: "Goal created" });
    }
    onClose();
  };

  return (
    <Modal
      title={isEdit ? "Edit goal" : "New goal"}
      label="Goal"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" disabled={!title.trim() || !themeId} onClick={submit}>
            {isEdit ? "Save changes" : "Create goal"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="modal-scroll-inner"
      >
        <Field label="Title">
          <HaloInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ship the redesign"
          />
        </Field>
        <Field label="Notes">
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What does success look like?"
          />
        </Field>
        <div className="modal-grid">
          <Field label="Horizon">
            <SelectField
              value={horizon}
              onChange={setHorizon}
              options={[
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
              ]}
            />
          </Field>
          <Field label="Deadline">
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <DateField value={deadline} onChange={setDeadline} ariaLabel="Deadline" />
              {deadline && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="icon-btn"
                  aria-label="Clear deadline"
                  onClick={() => setDeadline("")}
                >
                  <Icon name="x" size={14} />
                </Button>
              )}
            </div>
          </Field>
        </div>
        <div className="modal-grid">
          <Field label="Theme">
            <SelectField
              value={themeId}
              onChange={setThemeId}
              placeholder="Theme"
              options={themes.map((t) => ({ value: String(t.id), label: String(t.name) }))}
            />
          </Field>
          {isEdit && (
            <Field label="Status">
              <SelectField
                value={status}
                onChange={setStatus}
                options={[
                  { value: "active", label: "In progress" },
                  { value: "done", label: "Completed" },
                ]}
              />
            </Field>
          )}
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------- misc */

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="page">
      <PageHead title={title} />
      {children}
    </section>
  );
}

export { Alert };
export const TabsWrap = { Tabs, TabList, Tab, TabPanel };
