/**
 * Shiki Code Block Component
 * Syntax highlighting using Pierre theme
 */

import {
  type Component,
  createSignal,
  createMemo,
  Show,
  onMount,
  createEffect,
} from "solid-js";
import { cn } from "~/lib/utils";
import { FiCopy, FiCheck, FiMaximize2, FiMinimize2 } from "solid-icons/fi";
import { highlightCode, detectLanguage } from "~/lib/syntax-highlight";

interface ShikiCodeBlockProps {
  code: string;
  language?: string;
  class?: string;
  isInline?: boolean;
}

export const ShikiCodeBlock: Component<ShikiCodeBlockProps> = (props) => {
  const [copied, setCopied] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal<string>("");
  const [loading, setLoading] = createSignal(true);

  const detectedLang = createMemo(() => {
    if (props.language && props.language !== "plaintext") {
      return props.language;
    }
    return detectLanguage(props.code);
  });

  onMount(async () => {
    try {
      const result = await highlightCode(props.code, detectedLang());
      setHighlighted(result.html);
    } catch {
      // Fallback to plain text
      setHighlighted(`<pre><code>${escapeHtml(props.code)}</code></pre>`);
    } finally {
      setLoading(false);
    }
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLong = createMemo(() => {
    const lines = props.code.split("\n").length;
    return lines > 20;
  });

  return (
    <Show
      when={!props.isInline}
      fallback={
        <code
          class={cn(
            "px-1.5 py-0.5 rounded-md bg-muted/80 text-[13px] font-mono",
            props.class
          )}
          innerHTML={highlighted() || escapeHtml(props.code)}
        />
      }
    >
      <div
        class={cn(
          "relative min-w-0 w-full rounded-xl overflow-hidden border border-border/50",
          "bg-[#070707]", // Pierre dark background
          props.class
        )}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-2.5 bg-[#141415] border-b border-[#1a1a1a]">
          <div class="flex items-center gap-2">
            {/* Language badge */}
            <span class="px-2 py-0.5 rounded-md bg-[#009fff]/10 text-[11px] font-semibold text-[#66b3ff] border border-[#009fff]/20">
              {detectedLang()}
            </span>
            {/* Line count */}
            <span class="text-[11px] text-[#84848A]">
              {props.code.split("\n").length} lines
            </span>
          </div>

          <div class="flex items-center gap-1">
            {/* Expand/Collapse for long code */}
            <Show when={isLong()}>
              <button
                type="button"
                onClick={() => setExpanded(!expanded())}
                class="p-1.5 hover:bg-[#1a1a1a] rounded-lg transition-colors text-[#84848A] hover:text-[#fbfbfb]"
                title={expanded() ? "Collapse" : "Expand"}
              >
                <Show
                  when={expanded()}
                  fallback={<FiMaximize2 size={14} />}
                >
                  <FiMinimize2 size={14} />
                </Show>
              </button>
            </Show>

            {/* Copy button */}
            <button
              type="button"
              onClick={handleCopy}
              class="p-1.5 hover:bg-[#1a1a1a] rounded-lg transition-colors text-[#84848A] hover:text-[#fbfbfb]"
              title="Copy code"
            >
              <Show when={copied()} fallback={<FiCopy size={14} />}>
                <FiCheck size={14} class="text-[#00d68f]" />
              </Show>
            </button>
          </div>
        </div>

        {/* Code content */}
        <div
          class={cn(
            "overflow-x-auto transition-all",
            !expanded() && isLong() && "max-h-80"
          )}
        >
          <Show when={!loading()} fallback={<LoadingSkeleton />}>
            <div
              class="shiki-wrapper"
              innerHTML={highlighted() || escapeHtml(props.code)}
            />
          </Show>
        </div>

        {/* Fade overlay for collapsed long code */}
        <Show when={!expanded() && isLong()}>
          <div class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#070707] to-transparent pointer-events-none" />
        </Show>
      </div>
    </Show>
  );
};

const LoadingSkeleton: Component = () => (
  <div class="animate-pulse p-4 space-y-2">
    <div class="h-3 bg-[#1a1a1a] rounded w-3/4" />
    <div class="h-3 bg-[#1a1a1a] rounded w-1/2" />
    <div class="h-3 bg-[#1a1a1a] rounded w-5/6" />
    <div class="h-3 bg-[#1a1a1a] rounded w-2/3" />
  </div>
);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Inline code component for short code snippets
export const ShikiInlineCode: Component<{
  code: string;
  language?: string;
  class?: string;
}> = (props) => {
  const [highlighted, setHighlighted] = createSignal("");

  createEffect(async () => {
    if (props.code.length > 100) {
      // Don't highlight long inline code, use ShikiCodeBlock instead
      setHighlighted(escapeHtml(props.code));
      return;
    }

    try {
      const result = await highlightCode(props.code, props.language || "plaintext");
      // Extract inner HTML without the pre wrapper
      const innerHtml = result.html
        .replace(/^<pre[^>]*><code[^>]*>/, "")
        .replace(/<\/code><\/pre>$/, "");
      setHighlighted(innerHtml);
    } catch {
      setHighlighted(escapeHtml(props.code));
    }
  });

  return (
    <code
      class={cn(
        "px-1.5 py-0.5 rounded-md bg-[#1a1a1a] text-[13px] font-mono text-[#00d68f]",
        props.class
      )}
      innerHTML={highlighted() || escapeHtml(props.code)}
    />
  );
};

export default ShikiCodeBlock;
