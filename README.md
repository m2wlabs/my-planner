# My Planner

Local-first desktop planner: tasks, time tracking and money tracking. No accounts, no server — SQLite on your computer, backups to a folder you choose (any folder, including one synced by Google Drive / OneDrive / Dropbox).

Tauri 2 shell · React + TypeScript + Vite · TanStack Router / Query / Form · Zod · SQLite in Rust · Halo UI (`@halo-ds/react`).

## Run

```bash
bun install
bun run tauri dev
```

Frontend only (browser, without the Rust backend): `bun run dev` — DB calls will fail there.

## Package

```bash
bun run tauri build
```

Installers land in `src-tauri/target/release/bundle/` (Windows: `msi/` and `nsis/`).

Checks: `bun run typecheck`, `cd src-tauri && cargo check`.

## Where data lives

- Database: `%APPDATA%\com.myplanner.app\MyPlanner\my-planner.db` (Tauri app-data dir; WAL mode).
  macOS: `~/Library/Application Support/com.myplanner.app/MyPlanner/`, Linux: `~/.local/share/com.myplanner.app/MyPlanner/`.
- Backups: the folder you pick in Settings / First run. Files are `my-planner-YYYYMMDD-HHMMSS.db`, or `.enc` when a passphrase is set. The last N (default 30) are kept.

## How backups work

- Snapshots use SQLite's backup API (`rusqlite::backup`), never a copy of the live file.
- Written after edits settle (5s debounce), every 15 minutes when the DB changed, and on app exit.
- Restore lists snapshots, warns that current data is replaced, keeps a `pre-restore-*.db` safety copy, then swaps the database in.
- Optional passphrase encryption: AES-256-GCM with an Argon2id-derived key.
- `BackupProvider` trait in `src-tauri/src/backup.rs` — a future Google Drive app-private provider implements `directory()`/`name()` and nothing else changes.

## Structure

```
src/
  App.tsx              router + weekly review notification
  components/ui.tsx    layout, sidebar, timer bar, task card, quick add
  pages/planning.tsx   Today, Goals + planner tabs, time editing
  pages/money.tsx      Money and Reports
  pages/setup.tsx      Settings and First run
  lib/api.ts           invoke() wrappers + date/number helpers
  lib/hooks.ts         TanStack Query hooks, debounced backup trigger
src-tauri/src/
  db.rs                migrations, CRUD, timer, settings
  backup.rs            snapshots, prune, restore, encryption
```

Data model: `themes`, `goals` (horizon week/month/year, optional deadline, theme, status), `tasks` (nullable `goal_id`, required `theme_id`, `planned_date`), `time_entries` (`start_utc`, nullable `end_utc` — an open row is the running timer and survives restarts), `money_entries` (minor units, in/out, category, optional task or goal), `weekly_reports`, `settings`. Timestamps UTC ISO-8601, integer IDs, versioned migrations (`PRAGMA user_version`).

## Design file

The Pencil file "My Planner" was not reachable from this environment, so layout follows the brief and the component library's own tokens. Drop the exported colours/fonts/spacing into `src/index.css` (after the Halo styles import) to match the design exactly.
