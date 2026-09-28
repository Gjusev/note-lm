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

/// Locate the resources dir without a running tauri app: dev builds get
/// resources copied next to the exe; the installed app keeps them under the
/// install dir; cargo runs can also use the source tree.
fn smoke_resource_dir() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("no exe dir")?.to_path_buf();
    let candidates = [
        exe_dir.join("resources"),
        exe_dir
            .parent()
            .map(|p| p.join("resources"))
            .unwrap_or_default(),
        std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/resources")),
    ];
    candidates
        .iter()
        .find(|p| p.join("engine").join("engine.cjs").exists())
        .cloned()
        .ok_or_else(|| {
            format!(
                "engine bundle not found in any of {:?} — run npm run build:engine",
                candidates
            )
        })
}

/// Self-verification without a window: `notelm-spike.exe --smoke` runs the
/// engine round trip and exits 0/1. Used by scripts/desktop-verify.mjs to
/// test the dev build AND the silently-installed app on a stripped PATH
/// (simulating a machine without Node).
fn smoke() -> Result<(), String> {
    let resources = smoke_resource_dir()?;

    let ffmpeg = resources.join("ffmpeg").join("ffmpeg.exe");
    if ffmpeg.exists() {
        std::env::set_var("FFMPEG_PATH", &ffmpeg);
    }

    let mut eng = engine::Engine::spawn(&resources.join("engine"))?;
    let mut failed = false;
    for (op, args) in [
        ("protocol.version", serde_json::json!({})),
        ("notebooks.create", serde_json::json!({ "title": "Smoke Book" })),
        ("notebooks.list", serde_json::json!({})),
        ("__unknown__", serde_json::json!({})),
    ] {
        let reply = eng.request(&format!("smoke-{op}"), op, args)?;
        let ok = reply.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        // the unknown op MUST answer ok:false with a typed error, not crash
        let pass = if op == "__unknown__" {
            !ok && reply["error"]["code"] == "unknown_op"
        } else {
            ok
        };
        println!("{} {} -> {}", if pass { "ok" } else { "FAIL" }, op, reply);
        failed = failed || !pass;
    }
    if failed {
        return Err("smoke checks failed".into());
    }
    println!("smoke: engine, SQLite and typed errors all verified");
    Ok(())
}

fn main() {
    if std::env::args().any(|a| a == "--smoke") {
        match smoke() {
            Ok(()) => std::process::exit(0),
            Err(e) => {
                eprintln!("smoke failed: {e}");
                std::process::exit(1);
            }
        }
    }

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
