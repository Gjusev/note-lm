#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use std::sync::Mutex;
use tauri::Manager;

struct EngineState(Mutex<Option<engine::Engine>>);

/// UI command: perform the protocol handshake with the local engine.
#[tauri::command]
fn engine_handshake(state: tauri::State<EngineState>) -> Result<serde_json::Value, String> {
    let mut guard = state.0.lock().unwrap();
    let engine = guard.as_mut().ok_or_else(|| "engine not running".to_string())?;
    engine.request("handshake-1", "protocol.version", serde_json::json!({}))
}

/// UI command: list notebooks through the engine (proves SQLite works packaged).
#[tauri::command]
fn engine_notebooks(state: tauri::State<EngineState>) -> Result<serde_json::Value, String> {
    let mut guard = state.0.lock().unwrap();
    let engine = guard.as_mut().ok_or_else(|| "engine not running".to_string())?;
    engine.request("handshake-2", "notebooks.list", serde_json::json!({}))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let resources = app.path().resource_dir()?;
            let engine_dir = resources.join("engine");
            // The engine resolves FFmpeg via FFMPEG_PATH (cached at first use,
            // so it must be set before any media op).
            let ffmpeg = resources.join("ffmpeg").join("ffmpeg.exe");
            if ffmpeg.exists() {
                std::env::set_var("FFMPEG_PATH", &ffmpeg);
            }
            match engine::Engine::spawn(&engine_dir) {
                Ok(eng) => {
                    app.manage(EngineState(Mutex::new(Some(eng))));
                }
                Err(e) => {
                    eprintln!("[spike] engine spawn failed: {e}");
                    app.manage(EngineState(Mutex::new(None)));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_handshake, engine_notebooks])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
