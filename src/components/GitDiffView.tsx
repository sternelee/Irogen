/**
 * Git Diff View
 *
 * P2P git operations component for viewing git status and diffs.
 */

import { Component, For, Show, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { gitStore } from "../stores/gitStore";
import { notificationStore } from "../stores/notificationStore";
import { Alert } from "./ui/primitives";
import { Badge } from "./ui/primitives";
import { Button } from "./ui/primitives";
import { Spinner } from "./ui/primitives";

// ============================================================================
// Types
// ============================================================================

interface GitDiffViewProps {
  class?: string;
  projectPath?: string;
}

// ============================================================================
// Types helpers
// ============================================================================

type GitStatusChar = "?" | " " | "M" | "A" | "D" | "R" | "C" | "U";

const getStatusColor = (status: GitStatusChar): string => {
  switch (status) {
    case "M":
      return "text-warning";
    case "A":
      return "text-success";
    case "D":
      return "text-error";
    case "R":
      return "text-info";
    case "?":
      return "text-foreground/50";
    case " ":
      return "text-success";
    default:
      return "text-foreground";
  }
};

const getStatusLabel = (x: GitStatusChar, y: GitStatusChar): string => {
  if (x === "?" && y === "?") return "Untracked";
  if (x === " " && y === "M") return "Modified";
  if (x === "M" && y === " ") return "Staged";
  if (x === "M" && y === "M") return "Modified & Staged";
  if (x === "A") return "Added";
  if (x === "D") return "Deleted";
  if (x === "R") return "Renamed";
  return "Changed";
};

// ============================================================================
// Icons
// ============================================================================

const FileIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-4 w-4"
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

const GitBranchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-5 w-5"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
      clip-rule="evenodd"
    />
    <path d="M12.5 4a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
    <path d="M4 12.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
  </svg>
);

// ============================================================================
// Component
// ============================================================================

