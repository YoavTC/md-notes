//! Note persistence. This module is the only code that touches disk.
//!
//! Layout under the data root:
//!   notes/<id>.md   raw Markdown content, byte-for-byte what the editor holds
//!   trash/<id>.md   content of trashed notes
//!   index.json      metadata for live and trashed notes (see `Index`)
//!
//! Every write goes to `<file>.tmp`, is flushed to disk, then renamed over the
//! target, so a crash leaves either the old or the new file, never a torn one.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const INDEX_VERSION: u32 = 1;
pub const DEFAULT_COLOR: &str = "white";
pub const DEFAULT_W: f64 = 300.0;
pub const DEFAULT_H: f64 = 280.0;
pub const TRASH_MAX_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    #[serde(default = "default_color")]
    pub color: String,
    /// Window position in physical (virtual-desktop) pixels. `None` until the
    /// window has been placed once. Physical coordinates are unambiguous across
    /// monitors with different scale factors; logical ones are not.
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    /// Window inner size in logical pixels, so it survives DPI changes.
    #[serde(default = "default_w")]
    pub w: f64,
    #[serde(default = "default_h")]
    pub h: f64,
    #[serde(default)]
    pub always_on_top: bool,
    /// The note has a window (possibly hidden). Closed notes have `open: false`.
    #[serde(default)]
    pub open: bool,
    /// The note's window is hidden via "Hide all".
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub created: u64,
    #[serde(default)]
    pub modified: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<u64>,
}

fn default_color() -> String {
    DEFAULT_COLOR.into()
}
fn default_w() -> f64 {
    DEFAULT_W
}
fn default_h() -> f64 {
    DEFAULT_H
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "yes")]
    pub autostart: bool,
}

fn yes() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings { autostart: true }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Index {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub notes: Vec<NoteMeta>,
    #[serde(default)]
    pub trash: Vec<NoteMeta>,
    #[serde(default)]
    pub settings: Settings,
}

pub struct Store {
    root: PathBuf,
    index: Index,
    dirty: bool,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Write `bytes` to `path` atomically: temp file, fsync, rename.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension(match path.extension() {
        Some(ext) => format!("{}.tmp", ext.to_string_lossy()),
        None => "tmp".into(),
    });
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

impl Store {
    /// Open (or create) the store at `root`. A missing or unreadable index is
    /// rebuilt from the note files on disk so content is never orphaned.
    pub fn open(root: impl Into<PathBuf>) -> io::Result<Store> {
        let root = root.into();
        fs::create_dir_all(root.join("notes"))?;
        fs::create_dir_all(root.join("trash"))?;

        let index_path = root.join("index.json");
        let mut dirty = false;
        let mut index = match fs::read(&index_path) {
            Ok(bytes) => match serde_json::from_slice::<Index>(&bytes) {
                Ok(index) => index,
                Err(err) => {
                    eprintln!("index.json unreadable ({err}); rebuilding from note files");
                    let _ = fs::copy(&index_path, root.join("index.corrupt.json"));
                    dirty = true;
                    Index::default()
                }
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                dirty = true;
                Index::default()
            }
            Err(e) => return Err(e),
        };

        if index.version < INDEX_VERSION {
            index.version = INDEX_VERSION;
            dirty = true;
        }

        let mut store = Store { root, index, dirty };
        store.adopt_orphans()?;
        Ok(store)
    }

    /// Add index entries for note files that the index doesn't know about
    /// (e.g. after a corrupt index or a crash between file and index writes).
    fn adopt_orphans(&mut self) -> io::Result<()> {
        for (dir, trashed) in [("notes", false), ("trash", true)] {
            for entry in fs::read_dir(self.root.join(dir))? {
                let path = entry?.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                if !valid_id(id) || self.find_any(id) {
                    continue;
                }
                let modified = fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or_else(now_ms);
                let meta = NoteMeta {
                    created: modified,
                    modified,
                    open: !trashed,
                    deleted_at: trashed.then_some(modified),
                    ..Self::blank_meta(id.to_string())
                };
                if trashed {
                    self.index.trash.push(meta);
                } else {
                    self.index.notes.push(meta);
                }
                self.dirty = true;
            }
        }
        Ok(())
    }

    fn blank_meta(id: String) -> NoteMeta {
        NoteMeta {
            id,
            color: default_color(),
            x: None,
            y: None,
            w: DEFAULT_W,
            h: DEFAULT_H,
            always_on_top: false,
            open: true,
            hidden: false,
            created: 0,
            modified: 0,
            deleted_at: None,
        }
    }

    fn find_any(&self, id: &str) -> bool {
        self.index.notes.iter().any(|n| n.id == id) || self.index.trash.iter().any(|n| n.id == id)
    }

    fn note_path(&self, id: &str) -> PathBuf {
        self.root.join("notes").join(format!("{id}.md"))
    }

