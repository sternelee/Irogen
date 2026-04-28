/**
 * File Browser View
 *
 * VS Code-style lazy file tree using @pierre/trees.
 * Directories expand in-place; their children are fetched on first open
 * and cached for the lifetime of the component.
 *
 * File preview uses @pierre/diffs File renderer (Shiki syntax highlighting).
 */

import {
  Component,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { FileTree } from "@pierre/trees";
import type { FileTreeBatchOperation } from "@pierre/trees";
import { File as PierreFile } from "@pierre/diffs";
import { fileBrowserStore } from "../stores/fileBrowserStore";
import type { FileEntry } from "../stores/fileBrowserStore";
import { notificationStore } from "../stores/notificationStore";
import type { SessionMode } from "../stores/sessionStore";
import { Alert } from "./ui/primitives";
import { Button } from "./ui/primitives";
import { Dialog } from "./ui/primitives";
import { Spinner } from "./ui/primitives";

// ============================================================================
// File-type helpers
// ============================================================================

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "tiff",
]);

const BINARY_EXTS = new Set([
  "pdf",
  "zip",
  "gz",
  "tar",
  "rar",
  "7z",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "wasm",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "aac",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "db",
  "sqlite",
  "parquet",
  "class",
  "pyc",
]);

const getExt = (path: string): string =>
  (path.split(".").pop() || "").toLowerCase();

type FileKind = "image" | "binary" | "text";

const classifyFile = (path: string): FileKind => {
  const ext = getExt(path);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (BINARY_EXTS.has(ext)) return "binary";
  return "text";
};

// ============================================================================
// Types
// ============================================================================

interface FileBrowserViewProps {
  class?: string;
  projectPath?: string;
  sessionMode?: SessionMode;
  controlSessionId?: string;
  onPathChange?: (path: string) => void;
}

// ============================================================================
// Icons
// ============================================================================

const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-4 w-4"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
      clip-rule="evenodd"
    />
  </svg>
);

const RefreshIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-4 w-4"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
      clip-rule="evenodd"
    />
  </svg>
);

const FileIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-5 w-5"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
      clip-rule="evenodd"
    />
  </svg>
);

// ============================================================================
// Component
// ============================================================================

