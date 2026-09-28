//! Engine child process: the local Node engine speaking NDJSON over stdio
//! (issue #9/#10 spike). stdout carries protocol frames only; stderr passes
//! through to our own stderr as logs.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};

pub struct Engine {
    child: Child,
}

impl Engine {
    /// Spawn `node <engine_dir>/engine.cjs`. The data dir comes from the
    /// environment (NOTELM_DATA_DIR) exactly like the browser app.
    pub fn spawn(engine_dir: &Path) -> Result<Engine, String> {
        let script = engine_dir.join("engine.cjs");
        if !script.exists() {
            return Err(format!("engine bundle not found at {} — run npm run build:engine", script.display()));
        }
        let node = std::env::var("NOTELM_NODE_BIN").unwrap_or_else(|_| "node".into());
        let child = Command::new(node)
            .arg(&script)
            .env("NODE_ENV", "production")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("failed to spawn node: {e}"))?;
        Ok(Engine { child })
    }

    /// One request/response round trip over the protocol.
    pub fn request(&mut self, id: &str, op: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
        let frame = serde_json::json!({ "id": id, "op": op, "args": args }).to_string() + "\n";
        let stdin = self.child.stdin.as_mut().ok_or("engine stdin closed")?;
        stdin
            .write_all(frame.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("write to engine failed: {e}"))?;

        let stdout = self.child.stdout.as_mut().ok_or("engine stdout closed")?;
        let mut line = String::new();
        let mut reader = BufReader::new(stdout);
        reader
            .read_line(&mut line)
            .map_err(|e| format!("read from engine failed: {e}"))?;
        if line.trim().is_empty() {
            return Err("engine closed the protocol stream".into());
        }
        serde_json::from_str(&line).map_err(|e| format!("bad engine frame: {e}"))
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // Closing stdin ends the engine loop; escalate if it lingers.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
