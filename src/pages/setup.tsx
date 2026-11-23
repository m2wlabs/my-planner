import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, SocialButton, useToast } from "@halo-ds/react";
import * as api from "../lib/api";
import {
  useAiModels,
  useCurrency,
  useDebouncedSettings,
  useGoalMut,
  useGoogleAuth,
  useRefreshRates,
  useSettings,
  useThemeMut,
} from "../lib/hooks";
import { currencyOptions } from "../lib/currency";
import {
  Alert,
  Button,
  Card,
  ComboboxField,
  Field,
  Icon,
  Input,
  PageHead,
  SelectField,
  Switch,
  Textarea,
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

function GoogleAccountSection() {
  const { data: auth } = useGoogleAuth();
  const { data: modelsRes, refetch: refetchModels, isFetching: fetchingModels } = useAiModels();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showOauthConfig, setShowOauthConfig] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [quotaProject, setQuotaProject] = useState("");
  const [jsonPaste, setJsonPaste] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth) return;
    setClientId(auth.oauth_client_id || "");
    setQuotaProject(auth.quota_project_id || "");
  }, [auth?.oauth_client_id, auth?.quota_project_id]);

  const invalidateAuth = async () => {
    await qc.invalidateQueries({ queryKey: ["google_auth"] });
    await qc.invalidateQueries({ queryKey: ["ai_models"] });
  };

  const handlePickJson = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await api.googlePickClientJson();
      if (!res.cancelled) {
        await invalidateAuth();
        setShowOauthConfig(false);
        toast({ type: "success", title: "Google OAuth client imported" });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleImportJsonPaste = async () => {
    if (!jsonPaste.trim()) return;
    setError("");
    setBusy(true);
    try {
      await api.googleImportClientJson(jsonPaste.trim());
      setJsonPaste("");
      await invalidateAuth();
      setShowOauthConfig(false);
      toast({ type: "success", title: "Google OAuth client imported" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveManualOauth = async () => {
    if (!clientId.trim()) return;
    setError("");
    setBusy(true);
    try {
      await api.googleSaveOauthConfig(clientId.trim(), clientSecret.trim(), quotaProject.trim());
      setClientSecret("");
      await invalidateAuth();
      toast({ type: "success", title: "Google OAuth client saved" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleOauthSignIn = async () => {
    if (!auth?.oauth_configured) {
      setShowOauthConfig(true);
      return;
    }
    setError("");
    setTestResult(null);
    setSigningIn(true);
    try {
      await api.googleOauthSignIn();
      await invalidateAuth();
      toast({ type: "success", title: "Signed in with Google" });
    } catch (e) {
      setError(String(e));
    } finally {
      setSigningIn(false);
    }
  };

  const handleImportAdc = async () => {
    setError("");
    setTestResult(null);
    setBusy(true);
    try {
      await api.googleImportAdc();
      await invalidateAuth();
      toast({ type: "success", title: "Connected local Google CLI account" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setTestResult(null);
    setBusy(true);
    try {
      await api.googleSaveApiKey(apiKey.trim());
      setApiKey("");
      await invalidateAuth();
      toast({ type: "success", title: "Google AI Studio key saved" });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleClearApiKey = async () => {
    setBusy(true);
    try {
      await api.googleSaveApiKey("", false);
      await invalidateAuth();
      toast({ type: "success", title: "Removed API key" });
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async (clearKey = false) => {
    setBusy(true);
    setError("");
    setTestResult(null);
    try {
      await api.googleSignOut(clearKey);
      await invalidateAuth();
      toast({ type: "success", title: "Disconnected Google Account" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleTestConnection = async () => {
    setBusy(true);
    setError("");
    setTestResult(null);
    try {
      const res = await api.googleTestConnection();
      setTestResult({
        ok: true,
        text: `Connected to ${res.model} via ${res.transport === "oauth" ? "Google OAuth" : "AI Studio key"} — "${res.reply.trim()}"`,
      });
      toast({ type: "success", title: "Gemini connection verified" });
    } catch (e) {
      const msg = String(e);
      setTestResult({ ok: false, text: msg });
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const models = modelsRes?.models ?? [];

  return (
    <Card id="section-google">
      <div className="card-head plain">
        <Icon name="sparkles" size={18} className="icon-muted" />
        <span className="card-title">Google Account & AI Models</span>
        <span className="spacer" />
        <span className={`chip ${auth?.connected ? "chip-success" : "chip-neutral"}`}>
          {auth?.connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="card-body pad" style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Connected profile summary */}
        {auth?.has_oauth && (
          <div className="google-profile-card">
            <Avatar
              src={auth.profile?.picture || undefined}
              initials={(auth.profile?.name || auth.profile?.email || "G").slice(0, 2).toUpperCase()}
              size="md"
              status="online"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {auth.profile?.name || "Google Account"}
              </div>
              <div className="field-hint">
                {auth.profile?.email || "Authenticated via Google OAuth"} ·{" "}
                {auth.auth_method === "adc" ? "Local Google CLI (ADC)" : "OAuth 2.0 PKCE"}
              </div>
            </div>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleSignOut(false)}>
              <Icon name="logout" size={14} /> Sign out
            </Button>
          </div>
        )}

        {/* Primary sign-in controls */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <SocialButton
            provider="google"
            variant="outline"
            disabled={signingIn || busy}
            onClick={handleOauthSignIn}
          >
            {signingIn
              ? "Waiting for browser sign-in…"
              : auth?.has_oauth
                ? "Switch Google Account"
                : "Sign in with Google"}
          </SocialButton>

          {signingIn && (
            <Button size="sm" variant="ghost" onClick={() => api.googleOauthCancel()}>
              Cancel
            </Button>
          )}

          {auth?.adc_available && (
            <Button variant="secondary" disabled={busy || signingIn} onClick={handleImportAdc}>
              <Icon name="user" size={15} /> Connect local Google CLI
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowOauthConfig((v) => !v)}
          >
            <Icon name="settings" size={14} />{" "}
            {auth?.oauth_configured ? "OAuth client settings" : "Configure Google OAuth client"}
          </Button>
        </div>

        {/* Collapsible Google Cloud Desktop OAuth Client setup */}
        {(showOauthConfig || (!auth?.oauth_configured && !auth?.has_oauth)) && (
          <div className="oauth-config-box">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13 }}>Google Cloud Desktop OAuth Client (PKCE)</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" variant="secondary" disabled={busy} onClick={handlePickJson}>
                  <Icon name="folder" size={14} /> Import client_secret.json
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => api.googleOpenUrl("https://console.cloud.google.com/apis/credentials")}
                >
                  <Icon name="external" size={13} /> Cloud Console
                </Button>
              </div>
            </div>
            <div className="field-hint">
              Create an OAuth 2.0 Client ID of type <strong>Desktop app</strong> in Google Cloud
              Console and import its JSON file (or paste credentials below). Tokens stay encrypted
              locally and outside your planner backups.
            </div>
            <div className="modal-grid">
              <Field label="Client ID">
                <Input
                  placeholder="xxxx.apps.googleusercontent.com"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </Field>
              <Field label="Client Secret">
                <Input
                  type="password"
                  placeholder={auth?.has_oauth_client_secret ? "Saved (leave blank to keep)" : "GOCSPX-…"}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Google Cloud Quota Project ID (optional)" className="grow">
                <Input
                  placeholder="my-gcp-project-id"
                  value={quotaProject}
                  onChange={(e) => setQuotaProject(e.target.value)}
                />
              </Field>
              <Button size="sm" variant="primary" disabled={busy || !clientId.trim()} onClick={handleSaveManualOauth}>
                Save OAuth client
              </Button>
            </div>
            <details style={{ fontSize: 13 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted-foreground)" }}>
                Or paste client_secret.json text
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <Textarea
                  rows={3}
                  placeholder='{"installed":{"client_id":"...","client_secret":"..."}}'
                  value={jsonPaste}
                  onChange={(e) => setJsonPaste(e.target.value)}
                />
                <div>
                  <Button size="sm" variant="secondary" disabled={busy || !jsonPaste.trim()} onClick={handleImportJsonPaste}>
                    Import pasted JSON
                  </Button>
                </div>
              </div>
            </details>
          </div>
        )}

        {/* Google AI Studio direct API key */}
        <SettingRow
          title="Google AI Studio API key"
          hint={
            auth?.has_api_key
              ? `Saved key: ${auth.api_key_preview} · Stored encrypted outside backups`
              : "Instant direct access to Gemini models using your Google AI Studio account"
          }
        >
          <form
            onSubmit={handleSaveApiKey}
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          >
            <div style={{ width: 210 }}>
              <Input
                type="password"
                placeholder={auth?.has_api_key ? "Replace key…" : "Paste AIza… key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <Button size="sm" variant="primary" type="submit" disabled={busy || !apiKey.trim()}>
              Save
            </Button>
            {auth?.has_api_key ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={handleClearApiKey}>
                Remove
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => api.googleOpenUrl("https://aistudio.google.com/apikey")}
              >
                <Icon name="external" size={14} /> Get key
              </Button>
            )}
          </form>
        </SettingRow>

        {auth?.has_oauth && auth?.has_api_key && (
          <SettingRow
            title="Use AI Studio key for Gemini calls"
            hint="Keep your Google Account signed in while routing AI billing through your AI Studio key"
          >
            <Switch
              checked={Boolean(auth.prefer_api_key)}
              onChange={async (checked) => {
                await api.googleSetPreferences({ preferApiKey: checked });
                invalidateAuth();
              }}
              label="Use AI Studio key for Gemini calls"
            />
          </SettingRow>
        )}

        {/* Model selector & connection test */}
        <SettingRow
          title="Default Gemini model"
          hint={
            modelsRes?.live
              ? "Live models synced from your Google Account"
              : "Current Gemini 4 & 3.5 models (Interactions API v1)"
          }
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="setting-control wide">
              <SelectField
                value={auth?.preferred_model || "gemini-4-hydrogen"}
                onChange={async (modelId) => {
                  await api.googleSetPreferences({ preferredModel: modelId });
                  invalidateAuth();
                }}
                ariaLabel="Default Gemini model"
                options={
                  models.length > 0
                    ? models.map((m) => ({
                        value: m.id,
                        label: `${m.label}${m.badge ? ` · ${m.badge}` : ""}`,
                      }))
                    : [{ value: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" }]
                }
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="icon-btn"
              aria-label="Refresh models"
              disabled={fetchingModels}
              onClick={() => refetchModels()}
            >
              <Icon name="refresh" size={15} />
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          title="Verify live AI connection"
          hint="Send a lightweight ping to the Gemini Interactions API using your active Google credentials"
        >
          <Button
            variant="secondary"
            disabled={busy || !auth?.connected}
            onClick={handleTestConnection}
          >
            <Icon name="zap" size={15} /> {busy ? "Testing…" : "Test connection"}
          </Button>
        </SettingRow>

        {testResult && (
          <Alert
            type={testResult.ok ? "success" : "error"}
            variant="soft"
            title={testResult.ok ? "Connection healthy" : "Connection check failed"}
            description={testResult.text}
          />
        )}
        {error && !testResult && <span className="field-error">{error}</span>}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------- Settings Page */

export function SettingsPage({ initialSection }: { initialSection?: string }) {
  const { data: settings = {} } = useSettings();
  const save = useDebouncedSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [section, setSection] = useState(initialSection || "google");
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
    { id: "google", label: "Google & AI", icon: "sparkles" },
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
        subtitle="Local-first SQLite storage with direct Google Account AI integration"
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
          <GoogleAccountSection />

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
                hint="Download a readable JSON copy of all themes, goals, tasks, time, and money"
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

  const finish = async (skip = false, openGoogleSetup = false) => {
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
      if (openGoogleSetup) {
        navigate({ to: "/settings", search: { section: "google" } });
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
          Tasks, time and money live in a SQLite file you own. Optionally connect your Google
          Account anytime to unlock Gemini AI planning.
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
              <Icon name="sparkles" size={15} /> Finish & connect Google Account AI
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
            Your tasks, time and money stay on this device. Google AI is opt-in and runs directly
            against your own account.
          </div>
        </div>
      </Card>
    </div>
  );
}
