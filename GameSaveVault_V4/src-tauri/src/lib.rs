//! GameSave Vault V4: a small, auditable desktop UI over the official Ludusavi CLI.
//! No HTTP server, PowerShell, cmd.exe, dynamic code downloads, or silent restores.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};

static OPERATIONS: OnceLock<Mutex<()>> = OnceLock::new();
fn with_exclusive<T>(job: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = OPERATIONS
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Operation lock is unavailable".to_string())?;
    job()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    engine_path: String,
    backup_dir: String,
    show_covers: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    connected: bool,
    engine_path: String,
    version: String,
    backup_dir: String,
    manifest_available: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Game {
    name: String,
    file_count: usize,
    registry_count: usize,
    bytes: u64,
    paths: Vec<String>,
    steam_id: Option<u64>,
    decision: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupVersion {
    name: String,
    when: String,
    comment: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryGame {
    name: String,
    backups: Vec<BackupVersion>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationResult {
    processed_games: u64,
    total_games: u64,
    processed_bytes: u64,
    message: String,
    safety_path: Option<String>,
    problems: Vec<String>,
}

fn default_backup_dir() -> String {
    let base = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("GameSaveVault").join("Backups").to_string_lossy().into_owned()
}
fn default_settings() -> Settings {
    Settings { engine_path: String::new(), backup_dir: default_backup_dir(), show_covers: true }
}
fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}
fn load_settings_impl(app: &AppHandle) -> Result<Settings, String> {
    let file = config_file(app)?;
    if !file.exists() { return Ok(default_settings()); }
    let raw = fs::read_to_string(file).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("Cannot read settings: {e}"))
}
fn save_settings_impl(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    if !Path::new(&settings.backup_dir).is_absolute() || settings.backup_dir.trim().is_empty() {
        return Err("Choose an absolute backup folder".to_string());
    }
    if !settings.engine_path.is_empty() {
        validate_engine_path(Path::new(&settings.engine_path))?;
    }
    let file = config_file(app)?;
    let parent = file.parent().ok_or("Invalid configuration location")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    // Avoid replacing the existing settings file if the temporary write failed.
    #[cfg(windows)]
    if file.exists() { fs::remove_file(&file).map_err(|e| e.to_string())?; }
    fs::rename(&tmp, &file).map_err(|e| e.to_string())
}
fn validate_engine_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || !path.is_file() {
        return Err("Select an existing absolute path to ludusavi.exe".into());
    }
    let name = path.file_name().and_then(|v| v.to_str()).unwrap_or("");
    #[cfg(windows)]
    let valid = name.eq_ignore_ascii_case("ludusavi.exe");
    #[cfg(not(windows))]
    let valid = name == "ludusavi" || name == "ludusavi.exe";
    if !valid { return Err("Select the official Ludusavi executable (ludusavi.exe)".into()); }
    Ok(())
}
fn find_engine(settings: &Settings) -> Result<PathBuf, String> {
    // Security-first: require the user to explicitly select Ludusavi.
    // Do not auto-execute a binary from PATH or a writable directory.
    if settings.engine_path.trim().is_empty() {
        return Err("Select the official ludusavi.exe in Settings to enable scanning.".into());
    }
    let path = PathBuf::from(&settings.engine_path);
    validate_engine_path(&path)?;
    Ok(path)
}

fn engine_command(path: &Path, args: &[String]) -> Result<String, String> {
    // Argument vector only. Never use shell interpolation, cmd.exe, PowerShell, or `eval`.
    let output = Command::new(path)
        .args(args)
        .output()
        .map_err(|e| format!("Could not start Ludusavi: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        return Err(format!("Ludusavi failed ({}): {}", output.status, detail.chars().take(900).collect::<String>()));
    }
    Ok(stdout)
}
fn ludusavi_json(settings: &Settings, args: &[&str], game: Option<&str>) -> Result<Value, String> {
    let exe = find_engine(settings)?;
    let mut argv = vec!["--no-manifest-update".to_string()];
    argv.extend(args.iter().map(|v| v.to_string()));
    if let Some(game) = game {
        if game.trim().is_empty() { return Err("Select a game".into()); }
        argv.push("--".into()); // protect option-like game titles
        argv.push(game.into());
    }
    let stdout = engine_command(&exe, &argv)?;
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Ludusavi returned non-JSON output: {e}"))
}
fn manifest_location(settings: &Settings) -> Option<PathBuf> {
    // Ludusavi uses %APPDATA%/ludusavi by default. Portable Ludusavi keeps its
    // own data next to its EXE when ludusavi.portable exists.
    if let Ok(exe) = find_engine(settings) {
        if let Some(dir) = exe.parent() {
            if dir.join("ludusavi.portable").exists() {
                let path = dir.join("manifest.yaml");
                if path.is_file() { return Some(path); }
            }
        }
    }
    let default = env::var_os("APPDATA").map(PathBuf::from)?.join("ludusavi").join("manifest.yaml");
    default.is_file().then_some(default)
}
fn steam_ids_for_games(settings: &Settings, names: &[String]) -> BTreeMap<String, u64> {
    let mut result = BTreeMap::new();
    let Some(location) = manifest_location(settings) else { return result; };
    let Ok(content) = fs::File::open(&location) else { return result; };
    let Ok(data) = serde_yaml::from_reader::<_, serde_yaml::Value>(content) else { return result; };
    for title in names {
        let Some(entry) = data.get(title.as_str()) else { continue; };
        let Some(id) = entry.get("steam").and_then(|s| s.get("id")).and_then(|id| id.as_u64()) else { continue; };
        if id > 0 { result.insert(title.clone(), id); }
    }
    result
}
fn status_impl(app: &AppHandle) -> Result<Status, String> {
    let settings = load_settings_impl(app)?;
    let engine = find_engine(&settings);
    let backup_dir = settings.backup_dir.clone();
    match engine {
        Ok(exe) => {
            let v = engine_command(&exe, &["--version".into()]);
            match v {
                Ok(version) => Ok(Status {
                    connected: true,
                    engine_path: exe.to_string_lossy().into_owned(),
                    version: version.trim().into(),
                    backup_dir,
                    manifest_available: manifest_location(&settings).is_some(),
                    message: "Ludusavi is ready".into(),
                }),
                Err(e) => Ok(Status {
                    connected: false, engine_path: exe.to_string_lossy().into_owned(),
                    version: String::new(), backup_dir, manifest_available: false, message: e,
                }),
            }
        }
        Err(e) => Ok(Status {
            connected: false, engine_path: String::new(), version: String::new(), backup_dir,
            manifest_available: false, message: e,
        }),
    }
}
fn scan_impl(app: &AppHandle) -> Result<Vec<Game>, String> {
    let settings = load_settings_impl(app)?;
    let data = ludusavi_json(&settings,
        &["backup", "--preview", "--api", "--path", &settings.backup_dir], None)?;
    if data.pointer("/errors/someGamesFailed").and_then(Value::as_bool) == Some(true) {
        return Err("Ludusavi reported scan errors. Check its configuration and logs.".into());
    }
    let empty = serde_json::Map::new();
    let games = data.get("games").and_then(Value::as_object).unwrap_or(&empty);
    let names = games.keys().cloned().collect::<Vec<_>>();
    let steam_ids = if settings.show_covers { steam_ids_for_games(&settings, &names) } else { BTreeMap::new() };
    let mut list = vec![];
    for (name, details) in games {
        let files = details.get("files").and_then(Value::as_object);
        let registry = details.get("registry").and_then(Value::as_object);
        let file_count = files.map_or(0, |f| f.len());
        let registry_count = registry.map_or(0, |r| r.len());
        // Keep only games for which the real scan discovered save files/keys.
        if file_count == 0 && registry_count == 0 { continue; }
        let bytes = files.map(|fs| fs.values().filter_map(|f| f.get("bytes").and_then(Value::as_u64)).sum()).unwrap_or(0);
        let paths = files
            .map(|fs| fs.keys().take(8).cloned().collect())
            .unwrap_or_default();
        list.push(Game {
            name: name.clone(), file_count, registry_count, bytes, paths,
            steam_id: steam_ids.get(name).copied(),
            decision: details.get("decision").and_then(Value::as_str).unwrap_or("Detected").into(),
        });
    }
    list.sort_by_key(|g| g.name.to_lowercase());
    Ok(list)
}
fn history_impl(app: &AppHandle) -> Result<Vec<HistoryGame>, String> {
    let settings = load_settings_impl(app)?;
    if !Path::new(&settings.backup_dir).exists() { return Ok(vec![]); }
    let data = ludusavi_json(&settings,
        &["backups", "--api", "--path", &settings.backup_dir], None)?;
    let mut result = vec![];
    if let Some(games) = data.get("games").and_then(Value::as_object) {
        for (name, detail) in games {
            let mut backups = vec![];
            if let Some(entries) = detail.get("backups").and_then(Value::as_array) {
                for entry in entries {
                    if let Some(id) = entry.get("name").and_then(Value::as_str) {
                        backups.push(BackupVersion {
                            name: id.into(),
                            when: entry.get("when").and_then(Value::as_str).unwrap_or("").into(),
                            comment: entry.get("comment").and_then(Value::as_str).unwrap_or("").into(),
                        });
                    }
                }
            }
            backups.sort_by(|a, b| b.when.cmp(&a.when));
            if !backups.is_empty() { result.push(HistoryGame { name: name.clone(), backups }); }
        }
    }
    result.sort_by_key(|g| g.name.to_lowercase());
    Ok(result)
}
fn check_failure(data: &Value) -> Result<(), String> {
    if data.pointer("/errors/someGamesFailed").and_then(Value::as_bool) == Some(true) {
        return Err("Ludusavi reported that one or more games failed. Check the original saves and logs.".into());
    }
    if let Some(unknown) = data.pointer("/errors/unknownGames").and_then(Value::as_array) {
        if !unknown.is_empty() { return Err("Ludusavi did not recognize the selected game".into()); }
    }
    Ok(())
}
fn operation_result(data: &Value, message: String, safety_path: Option<String>) -> OperationResult {
    let overall = &data["overall"];
    let errors = data.get("errors");
    let mut problems = vec![];
    if let Some(e) = errors {
        if !e.is_null() && e.as_object().is_some_and(|o| !o.is_empty()) {
            problems.push(e.to_string());
        }
    }
    OperationResult {
        processed_games: overall["processedGames"].as_u64().unwrap_or(0),
        total_games: overall["totalGames"].as_u64().unwrap_or(0),
        processed_bytes: overall["processedBytes"].as_u64().unwrap_or(0),
        message, safety_path, problems,
    }
}
fn backup_impl(app: &AppHandle, game: Option<String>) -> Result<OperationResult, String> {
    let settings = load_settings_impl(app)?;
    fs::create_dir_all(&settings.backup_dir).map_err(|e| format!("Cannot create backup folder: {e}"))?;
    let data = ludusavi_json(&settings,
        &["backup", "--force", "--api", "--path", &settings.backup_dir], game.as_deref())?;
    check_failure(&data)?;
    Ok(operation_result(&data, "Backup completed".into(), None))
}
fn selected_backup_is_valid(app: &AppHandle, game: &str, backup_id: &str) -> Result<bool, String> {
    if backup_id.is_empty() { return Ok(true); } // empty means latest
    let list = history_impl(app)?;
    Ok(list.into_iter().find(|g| g.name == game)
        .is_some_and(|g| g.backups.iter().any(|b| b.name == backup_id)))
}
fn restore_args<'a>(settings: &'a Settings, game: &'a str, backup_id: &'a str, preview: bool) -> Vec<String> {
    let mut args = vec!["--no-manifest-update".into(), "restore".into(),
        "--api".into(), "--no-cloud-sync".into(), "--path".into(), settings.backup_dir.clone()];
    if preview { args.push("--preview".into()); } else { args.push("--force".into()); }
    if !backup_id.is_empty() { args.push("--backup".into()); args.push(backup_id.into()); }
    args.push("--".into()); args.push(game.into());
    args
}
fn restore_preview_impl(app: &AppHandle, game: &str, backup_id: &str) -> Result<OperationResult, String> {
    if game.trim().is_empty() { return Err("Select a game".into()); }
    if !selected_backup_is_valid(app, game, backup_id)? { return Err("Selected backup was not found".into()); }
    let settings = load_settings_impl(app)?;
    let exe = find_engine(&settings)?;
    let stdout = engine_command(&exe, &restore_args(&settings, game, backup_id, true))?;
    let data: Value = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;
    check_failure(&data)?;
    Ok(operation_result(&data, "Restore preview (no files changed)".into(), None))
}
fn restore_impl(app: &AppHandle, game: &str, backup_id: &str, confirmation: &str, skip_safety: bool)
    -> Result<OperationResult, String> {
    if game.trim().is_empty() || game != confirmation {
        return Err("Type the exact game title to confirm the restore".into());
    }
    if !selected_backup_is_valid(app, game, backup_id)? { return Err("Selected backup was not found".into()); }
    let settings = load_settings_impl(app)?;
    let exe = find_engine(&settings)?;
    let mut safety_path = None;
    if !skip_safety {
        let folder_name: String = game.chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .take(56).collect();
        let timestamp: DateTime<Utc> = Utc::now();
        let safe_dir = app.path().app_data_dir().map_err(|e| e.to_string())?
            .join("safety-snapshots")
            .join(format!("{}_{}", folder_name, timestamp.format("%Y%m%dT%H%M%S%.3fZ")));
        fs::create_dir_all(&safe_dir).map_err(|e| e.to_string())?;
        let safe_text = safe_dir.to_string_lossy().into_owned();
        let safety = ludusavi_json(&settings,
            &["backup", "--force", "--api", "--path", &safe_text], Some(game))?;
        check_failure(&safety)?;
        if safety.pointer("/overall/processedGames").and_then(Value::as_u64).unwrap_or(0) == 0 {
            return Err("Safety snapshot could not be created. If this PC has no current save, check 'Skip safety snapshot' in Restore, then confirm again.".into());
        }
        safety_path = Some(safe_text);
    }
    // The UI requires preview + exact-title confirmation. The Rust command also
    // independently validates the title and backup ID before writing any files.
    let stdout = engine_command(&exe, &restore_args(&settings, game, backup_id, false))?;
    let data: Value = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;
    check_failure(&data)?;
    Ok(operation_result(&data, "Restore completed".into(), safety_path))
}

fn update_manifest_impl(app: &AppHandle) -> Result<String, String> {
    let settings = load_settings_impl(app)?;
    let exe = find_engine(&settings)?;
    // Intentional, user-triggered update only; Ludusavi handles HTTPS + manifest validation.
    let output = engine_command(&exe,
        &["manifest".into(), "update".into()])?;
    Ok(if output.trim().is_empty() { "Manifest update finished".into() } else { output.trim().chars().take(700).collect() })
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Settings, String> { load_settings_impl(&app) }
#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> { save_settings_impl(&app, &settings) }
#[tauri::command]
async fn get_status(app: AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || status_impl(&app))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn scan_games(app: AppHandle) -> Result<Vec<Game>, String> {
    tauri::async_runtime::spawn_blocking(move || with_exclusive(|| scan_impl(&app)))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn list_history(app: AppHandle) -> Result<Vec<HistoryGame>, String> {
    tauri::async_runtime::spawn_blocking(move || with_exclusive(|| history_impl(&app)))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn backup_games(app: AppHandle, game: Option<String>) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || with_exclusive(|| backup_impl(&app, game)))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn preview_restore(app: AppHandle, game: String, backup_id: String) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || with_exclusive(|| restore_preview_impl(&app, &game, &backup_id)))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn restore_game(app: AppHandle, game: String, backup_id: String, confirmation: String, skip_safety: bool)
    -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || with_exclusive(|| restore_impl(&app, &game, &backup_id, &confirmation, skip_safety)))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn update_manifest(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || with_exclusive(|| update_manifest_impl(&app)))
        .await.map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings, save_settings, get_status, scan_games, list_history,
            backup_games, preview_restore, restore_game, update_manifest
        ])
        .run(tauri::generate_context!())
        .expect("GameSave Vault could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_backup_folder_is_not_empty() { assert!(!default_backup_dir().is_empty()); }
    #[test]
    fn parse_empty_ludusavi_response_without_panic() {
        let v: Value = serde_json::from_str(r#"{"games":null,"overall":null}"#).unwrap();
        let result = operation_result(&v, "ok".into(), None);
        assert_eq!(result.processed_games, 0);
    }
    #[test]
    fn restore_args_are_not_shell_commands() {
        let s = default_settings();
        let args = restore_args(&s, "-suspicious title", "", true);
        assert_eq!(args[args.len() - 2], "--");
        assert_eq!(args.last().unwrap(), "-suspicious title");
    }
}
