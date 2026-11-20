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
];

pub fn columns(table: &str) -> Option<&'static [&'static str]> {
    Some(match table {
        "themes" => &["name", "color"],
        "goals" => &["title", "horizon", "deadline", "theme_id", "status"],
        "tasks" => &["title", "goal_id", "theme_id", "planned_date", "status", "created_at"],
        "time_entries" => &["task_id", "start_utc", "end_utc"],
        "money_entries" => &["amount_minor", "direction", "category", "date", "task_id", "goal_id"],
        "weekly_reports" => &["week_start", "snapshot_json"],
        _ => return None,
    })
}

pub fn open(path: &std::path::Path) -> Result<Connection, String> {
    let c = Connection::open(path).map_err(|e| e.to_string())?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
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
            "CREATE TABLE IF NOT EXISTS themes(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1');
             CREATE TABLE IF NOT EXISTS goals(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, horizon TEXT NOT NULL DEFAULT 'month', deadline TEXT, theme_id INTEGER NOT NULL REFERENCES themes(id), status TEXT NOT NULL DEFAULT 'active');
             CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, goal_id INTEGER REFERENCES goals(id), theme_id INTEGER NOT NULL REFERENCES themes(id), planned_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS time_entries(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id), start_utc TEXT NOT NULL, end_utc TEXT);
             CREATE TABLE IF NOT EXISTS money_entries(id INTEGER PRIMARY KEY AUTOINCREMENT, amount_minor INTEGER NOT NULL, direction TEXT NOT NULL, category TEXT NOT NULL, date TEXT NOT NULL, task_id INTEGER REFERENCES tasks(id), goal_id INTEGER REFERENCES goals(id));
             CREATE TABLE IF NOT EXISTS weekly_reports(id INTEGER PRIMARY KEY AUTOINCREMENT, week_start TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             PRAGMA user_version=1;",
        )
        .map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn init_db(state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    let running: Option<Value> = {
            let mut stmt = c
        .prepare("SELECT * FROM time_entries WHERE end_utc IS NULL ORDER BY start_utc DESC LIMIT 1")
        .map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query_map([], |r| row_json(&names, r)).map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())?
    };
    Ok(json!({ "running_timer": running }))
}

#[tauri::command]
pub fn list_table(table: String, state: State<DbPath>) -> Result<Value, String> {
    if !TABLES.contains(&table.as_str()) {
        return Err("unknown table".into());
    }
    let c = open(&state.0)?;
    let mut stmt = c
        .prepare(&format!("SELECT * FROM {table} ORDER BY id"))
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map([], |r| row_json(&names, r))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<Value>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(json!(rows))
}

#[tauri::command]
pub fn insert_row(table: String, row: Value, state: State<DbPath>) -> Result<Value, String> {
    let allowed = columns(&table).ok_or("unknown table")?;
    let obj = row.as_object().ok_or("row must be object")?;
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
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn delete_row(table: String, id: i64, state: State<DbPath>) -> Result<Value, String> {
    if !TABLES.contains(&table.as_str()) {
        return Err("unknown table".into());
    }
    let c = open(&state.0)?;
    c.execute(&format!("DELETE FROM {table} WHERE id=?"), params![id])
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn start_timer(task_id: i64, state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    // Stop any running timer first (one timer at a time).
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
        let s = v.as_str().map(|s| s.to_string()).unwrap_or_else(|| v.to_string());
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![k, s],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn save_weekly_report(week_start: String, snapshot: Value, state: State<DbPath>) -> Result<Value, String> {
    let c = open(&state.0)?;
    c.execute(
        "INSERT INTO weekly_reports (week_start, snapshot_json) VALUES (?, ?) ON CONFLICT(week_start) DO UPDATE SET snapshot_json=excluded.snapshot_json",
        params![week_start, snapshot.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}
