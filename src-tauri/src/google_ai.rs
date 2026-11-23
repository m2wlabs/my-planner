use crate::{db, DbPath};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};

const AUTH_FILE: &str = "google-auth.enc";
const KEY_FILE: &str = "google-auth.key";
const AUTH_MAGIC: &[u8; 4] = b"MPA1";

const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const GEMINI_INTERACTIONS_URL: &str = "https://generativelanguage.googleapis.com/v1/interactions";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

const OAUTH_SCOPES: &str =
    "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever";

pub const DEFAULT_MODEL: &str = "gemini-4-hydrogen";

/// Shared cancellation handle so an in-flight OAuth loopback sign-in can be cancelled cleanly.
pub struct OAuthFlowState {
    pub cancel: Mutex<Option<Arc<Notify>>>,
}

impl Default for OAuthFlowState {
    fn default() -> Self {
        Self {
            cancel: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GoogleProfile {
    pub sub: String,
    pub email: String,
    pub name: String,
    pub picture: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAuth {
    pub oauth_client_id: String,
    pub oauth_client_secret: String,
    pub quota_project_id: String,
    pub auth_method: String, // "", "oauth", "adc", "api_key"
    pub profile: Option<GoogleProfile>,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub scopes: Vec<String>,
    pub api_key: String,
    pub preferred_model: String,
    pub prefer_api_key: bool,
}

impl Default for StoredAuth {
    fn default() -> Self {
        Self {
            oauth_client_id: std::env::var("GOOGLE_OAUTH_CLIENT_ID").unwrap_or_default(),
            oauth_client_secret: std::env::var("GOOGLE_OAUTH_CLIENT_SECRET").unwrap_or_default(),
            quota_project_id: std::env::var("GOOGLE_CLOUD_PROJECT").unwrap_or_default(),
            auth_method: String::new(),
            profile: None,
            access_token: String::new(),
            refresh_token: String::new(),
            expires_at: 0,
            scopes: Vec::new(),
            api_key: std::env::var("GEMINI_API_KEY")
                .or_else(|_| std::env::var("GOOGLE_API_KEY"))
                .unwrap_or_default(),
            preferred_model: DEFAULT_MODEL.to_string(),
            prefer_api_key: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub badge: String,
    pub discovered: bool,
}

pub fn curated_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id: "gemini-4-hydrogen".into(),
            label: "Gemini 4 Hydrogen".into(),
            description: "Fast, balanced frontier model — great for daily planning and coaching.".into(),
            badge: "Recommended".into(),
            discovered: false,
        },
        ModelInfo {
            id: "gemini-4-argon".into(),
            label: "Gemini 4 Argon".into(),
            description: "Efficient frontier reasoning for goal breakdowns and schedules.".into(),
            badge: "Balanced".into(),
            discovered: false,
        },
        ModelInfo {
            id: "gemini-4-neon".into(),
            label: "Gemini 4 Neon".into(),
            description: "Frontier intelligence with fast end-to-end analysis and reviews.".into(),
            badge: "Pro".into(),
            discovered: false,
        },
        ModelInfo {
            id: "gemini-4-carbon".into(),
            label: "Gemini 4 Carbon".into(),
            description: "Strongest reasoning model for deep long-horizon strategy.".into(),
            badge: "Deep".into(),
            discovered: false,
        },
        ModelInfo {
            id: "gemini-3.5-flash-lite".into(),
            label: "Gemini 3.5 Flash-Lite".into(),
            description: "Fastest, lowest-cost model for instant note capture and parsing.".into(),
            badge: "Fast".into(),
            discovered: false,
        },
    ]
}

fn data_dir(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn load_or_create_key(dir: &Path) -> Result<[u8; 32], String> {
    let key_path = dir.join(KEY_FILE);
    if let Ok(bytes) = std::fs::read(&key_path) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(&key_path, &key).map_err(|e| e.to_string())?;
    Ok(key)
}

fn load_auth(db_path: &Path) -> StoredAuth {
    let dir = data_dir(db_path);
    let auth_path = dir.join(AUTH_FILE);
    let Ok(raw) = std::fs::read(&auth_path) else {
        return StoredAuth::default();
    };
    if raw.len() < 16 || !raw.starts_with(AUTH_MAGIC) {
        return StoredAuth::default();
    }
    let Ok(key) = load_or_create_key(&dir) else {
        return StoredAuth::default();
    };
    let nonce = &raw[4..16];
    let ct = &raw[16..];
    let Ok(cipher) = Aes256Gcm::new_from_slice(&key) else {
        return StoredAuth::default();
    };
    let Ok(plain) = cipher.decrypt(Nonce::from_slice(nonce), ct) else {
        return StoredAuth::default();
    };
    let mut stored: StoredAuth = serde_json::from_slice(&plain).unwrap_or_default();
    if stored.preferred_model.trim().is_empty() {
        stored.preferred_model = DEFAULT_MODEL.to_string();
    }
    // Never keep deprecated models if somehow written previously.
    if is_deprecated_model(&stored.preferred_model) {
        stored.preferred_model = DEFAULT_MODEL.to_string();
    }
    stored
}

fn save_auth(db_path: &Path, auth: &StoredAuth) -> Result<(), String> {
    let dir = data_dir(db_path);
    let key = load_or_create_key(&dir)?;
    let plain = serde_json::to_vec(auth).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(4 + 12 + ct.len());
    out.extend_from_slice(AUTH_MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    std::fs::write(dir.join(AUTH_FILE), &out).map_err(|e| e.to_string())?;
    Ok(())
}

fn is_deprecated_model(id: &str) -> bool {
    let lower = id.trim_start_matches("models/").to_ascii_lowercase();
    lower.starts_with("gemini-1.")
        || lower.starts_with("gemini-2.0")
        || lower.starts_with("gemini-2.5")
        || lower.starts_with("gemini-pro")
        || lower == "gemini-1.0-pro"
}

fn detect_adc_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("GOOGLE_APPLICATION_CREDENTIALS") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        let pb = PathBuf::from(appdata)
            .join("gcloud")
            .join("application_default_credentials.json");
        if pb.is_file() {
            return Some(pb);
        }
    }
    #[cfg(not(target_os = "windows"))]
    if let Ok(home) = std::env::var("HOME") {
        let pb = PathBuf::from(home)
            .join(".config")
            .join("gcloud")
            .join("application_default_credentials.json");
        if pb.is_file() {
            return Some(pb);
        }
    }
    None
}

fn status_json(auth: &StoredAuth) -> Value {
    let has_oauth = !auth.refresh_token.is_empty() || !auth.access_token.is_empty();
    let has_api_key = !auth.api_key.is_empty();
    let connected = has_oauth || has_api_key;
    let active_transport = if has_api_key && (auth.prefer_api_key || !has_oauth) {
        "api_key"
    } else if has_oauth {
        if auth.auth_method == "adc" {
            "adc"
        } else {
            "oauth"
        }
    } else {
        "none"
    };
    let adc_available = detect_adc_path().is_some();

    let api_key_preview = if auth.api_key.len() >= 10 {
        format!(
            "{}…{}",
            &auth.api_key[..6],
            &auth.api_key[auth.api_key.len() - 4..]
        )
    } else if !auth.api_key.is_empty() {
        "••••••••".into()
    } else {
        String::new()
    };

    json!({
        "connected": connected,
        "has_oauth": has_oauth,
        "has_api_key": has_api_key,
        "api_key_preview": api_key_preview,
        "auth_method": auth.auth_method,
        "active_transport": active_transport,
        "prefer_api_key": auth.prefer_api_key,
        "profile": auth.profile,
        "oauth_configured": !auth.oauth_client_id.trim().is_empty(),
        "oauth_client_id": auth.oauth_client_id,
        "has_oauth_client_secret": !auth.oauth_client_secret.trim().is_empty(),
        "quota_project_id": auth.quota_project_id,
        "preferred_model": auth.preferred_model,
        "adc_available": adc_available,
        "scopes": auth.scopes,
    })
}

fn open_system_browser(target_url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(target_url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only http/https URLs can be opened.".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let escaped = target_url.replace('\'', "''");
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &format!("Start-Process '{escaped}'"),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target_url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target_url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {e}"))?;
        return Ok(());
    }
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .user_agent("MyPlanner/0.2")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

async fn fetch_google_profile(client: &reqwest::Client, access_token: &str) -> Option<GoogleProfile> {
    let resp = client
        .get(GOOGLE_USERINFO_ENDPOINT)
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: Value = resp.json().await.ok()?;
    Some(GoogleProfile {
        sub: v.get("sub").and_then(|x| x.as_str()).unwrap_or("").into(),
        email: v.get("email").and_then(|x| x.as_str()).unwrap_or("").into(),
        name: v
            .get("name")
            .and_then(|x| x.as_str())
            .or_else(|| v.get("email").and_then(|x| x.as_str()))
            .unwrap_or("Google Account")
            .into(),
        picture: v.get("picture").and_then(|x| x.as_str()).unwrap_or("").into(),
    })
}

async fn ensure_fresh_access_token(
    client: &reqwest::Client,
    db_path: &Path,
    auth: &mut StoredAuth,
) -> Result<String, String> {
    let now = chrono::Utc::now().timestamp();
    if !auth.access_token.is_empty() && auth.expires_at > now + 60 {
        return Ok(auth.access_token.clone());
    }
    if auth.refresh_token.is_empty() {
        if !auth.access_token.is_empty() {
            return Ok(auth.access_token.clone());
        }
        return Err("Google session expired. Please sign in with Google again.".into());
    }

    let mut form_pairs: Vec<(&str, String)> = vec![
        ("grant_type", "refresh_token".into()),
        ("refresh_token", auth.refresh_token.clone()),
        ("client_id", auth.oauth_client_id.clone()),
    ];
    if !auth.oauth_client_secret.trim().is_empty() {
        form_pairs.push(("client_secret", auth.oauth_client_secret.clone()));
    }
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form_pairs)
        .finish();

    let resp = client
        .post(GOOGLE_TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Could not refresh Google token: {e}"))?;

    let status = resp.status();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid Google token refresh response: {e}"))?;

    if !status.is_success() {
        let desc = payload
            .get("error_description")
            .or_else(|| payload.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("Token refresh failed");
        return Err(format!("Google session could not be refreshed: {desc}. Please sign in again."));
    }

    let access_token = payload
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Google token response missing access_token")?
        .to_string();
    let expires_in = payload
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3500);

    auth.access_token = access_token.clone();
    auth.expires_at = now + expires_in;
    if let Some(new_refresh) = payload.get("refresh_token").and_then(|v| v.as_str()) {
        if !new_refresh.is_empty() {
            auth.refresh_token = new_refresh.to_string();
        }
    }
    if auth.profile.is_none() {
        auth.profile = fetch_google_profile(client, &access_token).await;
    }
    let _ = save_auth(db_path, auth);
    Ok(access_token)
}

enum AuthHeader {
    ApiKey(String),
    Bearer { token: String, project: Option<String> },
}

async fn resolve_auth_headers(
    client: &reqwest::Client,
    db_path: &Path,
    auth: &mut StoredAuth,
) -> Result<(AuthHeader, Option<AuthHeader>), String> {
    let has_oauth = !auth.refresh_token.is_empty() || !auth.access_token.is_empty();
    let has_key = !auth.api_key.trim().is_empty();

    if !has_oauth && !has_key {
        return Err(
            "Connect your Google Account (Sign in with Google, local Google CLI, or Google AI Studio key) in Settings to use AI models."
                .into(),
        );
    }

    if has_key && (auth.prefer_api_key || !has_oauth) {
        let fallback = if has_oauth {
            ensure_fresh_access_token(client, db_path, auth)
                .await
                .ok()
                .map(|token| AuthHeader::Bearer {
                    token,
                    project: (!auth.quota_project_id.trim().is_empty())
                        .then(|| auth.quota_project_id.clone()),
                })
        } else {
            None
        };
        return Ok((AuthHeader::ApiKey(auth.api_key.clone()), fallback));
    }

    let token = ensure_fresh_access_token(client, db_path, auth).await?;
    let primary = AuthHeader::Bearer {
        token,
        project: (!auth.quota_project_id.trim().is_empty())
            .then(|| auth.quota_project_id.clone()),
    };
    let fallback = if has_key {
        Some(AuthHeader::ApiKey(auth.api_key.clone()))
    } else {
        None
    };
    Ok((primary, fallback))
}

fn apply_auth(mut req: reqwest::RequestBuilder, header: &AuthHeader) -> reqwest::RequestBuilder {
    match header {
        AuthHeader::ApiKey(key) => req.header("x-goog-api-key", key),
        AuthHeader::Bearer { token, project } => {
            req = req.bearer_auth(token);
            if let Some(p) = project {
                req = req.header("x-goog-user-project", p);
            }
            req
        }
    }
}

fn parse_oauth_client_json(raw: &str) -> Result<(String, String, String), String> {
    let parsed: Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid JSON format: {e}"))?;
    let node = parsed
        .get("installed")
        .or_else(|| parsed.get("web"))
        .unwrap_or(&parsed);
    let client_id = node
        .get("client_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("JSON does not contain a valid `client_id`. Export a Desktop App OAuth client JSON from Google Cloud Console.")?
        .to_string();
    let client_secret = node
        .get("client_secret")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let project_id = node
        .get("project_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    Ok((client_id, client_secret, project_id))
}

fn html_response(title: &str, body: &str, ok: bool) -> String {
    let badge_bg = if ok { "#a1e5a1" } else { "#ffbfb2" };
    let badge_fg = if ok { "#003300" } else { "#590f00" };
    let badge_text = if ok { "Connected" } else { "Sign-in cancelled" };
    let html = format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{title} — My Planner</title>
<style>
  body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:#f5f5f5; font-family:system-ui,-apple-system,Segoe UI,sans-serif; color:#2a2933; }}
  .card {{ background:#fff; border:1px solid #e4e4e7; border-radius:28px; padding:36px 40px; max-width:440px; text-align:center; box-shadow:0 10px 30px rgba(16,16,20,.06); }}
  .badge {{ display:inline-block; padding:5px 12px; border-radius:999px; font-size:12px; font-weight:600; background:{badge_bg}; color:{badge_fg}; margin-bottom:14px; }}
  h1 {{ margin:0 0 10px; font-size:22px; font-weight:600; }}
  p {{ margin:0; color:#616167; line-height:1.5; font-size:14px; }}
</style>
</head>
<body>
  <div class="card">
    <div class="badge">{badge_text}</div>
    <h1>{title}</h1>
    <p>{body}</p>
  </div>
</body>
</html>"#
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    )
}

/* --------------------------------------------------------- Tauri commands */

#[tauri::command]
pub fn google_auth_status(state: State<DbPath>) -> Result<Value, String> {
    let auth = load_auth(&state.0);
    Ok(status_json(&auth))
}

#[tauri::command]
pub fn google_open_url(url: String) -> Result<Value, String> {
    open_system_browser(&url)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn google_save_oauth_config(
    client_id: String,
    client_secret: String,
    quota_project_id: Option<String>,
    state: State<DbPath>,
) -> Result<Value, String> {
    let mut auth = load_auth(&state.0);
    auth.oauth_client_id = client_id.trim().to_string();
    if !client_secret.trim().is_empty() || auth.oauth_client_id.is_empty() {
        auth.oauth_client_secret = client_secret.trim().to_string();
    }
    if let Some(proj) = quota_project_id {
        auth.quota_project_id = proj.trim().to_string();
    }
    save_auth(&state.0, &auth)?;
    Ok(status_json(&auth))
}

#[tauri::command]
pub fn google_import_client_json(json_text: String, state: State<DbPath>) -> Result<Value, String> {
    let (client_id, client_secret, project_id) = parse_oauth_client_json(&json_text)?;
    let mut auth = load_auth(&state.0);
    auth.oauth_client_id = client_id;
    auth.oauth_client_secret = client_secret;
    if !project_id.is_empty() {
        auth.quota_project_id = project_id;
    }
    save_auth(&state.0, &auth)?;
    Ok(status_json(&auth))
}

#[tauri::command]
pub fn google_pick_client_json(
    app: tauri::AppHandle,
    state: State<DbPath>,
) -> Result<Value, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Google OAuth Client JSON", &["json"])
        .blocking_pick_file();
    let Some(file_path) = picked else {
        return Ok(json!({ "cancelled": true }));
    };
    let path_str = file_path.to_string();
    let raw = std::fs::read_to_string(&path_str)
        .map_err(|e| format!("Could not read selected file: {e}"))?;
    let (client_id, client_secret, project_id) = parse_oauth_client_json(&raw)?;
    let mut auth = load_auth(&state.0);
    auth.oauth_client_id = client_id;
    auth.oauth_client_secret = client_secret;
    if !project_id.is_empty() {
        auth.quota_project_id = project_id;
    }
    save_auth(&state.0, &auth)?;
    Ok(json!({ "cancelled": false, "status": status_json(&auth) }))
}

#[tauri::command]
pub fn google_save_api_key(
    api_key: String,
    prefer_api_key: Option<bool>,
    state: State<DbPath>,
) -> Result<Value, String> {
    let mut auth = load_auth(&state.0);
    auth.api_key = api_key.trim().to_string();
    if let Some(pref) = prefer_api_key {
        auth.prefer_api_key = pref;
    } else if !auth.api_key.is_empty() && auth.refresh_token.is_empty() {
        auth.auth_method = "api_key".into();
        auth.prefer_api_key = true;
    }
    if auth.api_key.is_empty() && auth.auth_method == "api_key" {
        auth.auth_method.clear();
        auth.prefer_api_key = false;
    }
    save_auth(&state.0, &auth)?;
    Ok(status_json(&auth))
}

#[tauri::command]
pub fn google_set_preferences(
    preferred_model: Option<String>,
    prefer_api_key: Option<bool>,
    quota_project_id: Option<String>,
    state: State<DbPath>,
) -> Result<Value, String> {
    let mut auth = load_auth(&state.0);
    if let Some(m) = preferred_model {
        let trimmed = m.trim().trim_start_matches("models/");
        if !trimmed.is_empty() && !is_deprecated_model(trimmed) {
            auth.preferred_model = trimmed.to_string();
        }
    }
    if let Some(pref) = prefer_api_key {
        auth.prefer_api_key = pref;
    }
    if let Some(proj) = quota_project_id {
        auth.quota_project_id = proj.trim().to_string();
    }
    save_auth(&state.0, &auth)?;
    Ok(status_json(&auth))
}

#[tauri::command]
pub async fn google_oauth_cancel(flow: State<'_, OAuthFlowState>) -> Result<Value, String> {
    if let Some(notify) = flow.cancel.lock().await.take() {
        notify.notify_waiters();
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn google_oauth_sign_in(
    state: State<'_, DbPath>,
    flow: State<'_, OAuthFlowState>,
) -> Result<Value, String> {
    let db_path = state.0.clone();
    let mut auth = load_auth(&db_path);
    if auth.oauth_client_id.trim().is_empty() {
        return Err(
            "Add your Google Cloud Desktop OAuth client (import client_secret.json or enter Client ID) before signing in."
                .into(),
        );
    }

    // Cancel any previous pending sign-in flow.
    if let Some(prev) = flow.cancel.lock().await.take() {
        prev.notify_waiters();
    }
    let cancel_notify = Arc::new(Notify::new());
    *flow.cancel.lock().await = Some(cancel_notify.clone());

    // PKCE S256 verifier + challenge + CSRF state.
    let mut verifier_bytes = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let code_verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let challenge_hash = Sha256::digest(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(challenge_hash);

    let mut state_bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut state_bytes);
    let csrf_state = URL_SAFE_NO_PAD.encode(state_bytes);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not start local OAuth callback listener: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let mut auth_url = url::Url::parse(GOOGLE_AUTH_ENDPOINT).map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", auth.oauth_client_id.trim())
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", OAUTH_SCOPES)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &csrf_state);

    open_system_browser(auth_url.as_str())?;

    // Wait up to 3 minutes for the browser redirect (ignoring favicon requests).
    let code_result: Result<String, String> = tokio::select! {
        _ = cancel_notify.notified() => Err("Google sign-in was cancelled.".into()),
        _ = tokio::time::sleep(std::time::Duration::from_secs(180)) => {
            Err("Google sign-in timed out after 3 minutes. Please try again.".into())
        }
        res = async {
            loop {
                let (mut socket, _) = listener
                    .accept()
                    .await
                    .map_err(|e| format!("OAuth callback accept error: {e}"))?;
                let mut buf = [0u8; 8192];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                if n == 0 {
                    continue;
                }
                let req_str = String::from_utf8_lossy(&buf[..n]);
                let first_line = req_str.lines().next().unwrap_or("");
                let req_target = first_line.split_whitespace().nth(1).unwrap_or("/");
                if !req_target.starts_with("/callback") {
                    let _ = socket
                        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .await;
                    continue;
                }

                let full_url = url::Url::parse(&format!("http://127.0.0.1{req_target}"))
                    .map_err(|e| format!("Invalid callback URL: {e}"))?;
                let mut code = None;
                let mut got_state = None;
                let mut oauth_err = None;
                for (k, v) in full_url.query_pairs() {
                    match k.as_ref() {
                        "code" => code = Some(v.into_owned()),
                        "state" => got_state = Some(v.into_owned()),
                        "error" => oauth_err = Some(v.into_owned()),
                        _ => {}
                    }
                }

                if let Some(err) = oauth_err {
                    let body = html_response(
                        "Google sign-in did not finish",
                        &format!("Google returned: {err}. You can close this tab and try again in My Planner."),
                        false,
                    );
                    let _ = socket.write_all(body.as_bytes()).await;
                    return Err(format!("Google sign-in declined: {err}"));
                }

                if got_state.as_deref() != Some(csrf_state.as_str()) {
                    let body = html_response(
                        "Security check failed",
                        "The OAuth state token did not match. Please close this tab and try signing in again.",
                        false,
                    );
                    let _ = socket.write_all(body.as_bytes()).await;
                    return Err("OAuth state mismatch. Please retry sign-in.".into());
                }

                if let Some(c) = code {
                    let body = html_response(
                        "You're signed in to My Planner",
                        "Your Google Account is now connected for direct Gemini AI access. You can close this browser tab.",
                        true,
                    );
                    let _ = socket.write_all(body.as_bytes()).await;
                    return Ok(c);
                }

                let body = html_response(
                    "Missing authorization code",
                    "Google did not return an authorization code. Please close this tab and try again.",
                    false,
                );
                let _ = socket.write_all(body.as_bytes()).await;
                return Err("Google callback did not include an authorization code.".into());
            }
        } => res,
    };

    *flow.cancel.lock().await = None;
    let auth_code = code_result?;

    // Exchange code + PKCE verifier (+ client_secret if configured) for OAuth tokens.
    let client = build_http_client()?;
    let mut form_pairs: Vec<(&str, String)> = vec![
        ("code", auth_code),
        ("client_id", auth.oauth_client_id.clone()),
        ("code_verifier", code_verifier),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code".into()),
    ];
    if !auth.oauth_client_secret.trim().is_empty() {
        form_pairs.push(("client_secret", auth.oauth_client_secret.clone()));
    }
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form_pairs)
        .finish();

    let resp = client
        .post(GOOGLE_TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Google token endpoint: {e}"))?;

    let status = resp.status();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid token response from Google: {e}"))?;

    if !status.is_success() {
        let desc = payload
            .get("error_description")
            .or_else(|| payload.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("Token exchange failed");
        return Err(format!("Google token exchange failed: {desc}"));
    }

    let access_token = payload
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Google response missing access_token")?
        .to_string();
    let refresh_token = payload
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let expires_in = payload
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3500);
    let scopes: Vec<String> = payload
        .get("scope")
        .and_then(|v| v.as_str())
        .map(|s| s.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default();

    let profile = fetch_google_profile(&client, &access_token).await;

    auth.auth_method = "oauth".into();
    auth.access_token = access_token;
    if !refresh_token.is_empty() {
        auth.refresh_token = refresh_token;
    }
    auth.expires_at = chrono::Utc::now().timestamp() + expires_in;
    auth.scopes = scopes;
    auth.profile = profile;
    auth.prefer_api_key = false;
    save_auth(&db_path, &auth)?;

    Ok(status_json(&auth))
}

#[tauri::command]
pub async fn google_import_adc(state: State<'_, DbPath>) -> Result<Value, String> {
    let db_path = state.0.clone();
    let path = detect_adc_path().ok_or(
        "No local Google CLI (gcloud Application Default Credentials) file found on this device.",
    )?;
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read ADC credentials file: {e}"))?;
    let v: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid ADC credentials JSON: {e}"))?;

    if v.get("type").and_then(|t| t.as_str()) != Some("authorized_user") {
        return Err("Only user Google Account ADC files (`authorized_user`) can be imported.".into());
    }

    let client_id = v
        .get("client_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let client_secret = v
        .get("client_secret")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let refresh_token = v
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let quota_project_id = v
        .get("quota_project_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    if client_id.is_empty() || refresh_token.is_empty() {
        return Err("Local Google ADC file is missing client_id or refresh_token.".into());
    }

    let mut auth = load_auth(&db_path);
    auth.oauth_client_id = client_id;
    auth.oauth_client_secret = client_secret;
    auth.refresh_token = refresh_token;
    auth.access_token.clear();
    auth.expires_at = 0;
    if !quota_project_id.is_empty() {
        auth.quota_project_id = quota_project_id;
    }
    auth.auth_method = "adc".into();
    auth.prefer_api_key = false;

    let client = build_http_client()?;
    let token = ensure_fresh_access_token(&client, &db_path, &mut auth).await?;
    auth.profile = fetch_google_profile(&client, &token).await;
    save_auth(&db_path, &auth)?;

    Ok(status_json(&auth))
}

#[tauri::command]
pub async fn google_sign_out(
    clear_api_key: Option<bool>,
    state: State<'_, DbPath>,
) -> Result<Value, String> {
    let db_path = state.0.clone();
    let mut auth = load_auth(&db_path);
    let token_to_revoke = if !auth.refresh_token.is_empty() {
        auth.refresh_token.clone()
    } else {
        auth.access_token.clone()
    };

    if !token_to_revoke.is_empty() {
        if let Ok(client) = build_http_client() {
            let body = url::form_urlencoded::Serializer::new(String::new())
                .append_pair("token", &token_to_revoke)
                .finish();
            let _ = client
                .post(GOOGLE_REVOKE_ENDPOINT)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body)
                .send()
                .await;
        }
    }

    auth.access_token.clear();
    auth.refresh_token.clear();
    auth.expires_at = 0;
    auth.scopes.clear();
    auth.profile = None;
    if clear_api_key.unwrap_or(false) {
        auth.api_key.clear();
        auth.auth_method.clear();
        auth.prefer_api_key = false;
    } else if !auth.api_key.is_empty() {
        auth.auth_method = "api_key".into();
        auth.prefer_api_key = true;
    } else {
        auth.auth_method.clear();
        auth.prefer_api_key = false;
    }
    save_auth(&db_path, &auth)?;
    Ok(status_json(&auth))
}

#[tauri::command]
pub async fn google_list_models(state: State<'_, DbPath>) -> Result<Value, String> {
    let db_path = state.0.clone();
    let mut auth = load_auth(&db_path);
    let mut models = curated_models();

    let client = build_http_client()?;
    let Ok((primary, fallback)) = resolve_auth_headers(&client, &db_path, &mut auth).await else {
        return Ok(json!({ "models": models, "live": false }));
    };

    let mut resp = apply_auth(client.get(format!("{GEMINI_MODELS_URL}?pageSize=100")), &primary)
        .send()
        .await;
    if let Ok(ref r) = resp {
        if !r.status().is_success() {
            if let Some(fb) = fallback {
                resp = apply_auth(client.get(format!("{GEMINI_MODELS_URL}?pageSize=100")), &fb)
                    .send()
                    .await;
            }
        }
    }

    let Ok(r) = resp else {
        return Ok(json!({ "models": models, "live": false }));
    };
    if !r.status().is_success() {
        return Ok(json!({ "models": models, "live": false }));
    }

    let Ok(payload) = r.json::<Value>().await else {
        return Ok(json!({ "models": models, "live": false }));
    };

    if let Some(arr) = payload.get("models").and_then(|m| m.as_array()) {
        for item in arr {
            let raw_name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let id = raw_name.trim_start_matches("models/");
            if id.is_empty() || is_deprecated_model(id) {
                continue;
            }
            let lower = id.to_ascii_lowercase();
            // Keep modern text/reasoning Gemini & Gemma 4 models, exclude specialized media/embedding endpoints.
            let is_chat_model = (lower.starts_with("gemini-4")
                || lower.starts_with("gemini-3")
                || lower.starts_with("gemma-4"))
                && !lower.contains("embedding")
                && !lower.contains("tts")
                && !lower.contains("image")
                && !lower.contains("transcribe")
                && !lower.contains("omni")
                && !lower.contains("live")
                && !lower.contains("decision");
            if !is_chat_model {
                continue;
            }

            if let Some(existing) = models.iter_mut().find(|m| m.id == id) {
                existing.discovered = true;
            } else {
                let display = item
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(id)
                    .to_string();
                let desc = item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Available on your Google Account.")
                    .to_string();
                models.push(ModelInfo {
                    id: id.to_string(),
                    label: display,
                    description: desc,
                    badge: "Account".into(),
                    discovered: true,
                });
            }
        }
    }

    Ok(json!({ "models": models, "live": true }))
}

#[tauri::command]
pub async fn google_test_connection(state: State<'_, DbPath>) -> Result<Value, String> {
    let db_path = state.0.clone();
    let mut auth = load_auth(&db_path);
    let client = build_http_client()?;
    let (primary, fallback) = resolve_auth_headers(&client, &db_path, &mut auth).await?;

    let test_body = json!({
        "model": auth.preferred_model,
        "input": "Reply with exactly: OK",
        "store": false,
        "generation_config": {
            "max_output_tokens": 16
        }
    });

    let mut used = match &primary {
        AuthHeader::ApiKey(_) => "api_key",
        AuthHeader::Bearer { .. } => "oauth",
    };

    let mut resp = apply_auth(client.post(GEMINI_INTERACTIONS_URL).json(&test_body), &primary)
        .send()
        .await
        .map_err(|e| format!("Could not reach Gemini API: {e}"))?;

    if !resp.status().is_success() {
        let first_err = resp.text().await.unwrap_or_default();
        if let Some(fb) = fallback {
            used = match &fb {
                AuthHeader::ApiKey(_) => "api_key",
                AuthHeader::Bearer { .. } => "oauth",
            };
            resp = apply_auth(client.post(GEMINI_INTERACTIONS_URL).json(&test_body), &fb)
                .send()
                .await
                .map_err(|e| format!("Could not reach Gemini API: {e}"))?;
        } else {
            return Err(format_gemini_error(&first_err, used == "oauth"));
        }
    }

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format_gemini_error(&err_text, used == "oauth"));
    }

    let payload: Value = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected response from Gemini API: {e}"))?;
    let reply = extract_interaction_text(&payload);

    Ok(json!({
        "ok": true,
        "model": auth.preferred_model,
        "transport": used,
        "reply": reply,
    }))
}

fn format_gemini_error(raw: &str, was_oauth: bool) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(raw) {
        let msg = v
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or(raw);
        let status = v
            .pointer("/error/status")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if was_oauth
            && (status == "PERMISSION_DENIED"
                || msg.contains("has not been used in project")
                || msg.contains("Quota project")
                || msg.contains("API has not been enabled"))
        {
            return format!(
                "{msg} — Tip: Enable the Generative Language API in your Google Cloud project, set your Quota Project ID in Settings, or add a Google AI Studio key alongside your Google Account."
            );
        }
        return format!("Gemini API error ({status}): {msg}");
    }
    format!("Gemini API error: {}", raw.chars().take(280).collect::<String>())
}

/// Extracts trailing model_output text from an Interactions API v1 response (`steps` schema).
fn extract_interaction_text(payload: &Value) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if let Some(steps) = payload.get("steps").and_then(|s| s.as_array()) {
        for step in steps {
            if step.get("type").and_then(|t| t.as_str()) == Some("model_output") {
                if let Some(content) = step.get("content").and_then(|c| c.as_array()) {
                    for block in content {
                        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                            if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                                parts.push(t);
                            }
                        }
                    }
                }
            }
        }
    }
    if parts.is_empty() {
        if let Some(t) = payload.get("output_text").and_then(|x| x.as_str()) {
            return t.to_string();
        }
    }
    parts.join("")
}

fn planner_response_schema() -> Value {
    json!({
        "type": "text",
        "mime_type": "application/json",
        "schema": {
            "type": "object",
            "properties": {
                "reply": {
                    "type": "string",
                    "description": "Concise, actionable response for the user in clean plain text or lightweight Markdown bullets."
                },
                "suggested_actions": {
                    "type": "array",
                    "description": "Optional concrete planner changes the user can apply in one click. Return [] if no changes are needed.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": [
                                    "create_task",
                                    "complete_task",
                                    "reschedule_task",
                                    "create_goal",
                                    "create_money_entry",
                                    "create_theme"
                                ]
                            },
                            "label": { "type": "string" },
                            "title": { "type": "string" },
                            "notes": { "type": "string" },
                            "task_id": { "type": "integer" },
                            "theme_id": { "type": "integer" },
                            "theme_name": { "type": "string" },
                            "goal_id": { "type": "integer" },
                            "planned_date": { "type": "string" },
                            "estimate_mins": { "type": "integer" },
                            "priority": { "type": "string", "enum": ["low", "normal", "high"] },
                            "horizon": { "type": "string", "enum": ["week", "month", "year"] },
                            "deadline": { "type": "string" },
                            "direction": { "type": "string", "enum": ["in", "out"] },
                            "amount_usd": { "type": "number" },
                            "category": { "type": "string" },
                            "date": { "type": "string" },
                            "color": { "type": "string" }
                        },
                        "required": ["type", "label"]
                    }
                }
            },
            "required": ["reply", "suggested_actions"]
        }
    })
}

fn parse_structured_ai_output(raw_text: &str) -> (String, Vec<Value>) {
    let trimmed = raw_text.trim();
    let candidate = if trimmed.starts_with("```") {
        trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        trimmed
    };

    if let Ok(v) = serde_json::from_str::<Value>(candidate) {
        if let Some(reply) = v.get("reply").and_then(|r| r.as_str()) {
            let actions = v
                .get("suggested_actions")
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            return (reply.to_string(), actions);
        }
    }
    (trimmed.to_string(), Vec::new())
}

async fn run_gemini_planner_interaction(
    db_path: &Path,
    prompt: &str,
    model_override: Option<&str>,
    history: &[(String, String)],
    extra_context: Option<&str>,
) -> Result<(String, Vec<Value>, String, Value), String> {
    let mut auth = load_auth(db_path);
    let model = model_override
        .map(str::trim)
        .filter(|s| !s.is_empty() && !is_deprecated_model(s))
        .unwrap_or(&auth.preferred_model)
        .to_string();

    let snapshot = db::build_planner_context(db_path)?;
    let system_instruction = format!(
        "You are My Planner AI — a sharp, warm, practical personal planning, time-tracking, and money coach embedded in a local-first desktop app.\n\
         Rules:\n\
         - Be concise, direct, and grounded strictly in the user's real workspace data below.\n\
         - Never invent task IDs or goal IDs; only reference IDs present in the snapshot.\n\
         - All dates must use YYYY-MM-DD format relative to today_local.\n\
         - When the user asks to plan, break down a goal, schedule tasks, reschedule overdue items, or log expenses/income, populate `suggested_actions` with concrete, ready-to-apply items.\n\
         - For `create_task`, include `title`, `planned_date`, `theme_id` (from existing themes, or `theme_name` if proposing a new theme), optional `goal_id`, `estimate_mins`, `priority`, and `notes`.\n\
         - For `create_money_entry`, always convert amounts into positive `amount_usd` (number in USD, since the database stores USD base minor units), with `direction` ('in' or 'out'), `category`, `date`, optional `goal_id`, and `notes`.\n\
         - Keep `reply` crisp and readable.\n\n\
         CURRENT WORKSPACE SNAPSHOT:\n{}\n{}",
        serde_json::to_string(&snapshot).unwrap_or_default(),
        extra_context
            .map(|c| format!("\nEXTRA VIEW CONTEXT:\n{c}"))
            .unwrap_or_default()
    );

    let mut transcript = String::new();
    for (role, text) in history.iter().rev().take(12).collect::<Vec<_>>().into_iter().rev() {
        let who = if role == "user" { "User" } else { "Assistant" };
        transcript.push_str(&format!("{who}: {text}\n\n"));
    }
    transcript.push_str(&format!("User: {prompt}"));

    let request_body = json!({
        "model": model,
        "system_instruction": system_instruction,
        "input": transcript,
        "store": false,
        "response_format": planner_response_schema(),
        "generation_config": {
            "max_output_tokens": 2048
        }
    });

    let client = build_http_client()?;
    let (primary, fallback) = resolve_auth_headers(&client, db_path, &mut auth).await?;

    let mut used_oauth = matches!(primary, AuthHeader::Bearer { .. });
    let mut resp = apply_auth(client.post(GEMINI_INTERACTIONS_URL).json(&request_body), &primary)
        .send()
        .await
        .map_err(|e| format!("Network error calling Gemini: {e}"))?;

    if !resp.status().is_success() {
        let first_err = resp.text().await.unwrap_or_default();
        if let Some(fb) = fallback {
            used_oauth = matches!(fb, AuthHeader::Bearer { .. });
            resp = apply_auth(client.post(GEMINI_INTERACTIONS_URL).json(&request_body), &fb)
                .send()
                .await
                .map_err(|e| format!("Network error calling Gemini: {e}"))?;
        } else {
            return Err(format_gemini_error(&first_err, used_oauth));
        }
    }

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format_gemini_error(&err_text, used_oauth));
    }

    let payload: Value = resp
        .json()
        .await
        .map_err(|e| format!("Could not parse Gemini response: {e}"))?;
    let raw_text = extract_interaction_text(&payload);
    if raw_text.trim().is_empty() {
        return Err("Gemini returned an empty response. Try again or switch models.".into());
    }
    let (reply, actions) = parse_structured_ai_output(&raw_text);
    let usage = payload.get("usage").cloned().unwrap_or(Value::Null);
    Ok((reply, actions, model, usage))
}

#[tauri::command]
pub async fn ai_chat(
    prompt: String,
    session_id: Option<String>,
    model: Option<String>,
    extra_context: Option<String>,
    state: State<'_, DbPath>,
) -> Result<Value, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Enter a message for the AI assistant.".into());
    }
    let sid = session_id.unwrap_or_else(|| "default".into());
    let db_path = state.0.clone();

    // Load recent conversation history from SQLite.
    let history: Vec<(String, String)> = {
        let c = db::open(&db_path)?;
        let mut stmt = c
            .prepare("SELECT role, content FROM ai_messages WHERE session_id=? ORDER BY id DESC LIMIT 12")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![sid], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows.into_iter().rev().collect()
    };

    // Save user message immediately.
    let now_user = chrono::Utc::now().to_rfc3339();
    {
        let c = db::open(&db_path)?;
        c.execute(
            "INSERT INTO ai_messages (session_id, role, content, model, actions_json, created_at) VALUES (?, 'user', ?, '', NULL, ?)",
            rusqlite::params![sid, prompt, now_user],
        )
        .map_err(|e| e.to_string())?;
    }

    let (reply, actions, used_model, usage) = run_gemini_planner_interaction(
        &db_path,
        &prompt,
        model.as_deref(),
        &history,
        extra_context.as_deref(),
    )
    .await?;

    let now_ai = chrono::Utc::now().to_rfc3339();
    let actions_str = serde_json::to_string(&actions).unwrap_or_else(|_| "[]".into());
    let msg_id = {
        let c = db::open(&db_path)?;
        c.execute(
            "INSERT INTO ai_messages (session_id, role, content, model, actions_json, created_at) VALUES (?, 'assistant', ?, ?, ?, ?)",
            rusqlite::params![sid, reply, used_model, actions_str, now_ai],
        )
        .map_err(|e| e.to_string())?;
        c.last_insert_rowid()
    };

    Ok(json!({
        "id": msg_id,
        "reply": reply,
        "suggested_actions": actions,
        "model": used_model,
        "usage": usage,
        "created_at": now_ai,
    }))
}

