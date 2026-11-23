use crate::DbPath;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use tauri::State;

pub const TABLES: &[&str] = &[
    "themes",
    "goals",
    "tasks",
    "time_entries",
    "money_entries",
    "weekly_reports",
    "ai_messages",
];

pub fn columns(table: &str) -> Option<&'static [&'static str]> {
    Some(match table {
        "themes" => &["name", "color"],
        "goals" => &["title", "horizon", "deadline", "theme_id", "status", "notes"],
        "tasks" => &[
            "title",
            "goal_id",
            "theme_id",
            "planned_date",
            "status",
            "created_at",
            "notes",
            "estimate_mins",
            "priority",
        ],
        "time_entries" => &["task_id", "start_utc", "end_utc"],
        "money_entries" => &[
            "amount_minor",
            "direction",
            "category",
            "date",
            "task_id",
            "goal_id",
            "note",
        ],
        "weekly_reports" => &["week_start", "snapshot_json"],
        "ai_messages" => &[
            "session_id",
            "role",
            "content",
            "model",
            "actions_json",
            "created_at",
        ],
        _ => return None,
    })
}

pub fn open(path: &std::path::Path) -> Result<Connection, String> {
    let c = Connection::open(path).map_err(|e| e.to_string())?;
    c.execute_batch(
        "PRAGMA busy_timeout=5000;
         PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;",
    )
    .map_err(|e| e.to_string())?;
    Ok(c)
}

pub fn migrate(path: &std::path::Path) -> Result<(), String> {
    let c = open(path)?;
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    if version < 1 {
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS themes(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#6366f1'
             );
             CREATE TABLE IF NOT EXISTS goals(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                horizon TEXT NOT NULL DEFAULT 'month',
                deadline TEXT,
                theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
                status TEXT NOT NULL DEFAULT 'active',
                notes TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE IF NOT EXISTS tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
                theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
                planned_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'planned',
                created_at TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                estimate_mins INTEGER,
                priority TEXT NOT NULL DEFAULT 'normal'
             );
             CREATE TABLE IF NOT EXISTS time_entries(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                start_utc TEXT NOT NULL,
                end_utc TEXT
             );
             CREATE TABLE IF NOT EXISTS money_entries(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount_minor INTEGER NOT NULL,
                direction TEXT NOT NULL,
                category TEXT NOT NULL,
                date TEXT NOT NULL,
                task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
                goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
                note TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE IF NOT EXISTS weekly_reports(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_start TEXT NOT NULL UNIQUE,
                snapshot_json TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS settings(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS ai_messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL DEFAULT 'default',
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model TEXT NOT NULL DEFAULT '',
                actions_json TEXT,
                created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_tasks_planned_date ON tasks(planned_date);
             CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
             CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);
             CREATE INDEX IF NOT EXISTS idx_money_entries_date ON money_entries(date);
             CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id, id);
             PRAGMA user_version=2;",
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    if version < 2 {
        c.execute_batch("PRAGMA foreign_keys=OFF;")
            .map_err(|e| e.to_string())?;

        let upgrade = c.execute_batch(
            "BEGIN IMMEDIATE;

             CREATE TABLE goals_v2(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                horizon TEXT NOT NULL DEFAULT 'month',
                deadline TEXT,
                theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
                status TEXT NOT NULL DEFAULT 'active',
                notes TEXT NOT NULL DEFAULT ''
             );
             INSERT INTO goals_v2 (id, title, horizon, deadline, theme_id, status, notes)
             SELECT id, title, horizon, deadline, theme_id, status, '' FROM goals;
             DROP TABLE goals;
             ALTER TABLE goals_v2 RENAME TO goals;

             CREATE TABLE tasks_v2(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
                theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
                planned_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'planned',
                created_at TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                estimate_mins INTEGER,
                priority TEXT NOT NULL DEFAULT 'normal'
             );
             INSERT INTO tasks_v2 (id, title, goal_id, theme_id, planned_date, status, created_at, notes, estimate_mins, priority)
             SELECT id, title,
                    CASE WHEN goal_id IN (SELECT id FROM goals) THEN goal_id ELSE NULL END,
                    theme_id, planned_date, status, created_at, '', NULL, 'normal'
             FROM tasks;
             DROP TABLE tasks;
             ALTER TABLE tasks_v2 RENAME TO tasks;

             CREATE TABLE time_entries_v2(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                start_utc TEXT NOT NULL,
                end_utc TEXT
             );
             INSERT INTO time_entries_v2 (id, task_id, start_utc, end_utc)
             SELECT id, task_id, start_utc, end_utc FROM time_entries
             WHERE task_id IN (SELECT id FROM tasks);
             DROP TABLE time_entries;
             ALTER TABLE time_entries_v2 RENAME TO time_entries;

             CREATE TABLE money_entries_v2(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount_minor INTEGER NOT NULL,
                direction TEXT NOT NULL,
                category TEXT NOT NULL,
                date TEXT NOT NULL,
                task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
                goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
                note TEXT NOT NULL DEFAULT ''
             );
             INSERT INTO money_entries_v2 (id, amount_minor, direction, category, date, task_id, goal_id, note)
             SELECT id, amount_minor, direction, category, date,
                    CASE WHEN task_id IN (SELECT id FROM tasks) THEN task_id ELSE NULL END,
                    CASE WHEN goal_id IN (SELECT id FROM goals) THEN goal_id ELSE NULL END,
                    ''
             FROM money_entries;
             DROP TABLE money_entries;
             ALTER TABLE money_entries_v2 RENAME TO money_entries;

             CREATE TABLE IF NOT EXISTS ai_messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL DEFAULT 'default',
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model TEXT NOT NULL DEFAULT '',
                actions_json TEXT,
                created_at TEXT NOT NULL
             );

             CREATE INDEX IF NOT EXISTS idx_tasks_planned_date ON tasks(planned_date);
             CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
             CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);
             CREATE INDEX IF NOT EXISTS idx_money_entries_date ON money_entries(date);
             CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id, id);

             PRAGMA user_version=2;
             COMMIT;",
        );

        let _ = c.execute_batch("PRAGMA foreign_keys=ON;");
        if let Err(e) = upgrade {
            let _ = c.execute_batch("ROLLBACK;");
            return Err(format!("Database migration to v2 failed: {e}"));
        }
    }

    Ok(())
}

