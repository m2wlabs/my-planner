mod backup;
mod db;

use tauri::Manager;

pub struct DbPath(pub std::path::PathBuf);

/// Background safety net: snapshot on a schedule while the app runs, but only
/// when the database changed since the last snapshot.
fn spawn_scheduler(path: std::path::PathBuf) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(15 * 60));
        let Ok(c) = db::open(&path) else { continue };
        let folder: Option<String> = c
            .query_row("SELECT value FROM settings WHERE key='backup_folder'", [], |r| r.get(0))
            .ok();
        if folder.map(|f| f.is_empty()).unwrap_or(true) {
            continue;
        }
        let last: Option<String> = c
            .query_row("SELECT value FROM settings WHERE key='last_backup_at'", [], |r| r.get(0))
            .ok();
        drop(c);
        let changed = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::init_db,
            db::list_table,
            db::insert_row,
            db::update_row,
            db::delete_row,
            db::start_timer,
            db::stop_timer,
            db::get_settings,
            db::set_settings,
            db::save_weekly_report,
            backup::backup_now,
            backup::list_backups,
            backup::restore_backup,
            backup::pick_backup_folder,
            backup::backup_status,
            backup::schedule_backup
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
