#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

struct EngineState(Mutex<Option<engine::Engine>>);

/// One engine round trip from Rust (no webview involved). None on any
/// failure — callers treat an unreachable engine as "nothing running".
fn engine_call(state: &EngineState, op: &str, args: serde_json::Value) -> Option<serde_json::Value> {
    let mut guard = state.0.lock().ok()?;
    let engine = guard.as_mut()?;
    let reply = engine
        .request(&format!("sys-{op}"), op, args)
        .ok()?;
    if !reply.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }
    Some(reply.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

/// Active work = any job whose observed status is not terminal — the same
/// rule the activity screen applies, decided from the engine's jobs.list.
fn has_active_jobs(state: &EngineState) -> bool {
    match engine_call(state, "jobs.list", serde_json::json!({})) {
        Some(result) => has_active_jobs_reply(&result),
        None => false, // engine down: nothing can be executing; close normally
    }
}

/// Pure predicate over the jobs.list result (unit-testable without a window).
fn has_active_jobs_reply(result: &serde_json::Value) -> bool {
    const TERMINAL: [&str; 3] = ["completed", "failed", "cancelled"];
    result
        .get("jobs")
        .and_then(|j| j.as_array())
        .is_some_and(|jobs| {
            jobs.iter().any(|j| {
                !j.get("status")
                    .and_then(|s| s.as_str())
                    .is_some_and(|s| TERMINAL.contains(&s))
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_dialog_triggers_only_on_non_terminal_jobs() {
        // no jobs, engine-error-shaped payloads and terminal states all mean
        // a plain close (today's behavior); only non-terminal status asks
        assert!(!has_active_jobs_reply(&serde_json::json!({ "jobs": [] })));
        assert!(!has_active_jobs_reply(&serde_json::json!({
            "jobs": [
                { "status": "completed" }, { "status": "failed" }, { "status": "cancelled" }
            ]
        })));
        for status in ["queued", "running", "paused", "retry_wait", "pending", "generating"] {
            assert!(has_active_jobs_reply(&serde_json::json!({
                "jobs": [{ "status": status }]
            })));
        }
    }
}

/// Single exit path: persist the global pause THROUGH THE ENGINE (the engine
/// is the sole state writer; Rust never writes SQLite), then exit via the
/// normal run loop — the same teardown that already kills the engine child.
fn pause_then_exit(app: &tauri::AppHandle, state: &EngineState) {
    let _ = engine_call(state, "scheduler.pause", serde_json::json!({}));
    app.exit(0);
}

/// UI command: hide the window to the tray ("Weiter im Hintergrund").
#[tauri::command]
fn hide_to_tray(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// UI command: "Pausieren und beenden" — pause via the engine, then exit.
#[tauri::command]
fn pause_and_exit(app: tauri::AppHandle, state: tauri::State<EngineState>) {
    pause_then_exit(&app, state.inner());
}

/// UI command: perform the protocol handshake with the local engine.
#[tauri::command]
fn engine_handshake(state: tauri::State<EngineState>) -> Result<serde_json::Value, String> {
    let mut guard = state.0.lock().unwrap();
    let engine = guard.as_mut().ok_or_else(|| "engine not running".to_string())?;
    engine.request("handshake-1", "protocol.version", serde_json::json!({}))
}

/// UI command: one engine op from the React adapter (phase 4). The engine
/// validates op + args; the window never touches SQL, shells or paths.
#[tauri::command]
fn engine_op(
    state: tauri::State<EngineState>,
    op: String,
    args_json: String,
) -> Result<serde_json::Value, String> {
    let args: serde_json::Value =
        serde_json::from_str(&args_json).map_err(|e| format!("bad args: {e}"))?;
    // request ids are internal; the reply carries the engine's own id anyway
    let mut guard = state.0.lock().unwrap();
    let engine = guard.as_mut().ok_or_else(|| "engine not running".to_string())?;
    engine.request(&format!("ui-{op}"), &op, args)
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
    // local AI helper directory (models come from settings; env override wins)
    let llama = resources.join("llama");
    if llama.exists() && std::env::var_os("NOTELM_LLAMA_DIR").is_none() {
        std::env::set_var("NOTELM_LLAMA_DIR", &llama);
    }

    let mut eng = engine::Engine::spawn(&resources.join("engine"))?;
    let mut failed = false;
    for (op, args) in [
        ("protocol.version", serde_json::json!({})),
        ("notebooks.create", serde_json::json!({ "title": "Smoke Book" })),
        ("notebooks.list", serde_json::json!({})),
        ("diagnostics.capabilities", serde_json::json!({})),
        ("__unknown__", serde_json::json!({})),
    ] {
        let reply = eng.request(&format!("smoke-{op}"), op, args)?;
        let ok = reply.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        // the unknown op MUST answer ok:false with a typed error, not crash;
        // diagnostics MUST report a loaded sqlite-vec (it ships in the bundle)
        let pass = if op == "__unknown__" {
            !ok && reply["error"]["code"] == "unknown_op"
        } else if op == "diagnostics.capabilities" {
            ok && !reply["result"]["vecVersion"].is_null()
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
            let llama = resources.join("llama");
            if llama.exists() && std::env::var_os("NOTELM_LLAMA_DIR").is_none() {
                std::env::set_var("NOTELM_LLAMA_DIR", &llama);
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

            // Tray (close/tray slice): always present so a hidden window can
            // always be brought back or quit. Icon = the bundled app icon.
            let open = MenuItem::with_id(app, "open", "note-lm öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(
                    app.default_window_icon()
                        .expect("bundle icon present")
                        .clone(),
                )
                .tooltip("note-lm")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        let state = app.state::<EngineState>();
                        // Same semantics as the close dialog: active work
                        // pauses first; idle exit goes straight out.
                        if has_active_jobs(&state) {
                            pause_then_exit(app, &state);
                        } else {
                            app.exit(0);
                        }
                        // Note: if the scheduler-pause round trip fails the
                        // app still exits — quitting must never hang.
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Idle (or engine down): today's plain close — the run loop
                // exits, the engine child dies with the managed state drop.
                let state = window.app_handle().state::<EngineState>();
                if !has_active_jobs(&state) {
                    return;
                }
                // Active work: ask the UI; if the webview cannot answer,
                // fall back to the safe pause-and-exit path rather than hang.
                api.prevent_close();
                if window.emit("close-requested", ()).is_err() {
                    pause_then_exit(window.app_handle(), &state);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            engine_handshake, engine_op, hide_to_tray, pause_and_exit
        ])
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
