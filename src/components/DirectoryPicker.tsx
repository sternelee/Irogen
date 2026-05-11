import { useState, useRef, useEffect, useCallback } from "react";
import { listDirectory, listRemoteDirectory } from "@/lib/tauri-api";
import { Folder, ChevronRight, Search } from "lucide-react";

interface DirectoryPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
  connectionSessionId?: string | null;
}

/** Return the parent directory of a given path */
function getParentPath(path: string): string {
  if (!path) return "/";
  const trimmed = path.replace(/\/$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return trimmed.slice(0, lastSlash) || "/";
}

/** Return the directory to list for a given input value.
 *  If value ends with /, list that directory itself.
 *  Otherwise list the parent directory. */
function getListPath(value: string): string {
  if (!value) return "/";
  if (value.endsWith("/")) return value.replace(/\/+$/, "/") || "/";
  return getParentPath(value);
}

/** Extract filter keyword from input value.
 *  If value ends with /, no filtering (return empty string).
 *  Otherwise return the last path segment.
 *  E.g. "~/www/git" → "git", "/home/user/projects" → "projects" */
function getFilterKeyword(value: string): string {
  if (!value || value.endsWith("/")) return "";
  const trimmed = value.replace(/\/$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash < 0) return trimmed.toLowerCase();
  return trimmed.slice(lastSlash + 1).toLowerCase();
}

export function DirectoryPicker({
  value,
  onChange,
  placeholder = "/path/to/project",
  disabled = false,
  connectionSessionId = null,
}: DirectoryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [entries, setEntries] = useState<{ name: string; is_dir: boolean }[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const listPath = getListPath(value);

  const loadEntries = useCallback(async (path: string) => {
    console.log("[DirectoryPicker] loadEntries:", path, "remote:", !!connectionSessionId);
    setLoading(true);
    try {
      const result = connectionSessionId
        ? await listRemoteDirectory(connectionSessionId, path || "/")
        : await listDirectory(path || "/");
      console.log("[DirectoryPicker] result:", result.length);
      const dirs = result
        .filter((e) => e.is_dir)
        .sort((a, b) => a.name.localeCompare(b.name));
      console.log(
        "[DirectoryPicker] dirs:",
        dirs.length,
        dirs.map((d) => d.name),
      );
      setEntries(dirs);
    } catch (err) {
      console.error("[DirectoryPicker] error:", err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [connectionSessionId]);

  /** Open dropdown and fetch current listPath */
  const openAndFetch = useCallback(() => {
    setIsOpen(true);
    void loadEntries(listPath);
  }, [loadEntries, listPath]);

  /** Click a directory entry: update path (with trailing /) and CLOSE dropdown.
   *  Do NOT auto-fetch — user must explicitly trigger again. */
  const handleSelect = useCallback(
    (name: string) => {
      const base = listPath === "/" ? "/" : listPath.replace(/\/$/, "") + "/";
      const newPath = base + name;
      console.log("[DirectoryPicker] selected:", name, "->", newPath);
      onChange(newPath);
      setIsOpen(false); // close, no auto-fetch
    },
    [onChange, listPath],
  );

  /** Go to parent: update path and fetch parent */
  const handleGoUp = useCallback(() => {
    const parent = getParentPath(listPath);
    onChange(parent);
    void loadEntries(parent);
  }, [onChange, loadEntries, listPath]);

  /** Key handling:
   *  - / : open dropdown and fetch the directory the user is typing into
   *  - ArrowDown : open dropdown
   *  - Escape : close dropdown
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "/") {
        // User typed / — open and fetch the directory they just typed
        setIsOpen(true);
        const currentValue = inputRef.current?.value ?? "";
        const pathToList = getListPath(currentValue + "/");
        void loadEntries(pathToList);
      } else if (e.key === "ArrowDown" && !isOpen) {
        e.preventDefault();
        openAndFetch();
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    },
    [isOpen, openAndFetch, loadEntries],
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-2.5 pr-10 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={openAndFetch}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
          title="Browse directories"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg max-h-60 overflow-y-auto">
          {/* Parent navigation */}
          {listPath !== "/" && (
            <button
              type="button"
              onClick={handleGoUp}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
              <span>..</span>
              <span className="ml-auto text-xs opacity-60">
                {getParentPath(listPath)}
              </span>
            </button>
          )}

          {/* Current path header */}
          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--app-hint)] border-b border-[var(--app-border)] flex items-center justify-between">
            <span>{listPath === "/" ? "Root" : listPath}</span>
            {(() => {
              const keyword = getFilterKeyword(value);
              return keyword ? (
                <span className="normal-case">filter: "{keyword}"</span>
              ) : null;
            })()}
          </div>

          {(() => {
            const keyword = getFilterKeyword(value);
            const filtered = keyword
              ? entries.filter((e) => e.name.toLowerCase().includes(keyword))
              : entries;

            if (loading) {
              return (
                <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                  Loading…
                </div>
              );
            }
            if (entries.length === 0) {
              return (
                <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                  No directories
                </div>
              );
            }
            if (filtered.length === 0) {
              return (
                <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                  No matching directories for "{keyword}"
                </div>
              );
            }
            return filtered.map((entry) => (
              <button
                key={entry.name}
                type="button"
                onClick={() => handleSelect(entry.name)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
              >
                <Folder className="h-4 w-4 text-[var(--app-hint)] shrink-0" />
                <span className="truncate">{entry.name}</span>
                <ChevronRight className="h-3.5 w-3.5 ml-auto text-[var(--app-hint)] shrink-0" />
              </button>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
