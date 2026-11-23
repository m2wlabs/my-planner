mod backup;
mod db;
mod google_ai;

use std::path::PathBuf;
use tauri::Manager;

pub struct DbPath(pub PathBuf);

fn latest_db_mtime(path: &std::path::Path) -> Option<std::time::SystemTime> {
    let wal = PathBuf::from(format!("{}-wal", path.to_string_lossy()));
    let m1 = std::fs::metadata(path).and_then(|m| m.modified()).ok();
    let m2 = std::fs::metadata(&wal).and_then(|m| m.modified()).ok();
    match (m1, m2) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

/// Background safety net: snapshot on a schedule while the app runs, but only
/// when the database (or its WAL file) changed since the last snapshot.
fn spawn_scheduler(path: PathBuf) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(15 * 60));
        let Ok(c) = db::open(&path) else { continue };
        let folder: Option<String> = c
            .query_row("SELECT value FROM settings WHERE key='backup_folder'", [], |r| {
                r.get(0)
            })
            .ok();
        if folder.map(|f| f.is_empty()).unwrap_or(true) {
            continue;
        }
        let last: Option<String> = c
            .query_row("SELECT value FROM settings WHERE key='last_backup_at'", [], |r| {
                r.get(0)
            })
            .ok();
        drop(c);
        let changed = latest_db_mtime(&path)
            .zip(last.and_then(|l| chrono::DateTime::parse_from_rfc3339(&l).ok()))
            .map(|(mtime, last)| chrono::DateTime::<chrono::Utc>::from(mtime) > last)
            .unwrap_or(true);
        if changed {
            let _ = backup::do_backup(&path);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("app data dir")
                .join("MyPlanner");
            std::fs::create_dir_all(&dir).expect("create data dir");
            let path = dir.join("my-planner.db");
            db::migrate(&path).expect("migrate db");
            spawn_scheduler(path.clone());
            app.manage(DbPath(path));
            app.manage(google_ai::OAuthFlowState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::init_db,
            db::list_table,
            db::insert_row,
            db::update_row,
            db::delete_row,
            db::delete_theme,
            db::reschedule_overdue,
            db::clear_ai_messages,
            db::start_timer,
            db::stop_timer,
            db::get_settings,
            db::set_settings,
            db::save_weekly_report,
            db::export_all_data,
            backup::backup_now,
            backup::list_backups,
            backup::restore_backup,
            backup::pick_backup_folder,
            backup::backup_status,
            backup::schedule_backup,
            google_ai::google_auth_status,
            google_ai::google_open_url,
            google_ai::google_save_oauth_config,
            google_ai::google_import_client_json,
            google_ai::google_pick_client_json,
            google_ai::google_save_api_key,
            google_ai::google_set_preferences,
            google_ai::google_oauth_sign_in,
            google_ai::google_oauth_cancel,
            google_ai::google_import_adc,
            google_ai::google_sign_out,
            google_ai::google_list_models,
            google_ai::google_test_connection,
            google_ai::ai_chat,
            google_ai::ai_quick_prompt,
            google_ai::ai_apply_action,
        ])
        .build(tauri::generate_context!())
        .expect("error while building My Planner");

    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(path) = handle.try_state::<DbPath>() {
                let _ = backup::do_backup(&path.0);
            }
        }
    });
}
