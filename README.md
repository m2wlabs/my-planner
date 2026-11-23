# My Planner

Local-first desktop planner for tasks, goals, routines, time tracking, money tracking and an AI coach that runs on the provider you choose.

Tauri 2 shell · React 19 + TypeScript + Vite · TanStack Router / Query · SQLite in Rust · Halo UI (`@halo-ds/react`) · Vercel AI SDK (Anthropic, OpenAI, Google Gemini, any OpenAI-compatible endpoint).

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

## Multi-provider AI

Open **AI Coach** (`Ctrl+K`) or **Settings → AI providers** and click **Add provider** to pick from **45 providers** with official SVG logos (sourced from OpenCode's `models.dev` logo set, bundled locally):

- **Major** — Anthropic, OpenAI, Google Gemini, xAI (Grok), DeepSeek, MiniMax, Mistral AI, Perplexity, Cohere, Moonshot (Kimi), Alibaba (Qwen), Zhipu AI (GLM), Xiaomi (MiMo), StepFun, Inception
- **Cloud & Routers** — OpenRouter, OpenCode Zen, Vercel AI Gateway, Azure OpenAI, Cloudflare Workers AI, GitHub Models, Together AI, Fireworks AI, DeepInfra, Nebius AI Studio, Novita AI, SiliconFlow, Baseten, NVIDIA NIM, Hugging Face, Venice AI, Poe, Scaleway, FriendliAI, AIHubMix, 302.AI, ZenMux, ModelScope, Abacus AI
- **Fast Inference** — Groq, Cerebras, SambaNova
- **Local & Custom** — Ollama, LM Studio, or any custom OpenAI-compatible `/v1` server (no API key required for local endpoints)

No providers are pre-added and **no models are hardcoded**. Models appear under a provider only after you verify its API key or base URL against its live `/models` endpoint (with `/api/tags` fallback for Ollama). Once verified, pick any available model from the searchable combobox and switch providers or models mid-conversation.

AI keys are stored encrypted at rest with AES-256-GCM in `%APPDATA%\com.myplanner.app\MyPlanner\ai-config.enc` with a separate `ai-config.key` — outside `my-planner.db`, so database backups never include credentials.

One TypeScript engine (`src/lib/aiEngine.ts`) streams replies with the AI SDK for both the desktop WebView and the browser preview. Replies can propose planner changes as a fenced `planner-actions` block, surfaced as one-click cards (tasks, goals, reschedules, money entries, themes, and new non-negotiables). Token usage and latency are logged locally, with a 7-day chart, per-model breakdown and a monthly token budget.

## Voice AI

**Settings → Voice** (or the Voice popover in AI Coach) configures speech in and out:

- **Text to speech** — Browser Native (`speechSynthesis`), OpenAI (`/audio/speech`), Google Gemini TTS, or OpenAI-compatible; pick a voice from system voices, OpenAI voices (`alloy, ash, coral, echo, nova, onyx, sage, shimmer`), Gemini voices (`Kore, Puck, Charon, Fenrir, Aoede`), or type a custom one; adjust speech speed and test instantly.
- **Speech to text** — Browser Native recognition or OpenAI/OpenAI-compatible transcription (`gpt-4o-mini-transcribe`, `whisper-1`, `whisper-large-v3-turbo`, custom). Base URL and API key overrides are optional; otherwise the matching provider key is used.
- Toggles for auto-speak replies and auto-send after voice input, a mic button with interim transcript, and a Voice Mode banner (Listening / Thinking / Speaking) with a stop button. Every assistant message has Listen/Stop next to Copy and Retry.

## Daily non-negotiables & routines heatmap

**Today** leads with a Daily Non-Negotiables card: `X / Y`, a streak badge, progress bar, quick add, and one-click check-ins.

**Routines** (`/routines`) adds:

- A 52-week GitHub-style heatmap (Mon–Sun rows, month labels, 5 intensity levels, legend) and a monthly calendar with prev/next navigation.
- “All non-negotiables” percentage intensity or a single habit’s binary history with its own streak.
- Accurate per-day denominators (habits created on or before that day; archived habits still count on days they were checked).
- Click any past or current cell for a day inspector to view or retroactively toggle check-ins.
- A manager for adding/editing (title, time of day, colour), reordering, archiving (history preserved) and permanently deleting habits, with per-habit streak and 30-day consistency.

**Reports → Routine consistency** summarizes the selected week or month: overall completion, perfect days, per-routine bars, and a link to the full heatmap.

## Where data lives

- Database: `%APPDATA%\com.myplanner.app\MyPlanner\my-planner.db` (Tauri app-data dir; WAL mode, `PRAGMA user_version = 4`).
- Backups: the folder you pick in Settings / First run. Managed snapshots are `my-planner-YYYYMMDD-HHMMSS.db` (or `.enc` when encrypted with AES-256-GCM + Argon2id). The last `N` (default 30) managed snapshots are kept; `pre-restore-*.db` safety copies and unrelated files are never pruned.
- AI & voice config: `ai-config.enc` + `ai-config.key` beside the database, never inside backups.

## Structure

```
src/
  App.tsx                  router, AI drawer provider, Sunday weekly review
  components/ui.tsx        shell, TopBar popovers, timer bar, TaskRow, QuickTask, modals
  components/AiWidgets.tsx provider manager, voice settings, usage card, quick setup
  pages/planning.tsx       Today (incl. non-negotiables), Goals, Tomorrow/Week/Month/Year, Themes
  pages/routines.tsx       Routines heatmap, monthly calendar, manager, day inspector
  pages/money.tsx          Money ledger + Reports (incl. routine consistency)
  pages/ai.tsx             AI Coach page & Ctrl+K drawer: streaming, voice, provider switching
  pages/setup.tsx          Settings (AI providers, Voice, Usage, General, Currency, Data, Review) & First run
  lib/api.ts               typed Tauri invoke wrappers + shared AI/voice types + date helpers
  lib/aiEngine.ts          AI SDK providers, model discovery, streaming chat, connection tests
  lib/aiParser.ts          structured reply/action parsing and repetition cleanup
  lib/voiceEngine.ts       TTS (browser/OpenAI/Gemini) and STT (browser/OpenAI-compatible)
  lib/hooks.ts             TanStack Query hooks, optimistic updates, routines, AI config
  lib/browserFallback.ts   browser-preview store with full parity for every command
src-tauri/src/
  db.rs                    v1→v4 lossless migrations, FK cascades, CRUD, planner context, routine toggles
  backup.rs                WAL-safe snapshots, managed pruning, encryption, safe restore
  ai_store.rs              encrypted AI config, planner context, turns/usage, action execution
```
