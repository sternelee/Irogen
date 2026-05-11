import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  gitStatus,
  gitDiff,
  remoteGitStatus,
  remoteGitDiff,
} from "@/lib/tauri-api";
import { FileDiff, processFile } from "@pierre/diffs";
import { GitBranch, FileText, ChevronLeft } from "lucide-react";

interface GitStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  controlSessionId?: string;
}

interface ChangedFile {
  path: string;
  index: string;
  worktree: string;
  raw: string;
}

/** Parse `git status --porcelain` output into structured entries. */
function parsePorcelain(status: string): ChangedFile[] {
  const lines = status.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    const path = line.slice(3).trim();
    return { index, worktree, path, raw: line };
  });
}

function statusLabel(file: ChangedFile): string {
  const code = `${file.index}${file.worktree}`.trim();
  switch (code) {
    case "M":
    case "MM":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "??":
      return "untracked";
    case "U":
      return "unmerged";
    default:
      return code;
  }
}

function statusColor(file: ChangedFile): string {
  const code = `${file.index}${file.worktree}`.trim();
  if (code.includes("D")) return "text-red-400";
  if (code.includes("?")) return "text-yellow-400";
  if (code.includes("A")) return "text-green-400";
  return "text-blue-400";
}

export function GitStatusDialog({
  open,
  onOpenChange,
  projectPath,
  controlSessionId,
}: GitStatusDialogProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChangedFile | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const isRemote = Boolean(controlSessionId);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const fileDiffRef = useRef<FileDiff | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(null);
    setDiff(null);
    try {
      const result = isRemote
        ? await remoteGitStatus(controlSessionId!, projectPath)
        : await gitStatus(projectPath);
      if (result.success) {
        setStatus(result.status ?? "");
      } else {
        setError(result.error ?? "Failed to get git status");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectPath, isRemote, controlSessionId]);

  useEffect(() => {
    if (open) {
      void load();
    } else {
      // Reset selection when dialog closes so FileDiff container is cleared
      setSelected(null);
      setDiff(null);
    }
  }, [open, load]);

  const files = useMemo(() => parsePorcelain(status ?? ""), [status]);

  const loadDiff = useCallback(
    async (file: ChangedFile) => {
      setSelected(file);
      setDiff(null);
      setDiffError(null);
      setDiffLoading(true);
      try {
        const result = isRemote
          ? await remoteGitDiff(controlSessionId!, projectPath, file.path)
          : await gitDiff(projectPath, file.path);
        if (result.success) {
          setDiff(result.diff ?? "");
        } else {
          setDiffError(result.error ?? "Failed to load diff");
        }
      } catch (err) {
        setDiffError(err instanceof Error ? err.message : String(err));
      } finally {
        setDiffLoading(false);
      }
    },
    [isRemote, controlSessionId, projectPath],
  );

  // ── Pierre FileDiff lifecycle ───────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    fileDiffRef.current = new FileDiff({ theme: "pierre-dark" });

    return () => {
      fileDiffRef.current?.cleanUp();
      fileDiffRef.current = null;
    };
  }, [open]);

  // Render diff content into the FileDiff container
  useEffect(() => {
    if (!diff || !diffContainerRef.current || !fileDiffRef.current) return;

    const fileDiffMetadata = processFile(diff, { isGitDiff: true });
    if (fileDiffMetadata) {
      fileDiffRef.current.render({
        fileDiff: fileDiffMetadata,
        containerWrapper: diffContainerRef.current,
      });
    }
  }, [diff]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            {selected && (
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setDiff(null);
                }}
                className="p-1 rounded hover:bg-[var(--app-subtle-bg)] transition-colors"
                title="Back to file list"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            )}
            <GitBranch className="h-4 w-4" />
            {selected ? selected.path : "Git Status"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--app-hint)]">
              Loading…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-32 text-sm text-red-400">
              {error}
            </div>
          ) : selected ? (
            diffLoading ? (
              <div className="flex items-center justify-center h-32 text-sm text-[var(--app-hint)]">
                Loading diff…
              </div>
            ) : diffError ? (
              <div className="flex items-center justify-center h-32 text-sm text-red-400">
                {diffError}
              </div>
            ) : diff?.trim() ? (
              <div
                ref={diffContainerRef}
                className="rounded-lg overflow-hidden"
              />
            ) : (
              <div className="px-3 py-4 text-xs text-[var(--app-hint)]">
                No changes
              </div>
            )
          ) : files.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--app-hint)]">
              Clean working tree
            </div>
          ) : (
            <div className="space-y-0.5">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => void loadDiff(file)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm rounded-md hover:bg-[var(--app-subtle-bg)] transition-colors"
                >
                  <FileText className="h-4 w-4 text-[var(--app-hint)] shrink-0" />
                  <span className="font-mono truncate flex-1">{file.path}</span>
                  <span
                    className={`text-[10px] uppercase tracking-wider shrink-0 ${statusColor(
                      file,
                    )}`}
                  >
                    {statusLabel(file)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
