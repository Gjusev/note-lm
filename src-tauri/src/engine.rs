//! Engine child process: the local Node engine speaking NDJSON over stdio
//! (issue #9/#10 spike). stdout carries protocol frames only; stderr passes
//! through to our own stderr as logs.
//!
//! Multi-provider S2: the host reads PERSISTENTLY and demultiplexes by frame
//! type + id. Host-initiated request/reply frames are correlated by id as
//! before; engine-initiated `secret_request` frames are answered from the OS
//! keyring. Frames that could contain a secret value are never logged - only
//! op/id/connectionId.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

/// Where connection secrets live. Abstracted so the demux routing is
/// unit-testable without touching the OS keyring.
pub trait SecretStore: Send {
    fn get(&self, connection_id: &str) -> Option<String>;
    fn set(&self, connection_id: &str, value: &str) -> Result<(), String>;
    fn delete(&self, connection_id: &str) -> Result<(), String>;
}

/// OS keyring, service "note-lm", one entry per connection id.
pub struct KeyringStore;

impl SecretStore for KeyringStore {
    fn get(&self, connection_id: &str) -> Option<String> {
        match keyring::Entry::new("note-lm", connection_id) {
            Ok(entry) => entry.get_password().ok(),
            Err(_) => None,
        }
    }
    fn set(&self, connection_id: &str, value: &str) -> Result<(), String> {
        let entry = keyring::Entry::new("note-lm", connection_id).map_err(|e| e.to_string())?;
        entry.set_password(value).map_err(|e| e.to_string())
    }
    fn delete(&self, connection_id: &str) -> Result<(), String> {
        let entry = keyring::Entry::new("note-lm", connection_id).map_err(|e| e.to_string())?;
        entry.delete_credential().map_err(|e| e.to_string())
    }
}

/// Entry point for the UI command (main.rs).
pub fn keyring_store() -> impl SecretStore {
    KeyringStore
}

/// Reader-side demultiplexer over the engine's stdout lines.
pub struct Demux {
    pending: HashMap<String, Sender<String>>,
    store: Box<dyn SecretStore>,
}

impl Demux {
    pub fn new(store: Box<dyn SecretStore>) -> Demux {
        Demux { pending: HashMap::new(), store }
    }

    /// Register a waiter for the reply of a host-initiated request.
    pub fn expect_reply(&mut self, id: &str, tx: Sender<String>) {
        self.pending.insert(id.to_string(), tx);
    }

    /// Route one inbound line.
    /// Returns Some(outbound) for engine-initiated secret_request frames
    /// (the reply to write back to the engine's stdin), None otherwise.
    pub fn route(&mut self, line: &str) -> Option<String> {
        let frame: serde_json::Value = serde_json::from_str(line).ok()?;
        if frame.get("t").and_then(|t| t.as_str()) == Some("secret_request") {
            let id = frame.get("id").and_then(|v| v.as_str())?.to_string();
            let connection_id = frame.get("connectionId").and_then(|v| v.as_str()).unwrap_or("");
            // Log the connectionId only - the value never appears anywhere.
            eprintln!("[engine-bridge] secret_request for connection {}", connection_id);
            let value = self.store.get(connection_id);
            let reply = serde_json::json!({ "t": "secret_response", "id": id, "value": value });
            return Some(reply.to_string() + "\n");
        }
        if let Some(id) = frame.get("id").and_then(|v| v.as_str()) {
            match self.pending.remove(id) {
                Some(tx) => {
                    let _ = tx.send(line.to_string());
                }
                None => {
                    // unknown id: dropped, logged without any frame content
                    // (a secret_response carries the value - never printed)
                    eprintln!("[engine-bridge] dropped reply for unknown id {}", id);
                }
            }
        }
        None
    }

    /// Stdout EOF = the engine is gone: pending requests fail fast.
    pub fn fail_all(&mut self) {
        for (_, tx) in self.pending.drain() {
            let _ = tx.send(
                r#"{"ok":false,"error":{"code":"engine_closed","message":"engine process closed"}}"#.to_string(),
            );
        }
    }
}