export const GitDiffView: Component<GitDiffViewProps> = (props) => {
  const {
    state,
    setStatusOutput,
    setCurrentDiff,
    setLoadingStatus,
    setLoadingDiff,
    setSelectedFile,
    setError,
    setViewMode,
    getStagedFiles,
    getModifiedFiles,
    getUntrackedFiles,
    hasChanges,
    getStatusSummary,
  } = gitStore;

  // Load git status
  const loadStatus = async () => {
    setLoadingStatus(true);
    setError(null);

    try {
      const response = await invoke<{
        success: boolean;
        status?: string;
        error?: string;
      }>("git_status", {
        path: props.projectPath || ".",
      });
      if (response?.success) {
        setStatusOutput(response.status || "");
      } else {
        throw new Error(response?.error || "Failed to get git status");
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to get git status";
      setError(errorMsg);
      notificationStore.error(errorMsg, "Git Error");
    } finally {
      setLoadingStatus(false);
    }
  };

  // Load diff for a file
  const loadDiff = async (filePath: string) => {
    setLoadingDiff(true);
    setError(null);
    setSelectedFile(filePath);

    try {
      const response = await invoke<{
        success: boolean;
        diff?: string;
        error?: string;
      }>("git_diff", {
        path: props.projectPath || ".",
        file: filePath,
      });
      if (response?.success) {
        setCurrentDiff({
          file: filePath,
          diff: response.diff || "",
        });
        setViewMode("diff");
      } else {
        throw new Error(response?.error || "Failed to get diff");
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to get diff";
      setError(errorMsg);
      notificationStore.error(errorMsg, "Git Error");
    } finally {
      setLoadingDiff(false);
    }
  };

  // Refresh
  const refresh = () => {
    loadStatus();
  };

  // Initial load
  onMount(() => {
    loadStatus();
  });

  // Summary
  const summary = () => getStatusSummary();

  // ============================================================================
  // Diff Line Component
  // ============================================================================

  const DiffLine = (props: {
    line: {
      type: string;
      content: string;
      oldLineNum?: number;
      newLineNum?: number;
    };
  }) => {
    const line = () => props.line;
    return (
      <div
        class={`flex ${line().type === "add" ? "bg-success/10" : line().type === "remove" ? "bg-error/10" : ""}`}
      >
        <Show when={line().oldLineNum !== undefined}>
          <span class="w-12 text-right pr-2 text-foreground/30 select-none text-xs font-mono">
            {line().oldLineNum}
          </span>
        </Show>
        <Show when={line().newLineNum !== undefined}>
          <span class="w-12 text-right pr-2 text-foreground/30 select-none text-xs font-mono">
            {line().newLineNum}
          </span>
        </Show>
        <span
          class={`flex-1 font-mono text-xs whitespace-pre ${
            line().type === "add"
              ? "text-success"
              : line().type === "remove"
                ? "text-error"
                : "text-foreground"
          }`}
        >
          {line().type === "add" && "+"}
          {line().type === "remove" && "-"}
          {line().content}
        </span>
      </div>
    );
  };

  return (
    <div class={`git-diff-view ${props.class || ""}`}>
      {/* Header */}
      <div class="git-diff-header p-3 border-b border-border">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <GitBranchIcon />
            <h2 class="text-base font-semibold">Git Status</h2>
            <Show when={state.currentBranch}>
              <Badge>{state.currentBranch}</Badge>
            </Show>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={state.isLoadingStatus}
          >
            <Show when={state.isLoadingStatus}>
              <Spinner size="sm" />
            </Show>
            <Show when={!state.isLoadingStatus}>
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
            </Show>
            Refresh
          </Button>
        </div>

        {/* Summary */}
        <Show when={hasChanges()}>
          <div class="flex gap-3 mt-2 text-xs">
            <span class="text-success">Staged: {summary().staged}</span>
            <span class="text-warning">Modified: {summary().modified}</span>
            <span class="text-foreground/50">
              Untracked: {summary().untracked}
            </span>
          </div>
        </Show>

        <Show when={!hasChanges() && !state.isLoadingStatus}>
          <div class="mt-2 text-xs text-foreground/50">No changes detected</div>
        </Show>
      </div>

      {/* Content */}
      <div class="git-diff-content">
        {/* Status View */}
        <Show when={state.viewMode === "status"}>
          <div class="divide-y divide-border">
            {/* Staged Files */}
            <Show when={getStagedFiles().length > 0}>
              <div class="p-2.5">
                <h3 class="text-xs font-semibold mb-1.5 text-success">
                  Staged Changes
                </h3>
                <For each={getStagedFiles()}>
                  {(entry) => (
                    <div
                      class="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                      onClick={() => loadDiff(entry.from)}
                    >
                      <span
                        class={`text-lg ${getStatusColor(entry.x as GitStatusChar)}`}
                      >
                        {entry.x}
                      </span>
                      <FileIcon />
                      <span class="flex-1 truncate">{entry.from}</span>
                      <Show when={entry.to}>
                        <span class="text-foreground/50">→ {entry.to}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Modified Files */}
            <Show when={getModifiedFiles().length > 0}>
              <div class="p-2.5">
                <h3 class="text-xs font-semibold mb-1.5 text-warning">
                  Modified
                </h3>
                <For each={getModifiedFiles()}>
                  {(entry) => (
                    <div
                      class="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                      onClick={() => loadDiff(entry.from)}
                    >
                      <span
                        class={`text-lg ${getStatusColor(entry.y as GitStatusChar)}`}
                      >
                        {entry.y}
                      </span>
                      <FileIcon />
                      <span class="flex-1 truncate">{entry.from}</span>
                      <span class="text-xs text-foreground/50">
                        {getStatusLabel(
                          entry.x as GitStatusChar,
                          entry.y as GitStatusChar,
                        )}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Untracked Files */}
            <Show when={getUntrackedFiles().length > 0}>
              <div class="p-2.5">
                <h3 class="text-xs font-semibold mb-1.5 text-foreground/50">
                  Untracked
                </h3>
                <For each={getUntrackedFiles()}>
                  {(entry) => (
                    <div
                      class="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                      onClick={() => loadDiff(entry.from)}
                    >
                      <span class="text-lg text-foreground/30">?</span>
                      <FileIcon />
                      <span class="flex-1 truncate">{entry.from}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* Diff View */}
        <Show when={state.viewMode === "diff" && state.currentDiff}>
          <div class="p-2.5">
            {/* Diff Header */}
            <div class="flex items-center justify-between mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("status")}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                    clip-rule="evenodd"
                  />
                </svg>
                Back
              </Button>
              <span class="font-mono text-xs truncate flex-1 text-center">
                {state.currentDiff?.file}
              </span>
              <div class="w-16"></div>
            </div>

            {/* Loading */}
            <Show when={state.isLoadingDiff}>
              <div class="flex items-center justify-center h-32">
                <Spinner size="lg" />
              </div>
            </Show>

            {/* Diff Content */}
            <Show when={!state.isLoadingDiff && state.currentDiff?.hunks}>
              <div class="bg-muted rounded-lg overflow-hidden text-xs">
                <For each={state.currentDiff?.hunks}>
                  {(hunk) => (
                    <div class="border-b border-border last:border-0">
                      {/* Hunk Header */}
                      <div class="bg-muted/50 px-3 py-1 font-mono text-xs text-foreground/70">
                        {hunk.header}
                      </div>
                      {/* Hunk Lines */}
                      <For each={hunk.lines}>
                        {(line) => <DiffLine line={line} />}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Raw Diff */}
            <Show
              when={
                !state.isLoadingDiff &&
                !state.currentDiff?.hunks &&
                !!state.currentDiff?.diff.trim()
              }
            >
              <pre class="bg-muted rounded-lg p-2.5 text-xs overflow-x-auto whitespace-pre-wrap">
                {state.currentDiff?.diff}
              </pre>
            </Show>

            <Show
              when={
                !state.isLoadingDiff &&
                state.currentDiff &&
                !state.currentDiff.diff.trim()
              }
            >
              <div class="mt-2 rounded-lg border border-border p-2.5 text-xs text-foreground/60">
                No diff content available for this file.
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* Error Display */}
      <Show when={state.error}>
        <Alert variant="destructive" class="m-4">
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
    </div>
  );
};

export default GitDiffView;
