use anyhow::Result;
use compiler::registry::Registry;
use notify_debouncer_mini::{
    new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer,
};
use notify_debouncer_mini::notify::RecommendedWatcher;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::sync::broadcast;

pub struct RegistryState {
    snapshot: RwLock<Arc<Registry>>,
    notifier: broadcast::Sender<()>,
    modules_dir: PathBuf,
}

impl RegistryState {
    pub fn new(modules_dir: PathBuf) -> Arc<Self> {
        let initial = match Registry::load(&modules_dir) {
            Ok(r) => Arc::new(r),
            Err(e) => {
                eprintln!(
                    "warning: initial registry load at {} failed: {e:#}",
                    modules_dir.display()
                );
                Arc::new(Registry::default())
            }
        };
        let (notifier, _) = broadcast::channel(64);
        Arc::new(Self {
            snapshot: RwLock::new(initial),
            notifier,
            modules_dir,
        })
    }

    pub fn current(&self) -> Arc<Registry> {
        self.snapshot.read().unwrap().clone()
    }

    pub fn modules_dir(&self) -> &Path {
        &self.modules_dir
    }

    pub fn reload(&self) -> Result<()> {
        let r = Registry::load(&self.modules_dir)?;
        *self.snapshot.write().unwrap() = Arc::new(r);
        let _ = self.notifier.send(());
        Ok(())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<()> {
        self.notifier.subscribe()
    }
}

pub fn spawn_watcher(
    state: Arc<RegistryState>,
) -> Result<Debouncer<RecommendedWatcher>> {
    let dir = state.modules_dir().to_path_buf();
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    let st = state.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(250),
        move |res: DebounceEventResult| match res {
            Ok(_events) => {
                if let Err(e) = st.reload() {
                    eprintln!("registry reload failed: {e:#}");
                }
            }
            Err(error) => {
                eprintln!("watcher error: {error}");
            }
        },
    )?;
    debouncer
        .watcher()
        .watch(&dir, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