fn row_json(names: &[String], row: &rusqlite::Row) -> Result<Value, rusqlite::Error> {
    let mut map = Map::new();
    for (i, name) in names.iter().enumerate() {
        let v: rusqlite::types::Value = row.get(i)?;
        map.insert(
            name.clone(),
            match v {
                rusqlite::types::Value::Null => Value::Null,
                rusqlite::types::Value::Integer(n) => json!(n),
                rusqlite::types::Value::Real(f) => json!(f),
                rusqlite::types::Value::Text(t) => json!(t),
                rusqlite::types::Value::Blob(b) => json!(b),
            },
        );
    }
    Ok(Value::Object(map))
}

fn val(v: &Value) -> rusqlite::types::Value {
    match v {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(b) => rusqlite::types::Value::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else {
                rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        _ => rusqlite::types::Value::Text(v.to_string()),
    }
}

pub fn query_table(c: &Connection, table: &str) -> Result<Vec<Value>, String> {
    if !TABLES.contains(&table) {
        return Err("unknown table".into());
    }
    let mut stmt = c
        .prepare(&format!("SELECT * FROM {table} ORDER BY id"))
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map([], |r| row_json(&names, r))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<Value>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn validate_row(table: &str, obj: &Map<String, Value>, is_insert: bool) -> Result<(), String> {
    if table == "money_entries" {
        if let Some(amt) = obj.get("amount_minor") {
            let n = amt.as_i64().unwrap_or(0);
            if n <= 0 {
                return Err("Amount must be greater than zero.".into());
            }
        } else if is_insert {
            return Err("Amount is required.".into());
        }
        if let Some(dir) = obj.get("direction").and_then(|v| v.as_str()) {
            if dir != "in" && dir != "out" {
                return Err("Direction must be 'in' or 'out'.".into());
            }
        }
    }
    if table == "tasks" {
        if let Some(title) = obj.get("title").and_then(|v| v.as_str()) {
            if title.trim().is_empty() {
                return Err("Task title cannot be empty.".into());
            }
        }
    }
    if table == "goals" {
        if let Some(title) = obj.get("title").and_then(|v| v.as_str()) {
            if title.trim().is_empty() {
                return Err("Goal title cannot be empty.".into());
            }
        }
    }
    if table == "themes" {
        if let Some(name) = obj.get("name").and_then(|v| v.as_str()) {
            if name.trim().is_empty() {
                return Err("Theme name cannot be empty.".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn init_db(state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    let running: Option<Value> = {
        let mut stmt = c
            .prepare("SELECT * FROM time_entries WHERE end_utc IS NULL ORDER BY start_utc DESC LIMIT 1")
            .map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt
            .query_map([], |r| row_json(&names, r))
            .map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())?
    };
    Ok(json!({ "running_timer": running }))
}

#[tauri::command]
pub fn list_table(table: String, state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    let rows = query_table(&c, &table)?;
    Ok(json!(rows))
}

#[tauri::command]
pub fn insert_row(table: String, row: Value, state: State<DbPath>) -> Result<Value, String> {
    let allowed = columns(&table).ok_or("unknown table")?;
    let obj = row.as_object().ok_or("row must be object")?;
    validate_row(&table, obj, true)?;
    let (cols, vals): (Vec<&str>, Vec<rusqlite::types::Value>) = obj
        .iter()
        .filter(|(k, _)| allowed.contains(&k.as_str()))
        .map(|(k, v)| (k.as_str(), val(v)))
        .unzip();
    if cols.is_empty() {
        return Err("no valid columns".into());
    }
    let c = open(&state.0)?;
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        cols.join(","),
        cols.iter().map(|_| "?").collect::<Vec<_>>().join(",")
    );
    let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.execute(rusqlite::params_from_iter(vals))
        .map_err(|e| e.to_string())?;
    Ok(json!({ "id": c.last_insert_rowid() }))
}

#[tauri::command]
pub fn update_row(table: String, id: i64, row: Value, state: State<DbPath>) -> Result<Value, String> {
    let allowed = columns(&table).ok_or("unknown table")?;
    let obj = row.as_object().ok_or("row must be object")?;
    validate_row(&table, obj, false)?;
    let sets: Vec<String> = obj
        .keys()
        .filter(|k| allowed.contains(&k.as_str()))
        .map(|k| format!("{k}=?"))
        .collect();
    if sets.is_empty() {
        return Err("no valid columns".into());
    }
    let vals: Vec<rusqlite::types::Value> = obj
        .iter()
        .filter(|(k, _)| allowed.contains(&k.as_str()))
        .map(|(_, v)| val(v))
        .chain(std::iter::once(rusqlite::types::Value::Integer(id)))
        .collect();
    let c = open(&state.0)?;
    let sql = format!("UPDATE {table} SET {} WHERE id=?", sets.join(","));
    c.execute(&sql, rusqlite::params_from_iter(vals))
        .map_err(|e| e.to_string())?;

    // If a task is marked done while its timer is running, stop its timer automatically.
    if table == "tasks" && obj.get("status").and_then(|v| v.as_str()) == Some("done") {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = c.execute(
            "UPDATE time_entries SET end_utc=? WHERE task_id=? AND end_utc IS NULL",
            params![now, id],
        );
    }

    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn delete_row(table: String, id: i64, state: State<DbPath>) -> Result<Value, String> {
    if !TABLES.contains(&table.as_str()) {
        return Err("unknown table".into());
    }
    if table == "themes" {
        return delete_theme(id, None, state);
    }
    let c = open(&state.0)?;
    c.execute(&format!("DELETE FROM {table} WHERE id=?"), params![id])
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn delete_theme(
    id: i64,
    reassign_to_id: Option<i64>,
    state: State<DbPath>,
) -> Result<Value, String> {
    let mut c = open(&state.0)?;
    let task_count: i64 = c
        .query_row("SELECT COUNT(*) FROM tasks WHERE theme_id=?", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let goal_count: i64 = c
        .query_row("SELECT COUNT(*) FROM goals WHERE theme_id=?", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    if task_count > 0 || goal_count > 0 {
        let Some(target) = reassign_to_id else {
            return Err(format!(
                "Theme is in use by {task_count} task(s) and {goal_count} goal(s). Reassign them to another theme before deleting."
            ));
        };
        if target == id {
            return Err("Replacement theme must be different from the theme being deleted.".into());
        }
        let target_exists: i64 = c
            .query_row("SELECT COUNT(*) FROM themes WHERE id=?", params![target], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if target_exists == 0 {
            return Err("Replacement theme does not exist.".into());
        }
        let tx = c.transaction().map_err(|e| e.to_string())?;
        tx.execute("UPDATE goals SET theme_id=? WHERE theme_id=?", params![target, id])
            .map_err(|e| e.to_string())?;
        tx.execute("UPDATE tasks SET theme_id=? WHERE theme_id=?", params![target, id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM themes WHERE id=?", params![id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(json!({ "ok": true, "reassigned_tasks": task_count, "reassigned_goals": goal_count }));
    }

    c.execute("DELETE FROM themes WHERE id=?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "reassigned_tasks": 0, "reassigned_goals": 0 }))
}

#[tauri::command]
pub fn reschedule_overdue(to_date: String, state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    let moved = c
        .execute(
            "UPDATE tasks SET planned_date=? WHERE planned_date < ? AND status != 'done'",
            params![to_date, to_date],
        )
        .map_err(|e| e.to_string())?;
    Ok(json!({ "moved": moved }))
}

#[tauri::command]
pub fn clear_ai_messages(session_id: Option<String>, state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    if let Some(sid) = session_id {
        c.execute("DELETE FROM ai_messages WHERE session_id=?", params![sid])
            .map_err(|e| e.to_string())?;
    } else {
        c.execute("DELETE FROM ai_messages", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn start_timer(task_id: i64, state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    let now = chrono::Utc::now().to_rfc3339();
    c.execute(
        "UPDATE time_entries SET end_utc=? WHERE end_utc IS NULL",
        params![now],
    )
    .map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO time_entries (task_id, start_utc, end_utc) VALUES (?, ?, NULL)",
        params![task_id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": c.last_insert_rowid(), "start_utc": now }))
}

#[tauri::command]
pub fn stop_timer(state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    let now = chrono::Utc::now().to_rfc3339();
    c.execute(
        "UPDATE time_entries SET end_utc=? WHERE end_utc IS NULL",
        params![now],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn get_settings(state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    let mut stmt = c
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let map: Map<String, Value> = rows.into_iter().map(|(k, v)| (k, json!(v))).collect();
    Ok(Value::Object(map))
}

#[tauri::command]
pub fn set_settings(values: Value, state: State<DbPath>) -> Result<Value, String> {
    let obj = values.as_object().ok_or("values must be object")?;
    let c = open(&state.0)?;
    for (k, v) in obj {
        let s = v
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| v.to_string());
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![k, s],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn save_weekly_report(
    week_start: String,
    snapshot: Value,
    state: State<DbPath>,
) -> Result<Value, String> {
    let c = open(&state.0)?;
    c.execute(
        "INSERT INTO weekly_reports (week_start, snapshot_json) VALUES (?, ?) ON CONFLICT(week_start) DO UPDATE SET snapshot_json=excluded.snapshot_json",
        params![week_start, snapshot.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn export_all_data(state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    Ok(json!({
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "version": 2,
        "themes": query_table(&c, "themes")?,
        "goals": query_table(&c, "goals")?,
        "tasks": query_table(&c, "tasks")?,
        "time_entries": query_table(&c, "time_entries")?,
        "money_entries": query_table(&c, "money_entries")?,
        "weekly_reports": query_table(&c, "weekly_reports")?,
    }))
}

/// Builds a concise, structured snapshot of the user's workspace for Gemini AI context.
pub fn build_planner_context(path: &std::path::Path) -> Result<Value, String> {
    let c = open(path)?;
    let themes = query_table(&c, "themes")?;
    let goals = query_table(&c, "goals")?;
    let tasks = query_table(&c, "tasks")?;
    let time_entries = query_table(&c, "time_entries")?;
    let money_entries = query_table(&c, "money_entries")?;

    let today_local = chrono::Local::now().format("%Y-%m-%d").to_string();
    let cur_month = &today_local[..7];

    // Keep recent / active tasks and recent entries bounded so prompts stay crisp and fast.
    let recent_tasks: Vec<&Value> = tasks
        .iter()
        .rev()
        .take(120)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    let recent_time: Vec<&Value> = time_entries
        .iter()
        .rev()
        .take(80)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    let recent_money: Vec<&Value> = money_entries
        .iter()
        .filter(|m| {
            m.get("date")
                .and_then(|d| d.as_str())
                .map(|d| d.starts_with(cur_month))
                .unwrap_or(false)
        })
        .take(80)
        .collect();

    let currency: String = c
        .query_row("SELECT value FROM settings WHERE key='currency'", [], |r| r.get(0))
        .unwrap_or_else(|_| "USD".into());

    Ok(json!({
        "today_local": today_local,
        "display_currency": currency,
        "base_currency_note": "money_entries.amount_minor is stored in USD cents (100 = $1.00).",
        "themes": themes,
        "goals": goals,
        "tasks": recent_tasks,
        "recent_time_entries": recent_time,
        "this_month_money_entries": recent_money,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_db(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "my_planner_test_{}_{}.db",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(format!("{}-wal", p.display()));
        let _ = std::fs::remove_file(format!("{}-shm", p.display()));
        p
    }

    #[test]
    fn migrates_v1_to_v2_and_cascades_deletes() {
        let p = temp_db("migrate_v1_v2");
        // Simulate a v1 database
        {
            let c = open(&p).unwrap();
            c.execute_batch(
                "CREATE TABLE themes(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1');
                 CREATE TABLE goals(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, horizon TEXT NOT NULL DEFAULT 'month', deadline TEXT, theme_id INTEGER NOT NULL REFERENCES themes(id), status TEXT NOT NULL DEFAULT 'active');
                 CREATE TABLE tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, goal_id INTEGER REFERENCES goals(id), theme_id INTEGER NOT NULL REFERENCES themes(id), planned_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL);
                 CREATE TABLE time_entries(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id), start_utc TEXT NOT NULL, end_utc TEXT);
                 CREATE TABLE money_entries(id INTEGER PRIMARY KEY AUTOINCREMENT, amount_minor INTEGER NOT NULL, direction TEXT NOT NULL, category TEXT NOT NULL, date TEXT NOT NULL, task_id INTEGER REFERENCES tasks(id), goal_id INTEGER REFERENCES goals(id));
                 CREATE TABLE weekly_reports(id INTEGER PRIMARY KEY AUTOINCREMENT, week_start TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL);
                 CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO themes (name, color) VALUES ('Work', '#5749F4');
                 INSERT INTO goals (title, horizon, theme_id) VALUES ('Ship App', 'month', 1);
                 INSERT INTO tasks (title, goal_id, theme_id, planned_date, status, created_at) VALUES ('Fix DB', 1, 1, '2026-11-22', 'planned', '2026-11-22T00:00:00Z');
                 INSERT INTO time_entries (task_id, start_utc, end_utc) VALUES (1, '2026-11-22T01:00:00Z', '2026-11-22T02:00:00Z');
                 INSERT INTO money_entries (amount_minor, direction, category, date, task_id, goal_id) VALUES (500, 'out', 'Coffee', '2026-11-22', 1, 1);
                 PRAGMA user_version=1;",
            )
            .unwrap();
        }

        migrate(&p).unwrap();
        let c = open(&p).unwrap();
        let ver: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(ver, 2);

        // Deleting a task with time_entries and money_entries now succeeds cleanly!
        c.execute("DELETE FROM tasks WHERE id=1", []).unwrap();
        let te_count: i64 = c.query_row("SELECT COUNT(*) FROM time_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(te_count, 0);
        let me_task_id: Option<i64> = c.query_row("SELECT task_id FROM money_entries WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(me_task_id, None);

        // Deleting a goal sets money_entries.goal_id to NULL!
        c.execute("DELETE FROM goals WHERE id=1", []).unwrap();
        let me_goal_id: Option<i64> = c.query_row("SELECT goal_id FROM money_entries WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(me_goal_id, None);

        let _ = std::fs::remove_file(&p);
    }
}
