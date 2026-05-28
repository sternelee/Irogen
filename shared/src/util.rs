use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileBrowserEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MentionCandidate {
    pub name: String,
    pub path: String,
}

/// Validate a path to prevent directory traversal attacks.
/// Returns an error if the path contains suspicious components.
fn validate_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::ParentDir => {
                // Reject paths containing ".." to prevent directory traversal
                return Err(format!("Path traversal not allowed: {}", path.display()));
            }
            Component::Normal(part) => {
                // Check for null bytes which could be used for path injection
                let part_str = part.to_string_lossy();
                if part_str.contains('\0') {
                    return Err(format!("Invalid path component: null byte detected"));
                }
                normalized.push(component);
            }
            Component::RootDir | Component::Prefix(_) | Component::CurDir => {
                normalized.push(component);
            }
        }
    }

    Ok(normalized)
}

/// Validate a file name to prevent command injection.
/// Returns an error if the file name contains dangerous characters.
fn validate_filename(filename: &str) -> Result<(), String> {
    // Reject empty filenames
    if filename.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }

    // Reject filenames with null bytes
    if filename.contains('\0') {
        return Err("Filename contains null byte".to_string());
    }

    // Reject filenames that look like command injection attempts
    // These characters could be interpreted by shells or cause issues
    let dangerous_chars = ['|', '&', ';', '<', '>', '$', '`', '\\', '\n', '\r'];
    for ch in dangerous_chars {
        if filename.contains(ch) {
            return Err(format!("Filename contains invalid character: {:?}", ch));
        }
    }

    // Reject filenames starting with a dash (could be interpreted as flags)
    if filename.starts_with('-') {
        return Err(format!("Filename cannot start with a dash: {}", filename));
    }

    Ok(())
}

/// Expand ~ to home directory
fn expand_path(path: &str) -> PathBuf {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            if path == "~" {
                return home;
            }
            return home.join(&path[2..]);
        }
    }
    PathBuf::from(path)
}

fn normalize_path(path: &str) -> PathBuf {
    let expanded = expand_path(path);
    if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(expanded)
    }
}

fn score_mention_candidate(candidate: &str, needle: &str) -> i32 {
    let c = candidate.to_lowercase();
    let n = needle.to_lowercase();
    if c == n {
        return 0;
    }
    if c.starts_with(&n) {
        return 1;
    }
    if c.contains(&n) {
        return 2;
    }
    3
}

fn parse_mention_query(query: &str) -> (String, String) {
    let clean = query.trim().trim_start_matches('@');
    if clean.is_empty() {
        return ("".to_string(), "".to_string());
    }
    if let Some(idx) = clean.rfind('/') {
        let dir = clean[..idx].to_string();
        let needle = clean[idx + 1..].to_string();
        (dir, needle)
    } else {
        ("".to_string(), clean.to_string())
    }
}

fn should_skip_name(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    name == ".git" || name == "node_modules" || name == "target"
}

fn fallback_collect_files(dir: &Path, max_results: usize) -> Vec<PathBuf> {
    use ignore::WalkBuilder;

    let mut out = Vec::new();
    let mut builder = WalkBuilder::new(dir);
    builder
        .hidden(false)
        .ignore(true)
        .git_ignore(true)
        .git_exclude(true)
        .parents(true)
        .max_depth(Some(8));

    let walker = builder.build();
    for entry in walker.flatten() {
        if out.len() >= max_results {
            break;
        }
        let path = entry.path();
        if let Some(name) = path.file_name() {
            if should_skip_name(name) {
                continue;
            }
        }
        if path.is_file() {
            out.push(path.to_path_buf());
        }
    }

    out
}

