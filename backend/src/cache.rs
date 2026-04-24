use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub const CACHE_DIR_NAME: &str = ".cache";
pub const CACHE_ID_PREFIX: &str = "cache_";

#[derive(Default, Serialize, Deserialize)]
struct PersistedState {
    #[serde(default)]
    last_used: HashMap<String, u64>,
}

pub struct CacheTracker {
    file: PathBuf,
    state: RwLock<PersistedState>,
}

impl CacheTracker {
    pub fn load(file: PathBuf) -> Self {
        let state = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice::<PersistedState>(&bytes).unwrap_or_default(),
            Err(_) => PersistedState::default(),
        };
        Self {
            file,
            state: RwLock::new(state),
        }
    }

    pub fn touch(&self, id: &str) {
        if !is_cache_id(id) {
            return;
        }
        let now = epoch_seconds();
        let mut g = self.state.write().unwrap();
        g.last_used.insert(id.to_string(), now);
        drop(g);
        let _ = self.persist();
    }

    pub fn touch_many<'a, I: IntoIterator<Item = &'a str>>(&self, ids: I) {
        let now = epoch_seconds();
        let mut changed = false;
        {
            let mut g = self.state.write().unwrap();
            for id in ids {
                if is_cache_id(id) {
                    g.last_used.insert(id.to_string(), now);
                    changed = true;
                }
            }
        }
        if changed {
            let _ = self.persist();
        }
    }

    pub fn forget(&self, id: &str) {
        let mut g = self.state.write().unwrap();
        if g.last_used.remove(id).is_some() {
            drop(g);
            let _ = self.persist();
        }
    }

    pub fn snapshot(&self) -> HashMap<String, u64> {
        self.state.read().unwrap().last_used.clone()
    }

    fn persist(&self) -> Result<()> {
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        let g = self.state.read().unwrap();
        let bytes = serde_json::to_vec_pretty(&*g)?;
        std::fs::write(&self.file, bytes)
            .with_context(|| format!("writing {}", self.file.display()))?;
        Ok(())
    }
}

pub fn is_cache_id(id: &str) -> bool {
    id.starts_with(CACHE_ID_PREFIX)
}

pub fn cache_dir(modules_dir: &Path) -> PathBuf {
    modules_dir.join(CACHE_DIR_NAME)
}

pub fn cache_entry_path(modules_dir: &Path, id: &str) -> PathBuf {
    cache_dir(modules_dir).join(id)
}

fn epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
