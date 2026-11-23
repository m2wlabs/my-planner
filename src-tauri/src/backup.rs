use crate::db;
use crate::DbPath;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use chrono::Utc;
use rand::RngCore;
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

const MAGIC: &[u8; 4] = b"MPG1";

fn setting(c: &rusqlite::Connection, key: &str) -> Option<String> {
    c.query_row("SELECT value FROM settings WHERE key=?", rusqlite::params![key], |r| r.get(0))
        .ok()
}

fn provider(c: &rusqlite::Connection) -> Result<FolderProvider, String> {
    let f = setting(c, "backup_folder")
        .filter(|s| !s.is_empty())
        .ok_or("No backup folder chosen")?;
    let p = PathBuf::from(f);
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(FolderProvider(p))
}

fn encrypt(data: &[u8], passphrase: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let mut hash = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), &salt, &mut hash)
        .map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&hash).map_err(|e| e.to_string())?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), data)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(4 + 16 + 12 + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt(data: &[u8], passphrase: &str) -> Result<Vec<u8>, String> {
    if !data.starts_with(MAGIC) {
        return Ok(data.to_vec());
    }
    if data.len() < 32 {
        return Err("Encrypted backup file is truncated or corrupted.".into());
    }
    if passphrase.is_empty() {
        return Err("This backup is encrypted. Enter its passphrase to restore.".into());
    }
    let salt = &data[4..20];
    let nonce = &data[20..32];
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(Nonce::from_slice(nonce), &data[32..])
        .map_err(|_| "Wrong passphrase or corrupted encrypted backup.".to_string())
}

/// Where snapshots go. Local folder today; a cloud provider can implement this same trait.
pub trait BackupProvider {
    fn name(&self) -> &str;
    fn directory(&self) -> PathBuf;
}

pub struct FolderProvider(pub PathBuf);

impl BackupProvider for FolderProvider {
    fn name(&self) -> &str {
        "Local folder"
    }
    fn directory(&self) -> PathBuf {
        self.0.clone()
    }
}

#[allow(dead_code)]
fn provider_name(p: &FolderProvider) -> &str {
    p.name()
}

fn snapshot(db_path: &Path, dest: &Path) -> Result<(), String> {
    let src = db::open(db_path)?;
    let mut dst = rusqlite::Connection::open(dest).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&src, &mut dst).map_err(|e| e.to_string())?;
    backup
        .run_to_completion(100, std::time::Duration::from_millis(10), None)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn is_managed_snapshot(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    let ext_ok = path
        .extension()
        .map(|e| e == "db" || e == "enc")
        .unwrap_or(false);
    name.starts_with("my-planner-") && ext_ok
}

fn prune(dir: &Path, keep: usize) {
    let keep = keep.max(1);
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok().map(|x| x.path()))
                .filter(|p| is_managed_snapshot(p))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files.reverse();
    for f in files.iter().skip(keep) {
        let _ = std::fs::remove_file(f);
    }
}

pub fn do_backup(db_path: &Path) -> Result<serde_json::Value, String> {
    let c = db::open(db_path)?;
    let dir = provider(&c)?.directory();
    let keep: usize = setting(&c, "backup_keep")
        .and_then(|s| s.parse().ok())
        .unwrap_or(30)
        .max(1);
    let pass = setting(&c, "backup_passphrase").unwrap_or_default();
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let raw = dir.join(format!("my-planner-{stamp}.db"));
    snapshot(db_path, &raw)?;
    let final_name = if pass.is_empty() {
        raw.clone()
    } else {
        let data = std::fs::read(&raw).map_err(|e| e.to_string())?;
        let enc = dir.join(format!("my-planner-{stamp}.enc"));
        let mut f = std::fs::File::create(&enc).map_err(|e| e.to_string())?;
        f.write_all(&encrypt(&data, &pass)?)
            .map_err(|e| e.to_string())?;
        std::fs::remove_file(&raw).ok();
        enc
    };
    prune(&dir, keep);
    let now = Utc::now().to_rfc3339();
    c.execute(
        "INSERT INTO settings (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![now],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({
        "file": final_name.file_name().unwrap_or_default().to_string_lossy(),
        "at": now
    }))
}

#[tauri::command]
pub fn backup_now(state: State<DbPath>) -> Result<serde_json::Value, String> {
    do_backup(&state.0)
}

#[tauri::command]
pub fn schedule_backup(state: State<DbPath>) -> Result<serde_json::Value, String> {
    do_backup(&state.0)
}

