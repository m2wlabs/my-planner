# Implementation Checklist: Remove Google Auth, Multi-Provider AI SDKs, Voice AI & Daily Routines

> **Instructions for the AI agent:**
> - Work through the phases below **in order**.
> - After completing each task, immediately edit this file to tick its checkbox (`- [x]` → `- [x]`).
> - Do **not** tick a checkbox until the code is implemented and cleanly wired.
> - Keep both **Tauri desktop runtime** (`src-tauri/`) and **Vite browser preview** (`src/lib/browserFallback.ts`) working in full parity.
> - Do **not** break existing Tasks, Goals, Themes, Time Tracking, Money, Currency, Backups, or Weekly Reports.

---

## Tech Stack & Architecture Guardrails

- **App stack**: Tauri 2 (Rust + SQLite) · React 19 + TypeScript + Vite · TanStack Router & Query · `@halo-ds/react` · Package manager: `bun`.
- **Single AI engine in TypeScript**: Use Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`) inside `src/lib/aiEngine.ts` so both Tauri desktop and Vite browser preview share one clean streaming/chat implementation.
- **Anthropic browser/WebView CORS**: Always pass `headers: { "anthropic-dangerous-direct-browser-access": "true" }` to `createAnthropic(...)`.
- **SDK version safety**: Inspect the installed `ai` package types (`node_modules/ai`) and handle token usage defensively (`inputTokens ?? promptTokens`, `outputTokens ?? completionTokens`, `totalTokens`).
- **Rust backend scope (`src-tauri/src/ai_store.rs`)**: Handles encrypted at-rest storage of AI & Voice config (`ai-config.enc` + `ai-config.key`, AES-256-GCM, outside backups), SQLite planner context (`get_planner_context`), atomic turn & usage persistence (`save_ai_turn`, `log_ai_usage_event`, `ai_usage_summary`), planner action execution (`ai_apply_action`), and `open_external_url`.

---

## Phase 1: Dependencies & Complete Removal of Google Auth

- [x] Install Vercel AI SDK packages via Bun:
  ```bash
  bun add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/openai-compatible
  ```
- [x] Delete `public/oauth-callback.html`.
- [x] Delete `src/components/GoogleAiWidgets.tsx`.
- [x] Delete `src-tauri/src/google_ai.rs`.
- [x] Clean up `src-tauri/Cargo.toml`: remove unused `sha2`, `base64`, `reqwest`, and `tokio` crates (keep `aes-gcm`, `argon2`, `rand`, `open`, `url`, `rusqlite`, `chrono`, `serde`, `serde_json`, `tauri`, `tauri-plugin-dialog`, `tauri-plugin-notification`).
- [x] Update `src-tauri/src/lib.rs`:
  - Replace `mod google_ai;` with `mod ai_store;`.
  - Remove `app.manage(google_ai::OAuthFlowState::default())` and `app.manage(google_ai::AiStreamState::default())`.
  - Remove all `google_*`, `ai_chat`, `ai_chat_cancel`, and `ai_quick_prompt` commands from `tauri::generate_handler!`.
  - Register `db::toggle_routine_log` and all new `ai_store::*` commands (`ai_get_config`, `ai_save_config`, `open_external_url`, `get_planner_context`, `save_ai_turn`, `log_ai_usage_event`, `ai_usage_summary`, `ai_apply_action`).
- [x] Remove dead Google OAuth / Plan CSS classes from `src/index.css` (`.google-profile-card`, `.oauth-*`, `.plan-*`, `.signin-option-*`).

---

## Phase 2: Database v4 Migration & Routines Backend (`src-tauri/src/db.rs` + `browserFallback.ts`)

- [x] In `src-tauri/src/db.rs`, bump `PRAGMA user_version` from `3` to `4` in both the fresh `version < 1` schema and a new `if version_after_v3 < 4` incremental migration adding:
  ```sql
  CREATE TABLE IF NOT EXISTS routines(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      time_of_day TEXT NOT NULL DEFAULT 'anytime',
      color TEXT NOT NULL DEFAULT '#5749F4',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS routine_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      UNIQUE(routine_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_routine_logs_date ON routine_logs(date);
  ```
- [x] Add `"routines"` and `"routine_logs"` to `TABLES`, `columns()`, and `validate_row()` (non-empty `routines.title`) in `src-tauri/src/db.rs`.
- [x] Add idempotent Tauri command `db::toggle_routine_log(routine_id: i64, date: String)` returning `{ "completed": bool }` (deletes existing `(routine_id, date)` row if present, otherwise inserts with UTC RFC3339 `completed_at`).
- [x] Update `db::export_all_data` and `db::build_planner_context` to include `routines` and `routine_logs` (last 30 days in planner context so AI Coach can reference non-negotiables and streaks).
- [x] Update existing Rust unit test `migrates_v1_to_v2_and_cascades_deletes` (`assert_eq!(ver, 4);`) and add a unit test verifying `routines` + `routine_logs` migration, toggle idempotency, and cascade delete.
- [x] Update `src/lib/browserFallback.ts` to add `routines` and `routine_logs` tables, implement `toggle_routine_log`, include routines in `export_all_data` and `get_planner_context`, and seed 4 sample daily non-negotiables with ~21 days of realistic log history for browser preview.

---

## Phase 3: Encrypted Multi-Provider AI Store (`src-tauri/src/ai_store.rs` + `src/lib/api.ts`)

- [x] Define shared TypeScript types in `src/lib/api.ts` (replacing all `Google*` and `AiPlanInfo` types):
  - `AiProviderKind = "anthropic" | "openai" | "google" | "openai-compatible"`
  - `AiProviderConfig`: `{ id, kind, name, apiKey, baseUrl, model, enabled }`
  - `VoiceTtsProvider = "browser" | "openai" | "google" | "openai-compatible"`
  - `VoiceSttProvider = "browser" | "openai" | "openai-compatible"`
  - `AiVoiceConfig`: `{ ttsProvider, ttsModel, ttsVoice, ttsBaseUrl, ttsApiKey, ttsRate, sttProvider, sttModel, sttBaseUrl, sttApiKey, autoSpeakReplies, autoSendVoice }`
  - `AiConfig`: `{ activeProviderId, providers, monthlyTokenBudget, voice }`
  - Update `AiSuggestedAction` union to include `"create_routine"` (with `time_of_day?: "morning" | "afternoon" | "evening" | "anytime"`).
  - Replace all `google*` invoke wrappers with `aiGetConfig`, `aiSaveConfig`, `openExternalUrl`, `getPlannerContext`, `saveAiTurn`, `logAiUsageEvent`, `aiUsageSummary`, `aiApplyAction`, `toggleRoutineLog`.
- [x] Create `src-tauri/src/ai_store.rs`:
  - Encrypt/decrypt `AiConfig` JSON using AES-256-GCM (`ai-config.enc` + `ai-config.key`, magic `b"MPA2"`) in app data dir (outside SQLite backups).
  - Seed default providers (`anthropic`, `openai`, `google`, plus `openai-compatible` ready to configure) and default `voice` config (`ttsProvider: "browser"`, `sttProvider: "browser"`, `ttsRate: 1.0`, `autoSpeakReplies: false`, `autoSendVoice: true`).
  - Implement commands: `ai_get_config`, `ai_save_config`, `open_external_url`, `get_planner_context`, `save_ai_turn`, `log_ai_usage_event`, `ai_usage_summary`, and `ai_apply_action` (preserving all 6 existing action types + adding `create_routine`).
  - Add Rust unit tests for `ai_store` AES-256-GCM encryption roundtrip and default config creation.
- [x] Update `src/lib/browserFallback.ts` to remove all Google OAuth/Gemini HTTP code and implement parity handlers for `ai_get_config`, `ai_save_config`, `open_external_url`, `get_planner_context`, `save_ai_turn`, `log_ai_usage_event`, `ai_usage_summary`, and `ai_apply_action` (including `create_routine`).
- [x] Update `src/lib/hooks.ts`:
  - Replace `useGoogleAuth` and `useAiModels` with `useAiConfig()` and `useSaveAiConfig()`.
  - Add `useRoutines()`, `useRoutineLogs()`, `useRoutineMut()`, and `useToggleRoutineLog()` (with optimistic cache update + `queueBackup()`).
  - Ensure `useApplyAiAction()` invalidates `["routines"]` and `["routine_logs"]` as well.

---

## Phase 4: Unified Multi-Provider AI SDK Engine (`src/lib/aiParser.ts` & `src/lib/aiEngine.ts`)

- [x] Create `src/lib/aiParser.ts` extracting `parseStructuredOutput` and `sanitizeRepetitionLoops` from `browserFallback.ts` (make fallback messages provider-agnostic instead of referencing Gemini).
- [x] Create `src/lib/aiEngine.ts`:
  - Export curated provider presets & default model lists:
    - **Anthropic**: `claude-sonnet-4-5`, `claude-opus-4-1`, `claude-3-5-haiku-latest`
    - **OpenAI**: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `o4-mini`
    - **Google Gemini**: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`
    - **OpenAI-Compatible quick templates**: OpenRouter (`https://openrouter.ai/api/v1`), Groq (`https://api.groq.com/openai/v1`), DeepSeek (`https://api.deepseek.com/v1`), Ollama (`http://localhost:11434/v1`, no API key required), LM Studio (`http://localhost:1234/v1`, no API key required), Custom Endpoint.
  - Implement `createLanguageModel(provider: AiProviderConfig)` using `createAnthropic` (with `anthropic-dangerous-direct-browser-access: true`), `createOpenAI`, `createGoogleGenerativeAI`, and `createOpenAICompatible`.
  - Implement `fetchProviderModels(provider: AiProviderConfig)` for OpenAI / OpenAI-compatible (`GET {baseUrl}/models`) and Google (`GET https://generativelanguage.googleapis.com/v1beta/models`), failing gracefully back to curated models.
  - Implement `streamPlannerChat({ prompt, sessionId, provider, history, extraContext, signal, onDelta, onReasoning })`:
    - Loads live snapshot via `api.getPlannerContext()`.
    - Uses `streamText(...)` with the workspace-grounded planner system prompt (supporting ` ```planner-actions [...] ``` ` including `create_routine`).
    - Streams text and optional reasoning deltas, parses structured actions via `parseStructuredOutput`, and persists turns + token usage via `api.saveAiTurn(...)`.
    - Logs errors via `api.logAiUsageEvent(...)` (ignoring intentional user abort).
  - Implement `testProviderConnection(provider: AiProviderConfig)` using `generateText(...)` with `"Reply with exactly: OK"`, logging usage (`feature: "test"`), returning `{ ok, model, provider, reply, latency_ms }`.

---

## Phase 5: Built-in Configurable Voice Model (`src/lib/voiceEngine.ts`)

- [x] Create `src/lib/voiceEngine.ts`:
  - Implement `prepareTextForSpeech(markdown: string): string` stripping ` ```planner-actions ... ``` `, code blocks, and markdown punctuation so spoken replies sound natural.
  - Implement `listBrowserVoices(): SpeechSynthesisVoice[]` (handling async `voiceschanged` cleanly).
  - Implement `speakText(text, voiceConfig, providers, callbacks)` returning `{ stop: () => void }`:
    - **`browser`**: Uses `window.speechSynthesis` with chosen voice and `ttsRate`.
    - **`openai` & `openai-compatible`**: Calls `POST {baseUrl}/audio/speech` (`https://api.openai.com/v1/audio/speech` for OpenAI) using `ttsApiKey` or fallback to the matching configured provider's `apiKey`; plays MP3 blob via `HTMLAudioElement` and revokes object URL on end/stop/error.
    - **`google`**: Calls `POST https://generativelanguage.googleapis.com/v1beta/models/{ttsModel}:generateContent` with `x-goog-api-key`, `responseModalities: ["AUDIO"]`, and `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`; converts raw `audio/L16` PCM to WAV if needed, plays via `HTMLAudioElement`, and cleans up on `stop()`.
  - Implement `startListening(voiceConfig, providers, callbacks)` returning `{ stop: () => Promise<string>, cancel: () => void }`:
    - **`browser`**: Uses `SpeechRecognition` / `webkitSpeechRecognition` with `interimResults = true`, surfacing a clear message if unsupported in the current WebView.
    - **`openai` & `openai-compatible`**: Records mic via `MediaRecorder`, sends `FormData` (`file`, `model`) to `POST {baseUrl}/audio/transcriptions`, returns `text`, and always stops all `MediaStreamTrack`s on stop/cancel.

---

## Phase 6: AI Widgets, AI Coach & Settings UI (`AiWidgets.tsx`, `ai.tsx`, `setup.tsx`, `ui.tsx`)

- [x] Create `src/components/AiWidgets.tsx`:
  - Provider-agnostic `AiUsageCard` (keep 7-day chart, monthly token budget saved via `aiSaveConfig`, per-model breakdown, recent log table; remove Google AI Studio links).
  - `AiProvidersCard` (`#section-ai-providers`):
    - Manage Anthropic, OpenAI, Google Gemini, and OpenAI-Compatible providers (plus "+ Add OpenAI-Compatible Provider" button with quick-fill templates: OpenRouter, Groq, DeepSeek, Ollama, LM Studio, Custom).
    - Per provider: enable/set active, masked API key input + clear button, Base URL field, curated model picker **plus free-text custom model ID input**, "Fetch models" button, "Test connection" button with live status/latency, and Delete button for custom providers.
  - `VoiceSettingsCard` (`#section-ai-voice`):
    - Choose TTS Provider (`Browser Native`, `OpenAI`, `Google Gemini`, `OpenAI-Compatible`), TTS Model (preset or custom), Voice selector (system voices / OpenAI voices `alloy, ash, coral, echo, nova, onyx, sage, shimmer` / Gemini voices `Kore, Puck, Charon, Fenrir, Aoede` / custom), speech speed (`ttsRate`), optional custom base URL/API key overrides.
    - Choose STT Provider (`Browser Native`, `OpenAI`, `OpenAI-Compatible`), STT Model (`gpt-4o-mini-transcribe`, `whisper-1`, `whisper-large-v3-turbo`, or custom), optional base URL/API key overrides.
    - Toggles for `Auto-speak AI replies` and `Auto-send after voice input`.
    - `"Test Voice"` button to preview the chosen TTS model/voice immediately.
  - `QuickAiSetupModal`: Clean modal opened from AI Coach when no provider is configured yet, letting users pick a provider (Anthropic / OpenAI / Google / OpenAI-Compatible), paste API key (or local URL), pick model, and connect immediately.
- [x] Update `src/pages/ai.tsx`:
  - Remove all Google OAuth/Sign-In/Plan components and hardcoded `"Gemini"` copy; use `"AI Coach"` / active provider name.
  - Show active **Provider + Model switcher** right in the composer bar (switch between any enabled provider & model in 1 click).
  - Add **Voice Model quick switcher popover** in the header/composer so users can switch their TTS/STT provider, model, voice, and `Auto-speak` directly inside AI Coach without leaving the page.
  - Add **Mic button** in the composer bar with animated listening/recording state, interim transcript preview, and transcribing indicator.
  - Add **Voice Mode toggle** with an active voice banner (`Listening…` / `Thinking…` / `Speaking…` + `Stop speaking` button) that speaks replies via `voiceEngine.ts`.
  - Add per-message **Listen / Stop** speaker button next to Copy & Retry on every assistant message.
  - Wire `streamPlannerChat` + `AbortController` for streaming & Stop generation.
- [x] Update `src/pages/setup.tsx`:
  - Replace `GoogleAccountSection` & `AiPlanCard` with `AiProvidersCard`, `VoiceSettingsCard`, and `AiUsageCard`.
  - Update Settings nav items (`ai-providers`, `ai-voice`, `ai-usage`, `general`, `currency`, `backup`, `review`) and `FirstRunPage` copy/CTA.
- [x] Update `src/components/ui.tsx`:
  - Add `mic`, `micOff`, `volume`, `volumeOff`, `repeat`, `flame`, `arrowDown`, `sliders` icons to `PATHS`.
  - Add `{ to: "/routines", label: "Routines", icon: "repeat" }` right after Today in `NAV` and add `"/routines": "Routines"` to `TITLES`.
  - Replace Google Auth sidebar footer & topbar account popover with active AI Provider/Model status + today's token usage + buttons to `"Open AI Coach"` and `"AI & Voice Settings"` (`/settings?section=ai-providers`).

---

## Phase 7: Daily Non-Negotiables (Today) + Routines Heatmap Page + Reports Card

- [x] Register `/routines` route in `src/App.tsx` pointing to `RoutinesPage`.
- [x] Create `src/pages/routines.tsx` (`RoutinesPage`):
  - **PageHead** with stats: Today (`X / Y`), Current Streak (consecutive 100% days), Best Streak, 30-Day Consistency %, plus actions (`"Ask AI"` to audit routine consistency + `"+ New non-negotiable"`).
  - **Heatmap Calendar Card**:
    - View mode toggle (`SegmentedControl`): **Year heatmap** (52-week GitHub-style grid ending today, 7 rows Mon–Sun, month labels, 5 intensity levels, legend `Less … More`) vs **Monthly calendar** (prev/next month grid with daily completion indicators).
    - **Habit filter pills**: `"All non-negotiables"` (percentage intensity scale: 0%, 1–33%, 34–66%, 67–99%, 100%) OR click any individual routine to view that habit's binary heatmap and individual streak.
    - Accurate historical denominator per day (count active routines created on or before that date, falling back cleanly if logs exist).
    - Hover tooltip showing formatted date + `X/Y (Z%)`.
    - **Click any cell (<= today)** to open an inline Day Inspector panel/modal listing that date's non-negotiables with checkboxes to view or retroactively toggle check-ins.
  - **Non-Negotiables Manager Card**:
    - Add / Edit modal (`title`, `time_of_day`: Morning/Afternoon/Evening/Anytime, `color` swatch).
    - Move up / Move down reordering (`sort_order`), per-routine streak & 30d % badge, and Archive action (`active: 0` so past heatmap data stays intact).
    - Collapsible `"Archived"` list with Restore and Delete permanently.
- [x] Update `src/pages/planning.tsx` (`TodayPage`):
  - Add a **"Daily Non-Negotiables"** card at the top of the Today ledger (above Overdue / Planned for today):
    - Shows completion count (`X / Y`), current streak badge (`Xd streak`), slim progress bar, `+ Add` quick modal trigger, and `"Heatmap →"` link to `/routines`.
    - Renders the fixed ordered list of active non-negotiables with one-click checkboxes (`useToggleRoutineLog`), color dots, time-of-day chips, and strike-through done state.
- [x] Update `src/pages/money.tsx` (`ReportsPage`):
  - Add a compact **"Routine consistency"** card scoped to the selected Weekly/Monthly period showing overall completion %, perfect days count, per-routine completion bars for that period, and a `"Full heatmap →"` button navigating to `/routines`.
- [x] Add cohesive styling in `src/index.css` for provider cards, voice controls/recording pulse, Today's Daily Non-Negotiables card, and the Routines Contribution Heatmap + Monthly Calendar views.
- [x] Update `README.md` to document Multi-Provider AI SDKs, Voice AI, and Daily Non-Negotiables / Routines Heatmap (zero Google Auth references).

---

## Phase 8: Final Verification (Required Before Finishing)

- [x] Run `bun run typecheck` — passes with 0 errors.
- [x] Run `bun run build` — Vite production build succeeds cleanly.
- [x] Run `cargo test` in `src-tauri/` — compiles and all Rust unit tests pass.
- [x] Run a codebase search across `src/`, `src-tauri/src/`, and `public/` for `oauth`, `OAuthFlowState`, `SocialButton`, `google_auth`, `gcloud`, `import_adc`, `client_secret`, and `oauth-callback` — confirm **0 matches**.
- [x] Summarize all created, modified, and deleted files plus any edge cases or manual QA notes for review.