    fn trash_path(&self, id: &str) -> PathBuf {
        self.root.join("trash").join(format!("{id}.md"))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn notes(&self) -> &[NoteMeta] {
        &self.index.notes
    }

    pub fn trash(&self) -> &[NoteMeta] {
        &self.index.trash
    }

    pub fn settings(&self) -> &Settings {
        &self.index.settings
    }

    pub fn set_autostart(&mut self, on: bool) {
        self.index.settings.autostart = on;
        self.dirty = true;
    }

    pub fn get(&self, id: &str) -> Option<&NoteMeta> {
        self.index.notes.iter().find(|n| n.id == id)
    }

    /// Mutate a live note's metadata. Marks the index dirty; it is written by
    /// the next `flush`. Returns the updated metadata.
    pub fn update<F: FnOnce(&mut NoteMeta)>(&mut self, id: &str, f: F) -> Option<NoteMeta> {
        let note = self.index.notes.iter_mut().find(|n| n.id == id)?;
        f(note);
        self.dirty = true;
        Some(note.clone())
    }

    /// Create a new open note with `content`. Content and index are written
    /// immediately so a brand-new note survives a crash.
    pub fn create(&mut self, content: &str) -> io::Result<NoteMeta> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let meta = NoteMeta {
            created: now,
            modified: now,
            ..Self::blank_meta(id.clone())
        };
        atomic_write(&self.note_path(&id), content.as_bytes())?;
        self.index.notes.push(meta.clone());
        self.dirty = true;
        self.flush()?;
        Ok(meta)
    }

    pub fn read(&self, id: &str) -> io::Result<String> {
        if !valid_id(id) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad note id"));
        }
        let path = if self.get(id).is_some() {
            self.note_path(id)
        } else {
            self.trash_path(id)
        };
        match fs::read(&path) {
            Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(String::new()),
            Err(e) => Err(e),
        }
    }

    /// Write a live note's content. Only writes if the content changed.
    pub fn write(&mut self, id: &str, content: &str) -> io::Result<()> {
        if self.get(id).is_none() {
            return Err(io::Error::new(io::ErrorKind::NotFound, "no such note"));
        }
        if self.read(id).map(|old| old == content).unwrap_or(false) {
            return Ok(());
        }
        atomic_write(&self.note_path(id), content.as_bytes())?;
        self.update(id, |n| n.modified = now_ms());
        Ok(())
    }