#[tauri::command]
pub fn list_backups(state: State<DbPath>) -> Result<serde_json::Value, String> {
    let c = db::open(&state.0)?;
    let dir = provider(&c)?.directory();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|x| x.path()))
        .filter(|p| is_managed_snapshot(p))
        .collect();
    files.sort();
    files.reverse();
    let out: Vec<serde_json::Value> = files
        .iter()
        .map(|p| {
            let meta = std::fs::metadata(p).ok();
            let encrypted = p.extension().map(|e| e == "enc").unwrap_or(false);
            json!({
                "name": p.file_name().unwrap_or_default().to_string_lossy(),
                "bytes": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                "modified": meta
                    .and_then(|m| m.modified().ok())
                    .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
                    .unwrap_or_default(),
                "encrypted": encrypted,
            })
        })
        .collect();
    Ok(json!(out))
}

fn remove_wal_sidecars(path: &Path) {
    for ext in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", path.to_string_lossy(), ext));
        let _ = std::fs::remove_file(sidecar);
    }
}

#[tauri::command]
pub fn restore_backup(
    name: String,
    passphrase: String,
    state: State<DbPath>,
) -> Result<serde_json::Value, String> {
    // Reject path traversal: snapshot name must be a single file segment.
    if Path::new(&name).file_name().and_then(|s| s.to_str()) != Some(name.as_str()) {
        return Err("Invalid backup file name.".into());
    }
    let c = db::open(&state.0)?;
    let dir = provider(&c)?.directory();
    drop(c);

    let src = dir.join(&name);
    if !src.exists() {
        return Err("Snapshot not found.".into());
    }

    // Safety copy of current DB before replacing.
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let safety = dir.join(format!("pre-restore-{stamp}.db"));
    snapshot(&state.0, &safety)?;

    let data = std::fs::read(&src).map_err(|e| e.to_string())?;
    let plain = decrypt(&data, &passphrase)?;

    let tmp = state.0.with_extension("restore-tmp");
    let _ = std::fs::remove_file(&tmp);
    remove_wal_sidecars(&tmp);

    std::fs::write(&tmp, &plain).map_err(|e| e.to_string())?;
    // Verify and migrate restored database cleanly, then collapse its WAL before swapping.
    if let Err(e) = db::migrate(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        remove_wal_sidecars(&tmp);
        return Err(format!("Snapshot is not a valid My Planner database: {e}"));
    }
    if let Ok(tc) = rusqlite::Connection::open(&tmp) {
        let _ = tc.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    }
    remove_wal_sidecars(&tmp);

    // Replace the live database safely on Windows & Unix.
    remove_wal_sidecars(&state.0);
    if std::fs::rename(&tmp, &state.0).is_err() {
        std::fs::copy(&tmp, &state.0).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&tmp);
    }

    Ok(json!({
        "ok": true,
        "safety_copy": safety.file_name().unwrap_or_default().to_string_lossy()
    }))
}

#[tauri::command]
pub fn pick_backup_folder(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(json!({ "path": picked.map(|p| p.to_string()) }))
}

#[tauri::command]
pub fn backup_status(state: State<DbPath>) -> Result<serde_json::Value, String> {
    let c = db::open(&state.0)?;
    Ok(json!({
        "folder": setting(&c, "backup_folder").unwrap_or_default(),
        "last_backup_at": setting(&c, "last_backup_at").unwrap_or_default(),
        "keep": setting(&c, "backup_keep").unwrap_or_else(|| "30".into()),
        "encrypted": !setting(&c, "backup_passphrase").unwrap_or_default().is_empty(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip_and_truncation_safety() {
        let payload = b"SQLite format 3\0test payload";
        let enc = encrypt(payload, "s3cret!").unwrap();
        assert!(enc.starts_with(MAGIC));
        assert_eq!(decrypt(&enc, "s3cret!").unwrap(), payload);
        assert!(decrypt(&enc, "wrong").is_err());
        assert!(decrypt(&enc, "").is_err());
        // Truncated file with magic header must return Err instead of panicking
        assert!(decrypt(b"MPG1short", "s3cret!").is_err());
        // Unencrypted file passes straight through
        assert_eq!(decrypt(payload, "").unwrap(), payload);
    }

    #[test]
    fn prune_only_touches_managed_snapshots() {
        let dir = std::env::temp_dir().join(format!("my_planner_prune_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("my-planner-20261120-100000.db"), b"1").unwrap();
        std::fs::write(dir.join("my-planner-20261121-100000.db"), b"2").unwrap();
        std::fs::write(dir.join("my-planner-20261122-100000.db"), b"3").unwrap();
        std::fs::write(dir.join("pre-restore-20261120-100000.db"), b"safe").unwrap();
        std::fs::write(dir.join("other-user-file.db"), b"keep").unwrap();

        prune(&dir, 2);

        assert!(!dir.join("my-planner-20261120-100000.db").exists());
        assert!(dir.join("my-planner-20261121-100000.db").exists());
        assert!(dir.join("my-planner-20261122-100000.db").exists());
        assert!(dir.join("pre-restore-20261120-100000.db").exists());
        assert!(dir.join("other-user-file.db").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
