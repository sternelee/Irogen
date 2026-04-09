/**
 * File Browser View
 *
 * P2P file browser component for browsing remote directories and viewing files.
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import Prism from "prismjs";
import "prismjs/themes/prism.css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";
import { fileBrowserStore } from "../stores/fileBrowserStore";
import type { FileEntry } from "../stores/fileBrowserStore";
import { notificationStore } from "../stores/notificationStore";
import type { SessionMode } from "../stores/sessionStore";
import { Alert } from "./ui/primitives";
import { Button } from "./ui/primitives";
import { Dialog } from "./ui/primitives";
import { Spinner } from "./ui/primitives";

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

const extensionLanguageMap: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  html: "markup",
  htm: "markup",
  xml: "markup",
  css: "css",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  diff: "diff",
  patch: "diff",
};

const escapeHtml = (input: string): string =>
  input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const getLanguageFromPath = (path: string): string => {
  const fileName = path.split("/").pop() ?? "";
  const extension = fileName.includes(".")
    ? fileName.split(".").pop()?.toLowerCase()
    : undefined;
  return (extension && extensionLanguageMap[extension]) || "none";
};

// ============================================================================
// Icons
// ============================================================================

const FolderIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-5 w-5"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
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

const ChevronRightIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-3.5 w-3.5 sm:h-4 sm:w-4"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
      clip-rule="evenodd"
    />
  </svg>
);

const HomeIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-4 w-4"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
  </svg>
);

// ============================================================================
// Component
// ============================================================================

export const FileBrowserView: Component<FileBrowserViewProps> = (props) => {
  const {
    state,
    navigateToPath,
    setEntries,
    setLoading,
    setError,
    viewFile,
    closeFile,
    setViewMode,
    clearOpenRequest,
    getDirectories,
    getFiles,
  } = fileBrowserStore;
  let lastRootPath: string | null = null;
  let filePreviewContainerRef: HTMLDivElement | undefined;
  const [targetLine, setTargetLine] = createSignal<number | undefined>(
    undefined,
  );

  const rootPath = createMemo(() => {
    const raw = (props.projectPath || ".").trim();
    if (!raw) return ".";
    if (raw === "/") return raw;
    return raw.replace(/\/+$/, "");
  });

  const resolvePath = (path: string): string =>
    path === "." ? rootPath() : path;

  const joinPath = (base: string, name: string): string => {
    if (base === "/") return `/${name}`;
    return `${base}/${name}`;
  };

  const getRemoteControlSessionId = (): string => {
    const controlSessionId = props.controlSessionId;
    if (!controlSessionId) {
      throw new Error("Remote control session is not available");
    }
    return controlSessionId;
  };

  // Load directory content
  const loadDirectory = async (path: string) => {
    const resolvedPath = resolvePath(path);
    setLoading(true);
    setError(null);

    try {
      const response =
        props.sessionMode === "remote"
          ? await invoke<{
              success: boolean;
              entries?: FileEntry[];
              error?: string;
            }>("remote_file_browser_list", {
              controlSessionId: getRemoteControlSessionId(),
              path: resolvedPath,
            })
          : await invoke<{
              success: boolean;
              entries?: FileEntry[];
              error?: string;
            }>("file_browser_list", { path: resolvedPath });
      if (response?.success) {
        setEntries(response.entries || []);
        navigateToPath(resolvedPath);
        props.onPathChange?.(resolvedPath);
      } else {
        throw new Error(response?.error || "Failed to load directory");
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to load directory";
      setError(errorMsg);
      notificationStore.error(errorMsg, "File Browser Error");
    } finally {
      setLoading(false);
    }
  };

  // Load file content
  const loadFile = async (path: string, jumpToLine?: number) => {
    setLoading(true);
    setError(null);

    try {
      const response =
        props.sessionMode === "remote"
          ? await invoke<{
              success: boolean;
              content?: string;
              error?: string;
            }>("remote_file_browser_read", {
              controlSessionId: getRemoteControlSessionId(),
              path,
            })
          : await invoke<{
              success: boolean;
              content?: string;
              error?: string;
            }>("file_browser_read", { path });
      if (response?.success) {
        viewFile(path, response.content || "");
        if (
          typeof jumpToLine === "number" &&
          Number.isFinite(jumpToLine) &&
          jumpToLine > 0
        ) {
          setTargetLine(Math.floor(jumpToLine));
        } else {
          setTargetLine(undefined);
        }
      } else {
        throw new Error(response?.error || "Failed to read file");
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to read file";
      setError(errorMsg);
      notificationStore.error(errorMsg, "File Read Error");
    } finally {
      setLoading(false);
    }
  };

  // Handle entry click
  const handleEntryClick = (entry: { name: string; isDir: boolean }) => {
    const basePath = resolvePath(state.currentPath);
    const fullPath = joinPath(basePath, entry.name);

    if (entry.isDir) {
      loadDirectory(fullPath);
    } else {
      loadFile(fullPath);
    }
  };

  // Refresh current directory
  const refresh = () => {
    loadDirectory(resolvePath(state.currentPath));
  };

  const goUp = () => {
    const current = resolvePath(state.currentPath);
    const root = rootPath();
    if (current === root) return;
    const parts = current.split("/").filter(Boolean);
    parts.pop();
    const parentPath = current.startsWith("/")
      ? `/${parts.join("/")}` || "/"
      : parts.join("/") || ".";
    loadDirectory(parentPath);
  };

  onMount(() => {
    const hasCachedEntries = state.entries.length > 0;
    const pathToLoad = hasCachedEntries
      ? resolvePath(state.currentPath)
      : rootPath();
    loadDirectory(pathToLoad);
  });

  createEffect(() => {
    const nextRoot = rootPath();
    if (lastRootPath === null) {
      lastRootPath = nextRoot;
      return;
    }
    if (lastRootPath !== nextRoot) {
      lastRootPath = nextRoot;
      loadDirectory(nextRoot);
    }
  });

  createEffect(() => {
    const req = state.openRequest;
    if (!req) return;

    const openRequestedFile = async () => {
      const normalizedPath = req.path;
      const lastSlash = normalizedPath.lastIndexOf("/");
      const parentPath =
        lastSlash > 0
          ? normalizedPath.slice(0, lastSlash)
          : normalizedPath.startsWith("/")
            ? "/"
            : ".";
      try {
        await loadDirectory(parentPath);
        await loadFile(normalizedPath, req.line);
      } finally {
        clearOpenRequest();
      }
    };

    void openRequestedFile();
  });

  createEffect(() => {
    const line = targetLine();
    if (!state.viewingFile || !line || !filePreviewContainerRef) return;
    const lineHeight = 20;
    const top = Math.max((line - 1) * lineHeight - 80, 0);
    filePreviewContainerRef.scrollTo({
      top,
      behavior: "smooth",
    });
  });

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Breadcrumb path segments
  const pathSegments = () => {
    const root = rootPath();
    const current = resolvePath(state.currentPath);
    if (current === root) return [];

    const rootWithSlash = root.endsWith("/") ? root : `${root}/`;
    if (!current.startsWith(rootWithSlash)) {
      return [];
    }

    const relative = current.slice(rootWithSlash.length);
    const segments = relative.split("/").filter(Boolean);
    return segments.map((seg, i) => ({
      name: seg,
      path: joinPath(root, segments.slice(0, i + 1).join("/")),
    }));
  };

  const highlightedFileContent = createMemo(() => {
    const viewingFile = state.viewingFile;
    if (!viewingFile) return "";

    const language = getLanguageFromPath(viewingFile.path);
    const grammar = Prism.languages[language];
    if (!grammar) return escapeHtml(viewingFile.content);

    return Prism.highlight(viewingFile.content, grammar, language);
  });

  const viewingLanguage = createMemo(() => {
    const viewingFile = state.viewingFile;
    if (!viewingFile) return "none";
    return getLanguageFromPath(viewingFile.path);
  });

  const hasCachedEntries = createMemo(() => state.entries.length > 0);

  return (
    <div class={`file-browser ${props.class || ""}`}>
      {/* Header */}
      <div class="file-browser-header">
        {/* Navigation Bar */}
        <div class="compact-mobile-controls flex items-center gap-1 p-1.5 sm:gap-1.5 sm:p-2 border-b border-border">
          {/* Navigation Buttons */}
          <div class="flex gap-1">
            <Button
              variant="ghost"
              size="xs"
              disabled={resolvePath(state.currentPath) === rootPath()}
              onClick={goUp}
              title="Up"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 sm:h-5 sm:w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" />
              </svg>
            </Button>
            <Button variant="ghost" size="xs" onClick={refresh} title="Refresh">
              <Show when={state.isLoading}>
                <Spinner size="sm" />
              </Show>
              <Show when={!state.isLoading}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 sm:h-5 sm:w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                    clip-rule="evenodd"
                  />
                </svg>
              </Show>
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => loadDirectory(rootPath())}
              title="Home"
            >
              <HomeIcon />
            </Button>
          </div>

          {/* Breadcrumb */}
          <div class="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
            <For each={pathSegments()}>
              {(segment, i) => (
                <>
                  <button
                    class="h-6 sm:h-7 max-w-22 sm:max-w-25 truncate rounded-md px-1 text-[11px] sm:px-1.5 sm:text-xs hover:bg-muted"
                    onClick={() => loadDirectory(segment.path)}
                  >
                    {segment.name}
                  </button>
                  <Show when={i() < pathSegments().length - 1}>
                    <ChevronRightIcon />
                  </Show>
                </>
              )}
            </For>
          </div>

          {/* View Mode Toggle */}
          <div class="rounded-md border border-border hidden">
            <Button
              size="xs"
              variant={state.viewMode === "list" ? "primary" : "ghost"}
              class="rounded-r-none"
              onClick={() => setViewMode("list")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
            </Button>
            <Button
              size="xs"
              variant={state.viewMode === "grid" ? "primary" : "ghost"}
              class="rounded-l-none border-l border-border"
              onClick={() => setViewMode("grid")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </Button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div class="file-browser-content">
        {/* Loading State */}
        <Show when={state.isLoading && !hasCachedEntries()}>
          <div class="flex items-center justify-center h-64">
            <Spinner size="lg" class="text-primary" />
          </div>
        </Show>

        {/* Error State */}
        <Show when={state.error}>
          <Alert variant="destructive" class="mx-4 mt-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
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
            <span>{state.error}</span>
          </Alert>
        </Show>

        {/* File List View */}
        <Show when={state.viewMode === "list"}>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-[11px] sm:text-xs">
              <thead class="border-b border-border text-muted-foreground/70">
                <tr>
                  <th class="px-2 py-1.5 sm:px-3 sm:py-2">Name</th>
                  <th class="px-2 py-1.5 sm:px-3 sm:py-2">Size</th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={
                    getDirectories().length === 0 && getFiles().length === 0
                  }
                >
                  <tr>
                    <td
                      colspan="2"
                      class="py-8 text-center text-muted-foreground/50"
                    >
                      This directory is empty
                    </td>
                  </tr>
                </Show>
                <For each={getDirectories()}>
                  {(entry) => (
                    <tr
                      class="cursor-pointer border-b border-border/50 hover:bg-muted"
                      onClick={() => handleEntryClick(entry)}
                    >
                      <td class="flex items-center gap-1.5 sm:gap-2 px-2 py-1.5 sm:px-3 sm:py-2">
                        <span class="text-primary">
                          <FolderIcon />
                        </span>
                        {entry.name}
                      </td>
                      <td class="px-2 py-1.5 sm:px-3 sm:py-2 text-muted-foreground/50">
                        -
                      </td>
                    </tr>
                  )}
                </For>
                <For each={getFiles()}>
                  {(entry) => (
                    <tr
                      class="cursor-pointer border-b border-border/50 hover:bg-muted"
                      onClick={() => handleEntryClick(entry)}
                    >
                      <td class="flex items-center gap-1.5 sm:gap-2 px-2 py-1.5 sm:px-3 sm:py-2">
                        <span class="text-muted-foreground/70">
                          <FileIcon />
                        </span>
                        {entry.name}
                      </td>
                      <td class="px-2 py-1.5 sm:px-3 sm:py-2">
                        {formatSize(entry.size)}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        {/* Grid View */}
        <Show when={state.viewMode === "grid"}>
          <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3 p-2 sm:p-3">
            <Show
              when={getDirectories().length === 0 && getFiles().length === 0}
            >
              <div class="col-span-full text-center text-muted-foreground/50 py-8">
                This directory is empty
              </div>
            </Show>
            <For each={getDirectories()}>
              {(entry) => (
                <div
                  class="flex flex-col items-center p-2 sm:p-3 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                  onClick={() => handleEntryClick(entry)}
                >
                  <span class="text-primary mb-2">
                    <FolderIcon />
                  </span>
                  <span class="text-xs text-center truncate w-full">
                    {entry.name}
                  </span>
                </div>
              )}
            </For>
            <For each={getFiles()}>
              {(entry) => (
                <div
                  class="flex flex-col items-center p-2 sm:p-3 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                  onClick={() => handleEntryClick(entry)}
                >
                  <span class="text-muted-foreground/70 mb-2">
                    <FileIcon />
                  </span>
                  <span class="text-xs text-center truncate w-full">
                    {entry.name}
                  </span>
                  <span class="text-xs text-muted-foreground/50">
                    {formatSize(entry.size)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* File Content Modal */}
      <Show when={state.viewingFile}>
        <Dialog
          open={!!state.viewingFile}
          onClose={closeFile}
          contentClass="max-w-4xl h-[80vh] flex flex-col"
        >
          <div>
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-lg truncate">
                {state.viewingFile?.path}
              </h3>
            </div>
            <div
              ref={filePreviewContainerRef}
              class="flex-1 overflow-auto rounded-sm bg-muted p-4"
            >
              <pre class="file-preview-prism text-xs leading-5">
                <code
                  class={`language-${viewingLanguage()} font-mono`}
                  innerHTML={highlightedFileContent()}
                />
              </pre>
            </div>
          </div>
        </Dialog>
      </Show>
    </div>
  );
};

export default FileBrowserView;