#[tauri::command]
pub async fn ai_quick_prompt(
    prompt: String,
    model: Option<String>,
    extra_context: Option<String>,
    state: State<'_, DbPath>,
) -> Result<Value, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Prompt cannot be empty.".into());
    }
    let db_path = state.0.clone();
    let (reply, actions, used_model, usage) = run_gemini_planner_interaction(
        &db_path,
        &prompt,
        model.as_deref(),
        &[],
        extra_context.as_deref(),
    )
    .await?;

    Ok(json!({
        "reply": reply,
        "suggested_actions": actions,
        "model": used_model,
        "usage": usage,
    }))
}

fn resolve_or_create_theme_id(
    c: &rusqlite::Connection,
    theme_id: Option<i64>,
    theme_name: Option<&str>,
) -> Result<i64, String> {
    if let Some(tid) = theme_id {
        let exists: i64 = c
            .query_row("SELECT COUNT(*) FROM themes WHERE id=?", rusqlite::params![tid], |r| {
                r.get(0)
            })
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
        c.execute(
            "INSERT INTO themes (name, color) VALUES (?, '#5749F4')",
            rusqlite::params![name],
        )
        .map_err(|e| e.to_string())?;
        return Ok(c.last_insert_rowid());
    }
    if let Ok(first) = c.query_row("SELECT id FROM themes ORDER BY id LIMIT 1", [], |r| {
        r.get::<_, i64>(0)
    }) {
        return Ok(first);
    }
    c.execute(
        "INSERT INTO themes (name, color) VALUES ('General', '#5749F4')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(c.last_insert_rowid())
}

#[tauri::command]
pub fn ai_apply_action(action: Value, state: State<DbPath>) -> Result<Value, String> {
    let c = db::open(&state.0)?;
    let kind = action
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or("Action missing type")?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    match kind {
        "create_theme" => {
            let name = action
                .get("title")
                .or_else(|| action.get("theme_name"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or("Theme name is required")?;
            let color = action
                .get("color")
                .and_then(|v| v.as_str())
                .filter(|s| s.starts_with('#') && s.len() == 7)
                .unwrap_or("#5749F4");
            c.execute(
                "INSERT INTO themes (name, color) VALUES (?, ?)",
                rusqlite::params![name, color],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Created theme \"{name}\"") }))
        }
        "create_goal" => {
            let title = action
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or("Goal title is required")?;
            let horizon = match action.get("horizon").and_then(|v| v.as_str()) {
                Some("week") => "week",
                Some("year") => "year",
                _ => "month",
            };
            let deadline = action
                .get("deadline")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| s.len() == 10)
                .map(str::to_string);
            let notes = action.get("notes").and_then(|v| v.as_str()).unwrap_or("");
            let tid = resolve_or_create_theme_id(
                &c,
                action.get("theme_id").and_then(|v| v.as_i64()),
                action.get("theme_name").and_then(|v| v.as_str()),
            )?;
            c.execute(
                "INSERT INTO goals (title, horizon, deadline, theme_id, status, notes) VALUES (?, ?, ?, ?, 'active', ?)",
                rusqlite::params![title, horizon, deadline, tid, notes],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Created goal \"{title}\"") }))
        }
        "create_task" => {
            let title = action
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or("Task title is required")?;
            let planned_date = action
                .get("planned_date")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| s.len() == 10)
                .unwrap_or(&today)
                .to_string();
            let goal_id = action.get("goal_id").and_then(|v| v.as_i64()).filter(|gid| {
                c.query_row("SELECT COUNT(*) FROM goals WHERE id=?", rusqlite::params![gid], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap_or(0)
                    > 0
            });
            let tid = resolve_or_create_theme_id(
                &c,
                action.get("theme_id").and_then(|v| v.as_i64()),
                action.get("theme_name").and_then(|v| v.as_str()),
            )?;
            let notes = action.get("notes").and_then(|v| v.as_str()).unwrap_or("");
            let estimate_mins = action
                .get("estimate_mins")
                .and_then(|v| v.as_i64())
                .filter(|&m| m > 0);
            let priority = match action.get("priority").and_then(|v| v.as_str()) {
                Some("high") => "high",
                Some("low") => "low",
                _ => "normal",
            };
            let created_at = chrono::Utc::now().to_rfc3339();
            c.execute(
                "INSERT INTO tasks (title, goal_id, theme_id, planned_date, status, created_at, notes, estimate_mins, priority) VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)",
                rusqlite::params![title, goal_id, tid, planned_date, created_at, notes, estimate_mins, priority],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Added task \"{title}\" on {planned_date}") }))
        }
        "complete_task" => {
            let task_id = action
                .get("task_id")
                .and_then(|v| v.as_i64())
                .ok_or("task_id is required")?;
            c.execute(
                "UPDATE tasks SET status='done' WHERE id=?",
                rusqlite::params![task_id],
            )
            .map_err(|e| e.to_string())?;
            let now = chrono::Utc::now().to_rfc3339();
            let _ = c.execute(
                "UPDATE time_entries SET end_utc=? WHERE task_id=? AND end_utc IS NULL",
                rusqlite::params![now, task_id],
            );
            Ok(json!({ "ok": true, "id": task_id, "summary": "Marked task as done" }))
        }
        "reschedule_task" => {
            let task_id = action
                .get("task_id")
                .and_then(|v| v.as_i64())
                .ok_or("task_id is required")?;
            let planned_date = action
                .get("planned_date")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| s.len() == 10)
                .unwrap_or(&today);
            c.execute(
                "UPDATE tasks SET planned_date=? WHERE id=?",
                rusqlite::params![planned_date, task_id],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": task_id, "summary": format!("Rescheduled task to {planned_date}") }))
        }
        "create_money_entry" => {
            let amount_usd = action
                .get("amount_usd")
                .and_then(|v| v.as_f64())
                .ok_or("amount_usd is required")?;
            let minor = (amount_usd * 100.0).round() as i64;
            if minor <= 0 {
                return Err("Amount must be greater than zero.".into());
            }
            let direction = match action.get("direction").and_then(|v| v.as_str()) {
                Some("in") => "in",
                _ => "out",
            };
            let category = action
                .get("category")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("General");
            let date = action
                .get("date")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| s.len() == 10)
                .unwrap_or(&today);
            let goal_id = action.get("goal_id").and_then(|v| v.as_i64()).filter(|gid| {
                c.query_row("SELECT COUNT(*) FROM goals WHERE id=?", rusqlite::params![gid], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap_or(0)
                    > 0
            });
            let note = action.get("notes").and_then(|v| v.as_str()).unwrap_or("");
            c.execute(
                "INSERT INTO money_entries (amount_minor, direction, category, date, task_id, goal_id, note) VALUES (?, ?, ?, ?, NULL, ?, ?)",
                rusqlite::params![minor, direction, category, date, goal_id, note],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "id": c.last_insert_rowid(), "summary": format!("Logged {category} ({direction})") }))
        }
        _ => Err(format!("Unsupported action type: {kind}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_google_desktop_client_json() {
        let sample = r#"{
            "installed": {
                "client_id": "12345.apps.googleusercontent.com",
                "project_id": "my-planner-proj",
                "client_secret": "GOCSPX-secret"
            }
        }"#;
        let (cid, csec, pid) = parse_oauth_client_json(sample).unwrap();
        assert_eq!(cid, "12345.apps.googleusercontent.com");
        assert_eq!(csec, "GOCSPX-secret");
        assert_eq!(pid, "my-planner-proj");
    }

    #[test]
    fn extracts_interactions_v1_steps_text_and_structured_json() {
        let resp = json!({
            "id": "int_abc",
            "steps": [
                {
                    "type": "thought",
                    "summary": "Thinking..."
                },
                {
                    "type": "model_output",
                    "content": [
                        {
                            "type": "text",
                            "text": "{\"reply\":\"Focus on 2 tasks today.\",\"suggested_actions\":[{\"type\":\"create_task\",\"label\":\"Add review\",\"title\":\"Weekly review\",\"planned_date\":\"2026-11-22\"}]}"
                        }
                    ]
                }
            ]
        });
        let raw = extract_interaction_text(&resp);
        let (reply, actions) = parse_structured_ai_output(&raw);
        assert_eq!(reply, "Focus on 2 tasks today.");
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0]["type"], "create_task");
    }

    #[test]
    fn curated_models_exclude_deprecated() {
        for m in curated_models() {
            assert!(!is_deprecated_model(&m.id), "deprecated model {}", m.id);
        }
        assert!(is_deprecated_model("gemini-2.5-flash"));
        assert!(is_deprecated_model("gemini-1.5-pro"));
        assert!(!is_deprecated_model("gemini-4-hydrogen"));
    }
}