pub fn list_mention_candidates(
    base_path: &str,
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<MentionCandidate>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 200);
    let base = normalize_path(base_path);

    if !base.exists() || !base.is_dir() {
        return Err(format!("Base path is invalid: {}", base.display()));
    }

    let (dir_hint, needle) = parse_mention_query(query);
    let search_root = if dir_hint.is_empty() {
        base.clone()
    } else {
        base.join(dir_hint)
    };

    if !search_root.exists() || !search_root.is_dir() {
        return Ok(Vec::new());
    }

    let rg_output = Command::new("rg")
        .args([
            "--files",
            "--hidden",
            "--glob",
            "!**/.git",
            "--glob",
            "!**/node_modules",
            "--glob",
            "!**/target",
        ])
        .current_dir(&search_root)
        .output();

    let files: Vec<PathBuf> = match rg_output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| search_root.join(line))
            .collect(),
        _ => fallback_collect_files(&search_root, limit * 8),
    };

    let needle_lc = needle.to_lowercase();
    let mut candidates: Vec<MentionCandidate> = files
        .into_iter()
        .filter_map(|path| {
            let rel = path.strip_prefix(&base).ok()?.to_string_lossy().to_string();
            let name = path.file_name()?.to_string_lossy().to_string();
            if needle_lc.is_empty() {
                return Some(MentionCandidate { name, path: rel });
            }
            let rel_lc = rel.to_lowercase();
            let name_lc = name.to_lowercase();
            if rel_lc.contains(&needle_lc) || name_lc.contains(&needle_lc) {
                Some(MentionCandidate { name, path: rel })
            } else {
                None
            }
        })
        .collect();

    candidates.sort_by(|a, b| {
        let sa = score_mention_candidate(&a.path, &needle);
        let sb = score_mention_candidate(&b.path, &needle);
        sa.cmp(&sb)
            .then_with(|| a.path.len().cmp(&b.path.len()))
            .then_with(|| a.path.cmp(&b.path))
    });
    candidates.truncate(limit);
    Ok(candidates)
}

pub fn list_directory(path: &str) -> Result<Vec<DirEntry>, String> {
    let normalized = normalize_path(path);
    let path = Path::new(&normalized);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }

    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result: Vec<DirEntry> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();

            // Skip hidden files and common non-relevant entries
            if name.starts_with('.')
                || name == "node_modules"
                || name == "target"
                || name == "__pycache__"
            {
                return None;
            }

            Some(DirEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: path.is_dir(),
            })
        })
        .collect();

    // Sort: directories first, then by name
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}

pub fn file_browser_list(path: &str) -> Result<Vec<FileBrowserEntry>, String> {
    let normalized = normalize_path(path);
    let path = Path::new(&normalized);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }

    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result: Vec<FileBrowserEntry> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let entry_path = entry.path();
            let name = entry_path.file_name()?.to_string_lossy().to_string();

            let metadata = entry.metadata().ok()?;
            let is_dir = metadata.is_dir();
            let size = if is_dir { 0 } else { metadata.len() };

            Some(FileBrowserEntry {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir,
                size,
            })
        })
        .collect();

    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}

pub fn file_browser_read(path: &str) -> Result<String, String> {
    let normalized = normalize_path(path);
    let path = Path::new(&normalized);

    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }

    if path.is_dir() {
        return Err(format!("Path is a directory: {}", path.display()));
    }

    fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
}

pub fn git_status(path: &str) -> Result<String, String> {
    let normalized = normalize_path(path);

    // Validate path to prevent directory traversal
    let validated = validate_path(&normalized)?;

    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&validated)
        .output()
        .map_err(|e| format!("Failed to execute git status: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn git_diff(path: &str, file: &str) -> Result<String, String> {
    let normalized = normalize_path(path);

    // Validate path to prevent directory traversal
    let validated = validate_path(&normalized)?;

    // Validate filename to prevent command injection
    validate_filename(file)?;

    let run_diff = |args: &[&str]| -> Result<(bool, String, String), String> {
        let output = Command::new("git")
            .args(args)
            .current_dir(&validated)
            .output()
            .map_err(|e| format!("Failed to execute git diff: {}", e))?;

        Ok((
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    };

    // 1) Working tree changes
    let (ok, stdout, stderr) = run_diff(&["diff", "--", file])?;
    if ok && !stdout.trim().is_empty() {
        return Ok(stdout);
    }

    // 2) Staged/index changes
    let (ok, stdout, stderr_cached) = run_diff(&["diff", "--cached", "--", file])?;
    if ok && !stdout.trim().is_empty() {
        return Ok(stdout);
    }

    // 3) Untracked files: compare with empty file via no-index.
    // git may return non-zero status for --no-index when differences exist,
    // but stdout still contains a valid unified diff.
    let (ok, stdout, stderr_no_index) = run_diff(&["diff", "--no-index", "--", "/dev/null", file])?;
    if (ok || !stderr_no_index.contains("usage:")) && !stdout.trim().is_empty() {
        return Ok(stdout);
    }

    if !stderr.is_empty() {
        return Err(stderr);
    }
    if !stderr_cached.is_empty() {
        return Err(stderr_cached);
    }
    if !stderr_no_index.is_empty() {
        return Err(stderr_no_index);
    }

    Ok(String::new())
}