    /// Move a note to the trash.
    pub fn trash_note(&mut self, id: &str) -> io::Result<NoteMeta> {
        let pos = self
            .index
            .notes
            .iter()
            .position(|n| n.id == id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no such note"))?;
        let from = self.note_path(id);
        if from.exists() {
            fs::rename(&from, self.trash_path(id))?;
        }
        let mut meta = self.index.notes.remove(pos);
        meta.deleted_at = Some(now_ms());
        self.index.trash.push(meta.clone());
        self.dirty = true;
        self.flush()?;
        Ok(meta)
    }

    /// Restore a trashed note. It comes back open and visible.
    pub fn restore(&mut self, id: &str) -> io::Result<NoteMeta> {
        let pos = self
            .index
            .trash
            .iter()
            .position(|n| n.id == id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no such trashed note"))?;
        let from = self.trash_path(id);
        if from.exists() {
            fs::rename(&from, self.note_path(id))?;
        }
        let mut meta = self.index.trash.remove(pos);
        meta.deleted_at = None;
        meta.open = true;
        meta.hidden = false;
        self.index.notes.push(meta.clone());
        self.dirty = true;
        self.flush()?;
        Ok(meta)
    }

    /// Permanently remove trashed notes older than `max_age_ms`.
    pub fn purge_trash(&mut self, now: u64, max_age_ms: u64) -> io::Result<usize> {
        let (expired, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.index.trash)
            .into_iter()
            .partition(|n| now.saturating_sub(n.deleted_at.unwrap_or(now)) > max_age_ms);
        self.index.trash = kept;
        for n in &expired {
            match fs::remove_file(self.trash_path(&n.id)) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
        }
        if !expired.is_empty() {
            self.dirty = true;
            self.flush()?;
        }
        Ok(expired.len())
    }

    /// Write the index if anything changed since the last flush.
    pub fn flush(&mut self) -> io::Result<()> {
        if !self.dirty {
            return Ok(());
        }
        let json = serde_json::to_vec_pretty(&self.index)?;
        atomic_write(&self.root.join("index.json"), &json)?;
        self.dirty = false;
        Ok(())
    }
}

/// A note's display title: its first non-empty line with leading Markdown
/// block markers stripped, truncated.
pub fn title_of(content: &str) -> String {
    let line = content.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let mut s = line;
    loop {
        let t = s
            .trim_start_matches('#')
            .trim_start_matches('>')
            .trim_start();
        let t = t
            .strip_prefix("- ")
            .or_else(|| t.strip_prefix("* "))
            .or_else(|| t.strip_prefix("+ "))
            .unwrap_or(t);
        let t = t
            .strip_prefix("[ ] ")
            .or_else(|| t.strip_prefix("[x] "))
            .or_else(|| t.strip_prefix("[X] "))
            .unwrap_or(t);
        if t.len() == s.len() {
            break;
        }
        s = t;
    }
    let s: String = s.chars().filter(|c| !matches!(c, '*' | '_' | '`' | '~')).collect();
    let s = s.trim();
    if s.chars().count() > 60 {
        format!("{}…", s.chars().take(60).collect::<String>())
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(dir.path()).unwrap();
        (dir, s)
    }

    #[test]
    fn round_trip_preserves_bytes() {
        let (dir, mut s) = store();
        let src = "# Title\r\n\n- [ ] _a_  \n\t* b\n```rs\nfn x() {}\n```\n";
        let n = s.create("").unwrap();
        s.write(&n.id, src).unwrap();
        s.flush().unwrap();
        drop(s);
        let s = Store::open(dir.path()).unwrap();
        assert_eq!(s.read(&n.id).unwrap(), src);
        assert_eq!(s.notes().len(), 1);
    }

    #[test]
    fn metadata_persists() {
        let (dir, mut s) = store();
        let n = s.create("x").unwrap();
        s.update(&n.id, |m| {
            m.x = Some(-1200);
            m.y = Some(40);
            m.w = 222.5;
            m.always_on_top = true;
            m.color = "blue".into();
        });
        s.flush().unwrap();
        let s = Store::open(dir.path()).unwrap();
        let m = s.get(&n.id).unwrap();
        assert_eq!((m.x, m.y, m.w, m.always_on_top, m.color.as_str()), (Some(-1200), Some(40), 222.5, true, "blue"));
    }

    #[test]
    fn stray_temp_file_is_ignored() {
        let (dir, mut s) = store();
        let n = s.create("good").unwrap();
        // Simulate a crash mid-write: a temp file that never got renamed.
        fs::write(dir.path().join("notes").join(format!("{}.md.tmp", n.id)), "torn").unwrap();
        fs::write(dir.path().join("index.json.tmp"), "{ torn").unwrap();
        drop(s);
        let s = Store::open(dir.path()).unwrap();
        assert_eq!(s.read(&n.id).unwrap(), "good");
        assert_eq!(s.notes().len(), 1);
    }

    #[test]
    fn corrupt_index_is_rebuilt_from_files() {
        let (dir, mut s) = store();
        let a = s.create("alpha").unwrap();
        let b = s.create("beta").unwrap();
        s.trash_note(&b.id).unwrap();
        drop(s);
        fs::write(dir.path().join("index.json"), "{ not json").unwrap();
        let s = Store::open(dir.path()).unwrap();
        assert_eq!(s.read(&a.id).unwrap(), "alpha");
        assert!(s.get(&a.id).is_some());
        assert!(s.trash().iter().any(|n| n.id == b.id));
        assert!(dir.path().join("index.corrupt.json").exists());
    }

    #[test]
    fn old_index_is_migrated() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("notes").join("abc.md"), "hi").unwrap();
        fs::write(dir.path().join("index.json"), r#"{"notes":[{"id":"abc","open":true}]}"#).unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        let m = s.get("abc").unwrap().clone();
        assert_eq!((m.color.as_str(), m.w, m.h), (DEFAULT_COLOR, DEFAULT_W, DEFAULT_H));
        assert!(s.settings().autostart);
        s.flush().unwrap();
        let raw = fs::read_to_string(dir.path().join("index.json")).unwrap();
        assert!(raw.contains(&format!("\"version\": {INDEX_VERSION}")));
    }

    #[test]
    fn trash_restore_and_purge() {
        let (dir, mut s) = store();
        let n = s.create("keep me").unwrap();
        s.update(&n.id, |m| m.hidden = true);
        s.trash_note(&n.id).unwrap();
        assert!(s.get(&n.id).is_none());
        assert_eq!(s.read(&n.id).unwrap(), "keep me");
        assert!(!dir.path().join("notes").join(format!("{}.md", n.id)).exists());

        let r = s.restore(&n.id).unwrap();
        assert!(r.open && !r.hidden && r.deleted_at.is_none());
        assert_eq!(s.read(&n.id).unwrap(), "keep me");

        s.trash_note(&n.id).unwrap();
        let deleted = s.trash()[0].deleted_at.unwrap();
        assert_eq!(s.purge_trash(deleted + 1000, TRASH_MAX_AGE_MS).unwrap(), 0);
        assert_eq!(s.purge_trash(deleted + TRASH_MAX_AGE_MS + 1, TRASH_MAX_AGE_MS).unwrap(), 1);
        assert!(s.trash().is_empty());
        assert!(!dir.path().join("trash").join(format!("{}.md", n.id)).exists());
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let (_dir, s) = store();
        assert!(s.read("../index").is_err());
    }

    #[test]
    fn titles() {
        assert_eq!(title_of("\n\n## **Groceries**\n- milk"), "Groceries");
        assert_eq!(title_of("- [ ] call mom"), "call mom");
        assert_eq!(title_of("> quote"), "quote");
        assert_eq!(title_of(""), "");
    }
}
