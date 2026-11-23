use crate::db;
use crate::DbPath;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::State;

const MAGIC: &[u8; 4] = b"MPA2";
const CONFIG_FILE: &str = "ai-config.enc";
const KEY_FILE: &str = "ai-config.key";

fn config_paths(db_path: &Path) -> (PathBuf, PathBuf) {
    let dir = db_path.parent().unwrap_or_else(|| Path::new("."));
    (dir.join(CONFIG_FILE), dir.join(KEY_FILE))
}

fn load_key(path: &Path) -> Result<[u8; 32], String> {
    if let Ok(bytes) = std::fs::read(path) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, key).map_err(|e| e.to_string())?;
    Ok(key)
}

fn encrypt(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(4 + 12 + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 16 || !data.starts_with(MAGIC) {
        return Err("AI config file is missing or corrupted.".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(Nonce::from_slice(&data[4..16]), &data[16..])
        .map_err(|_| "Could not decrypt AI config (key mismatch).".to_string())
}

/// Fresh installs start with zero pre-configured providers and zero hardcoded models.
/// Users pick which providers they want to connect and models populate only after live API verification.
pub fn default_config() -> Value {
    json!({
        "schemaVersion": 2,
        "activeProviderId": "",
        "monthlyTokenBudget": 1_000_000,
        "providers": [],
        "voice": {
            "ttsProvider": "browser",
            "ttsProviderId": "",
            "ttsModel": "",
            "ttsVoice": "",
            "ttsBaseUrl": "",
            "ttsApiKey": "",
            "ttsRate": 1.0,
            "sttProvider": "browser",
            "sttProviderId": "",
            "sttModel": "",
            "sttBaseUrl": "",
            "sttApiKey": "",
            "autoSpeakReplies": false,
            "autoSendVoice": true
        }
    })
}

/// Migrates v1 configs that had auto-seeded empty placeholder providers to v2 (user-selected providers only).
fn migrate_config_v2(mut cfg: Value) -> (Value, bool) {
    let ver = cfg.get("schemaVersion").and_then(Value::as_i64).unwrap_or(1);
    if ver >= 2 {
        return (cfg, false);
    }
    if let Some(obj) = cfg.as_object_mut() {
        obj.insert("schemaVersion".into(), json!(2));
        let active = obj
            .get("activeProviderId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let mut next_active_override: Option<String> = None;
        if let Some(providers) = obj.get_mut("providers").and_then(Value::as_array_mut) {
            providers.retain(|p| {
                let key = p.get("apiKey").and_then(Value::as_str).unwrap_or("").trim();
                let verified = p.get("verifiedAt").and_then(Value::as_str).unwrap_or("").trim();
                let kind = p.get("kind").and_then(Value::as_str).unwrap_or("");
                let enabled = p.get("enabled").and_then(Value::as_bool).unwrap_or(false);
                !key.is_empty() || !verified.is_empty() || (kind == "openai-compatible" && enabled)
            });
            for p in providers.iter_mut() {
                if let Some(po) = p.as_object_mut() {
                    if !po.contains_key("catalogId") {
                        let kind = po.get("kind").and_then(Value::as_str).unwrap_or("custom").to_string();
                        po.insert("catalogId".into(), json!(if kind == "openai-compatible" { "custom" } else { &kind }));
                    }
                    if !po.contains_key("discoveredModels") {
                        po.insert("discoveredModels".into(), json!([]));
                    }
                }
            }
            let active_exists = providers
                .iter()
                .any(|p| p.get("id").and_then(Value::as_str) == Some(active.as_str()));
            if !active_exists {
                let next_active = providers
                    .first()
                    .and_then(|p| p.get("id").and_then(Value::as_str))
                    .unwrap_or("")
                    .to_string();
                next_active_override = Some(next_active);
            }
        }
        if let Some(next_active) = next_active_override {
            obj.insert("activeProviderId".into(), json!(next_active));
        }
    }
    (cfg, true)
}

fn read_config(db_path: &Path) -> Result<Value, String> {
    let (cfg_path, key_path) = config_paths(db_path);
    if !cfg_path.exists() {
        let cfg = default_config();
        write_config(db_path, &cfg)?;
        return Ok(cfg);
    }
    let key = load_key(&key_path)?;
    let data = std::fs::read(&cfg_path).map_err(|e| e.to_string())?;
    let plain = decrypt(&key, &data)?;
    let parsed: Value =
        serde_json::from_slice(&plain).map_err(|e| format!("AI config is invalid JSON: {e}"))?;
    let (migrated, changed) = migrate_config_v2(parsed);
    if changed {
        let _ = write_config(db_path, &migrated);
    }
    Ok(migrated)
}

fn write_config(db_path: &Path, cfg: &Value) -> Result<(), String> {
    let (cfg_path, key_path) = config_paths(db_path);
    let key = load_key(&key_path)?;
    let plain = serde_json::to_vec(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&cfg_path, encrypt(&key, &plain)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_get_config(state: State<DbPath>) -> Result<Value, String> {
    read_config(&state.0)
}

#[tauri::command]
pub fn ai_save_config(config: Value, state: State<DbPath>) -> Result<Value, String> {
    if !config.is_object() {
        return Err("AI config must be an object.".into());
    }
    write_config(&state.0, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<Value, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http(s) links can be opened.".into());
    }
    open::that_detached(trimmed).map_err(|e| format!("Could not open browser: {e}"))?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn get_planner_context(state: State<DbPath>) -> Result<Value, String> {
    db::build_planner_context(&state.0)
}

#[tauri::command]
pub fn save_ai_turn(
    session_id: String,
    user_content: String,
    assistant_content: String,
    model: String,
    actions: Value,
    usage: Value,
    state: State<DbPath>,
) -> Result<Value, String> {
    let mut c = db::open(&state.0)?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let now_user = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO ai_messages (session_id, role, content, model, actions_json, usage_json, created_at) VALUES (?, 'user', ?, '', NULL, NULL, ?)",
        rusqlite::params![session_id, user_content, now_user],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO ai_messages (session_id, role, content, model, actions_json, usage_json, created_at) VALUES (?, 'assistant', ?, ?, ?, ?, ?)",
        rusqlite::params![
            session_id,
            assistant_content,
            model,
            actions.to_string(),
            usage.to_string(),
            chrono::Utc::now().to_rfc3339()
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub fn log_ai_usage_event(entry: Value, state: State<DbPath>) -> Result<Value, String> {
    let c = db::open(&state.0)?;
    let num = |key: &str| entry.get(key).and_then(Value::as_i64).unwrap_or(0);
    let text = |key: &str| entry.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    c.execute(
        "INSERT INTO ai_usage_logs (created_at, model, transport, feature, input_tokens, output_tokens, thought_tokens, cached_tokens, total_tokens, latency_ms, status, error_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![
            chrono::Utc::now().to_rfc3339(),
            text("model"),
            text("transport"),
            if text("feature").is_empty() { "chat".to_string() } else { text("feature") },
            num("input_tokens"),
            num("output_tokens"),
            num("thought_tokens"),
            num("cached_tokens"),
            num("total_tokens"),
            num("latency_ms"),
            if text("status").is_empty() { "ok".to_string() } else { text("status") },
            text("error_code"),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn ai_usage_summary(state: State<DbPath>) -> Result<Value, String> {
    let c = db::open(&state.0)?;
    let rows = db::query_table(&c, "ai_usage_logs")?;
    let budget = read_config(&state.0)
        .ok()
        .and_then(|cfg| cfg.get("monthlyTokenBudget").and_then(Value::as_i64))
        .unwrap_or(1_000_000);

    let today_local = chrono::Local::now().format("%Y-%m-%d").to_string();
    let cur_month = &today_local[..7];

    let mut today = (0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64);
    let mut month = (0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64);
    let mut all = (0i64, 0i64, 0i64, 0i64, 0i64);
    let mut daily: std::collections::BTreeMap<String, (i64, i64)> = std::collections::BTreeMap::new();
    let now_local = chrono::Local::now().date_naive();
    for offset in (0..7).rev() {
        if let Some(d) = now_local.checked_sub_days(chrono::Days::new(offset)) {
            daily.insert(d.format("%Y-%m-%d").to_string(), (0, 0));
        }
    }
    let mut models: std::collections::BTreeMap<String, (i64, i64, i64, i64, i64)> =
        std::collections::BTreeMap::new();

    for r in &rows {
        let created_raw = r.get("created_at").and_then(Value::as_str).unwrap_or("");
        let day = chrono::DateTime::parse_from_rfc3339(created_raw)
            .map(|dt| dt.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
            .unwrap_or_else(|_| created_raw.chars().take(10).collect());
        let model = r.get("model").and_then(Value::as_str).unwrap_or("unknown").to_string();
        let n = |key: &str| r.get(key).and_then(Value::as_i64).unwrap_or(0);
        let (inp, outp, thought, cached, total, latency) = (
            n("input_tokens"),
            n("output_tokens"),
            n("thought_tokens"),
            n("cached_tokens"),
            n("total_tokens"),
            n("latency_ms"),
        );
        let status = r.get("status").and_then(Value::as_str).unwrap_or("ok");
        let err_code = r.get("error_code").and_then(Value::as_str).unwrap_or("");

        all = (all.0 + 1, all.1 + inp, all.2 + outp, all.3 + thought, all.4 + total);
        if day == today_local {
            today = (
                today.0 + 1,
                today.1 + inp,
                today.2 + outp,
                today.3 + thought,
                today.4 + cached,
                today.5 + total,
                today.6 + latency,
            );
        }
        if day.starts_with(cur_month) {
            month = (
                month.0 + 1,
                month.1 + inp,
                month.2 + outp,
                month.3 + thought,
                month.4 + cached,
                month.5 + total,
                month.6 + if status != "ok" { 1 } else { 0 },
                month.7 + if err_code.contains("429") { 1 } else { 0 },
            );
        }
        if let Some(bucket) = daily.get_mut(&day) {
            bucket.0 += 1;
            bucket.1 += total;
        }
        let entry = models.entry(model).or_insert((0, 0, 0, 0, 0));
        entry.0 += 1;
        entry.1 += inp;
        entry.2 += outp;
        entry.3 += thought;
        entry.4 += total;
    }

    let mut by_model: Vec<Value> = models
        .into_iter()
        .map(|(model, (requests, input_tokens, output_tokens, thought_tokens, total_tokens))| {
            json!({ "model": model, "requests": requests, "input_tokens": input_tokens, "output_tokens": output_tokens, "thought_tokens": thought_tokens, "total_tokens": total_tokens })
        })
        .collect();
    by_model.sort_by(|a, b| {
        b.get("total_tokens")
            .and_then(Value::as_i64)
            .cmp(&a.get("total_tokens").and_then(Value::as_i64))
    });

    Ok(json!({
        "today": {
            "requests": today.0,
            "input_tokens": today.1,
            "output_tokens": today.2,
            "thought_tokens": today.3,
            "cached_tokens": today.4,
            "total_tokens": today.5,
            "avg_latency_ms": if today.0 > 0 { today.6 / today.0 } else { 0 },
        },
        "month": {
            "requests": month.0,
            "input_tokens": month.1,
            "output_tokens": month.2,
            "thought_tokens": month.3,
            "cached_tokens": month.4,
            "total_tokens": month.5,
            "errors": month.6,
            "rate_limits": month.7,
        },
        "all_time": {
            "requests": all.0,
            "input_tokens": all.1,
            "output_tokens": all.2,
            "thought_tokens": all.3,
            "total_tokens": all.4,
        },
        "daily_7d": daily.into_iter().map(|(date, (requests, total_tokens))| json!({ "date": date, "requests": requests, "total_tokens": total_tokens })).collect::<Vec<_>>(),
        "by_model": by_model,
        "recent": rows.into_iter().rev().take(20).collect::<Vec<_>>(),
        "monthly_token_budget": budget,
    }))
}

fn resolve_or_create_theme_id(
    c: &rusqlite::Connection,
    theme_id: Option<i64>,
    theme_name: Option<&str>,
) -> Result<i64, String> {
    if let Some(tid) = theme_id {
        let exists: i64 = c
            .query_row("SELECT COUNT(*) FROM themes WHERE id=?", rusqlite::params![tid], |r| r.get(0))
            .unwrap_or(0);
        if exists > 0 {
            return Ok(tid);
        }
    }
    if let Some(name) = theme_name.map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(found) = c.query_row(
            "SELECT id FROM themes WHERE lower(name)=lower(?) LIMIT 1",
            rusqlite::params![name],
            |r| r.get::<_, i64>(0),
        ) {
            return Ok(found);
        }
        c.execute("INSERT INTO themes (name, color) VALUES (?, '#5749F4')", rusqlite::params![name])
            .map_err(|e| e.to_string())?;
        return Ok(c.last_insert_rowid());
    }
    if let Ok(first) = c.query_row("SELECT id FROM themes ORDER BY id LIMIT 1", [], |r| r.get::<_, i64>(0)) {
        return Ok(first);
    }
    c.execute("INSERT INTO themes (name, color) VALUES ('General', '#5749F4')", [])
        .map_err(|e| e.to_string())?;
    Ok(c.last_insert_rowid())
}

#[tauri::command]
pub fn ai_apply_action(action: Value, state: State<DbPath>) -> Result<Value, String> {
    let c = db::open(&state.0)?;
    let kind = action
        .get("type")
        .and_then(Value::as_str)
        .ok_or("Action missing type")?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let text = |key: &str| action.get(key).and_then(Value::as_str);

    match kind {
        "create_theme" => {
            let name = text("title")
                .or_else(|| text("theme_name"))
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or("Theme name is required")?;
            let color = text("color").filter(|s| s.starts_with('#') && s.len() == 7).unwrap_or("#5749F4");
            c.execute("INSERT INTO themes (name, color) VALUES (?, ?)", rusqlite::params![name, color])
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Created theme \"{name}\"") }))
        }
        "create_goal" => {
            let title = text("title").map(str::trim).filter(|s| !s.is_empty()).ok_or("Goal title is required")?;
            let horizon = match text("horizon") {
                Some("week") => "week",
                Some("year") => "year",
                _ => "month",
            };
            let deadline = text("deadline").map(str::trim).filter(|s| s.len() == 10);
            let tid = resolve_or_create_theme_id(
                &c,
                action.get("theme_id").and_then(Value::as_i64),
                text("theme_name"),
            )?;
            c.execute(
                "INSERT INTO goals (title, horizon, deadline, theme_id, status, notes) VALUES (?, ?, ?, ?, 'active', ?)",
                rusqlite::params![title, horizon, deadline, tid, text("notes").unwrap_or("")],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Created goal \"{title}\"") }))
        }
        "create_task" => {
            let title = text("title").map(str::trim).filter(|s| !s.is_empty()).ok_or("Task title is required")?;
            let planned = text("planned_date").filter(|s| s.len() == 10).unwrap_or(&today).to_string();
            let goal_id = action.get("goal_id").and_then(Value::as_i64).filter(|gid| {
                c.query_row("SELECT COUNT(*) FROM goals WHERE id=?", rusqlite::params![gid], |r| r.get::<_, i64>(0))
                    .unwrap_or(0) > 0
            });
            let tid = resolve_or_create_theme_id(
                &c,
                action.get("theme_id").and_then(Value::as_i64),
                text("theme_name"),
            )?;
            let priority = match text("priority") {
                Some("high") => "high",
                Some("low") => "low",
                _ => "normal",
            };
            c.execute(
                "INSERT INTO tasks (title, goal_id, theme_id, planned_date, status, created_at, notes, estimate_mins, priority) VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)",
                rusqlite::params![
                    title,
                    goal_id,
                    tid,
                    planned,
                    chrono::Utc::now().to_rfc3339(),
                    text("notes").unwrap_or(""),
                    action.get("estimate_mins").and_then(Value::as_i64).filter(|&m| m > 0),
                    priority
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Added task \"{title}\" on {planned}") }))
        }
        "complete_task" => {
            let task_id = action.get("task_id").and_then(Value::as_i64).ok_or("task_id is required")?;
            c.execute("UPDATE tasks SET status='done' WHERE id=?", rusqlite::params![task_id])
                .map_err(|e| e.to_string())?;
            let now = chrono::Utc::now().to_rfc3339();
            let _ = c.execute(
                "UPDATE time_entries SET end_utc=? WHERE task_id=? AND end_utc IS NULL",
                rusqlite::params![now, task_id],
            );
            Ok(json!({ "ok": true, "id": task_id, "summary": "Marked task as done" }))
        }
        "reschedule_task" => {
            let task_id = action.get("task_id").and_then(Value::as_i64).ok_or("task_id is required")?;
            let planned = text("planned_date").filter(|s| s.len() == 10).unwrap_or(&today);
            c.execute("UPDATE tasks SET planned_date=? WHERE id=?", rusqlite::params![planned, task_id])
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": task_id, "summary": format!("Rescheduled task to {planned}") }))
        }
        "create_money_entry" => {
            let minor = (action.get("amount_usd").and_then(Value::as_f64).ok_or("amount_usd is required")? * 100.0).round() as i64;
            if minor <= 0 {
                return Err("Amount must be greater than zero.".into());
            }
            let direction = if text("direction") == Some("in") { "in" } else { "out" };
            let category = text("category").map(str::trim).filter(|s| !s.is_empty()).unwrap_or("General");
            let date = text("date").filter(|s| s.len() == 10).unwrap_or(&today);
            let goal_id = action.get("goal_id").and_then(Value::as_i64).filter(|gid| {
                c.query_row("SELECT COUNT(*) FROM goals WHERE id=?", rusqlite::params![gid], |r| r.get::<_, i64>(0))
                    .unwrap_or(0) > 0
            });
            c.execute(
                "INSERT INTO money_entries (amount_minor, direction, category, date, task_id, goal_id, note) VALUES (?, ?, ?, ?, NULL, ?, ?)",
                rusqlite::params![minor, direction, category, date, goal_id, text("notes").unwrap_or("")],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Logged {category} ({direction})") }))
        }
        "create_routine" => {
            let title = text("title").map(str::trim).filter(|s| !s.is_empty()).ok_or("Routine title is required")?;
            let time_of_day = match text("time_of_day") {
                Some("morning") => "morning",
                Some("afternoon") => "afternoon",
                Some("evening") => "evening",
                _ => "anytime",
            };
            let sort_order: i64 = c
                .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM routines", [], |r| r.get(0))
                .unwrap_or(0);
            c.execute(
                "INSERT INTO routines (title, time_of_day, color, sort_order, active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
                rusqlite::params![
                    title,
                    time_of_day,
                    text("color").filter(|s| s.starts_with('#') && s.len() == 7).unwrap_or("#5749F4"),
                    sort_order,
                    chrono::Utc::now().to_rfc3339()
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Created non-negotiable \"{title}\"") }))
        }
        other => Err(format!("Unsupported action type: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_roundtrips_through_aes_gcm() {
        let dir = std::env::temp_dir().join(format!("my_planner_ai_store_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("my-planner.db");

        let cfg = read_config(&db_path).unwrap();
        assert_eq!(cfg["schemaVersion"], 2);
        assert_eq!(cfg["providers"].as_array().unwrap().len(), 0);
        assert_eq!(cfg["activeProviderId"], "");
        assert_eq!(cfg["voice"]["ttsProvider"], "browser");
        assert_eq!(cfg["voice"]["ttsRate"], 1.0);

        let (cfg_path, _) = config_paths(&db_path);
        let raw = std::fs::read(&cfg_path).unwrap();
        assert!(raw.starts_with(MAGIC));
        assert!(!String::from_utf8_lossy(&raw).contains("autoSpeakReplies"));

        let mut edited = cfg.clone();
        edited["activeProviderId"] = json!("openai-1");
        edited["providers"] = json!([{ "id": "openai-1", "catalogId": "openai", "kind": "openai", "name": "OpenAI", "apiKey": "sk-test", "baseUrl": "", "model": "gpt-test", "discoveredModels": ["gpt-test"], "enabled": true }]);
        edited["voice"]["autoSpeakReplies"] = json!(true);
        write_config(&db_path, &edited).unwrap();
        let back = read_config(&db_path).unwrap();
        assert_eq!(back["activeProviderId"], "openai-1");
        assert_eq!(back["providers"].as_array().unwrap().len(), 1);
        assert_eq!(back["voice"]["autoSpeakReplies"], true);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