export const FileBrowserView: Component<FileBrowserViewProps> = (props) => {
  const { state, setError, setLoading, viewFile, closeFile, clearOpenRequest } =
    fileBrowserStore;

  // ── DOM refs ────────────────────────────────────────────────────────────────
  let treeContainerRef: HTMLDivElement | undefined;
  // Signal-based ref so createEffect re-runs when the Dialog Show block mounts
  const [filePreviewContainer, setFilePreviewContainer] = createSignal<
    HTMLDivElement | undefined
  >(undefined);

  // ── Local reactive state ────────────────────────────────────────────────────
  const [targetLine, setTargetLine] = createSignal<number | undefined>(
    undefined,
  );
  // True once at least one directory has finished loading
  const [hasLoadedAny, setHasLoadedAny] = createSignal(false);
  // Counts of active directory fetches (for the loading overlay)
  const [activeFetches, setActiveFetches] = createSignal(0);
  // Kind of the currently-viewed file
  const [viewingKind, setViewingKind] = createSignal<FileKind>("text");
  // Tauri-protocol src URL for image preview (local mode only)
  const [imageSrc, setImageSrc] = createSignal<string | undefined>(undefined);

  // ── Pierre instances (stable across re-renders) ─────────────────────────────
  let fileTreeInstance: FileTree;
  let pierreFileInstance: PierreFile;

  // ── Cache ───────────────────────────────────────────────────────────────────
  /**
   * Maps tree-relative dir path → its loaded FileEntry children.
   * Root directory is keyed as "".
   * Cleared when projectPath changes.
   */
  const dirCache = new Map<string, FileEntry[]>();
  /**
   * Tracks in-flight requests so we never double-fetch the same directory.
   */
  const inFlight = new Set<string>();

  // ============================================================================
  // Path utilities
  // ============================================================================

  const rootPath = createMemo(() => {
    const raw = (props.projectPath || ".").trim();
    if (!raw) return ".";
    if (raw === "/") return raw;
    return raw.replace(/\/+$/, "");
  });

  /** Absolute filesystem path → tree-relative path (root = "") */
  const toRelPath = (absPath: string): string => {
    const root = rootPath();
    if (absPath === root || absPath === ".") return "";
    const prefix = root === "/" ? "/" : `${root}/`;
    return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
  };

  /** Tree-relative path → absolute filesystem path */
  const toAbsPath = (relPath: string): string => {
    if (relPath === "") return rootPath();
    const root = rootPath();
    return root === "/" ? `/${relPath}` : `${root}/${relPath}`;
  };

  /**
   * Build the tree path for a single entry.
   * Directories get a trailing "/" per @pierre/trees normalizeInputPath spec:
   * "Trailing slashes explicitly mark directories".
   */
  const entryTreePath = (
    dirRelPath: string,
    name: string,
    isDir: boolean,
  ): string => {
    const prefix = dirRelPath ? `${dirRelPath}/` : "";
    return isDir ? `${prefix}${name}/` : `${prefix}${name}`;
  };

  const getRemoteControlSessionId = (): string => {
    if (!props.controlSessionId)
      throw new Error("Remote control session is not available");
    return props.controlSessionId;
  };

  // ============================================================================
  // Data fetching
  // ============================================================================

  const fetchEntries = async (absPath: string): Promise<FileEntry[]> => {
    const res =
      props.sessionMode === "remote"
        ? await invoke<{
            success: boolean;
            entries?: FileEntry[];
            error?: string;
          }>("remote_file_browser_list", {
            controlSessionId: getRemoteControlSessionId(),
            path: absPath,
          })
        : await invoke<{
            success: boolean;
            entries?: FileEntry[];
            error?: string;
          }>("file_browser_list", { path: absPath });

    if (!res?.success)
      throw new Error(res?.error || "Failed to load directory");
    return res.entries || [];
  };

  /**
   * Load a directory's children into the FileTree.
   *
   * - Skips if already cached or currently in-flight.
   * - Adds all children at once via `batch()` for a single DOM update.
   * - Caches the result for future expand/collapse cycles.
   *
   * @param dirRelPath  Tree-relative path, e.g. "src", "" for root.
   */
  const loadDir = async (dirRelPath: string): Promise<void> => {
    if (dirCache.has(dirRelPath) || inFlight.has(dirRelPath)) return;

    inFlight.add(dirRelPath);
    setActiveFetches((n) => n + 1);
    setError(null);

    try {
      const entries = await fetchEntries(toAbsPath(dirRelPath));
      dirCache.set(dirRelPath, entries);
      setHasLoadedAny(true);

      if (fileTreeInstance && entries.length > 0) {
        const ops: FileTreeBatchOperation[] = entries.map((e) => ({
          type: "add" as const,
          path: entryTreePath(dirRelPath, e.name, e.isDir),
        }));
        fileTreeInstance.batch(ops);
      }

      // Notify parent of path change (only for root load)
      if (dirRelPath === "") {
        props.onPathChange?.(rootPath());
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load directory";
      setError(msg);
      notificationStore.error(msg, "File Browser Error");
    } finally {
      inFlight.delete(dirRelPath);
      setActiveFetches((n) => n - 1);
    }
  };

  /**
   * Reload all previously-loaded directories.
   * Called by the Refresh button.
   */
  const refresh = async () => {
    if (!fileTreeInstance) return;
    const previouslyLoaded = [...dirCache.keys()];
    dirCache.clear();
    inFlight.clear();
    setHasLoadedAny(false);
    fileTreeInstance.resetPaths([]);
    // Reload all in parallel (breadth-first would be nicer but fine for typical trees)
    await Promise.all(previouslyLoaded.map(loadDir));
  };

  const loadFile = async (absPath: string, jumpToLine?: number) => {
    const kind = classifyFile(absPath);
    setViewingKind(kind);
    setImageSrc(undefined);

    // Binary (non-image): just open the dialog to show the unsupported banner
    if (kind === "binary") {
      viewFile(absPath, "");
      return;
    }

    // Image: use Tauri convertFileSrc for local sessions; unsupported for remote
    if (kind === "image") {
      if (props.sessionMode === "remote") {
        // Remote image preview not supported — show unsupported banner
        viewFile(absPath, "");
      } else {
        setImageSrc(convertFileSrc(absPath));
        viewFile(absPath, "");
      }
      return;
    }

    // Text file: fetch content and render via @pierre/diffs
    setLoading(true);
    setError(null);

    try {
      const res =
        props.sessionMode === "remote"
          ? await invoke<{
              success: boolean;
              content?: string;
              error?: string;
            }>("remote_file_browser_read", {
              controlSessionId: getRemoteControlSessionId(),
              path: absPath,
            })
          : await invoke<{
              success: boolean;
              content?: string;
              error?: string;
            }>("file_browser_read", { path: absPath });

      if (res?.success) {
        viewFile(absPath, res.content || "");
        setTargetLine(
          typeof jumpToLine === "number" &&
            Number.isFinite(jumpToLine) &&
            jumpToLine > 0
            ? Math.floor(jumpToLine)
            : undefined,
        );
      } else {
        throw new Error(res?.error || "Failed to read file");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to read file";
      setError(msg);
      notificationStore.error(msg, "File Read Error");
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // @pierre/trees selection handler
  // ============================================================================

  /**
   * Fired by FileTree on every selection change.
   *
   * - Directory path (trailing "/"):  load children if not cached, let the
   *   tree expand/collapse naturally.
   * - File path: open the file in the preview dialog.
   */
  const handleTreeSelection = (selectedPaths: readonly string[]) => {
    if (!selectedPaths.length) return;
    const selected = selectedPaths[0];

    if (selected.endsWith("/")) {
      // Strip trailing slash to get the cache key
      const dirRelPath = selected.slice(0, -1);
      void loadDir(dirRelPath);
    } else {
      void loadFile(toAbsPath(selected));
    }
  };

  // ============================================================================
  // Lifecycle
  // ============================================================================

  onMount(() => {
    fileTreeInstance = new FileTree({
      paths: [],
      icons: "complete",
      onSelectionChange: handleTreeSelection,
      // Start fully expanded so children are visible immediately after load
      initialExpansion: "open",
      // Keep empty dirs visible as expandable nodes (don't flatten them away)
      flattenEmptyDirectories: false,
      // Enable built-in search (Ctrl+F / keyboard shortcut)
      search: true,
    });

    if (treeContainerRef) {
      fileTreeInstance.render({ containerWrapper: treeContainerRef });
    }

    pierreFileInstance = new PierreFile({
      theme: "pierre-dark",
      disableFileHeader: false,
    });

    // Kick off root directory load
    void loadDir("");
  });

  onCleanup(() => {
    fileTreeInstance?.cleanUp();
    pierreFileInstance?.cleanUp();
  });

  // Re-init when projectPath changes
  let lastRootPath: string | null = null;
  createEffect(() => {
    const nextRoot = rootPath();
    if (lastRootPath === null) {
      lastRootPath = nextRoot;
      return;
    }
    if (lastRootPath !== nextRoot) {
      lastRootPath = nextRoot;
      dirCache.clear();
      inFlight.clear();
      setHasLoadedAny(false);
      fileTreeInstance?.resetPaths([]);
      void loadDir("");
    }
  });

  // Handle external open-file requests (e.g. chat card click with line number)
  createEffect(() => {
    const req = state.openRequest;
    if (!req) return;

    const open = async () => {
      const relPath = toRelPath(req.path);
      // Ensure every ancestor directory is loaded first
      const parts = relPath.split("/").filter(Boolean);
      parts.pop(); // remove the file itself
      for (let i = 0; i <= parts.length; i++) {
        await loadDir(parts.slice(0, i).join("/"));
      }
      await loadFile(req.path, req.line);
      // Scroll the tree to reveal the file
      fileTreeInstance?.focusPath(relPath);
      clearOpenRequest();
    };

    void open();
  });

  // Render file preview whenever file or container changes
  createEffect(() => {
    const vf = state.viewingFile;
    const container = filePreviewContainer();
    if (!vf || !container || !pierreFileInstance) return;
    const fileName = vf.path.split("/").pop() || "file";
    pierreFileInstance.render({
      file: { name: fileName, contents: vf.content },
      containerWrapper: container,
    });
  });

  // Scroll to target line inside the preview
  createEffect(() => {
    const line = targetLine();
    const container = filePreviewContainer();
    if (!line || !container) return;
    container.scrollTo({
      top: Math.max((line - 1) * 20 - 80, 0),
      behavior: "smooth",
    });
  });

  // ============================================================================
  // Render
  // ============================================================================

  const isLoading = () => activeFetches() > 0 || state.isLoading;

  return (
    <div class={`flex flex-col h-full bg-base-200 ${props.class || ""}`}>
      {/* Header */}
      <div class="flex-none border-b border-border/50 bg-base-200/80 backdrop-blur-sm">
        <div class="flex items-center gap-1.5 p-2 sm:p-3">
          {/* Root label */}
          <span class="flex-1 text-xs font-semibold text-muted-foreground truncate min-w-0">
            {rootPath().split("/").pop() || rootPath()}
          </span>

          {/* Search toggle */}
          <Button
            variant="ghost"
            size="xs"
            class="h-7 w-7 rounded-lg"
            onClick={() => fileTreeInstance?.openSearch()}
            title="Search files (Ctrl+F)"
          >
            <SearchIcon />
          </Button>

          {/* Refresh */}
          <Button
            variant="ghost"
            size="xs"
            class="h-7 w-7 rounded-lg"
            onClick={refresh}
            disabled={isLoading()}
            title="Refresh"
          >
            <Show when={isLoading()} fallback={<RefreshIcon />}>
              <Spinner size="sm" />
            </Show>
          </Button>
        </div>
      </div>

      {/* Main content — @pierre/trees fills this area */}
      <div class="flex-1 overflow-hidden relative">
        {/* Initial loading overlay — shown only before the first load completes */}
        <Show when={!hasLoadedAny() && isLoading()}>
          <div class="absolute inset-0 flex items-center justify-center bg-base-200/70 z-10">
            <Spinner size="lg" class="text-primary" />
          </div>
        </Show>

        {/* Error banner */}
        <Show when={state.error}>
          <Alert variant="destructive" class="m-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span class="text-sm">{state.error}</span>
          </Alert>
        </Show>

        {/* @pierre/trees mounts its shadow DOM here */}
        <div ref={treeContainerRef} class="h-full" />
      </div>

      {/* File preview Dialog — @pierre/diffs File renderer */}
      <Show when={state.viewingFile}>
        <Dialog
          open={!!state.viewingFile}
          onClose={closeFile}
          contentClass="max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-background rounded-2xl"
        >
          <div class="flex flex-col h-full min-h-0">
            {/* Dialog header */}
            <div class="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-base-200/50 shrink-0 min-w-0">
              <span class="shrink-0 text-muted-foreground">
                <FileIcon />
              </span>
              <span class="font-medium text-sm text-foreground truncate">
                {state.viewingFile?.path.split("/").pop() || "File"}
              </span>
              <span class="text-muted-foreground/50 font-normal text-xs hidden sm:block truncate">
                {state.viewingFile?.path}
              </span>
            </div>

            {/* Body — differs by file kind */}
            <Show when={viewingKind() === "image" && imageSrc()}>
              {/* Local image preview */}
              <div class="flex-1 overflow-auto flex items-center justify-center p-4 bg-zinc-950">
                <img
                  src={imageSrc()}
                  alt={state.viewingFile?.path.split("/").pop() || "image"}
                  class="max-w-full max-h-full object-contain"
                />
              </div>
            </Show>

            <Show
              when={
                viewingKind() === "binary" ||
                (viewingKind() === "image" && !imageSrc())
              }
            >
              {/* Binary / remote-image unsupported banner */}
              <div class="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-500 select-none p-8">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-10 w-10 opacity-40"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
                <span class="text-sm">不支持预览此文件类型</span>
                <span class="text-xs opacity-60">
                  {state.viewingFile?.path.split("/").pop()}
                </span>
              </div>
            </Show>

            <Show when={viewingKind() === "text"}>
              {/* @pierre/diffs File renderer — signal ref ensures effect re-runs after Show mounts */}
              <div ref={setFilePreviewContainer} class="flex-1 overflow-auto" />
            </Show>
          </div>
        </Dialog>
      </Show>
    </div>
  );
};

export default FileBrowserView;
