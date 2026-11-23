import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@halo-ds/react";
import * as api from "../lib/api";
import {
  useCurrency,
  useDebouncedSettings,
  useGoalMut,
  useRefreshRates,
  useSettings,
  useThemeMut,
} from "../lib/hooks";
import { currencyOptions } from "../lib/currency";
import { AiProvidersCard, AiUsageCard, VoiceSettingsCard } from "../components/AiWidgets";
import {
  Alert,
  Button,
  Card,
  ComboboxField,
  Icon,
  Input,
  PageHead,
  Switch,
  TimeField,
} from "../components/ui";

const SWATCHES = ["#5749F4", "#A1E5A1", "#FFD9B2", "#C9D6F0", "#F7C9DC", "#D9D9DB"];

function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* --------------------------------------------------------- Settings Page */

export function SettingsPage({ initialSection }: { initialSection?: string }) {
  const { data: settings = {} } = useSettings();
  const save = useDebouncedSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [section, setSection] = useState(initialSection || "ai-providers");
  const [status, setStatus] = useState("");
  const [backups, setBackups] = useState<api.BackupItem[]>([]);
  const [restoreName, setRestoreName] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [backupKeep, setBackupKeep] = useState("30");
  const { code, rate, table } = useCurrency();

  useEffect(() => {
    if (settings.backup_keep != null) {
      setBackupKeep(String(settings.backup_keep));
    }
  }, [settings.backup_keep]);
  const { refresh: refreshRates, busy: ratesBusy, error: ratesError } = useRefreshRates();
  const currencies = currencyOptions(table.rates);
  const ratesAt = table.at
    ? new Date(table.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Never";

  const refresh = () => api.listBackups().then(setBackups).catch(() => setBackups([]));
  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (initialSection) {
      setSection(initialSection);
      setTimeout(() => {
        document.getElementById(`section-${initialSection}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
    }
  }, [initialSection]);

  const pickFolder = async () => {
    const { path } = await api.pickBackupFolder();
    if (path) {
      save({ backup_folder: path });
      setStatus(`Backup folder: ${path}`);
      setTimeout(refresh, 450);
    }
  };

  const exportJson = async () => {
    try {
      const data = await api.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-planner-export-${api.todayLocal()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ type: "success", title: "Exported planner data to JSON" });
    } catch (e) {
      toast({ type: "error", title: "Export failed", description: String(e) });
    }
  };

  const sections = [
    { id: "ai-providers", label: "AI providers", icon: "sparkles" },
    { id: "ai-voice", label: "Voice", icon: "volume" },
    { id: "ai-usage", label: "AI usage", icon: "chart" },
    { id: "general", label: "General", icon: "settings" },
    { id: "currency", label: "Currency", icon: "wallet" },
    { id: "backup", label: "Data & storage", icon: "database" },
    { id: "review", label: "Weekly review", icon: "bell" },
  ];

  const go = (id: string) => {
    setSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="page">
      <PageHead
        title="Preferences"
        subtitle="Local-first SQLite storage with your own multi-provider AI and voice models"
        actions={
          <Button variant="primary" onClick={() => navigate({ to: "/today" })}>
            Done
          </Button>
        }
      />

      <div className="settings-grid">
        <Card className="settings-nav">
          <div style={{ padding: "2px 10px 8px", fontSize: 14, fontWeight: 600 }}>Sections</div>
          {sections.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`settings-nav-item ${section === s.id ? "active" : ""}`}
              onClick={() => go(s.id)}
            >
              <Icon name={s.icon} size={17} />
              {s.label}
            </button>
          ))}
        </Card>

        <div className="settings-col">
          <AiProvidersCard />
          <VoiceSettingsCard />
          <AiUsageCard />

          <Card id="section-general">
            <div className="card-head plain">
              <Icon name="settings" size={18} className="icon-muted" />
              <span className="card-title">General</span>
            </div>
            <div className="card-body pad" style={{ paddingTop: 4 }}>
              <SettingRow title="Wake-up time" hint="When your planning day starts">
                <div className="setting-control narrow">
                  <TimeField
                    value={settings.wake_up_time ?? "07:00"}
                    onChange={(v) => save({ wake_up_time: v })}
                    ariaLabel="Wake-up time"
                  />
                </div>
              </SettingRow>
              <SettingRow
                title="Backup retention"
                hint="How many snapshots to keep before the oldest is removed"
              >
                <div className="setting-control narrow">
                  <Input
                    inputMode="numeric"
                    min={1}
                    value={backupKeep}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^\d]/g, "");
                      setBackupKeep(clean);
                      if (clean && Number(clean) >= 1) {
                        save({ backup_keep: clean });
                      }
                    }}
                    onBlur={() => {
                      const clamped = Math.max(1, Number(backupKeep) || 1);
                      setBackupKeep(String(clamped));
                      save({ backup_keep: String(clamped) });
                    }}
                  />
                </div>
              </SettingRow>
              <SettingRow
                title="Snapshots are encrypted"
                hint="Set a passphrase under Data & storage to encrypt new snapshots"
              >
                <div className="setting-control" style={{ textAlign: "right" }}>
                  <span className={`chip ${settings.backup_passphrase ? "chip-success" : "chip-neutral"}`}>
                    {settings.backup_passphrase ? "On" : "Off"}
                  </span>
                </div>
              </SettingRow>
            </div>
          </Card>

          <Card id="section-currency">
            <div className="card-head plain">
              <Icon name="wallet" size={18} className="icon-muted" />
              <span className="card-title">Currency</span>
            </div>
            <div className="card-body pad" style={{ paddingTop: 4 }}>
              <SettingRow
                title="Display currency"
                hint="Every amount you enter and see uses this currency"
              >
                <div className="setting-control wide">
                  <ComboboxField
                    key={code}
                    value={code}
                    onChange={(value) => save({ currency: value })}
                    options={currencies}
                    placeholder="Display currency"
                    ariaLabel="Display currency"
                  />
                </div>
              </SettingRow>
              <SettingRow
                title="Exchange rates"
                hint={
                  code === "USD"
                    ? `Amounts are stored in USD · rates updated ${ratesAt}`
                    : `1 USD = ${rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${code} · updated ${ratesAt}`
                }
              >
                <div
                  className="setting-control"
                  style={{ display: "flex", alignItems: "flex-end", gap: 6, flexDirection: "column" }}
                >
                  <Button variant="secondary" onClick={refreshRates} disabled={ratesBusy}>
                    <Icon name="refresh" size={15} /> {ratesBusy ? "Fetching…" : "Refresh rates"}
                  </Button>
                  {ratesError && <span className="field-error">{ratesError}</span>}
                </div>
              </SettingRow>
              <div className="field-hint" style={{ padding: "2px 0 10px" }}>
                Rates by exchangerate-api.com. Your amounts stay in this device's database; only the
                rate table is downloaded.
              </div>
              <SettingRow
                title="Show kept as an amount"
                hint="Show the money you kept instead of the kept percentage"
              >
                <Switch
                  checked={(settings.kept_display ?? "percent") === "amount"}
                  onChange={(checked) => save({ kept_display: checked ? "amount" : "percent" })}
                  label="Show kept as an amount"
                />
              </SettingRow>
            </div>
          </Card>

          <Card id="section-backup">
            <div className="card-head plain">
              <Icon name="database" size={18} className="icon-muted" />
              <span className="card-title">Data & storage</span>
            </div>
            <div className="card-body pad" style={{ paddingTop: 4 }}>
              <SettingRow
                title="Backup folder"
                hint={settings.backup_folder || "No folder chosen yet"}
              >
                <div className="setting-control" style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" onClick={pickFolder}>
                    <Icon name="folder" size={15} /> Choose
                  </Button>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      try {
                        const r = await api.backupNow();
                        setStatus(`Backed up to ${r.file}`);
                        setError("");
                        await qc.invalidateQueries({ queryKey: ["settings"] });
                        refresh();
                        toast({ type: "success", title: "Backup saved", description: r.file });
                      } catch (e) {
                        setError(String(e));
                        toast({ type: "error", title: "Backup failed", description: String(e) });
                      }
                    }}
                  >
                    <Icon name="download" size={15} /> Back up now
                  </Button>
                </div>
              </SettingRow>
              <SettingRow
                title="Last backup"
                hint={
                  settings.last_backup_at
                    ? new Date(settings.last_backup_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "Never backed up"
                }
              >
                <span className="backup-note">
                  {settings.backup_folder ? `${backups.length} snapshots kept` : "Choose a folder first"}
                </span>
              </SettingRow>
              <SettingRow
                title="Passphrase"
                hint="Optional. Encrypts new snapshots with AES-256-GCM; keep it somewhere safe"
              >
                <div className="setting-control wide">
                  <Input
                    type="password"
                    placeholder="No passphrase"
                    value={settings.backup_passphrase ?? ""}
                    onChange={(e) => save({ backup_passphrase: e.target.value })}
                  />
                </div>
              </SettingRow>
              <SettingRow
                title="Export workspace"
                hint="Download a readable JSON copy of all themes, goals, tasks, time, money and routines"
              >
                <Button variant="secondary" onClick={exportJson}>
                  <Icon name="download" size={15} /> Export JSON
                </Button>
              </SettingRow>
              {(status || error) && (
                <div className={error ? "field-error" : "field-hint"} style={{ padding: "4px 0 10px" }}>
                  {error || status}
                </div>
              )}

              <div style={{ borderTop: "1px solid var(--muted)", paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                  <span className="field-label">Snapshots</span>
                  <span style={{ flex: 1 }} />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="icon-btn"
                    aria-label="Refresh snapshots"
                    onClick={refresh}
                  >
                    <Icon name="refresh" size={15} />
                  </Button>
                </div>
                {backups.length === 0 && (
                  <div className="field-hint">
                    No snapshots yet. They are taken after changes settle, on a schedule, and when
                    you close the app.
                  </div>
                )}
                {backups.map((b) => (
                  <div className="snapshot" key={b.name}>
                    <Icon name="database" size={15} />
                    <span className="meta">
                      {b.name} · {(b.bytes / 1024).toFixed(0)} KB ·{" "}
                      {b.modified.slice(0, 16).replace("T", " ")}
                      {b.encrypted ? " · encrypted" : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setRestoreName(b.name);
                        setPass("");
                        setError("");
                      }}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>

              {restoreName && (
                <Alert
                  className="inline-alert"
                  type="warning"
                  variant="soft"
                  title={`Restore ${restoreName}?`}
                  description="This replaces everything now in My Planner. A safety copy of the current database is written to the backup folder first."
                  actions={
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <div style={{ flex: "1 1 200px" }}>
                        <Input
                          type="password"
                          placeholder="Passphrase if this snapshot is encrypted"
                          value={pass}
                          onChange={(e) => setPass(e.target.value)}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          try {
                            const r = await api.restoreBackup(restoreName, pass);
                            setStatus(`Restored. Safety copy: ${r.safety_copy}`);
                            setError("");
                            setRestoreName("");
                            await qc.invalidateQueries();
                            toast({
                              type: "success",
                              title: "Backup restored",
                              description: `Safety copy saved: ${r.safety_copy}`,
                            });
                          } catch (e) {
                            setError(String(e));
                            toast({
                              type: "error",
                              title: "Restore failed",
                              description: String(e),
                            });
                          }
                        }}
                      >
                        Yes, restore
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRestoreName("")}>
                        Cancel
                      </Button>
                    </div>
                  }
                />
              )}
            </div>
          </Card>

          <Card id="section-review">
            <div className="card-head plain">
              <Icon name="bell" size={18} className="icon-muted" />
              <span className="card-title">Weekly review</span>
            </div>
            <div className="card-body pad" style={{ paddingTop: 4 }}>
              <SettingRow
                title="Review time"
                hint="Default is Sunday at 6:00 PM; the banner opens the weekly report"
              >
                <div className="setting-control narrow">
                  <TimeField
                    value={settings.review_time ?? "18:00"}
                    onChange={(v) => save({ review_time: v })}
                    ariaLabel="Review time"
                  />
                </div>
              </SettingRow>
              <SettingRow
                title="Weekly review reminder"
                hint="Show an in-app banner and native Windows notification on Sundays"
              >
                <Switch
                  checked={(settings.review_enabled ?? "1") === "1"}
                  onChange={(checked) => save({ review_enabled: checked ? "1" : "0" })}
                  label="Weekly review reminder"
                />
              </SettingRow>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- First Run Page */

export function FirstRunPage() {
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const themeMut = useThemeMut();
  const goalMut = useGoalMut();

  const [folder, setFolder] = useState("");
  const [wake, setWake] = useState("07:00");
  const [review, setReview] = useState("18:00");
  const [theme, setTheme] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!settings || hydrated) return;
    setHydrated(true);
    if (settings.backup_folder) setFolder(String(settings.backup_folder));
    if (settings.wake_up_time) setWake(String(settings.wake_up_time));
    if (settings.review_time) setReview(String(settings.review_time));
  }, [settings, hydrated]);

  const finish = async (skip = false, openAiSetup = false) => {
    setBusy(true);
    setError("");
    try {
      if (!skip) {
        let themeId: number | null = null;
        if (theme.trim()) {
          const { id } = await themeMut.insert.mutateAsync({ name: theme.trim(), color });
          themeId = id;
        } else if (goal.trim()) {
          // Never drop the user's first goal if they skipped naming a theme.
          const { id } = await themeMut.insert.mutateAsync({ name: "General", color });
          themeId = id;
        }
        if (goal.trim() && themeId) {
          await goalMut.insert.mutateAsync({
            title: goal.trim(),
            horizon: "month",
            deadline: null,
            theme_id: themeId,
            status: "active",
            notes: "",
          });
        }
        await api.setSettings({
          backup_folder: folder,
          wake_up_time: wake,
          review_time: review,
          first_run_done: "1",
        });
      } else {
        await api.setSettings({ first_run_done: "1" });
      }
      // Update & invalidate settings cache BEFORE navigating so useFirstRunRedirect never bounces back!
      qc.setQueryData<Record<string, string>>(["settings"], (prev) => ({
        ...(prev ?? {}),
        backup_folder: skip ? prev?.backup_folder ?? "" : folder,
        wake_up_time: skip ? prev?.wake_up_time ?? "07:00" : wake,
        review_time: skip ? prev?.review_time ?? "18:00" : review,
        first_run_done: "1",
      }));
      await qc.invalidateQueries({ queryKey: ["settings"] });
      if (openAiSetup) {
        navigate({ to: "/settings", search: { section: "ai-providers" } });
      } else {
        navigate({ to: "/today" });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <Card className="setup-card">
        <div className="setup-icon">
          <Icon name="database" size={22} />
        </div>
        <h1 className="setup-title">Set up My Planner</h1>
        <p className="setup-sub">
          Tasks, time, money and daily non-negotiables live in a SQLite file you own. Optionally
          connect Anthropic, OpenAI, Google Gemini, or a local model for AI coaching.
        </p>

        <div className="setup-form">
          <div className="field">
            <span className="field-label">Backup folder</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="C:\Users\you\OneDrive\MyPlanner-backups"
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  const r = await api.pickBackupFolder();
                  if (r.path) setFolder(r.path);
                }}
              >
                Choose…
              </Button>
            </div>
            <span className="field-hint">
              A Drive, OneDrive or Dropbox folder keeps copies off this laptop.
            </span>
          </div>

          <div className="modal-grid">
            <div className="field">
              <span className="field-label">Wake-up time</span>
              <TimeField value={wake} onChange={setWake} ariaLabel="Wake-up time" />
            </div>
            <div className="field">
              <span className="field-label">Weekly review time</span>
              <TimeField value={review} onChange={setReview} ariaLabel="Weekly review time" />
            </div>
          </div>

          <div className="field">
            <span className="field-label">First theme</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <Input
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="Health, Builder, Money…"
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
            </div>
            <span className="field-hint">Every task has a theme. You can add more later.</span>
          </div>

          <div className="field">
            <span className="field-label">First goal (optional)</span>
            <Input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Ship the redesign"
            />
          </div>

          {error && <div className="field-error">{error}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            <Button
              variant="primary"
              className="btn-block"
              disabled={busy}
              onClick={() => finish(false, false)}
            >
              <Icon name="check" size={16} /> {busy ? "Setting up…" : "Finish setup"}
            </Button>
            <Button
              variant="secondary"
              className="btn-block"
              disabled={busy}
              onClick={() => finish(false, true)}
            >
              <Icon name="sparkles" size={15} /> Finish &amp; connect an AI provider
            </Button>
            <Button
              variant="ghost"
              className="btn-block"
              disabled={busy}
              onClick={() => finish(true, false)}
            >
              Skip for now
            </Button>
          </div>

          <div className="setup-note">
            <Icon name="shield" size={16} />
            Your tasks, time and money stay on this device. AI is opt-in: keys are encrypted locally
            and requests go straight to the provider you choose.
          </div>
        </div>
      </Card>
    </div>
  );
}
