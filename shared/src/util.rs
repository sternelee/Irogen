use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
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
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&normalized)
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
    let run_diff = |args: &[&str]| -> Result<(bool, String, String), String> {
        let output = Command::new("git")
            .args(args)
            .current_dir(&normalized)
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
