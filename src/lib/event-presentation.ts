import type { SystemEventMessage } from "@/types/api";

export type EventPresentation = {
  icon: string | null;
  text: string;
};

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

/**
 * Convert a system event message into a human-readable { icon, text } presentation.
 * Inspired by hapi's getEventPresentation.
 */
export function getEventPresentation(event: SystemEventMessage): EventPresentation {
  const { level, title, content } = event;

  // API error
  if (level === "error" && content.toLowerCase().includes("api")) {
    return { icon: "⚠️", text: content };
  }

  // Title changed
  if (title?.toLowerCase().includes("title")) {
    return {
      icon: null,
      text: content ? `Title changed to "${content}"` : "Title changed",
    };
  }

  // Permission mode changed
  if (title?.toLowerCase().includes("permission")) {
    return { icon: "🔐", text: content };
  }

  // Turn duration
  if (title?.toLowerCase().includes("turn") || title?.toLowerCase().includes("duration")) {
    const ms = parseInt(content, 10);
    if (!Number.isNaN(ms)) {
      return { icon: "⏱️", text: `Turn: ${formatDuration(ms)}` };
    }
  }

  // Context compacted
  if (content.toLowerCase().includes("compact")) {
    const match = content.match(/saved\s+(\d+)\s+tokens/i);
    if (match) {
      const saved = parseInt(match[1]!, 10);
      const formatted = saved >= 1000 ? `${Math.round(saved / 1000)}K` : String(saved);
      return { icon: "📦", text: `Context compacted (saved ${formatted} tokens)` };
    }
    return { icon: "📦", text: "Conversation compacted" };
  }

  // Token count / usage
  if (title?.toLowerCase().includes("token") || title?.toLowerCase().includes("usage")) {
    try {
      const data = JSON.parse(content) as Record<string, unknown>;
      const inputTokens =
        (typeof data.inputTokens === "number" ? data.inputTokens : null) ??
        (typeof data.input_tokens === "number" ? data.input_tokens : null);
      const outputTokens =
        (typeof data.outputTokens === "number" ? data.outputTokens : null) ??
        (typeof data.output_tokens === "number" ? data.output_tokens : null);
      const cachedTokens =
        (typeof data.cachedTokens === "number" ? data.cachedTokens : null) ??
        (typeof data.cache_read_input_tokens === "number" ? data.cache_read_input_tokens : null);
      const contextWindow =
        (typeof data.modelContextWindow === "number" ? data.modelContextWindow : null) ??
        (typeof data.model_context_window === "number" ? data.model_context_window : null);

      const parts: string[] = [];
      if (inputTokens !== null && contextWindow !== null) {
        const pct = Math.round((inputTokens / contextWindow) * 100);
        parts.push(
          `Context ${formatTokenCount(inputTokens)} / ${formatTokenCount(contextWindow)} (${pct}%)`
        );
      } else if (inputTokens !== null) {
        parts.push(`Context ${formatTokenCount(inputTokens)}`);
      }
      if (outputTokens !== null) parts.push(`out ${formatTokenCount(outputTokens)}`);
      if (cachedTokens !== null && cachedTokens > 0)
        parts.push(`cached ${formatTokenCount(cachedTokens)}`);

      return {
        icon: "◷",
        text: parts.length > 0 ? parts.join(" · ") : "Context updated",
      };
    } catch {
      // fall through to default
    }
  }

  // Notification with explicit title
  if (title) {
    return { icon: null, text: `${title}: ${content}` };
  }

  // Default: just show the content
  return { icon: null, text: content };
}
