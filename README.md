# My Planner

Local-first desktop planner for tasks, goals, time tracking, money tracking, and direct Gemini AI coaching connected to your Google Account.

Tauri 2 shell · React 19 + TypeScript + Vite · TanStack Router / Query · SQLite in Rust · Halo UI (`@halo-ds/react`) · Google OAuth 2.0 (PKCE) & Gemini Interactions API (`v1`).

## Run

```bash
bun install
bun run tauri dev
```

Frontend-only browser preview (uses a local browser fallback store when outside Tauri): `bun run dev`.

## Package

```bash
bun run tauri build
```

Installers land in `src-tauri/target/release/bundle/` (Windows: `msi/` and `nsis/`).

Checks: `bun run typecheck`, `bun run build`, `cd src-tauri && cargo test`.

## Google Account & Direct AI Models

Open **Settings → Google & AI** (or **AI Coach** / press `Ctrl+K`) to connect directly to Gemini models (`gemini-4-hydrogen`, `gemini-4-argon`, `gemini-4-neon`, `gemini-4-carbon`, `gemini-3.5-flash-lite`, plus live models discovered on your account):

- **Sign in with Google (OAuth 2.0 + PKCE)**: Import your Google Cloud Desktop App `client_secret_*.json` (or enter Client ID / Secret), sign in through your system browser with automatic loopback callback and token refresh.
- **Local Google CLI (ADC)**: One-click import if `gcloud` Application Default Credentials exist on your machine.
- **Google AI Studio API Key**: Paste a Gemini API key directly (standalone or alongside your signed-in Google Account).

OAuth tokens and API keys are stored encrypted at rest in `%APPDATA%\com.myplanner.app\MyPlanner\google-auth.enc` — separate from `my-planner.db` so database backups never include credentials.

AI Coach uses the Gemini Interactions API (`POST https://generativelanguage.googleapis.com/v1/interactions`) with `store: false` and structured action proposals so you can preview and apply tasks, goals, reschedules, and money entries in one click.

## Where data lives

- Database: `%APPDATA%\com.myplanner.app\MyPlanner\my-planner.db` (Tauri app-data dir; WAL mode, `PRAGMA user_version = 2`).
- Backups: the folder you pick in Settings / First run. Managed snapshots are `my-planner-YYYYMMDD-HHMMSS.db` (or `.enc` when encrypted with AES-256-GCM + Argon2id). The last `N` (default 30) managed snapshots are kept; `pre-restore-*.db` safety copies and unrelated files are never pruned.

## Structure

```
src/
  App.tsx                  router, AI drawer provider, Sunday weekly review
  components/ui.tsx        shell, TopBar popovers, timer bar, TaskRow, QuickTask, modals
  pages/planning.tsx       Today, Goals, Tomorrow/Week/Month calendar/Year planner, Themes
  pages/money.tsx          Money ledger + edit modal + CSV export, Weekly/Monthly Reports
  pages/ai.tsx             AI Coach page & Ctrl+K slide-over drawer with one-click actions
  pages/setup.tsx          Settings (Google & AI, General, Currency, Data, Review) & First run
  lib/api.ts               typed Tauri invoke wrappers + date helpers
  lib/hooks.ts             TanStack Query hooks, optimistic timer & settings, toasts
src-tauri/src/
  db.rs                    v1→v2 lossless migrations, FK cascades, CRUD, AI context snapshot
  backup.rs                WAL-safe snapshots, managed pruning, encryption, safe restore
  google_ai.rs             Google OAuth 2.0 PKCE loopback, ADC import, Gemini Interactions API v1
```
