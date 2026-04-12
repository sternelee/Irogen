/**
 * Shiki Syntax Highlighter Utility
 * Uses Pierre theme for beautiful code highlighting
 */

import { createHighlighter, type Highlighter } from "shiki";
import { pierreLight, pierreDark } from "./shiki-themes";

let highlighterPromise: Promise<Highlighter> | null = null;

export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [pierreLight, pierreDark],
      langs: [
        "javascript",
        "typescript",
        "tsx",
        "jsx",
        "python",
        "rust",
        "go",
        "java",
        "c",
        "cpp",
        "csharp",
        "html",
        "css",
        "json",
        "yaml",
        "markdown",
        "bash",
        "shell",
        "sql",
        "dockerfile",
        "toml",
        "xml",
        "swift",
        "kotlin",
        "ruby",
        "php",
        "scala",
        "haskell",
        "lua",
        "perl",
        "r",
        "vim",
        "makefile",
        "cmake",
        "terraform",
        "graphql",
        "prisma",
        "svelte",
        "vue",
        "solid",
        "markdown",
      ],
    });
  }
  return highlighterPromise;
}

export interface HighlightResult {
  html: string;
  lang: string;
}

export async function highlightCode(
  code: string,
  lang: string = "plaintext"
): Promise<HighlightResult> {
  try {
    const highlighter = await getHighlighter();
    const validLang = highlighter.getLoadedLanguages().includes(lang as any) ? lang : "plaintext";

    const html = highlighter.codeToHtml(code, {
      lang: validLang,
      theme: "pierre-dark",
    });

    return { html, lang: validLang };
  } catch {
    // Fallback to plain text
    return {
      html: `<pre class="shiki-inline"><code>${escapeHtml(code)}</code></pre>`,
      lang: "plaintext",
    };
  }
}

export async function highlightCodeMultiline(
  code: string,
  lang: string = "plaintext"
): Promise<string> {
  try {
    const highlighter = await getHighlighter();
    const validLang = highlighter.getLoadedLanguages().includes(lang as any) ? lang : "plaintext";

    const html = highlighter.codeToHtml(code, {
      lang: validLang,
      theme: "pierre-dark",
    });

    return html;
  } catch {
    return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Simple language detection based on content patterns
export function detectLanguage(code: string): string {
  if (code.includes("function") && code.includes("=>")) return "javascript";
  if (code.includes("def ") && code.includes(":")) return "python";
  if (code.includes("fn ") && code.includes("->")) return "rust";
  if (code.includes("package ") && code.includes("func ")) return "go";
  if (code.includes("<template>") || code.includes("</template>")) return "vue";
  if (code.includes("import React") || code.includes("from 'react'")) return "tsx";
  if (code.includes("interface ") && code.includes(": ")) return "typescript";
  if (code.startsWith("{") || code.startsWith("[")) return "json";
  if (code.includes("---") || code.includes(": ")) return "yaml";
  if (code.includes("#!/bin/bash") || code.includes("#!/bin/sh")) return "bash";
  if (code.includes("SELECT ") || code.includes("FROM ")) return "sql";
  return "plaintext";
}
