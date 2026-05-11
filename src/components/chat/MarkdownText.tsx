import { useMemo } from "react";

interface MarkdownTextProps {
  content: string;
  className?: string;
}

/**
 * Lightweight markdown renderer for assistant text.
 * Handles headers, bold, italic, inline code, code blocks, lists, links.
 */
export function MarkdownText({ content, className = "" }: MarkdownTextProps) {
  const elements = useMemo(() => {
    const lines = content.split("\n");
    const result: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code block
      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        let code = "";
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          code += lines[i] + "\n";
          i++;
        }
        i++; // skip closing ```
        result.push(
          <pre
            key={`cb-${i}`}
            className="my-2 rounded-lg bg-black/70 border border-[var(--app-border)]/30 px-4 py-3 overflow-x-auto"
          >
            {lang && (
              <div className="text-[10px] uppercase tracking-wider text-[var(--app-hint)] mb-1.5">
                {lang}
              </div>
            )}
            <code className="text-sm font-mono text-green-400 whitespace-pre">
              {code}
            </code>
          </pre>
        );
        continue;
      }

      // Horizontal rule
      if (/^---+$|^\*\*\*+$|^___+$/.test(line.trim())) {
        result.push(
          <hr
            key={`hr-${i}`}
            className="my-3 border-[var(--app-border)]/50"
          />
        );
        i++;
        continue;
      }

      // Header
      const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const text = headerMatch[2];
        const Tag = `h${level}` as `h${1 | 2 | 3 | 4 | 5 | 6}`;
        result.push(
          <Tag
            key={`h-${i}`}
            className={`font-semibold text-[var(--app-fg)] mt-3 mb-1 ${
              level === 1
                ? "text-lg"
                : level === 2
                ? "text-base"
                : "text-sm"
            }`}
          >
            {renderInline(text)}
          </Tag>
        );
        i++;
        continue;
      }

      // Unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
          i++;
        }
        result.push(
          <ul key={`ul-${i}`} className="my-1.5 ml-4 list-disc space-y-0.5">
            {items.map((item, idx) => (
              <li key={idx} className="text-sm text-[var(--app-fg)]">
                {renderInline(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
          i++;
        }
        result.push(
          <ol
            key={`ol-${i}`}
            className="my-1.5 ml-4 list-decimal space-y-0.5"
          >
            {items.map((item, idx) => (
              <li key={idx} className="text-sm text-[var(--app-fg)]">
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Blockquote
      if (line.startsWith("> ")) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].startsWith("> ")) {
          quoteLines.push(lines[i].slice(2));
          i++;
        }
        result.push(
          <blockquote
            key={`bq-${i}`}
            className="my-2 border-l-2 border-[var(--app-link)]/40 pl-3 text-sm text-[var(--app-hint)] italic"
          >
            {quoteLines.join(" ")}
          </blockquote>
        );
        continue;
      }

      // Empty line
      if (line.trim() === "") {
        result.push(
          <div key={`br-${i}`} className="h-1" />
        );
        i++;
        continue;
      }

      // Normal paragraph with inline formatting
      result.push(
        <p key={`p-${i}`} className="text-sm leading-relaxed text-[var(--app-fg)]">
          {renderInline(line)}
        </p>
      );
      i++;
    }

    return result;
  }, [content]);

  return <div className={className}>{elements}</div>;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex =
    /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1] && match[2]) {
      // ***bold italic***
      parts.push(
        <strong key={`bi-${match.index}`} className="italic">
          {match[2]}
        </strong>
      );
    } else if (match[1] && match[3]) {
      // **bold**
      parts.push(
        <strong key={`b-${match.index}`}>{match[3]}</strong>
      );
    } else if (match[1] && match[4]) {
      // *italic*
      parts.push(
        <em key={`i-${match.index}`}>{match[4]}</em>
      );
    } else if (match[1] && match[5]) {
      // `code`
      parts.push(
        <code
          key={`c-${match.index}`}
          className="rounded bg-[var(--app-subtle-bg)] px-1 py-0.5 text-xs font-mono text-[var(--app-link)]"
        >
          {match[5]}
        </code>
      );
    } else if (match[1] && match[6] && match[7]) {
      // [text](url)
      parts.push(
        <a
          key={`a-${match.index}`}
          href={match[7]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--app-link)] hover:underline"
        >
          {match[6]}
        </a>
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