pub struct Engine {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    demux: Arc<Mutex<Demux>>,
}

impl Engine {
    /// Spawn `node <engine_dir>/engine.cjs`. The data dir comes from the
    /// environment (NOTELM_DATA_DIR) exactly like the browser app.
    pub fn spawn(engine_dir: &Path) -> Result<Engine, String> {
        let script = engine_dir.join("engine.cjs");
        if !script.exists() {
            return Err(format!("engine bundle not found at {} — run npm run build:engine", script.display()));
        }
        let node = resolve_node();
        let mut child = Command::new(node)
            .arg(&script)
            .env("NODE_ENV", "production")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("failed to spawn node: {e}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "engine stdout unavailable".to_string())?;
        let stdin = Arc::new(Mutex::new(
            child
                .stdin
                .take()
            .ok_or_else(|| "engine stdin unavailable".to_string())?,
        ));
        let demux = Arc::new(Mutex::new(Demux::new(Box::new(KeyringStore))));

        // Persistent reader: routes reply frames by id to pending waiters and
        // answers engine-initiated secret_request frames from the keyring.
        let reader_stdin = Arc::clone(&stdin);
        let reader_demux = Arc::clone(&demux);
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let outbound = reader_demux.lock().unwrap().route(line.trim_end_matches(['\r', '\n']));
                        if let Some(reply) = outbound {
                            let mut w = reader_stdin.lock().unwrap();
                            let _ = w.write_all(reply.as_bytes()).and_then(|_| w.flush());
                        }
                    }
                }
            }
            reader_demux.lock().unwrap().fail_all();
        });

        Ok(Engine { child, stdin, demux })
    }

    /// One request/response round trip. Writes the request and waits on the
    /// demux channel - an interleaved secret_request cannot misroute replies
    /// because routing is by id, not by read order.
    pub fn request(&mut self, id: &str, op: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
        let (tx, rx) = channel();
        self.demux.lock().map_err(|_| "demux poisoned")?.expect_reply(id, tx);
        {
            let frame = serde_json::json!({"id": id, "op": op, "args": args}).to_string() + "\n";
            let mut w = self.stdin.lock().map_err(|_| "engine stdin poisoned")?;
            w.write_all(frame.as_bytes())
                .and_then(|_| w.flush())
                .map_err(|e| format!("write to engine failed: {e}"))?;
        }
        let reply_line = rx
            .recv()
            .map_err(|_| "engine closed the protocol stream".to_string())?;
        serde_json::from_str(&reply_line).map_err(|e| format!("bad engine frame: {e}"))
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // Closing stdin ends the engine loop; escalate if it lingers.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Prefer the runtime bundled next to the app exe (clean machines have no
/// Node on PATH); fall back to NOTELM_NODE_BIN and then to PATH (dev).
fn resolve_node() -> String {
    if let Ok(from_env) = std::env::var("NOTELM_NODE_BIN") {
        return from_env;
    }
    if let Ok(exe) = std::env::current_exe() {
        let sibling = exe
            .parent()
            .map(|dir| dir.join("node.exe"))
            .filter(|p| p.exists());
        if let Some(sibling) = sibling {
            return sibling.to_string_lossy().into_owned();
        }
    }
    "node".into()
}

#[cfg(test)]
mod engine_tests {
    use super::*;

    /// In-memory fake so the routing tests never touch the OS keyring.
    struct MemStore {
        secrets: Mutex<HashMap<String, String>>,
    }

    impl MemStore {
        fn with(secret: &str) -> MemStore {
            let mut m = HashMap::new();
            m.insert("conn-9".to_string(), secret.to_string());
            MemStore { secrets: Mutex::new(m) }
        }
    }

    impl SecretStore for MemStore {
        fn get(&self, connection_id: &str) -> Option<String> {
            self.secrets.lock().unwrap().get(connection_id).cloned()
        }
        fn set(&self, connection_id: &str, value: &str) -> Result<(), String> {
            self.secrets.lock().unwrap().insert(connection_id.to_string(), value.to_string());
            Ok(())
        }
        fn delete(&self, connection_id: &str) -> Result<(), String> {
            self.secrets.lock().unwrap().remove(connection_id);
            Ok(())
        }
    }

    #[test]
    fn demux_routes_replies_by_id_and_answers_secret_requests() {
        let mut demux = Demux::new(Box::new(MemStore::with("sk-keyring-secret")));
        let (tx, rx) = channel();
        demux.expect_reply("req-1", tx);

        // an engine-initiated secret_request is answered with a typed reply
        let outbound = demux
            .route(r#"{"t":"secret_request","id":"s-1","connectionId":"conn-9"}"#)
            .expect("secret_request must produce an outbound reply");
        let reply: serde_json::Value = serde_json::from_str(outbound.trim()).unwrap();
        assert_eq!(reply["t"], "secret_response");
        assert_eq!(reply["id"], "s-1");
        assert_eq!(reply["value"], "sk-keyring-secret");

        // the correlated reply frame is routed to the pending waiter
        demux.route(r#"{"id":"req-1","ok":true,"result":{"n":1}}"#);
        let got = rx.recv().expect("pending waiter must receive its reply");
        let reply: serde_json::Value = serde_json::from_str(&got).unwrap();
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["result"]["n"], 1);
        assert!(demux.pending.is_empty());
    }

    #[test]
    fn demux_interleaves_secret_answers_with_host_requests_without_misrouting() {
        let mut demux = Demux::new(Box::new(MemStore::with("sk-a")));
        let (tx1, rx1) = channel();
        let (tx2, rx2) = channel();
        demux.expect_reply("h1", tx1);
        demux.expect_reply("h2", tx2);

        // secret_request between two host requests: neither waiter misroutes
        assert!(demux.route(r#"{"t":"secret_request","id":"s1","connectionId":"conn-9"}"#).is_some());
        demux.route(r#"{"id":"h2","ok":true,"result":2}"#);
        demux.route(r#"{"id":"h1","ok":true,"result":1}"#);
        assert_eq!(rx1.recv().unwrap(), r#"{"id":"h1","ok":true,"result":1}"#);
        assert_eq!(rx2.recv().unwrap(), r#"{"id":"h2","ok":true,"result":2}"#);
    }

    #[test]
    fn demux_drops_unknown_ids_and_malformed_lines() {
        let mut demux = Demux::new(Box::new(MemStore::with("sk-a")));
        let (tx, rx) = channel();
        demux.expect_reply("mine", tx);
        // foreign reply + malformed line: dropped, "mine" stays pending
        assert!(demux.route(r#"{"t":"secret_response","id":"foreign","value":"sk-should-never-misroute"}"#).is_none());
        assert!(demux.route("{not json").is_none());
        assert!(rx.try_recv().is_err());
        // and the correct reply still routes afterwards
        demux.route(r#"{"id":"mine","ok":true}"#);
        assert!(rx.recv().is_ok());
    }

    #[test]
    fn demux_answers_absent_secrets_with_null_value() {
        let mut demux = Demux::new(Box::new(MemStore::with("sk-a")));
        let outbound = demux
            .route(r#"{"t":"secret_request","id":"s2","connectionId":"unknown-conn"}"#)
            .expect("absent secret must still be answered");
        let reply: serde_json::Value = serde_json::from_str(outbound.trim()).unwrap();
        assert_eq!(reply["value"], serde_json::Value::Null);
    }

    #[test]
    fn demux_fails_pending_requests_when_engine_closes() {
        let mut demux = Demux::new(Box::new(MemStore::with("sk-a")));
        let (tx, rx) = channel();
        demux.expect_reply("w1", tx);
        demux.fail_all();
        let got = rx.recv().unwrap();
        assert!(got.contains("engine_closed"));
    }
}
