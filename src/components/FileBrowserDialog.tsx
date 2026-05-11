import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fileBrowserList,
  fileBrowserRead,
  remoteFileBrowserList,
  remoteFileBrowserRead,
} from "@/lib/tauri-api";
import { ChevronLeft } from "lucide-react";
import { FileTree } from "@pierre/trees";
import type { FileTreeBatchOperation } from "@pierre/trees";

interface FileBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePath: string;
  controlSessionId?: string;
  onSelectFile?: (path: string) => void;
}

interface PreviewState {
  path: string;
  content?: string;
  loading: boolean;
  error?: string;
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "yaml",
  "yml",
  "toml",
  "rs",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "scss",
  "html",
  "py",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "lock",
  "log",
  "csv",
  "xml",
  "ini",
  "conf",
  "env",
]);

function isLikelyText(name: string): boolean {
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx === -1) return true;
  const ext = name.slice(dotIdx + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/** Normalize basePath: remove trailing slashes, keep "/" as-is */
function normalizeBasePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "");
}

/** Tree-relative path → absolute filesystem path */
function toAbsPath(relPath: string, root: string): string {
  if (relPath === "") return root;
  return root === "/" ? `/${relPath}` : `${root}/${relPath}`;
}

/** Build tree path for an entry. Dirs get trailing "/" per @pierre/trees spec */
function entryTreePath(
  dirRelPath: string,
  name: string,
  isDir: boolean,
): string {
  const prefix = dirRelPath ? `${dirRelPath}/` : "";
  return isDir ? `${prefix}${name}/` : `${prefix}${name}`;
}

export function FileBrowserDialog({
  open,
  onOpenChange,
  basePath,
  controlSessionId,
  onSelectFile,
}: FileBrowserDialogProps) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const treeRef = useRef<FileTree | null>(null);

  const rootPath = normalizeBasePath(basePath);
  const isRemote = Boolean(controlSessionId);

  // Callback ref — React calls this synchronously during commit,
  // before effects run, guaranteeing the element is in the DOM.
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);

  // ── Tree lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !container) return;

    // Clear any stale hosts from previous StrictMode remounts
    container
      .querySelectorAll("file-tree-container")
      .forEach((el) => el.remove());

    setPreview(null);
    setError(null);

    // ── Cache & in-flight tracking ─────────────────────────────────────
    const dirCache = new Map<
      string,
      { name: string; is_dir?: boolean; isDir?: boolean; size?: number }[]
    >();
    const inFlight = new Set<string>();

    // ── Helper: load entries for an absolute path ──────────────────────
    async function fetchEntries(absPath: string) {
      const result = isRemote
        ? await remoteFileBrowserList(controlSessionId!, absPath)
        : await fileBrowserList(absPath);
      if (!result.success)
        throw new Error(result.error ?? "Failed to list directory");
      return result.entries;
    }

    // ── Helper: add entries to the tree ────────────────────────────────
    function addEntriesToTree(
      tree: FileTree,
      dirRelPath: string,
      entries: { name: string; is_dir?: boolean; isDir?: boolean; size?: number }[],
    ) {
      if (entries.length === 0) return;
      const ops: FileTreeBatchOperation[] = [];
      for (const e of entries) {
        const path = entryTreePath(
          dirRelPath,
          e.name,
          e.is_dir ?? (e as any).isDir ?? false,
        );
        if (!tree.getItem(path)) {
          ops.push({ type: "add", path });
        }
      }
      if (ops.length > 0) tree.batch(ops);
    }

    // ── Helper: load a directory and populate the tree ─────────────────
    async function loadDir(tree: FileTree, dirRelPath: string) {
      if (dirCache.has(dirRelPath) || inFlight.has(dirRelPath)) return;
      const absPath = toAbsPath(dirRelPath, rootPath);
      inFlight.add(dirRelPath);
      try {
        const entries = await fetchEntries(absPath);
        dirCache.set(dirRelPath, entries);
        addEntriesToTree(tree, dirRelPath, entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.delete(dirRelPath);
      }
    }

    // ── Selection handler (all closures stable within this effect) ─────
    const handleTreeSelection = (selectedPaths: readonly string[]) => {
      if (!selectedPaths.length) return;
      const selected = selectedPaths[0];

      if (selected.endsWith("/")) {
        // Directory — lazy-load its children
        const dirRelPath = selected.slice(0, -1);
        void loadDir(treeRef.current!, dirRelPath);
      } else {
        // File — select or preview
        const absPath = toAbsPath(selected, rootPath);
        if (onSelectFile) {
          onSelectFile(absPath);
          return;
        }
        // Load preview
        const name = absPath.split("/").pop() ?? "";
        if (!isLikelyText(name)) {
          setPreview({
            path: absPath,
            loading: false,
            error: "Preview not supported for this file type",
          });
          return;
        }
        setPreview({ path: absPath, loading: true });
        (async () => {
          try {
            const result = isRemote
              ? await remoteFileBrowserRead(controlSessionId!, absPath)
              : await fileBrowserRead(absPath);
            if (result.success) {
              setPreview({
                path: absPath,
                loading: false,
                content: result.content ?? "",
              });
            } else {
              setPreview({
                path: absPath,
                loading: false,
                error: result.error ?? "Failed to read file",
              });
            }
          } catch (err) {
            setPreview({
              path: absPath,
              loading: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      }
    };

    // ── Create & render tree ───────────────────────────────────────────
    const tree = new FileTree({
      paths: [],
      icons: "complete",
      onSelectionChange: handleTreeSelection,
      initialExpansion: "closed",
      flattenEmptyDirectories: false,
      search: true,
    });

    treeRef.current = tree;
    tree.render({ containerWrapper: container });

    // Kick off root load
    void loadDir(tree, "");

    return () => {
      tree.cleanUp();
      treeRef.current = null;
      // Defensive: remove orphaned host elements (React Strict Mode safety)
      container.querySelectorAll("file-tree-container").forEach((el) => {
        el.remove();
      });
    };
  }, [open, container, rootPath, isRemote, controlSessionId, onSelectFile]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            {preview && (
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="p-1 rounded hover:bg-[var(--app-subtle-bg)] transition-colors"
                title="Back to file list"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            )}
            {preview ? preview.path.split("/").pop() : "File Browser"}
          </DialogTitle>
        </DialogHeader>

        {!preview && (
          <div className="flex items-center gap-2 text-xs text-[var(--app-hint)] border-b border-[var(--app-border)] pb-2">
            <span className="font-mono truncate flex-1">{rootPath}</span>
            <span className="opacity-60 shrink-0">Ctrl+F to search</span>
          </div>
        )}

        {/* Main content — tree host is ALWAYS in the DOM; preview overlays */}
        <div className="flex-1 overflow-hidden min-h-[200px] -mx-2 relative">
          {/* Preview overlay */}
          {preview && (
            <div className="absolute inset-0 z-10 bg-[var(--app-bg)] p-2 overflow-auto">
              {preview.loading ? (
                <div className="flex items-center justify-center h-32 text-sm text-[var(--app-hint)]">
                  Loading…
                </div>
              ) : preview.error ? (
                <div className="flex items-center justify-center h-32 text-sm text-[var(--app-hint)] px-3">
                  {preview.error}
                </div>
              ) : (
                <pre className="text-xs font-mono leading-relaxed bg-[var(--app-subtle-bg)] rounded-lg p-3 overflow-x-auto whitespace-pre">
                  {preview.content}
                </pre>
              )}
            </div>
          )}

          {/* Error overlay */}
          {error && !preview && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Tree mount point — callback ref guarantees DOM availability */}
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
