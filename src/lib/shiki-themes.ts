/**
 * Pierre Theme for Shiki
 * Beautiful, fast syntax highlighting based on Pierre by mdo
 * https://github.com/pierrecomputer/theme
 */

import type { ShikiTheme } from "shiki";

export const pierreLight: ShikiTheme = {
  name: "pierre-light",
  type: "light",
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#070707",
    "editor.lineHighlightBackground": "#f5f5f5",
    "editor.selectionBackground": "#009fff33",
    "editorCursor.foreground": "#009fff",
    "editorLineNumber.foreground": "#84848A",
    "editorLineNumber.activeForeground": "#6C6C71",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#84848A", fontStyle: "italic" },
    },
    {
      scope: ["string", "string.quoted"],
      settings: { foreground: "#00a152" },
    },
    {
      scope: ["constant.numeric", "constant.language"],
      settings: { foreground: "#9558e5" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier"],
      settings: { foreground: "#d91e18" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#0072bd" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.class"],
      settings: { foreground: "#d91e18" },
    },
    {
      scope: ["variable", "variable.other"],
      settings: { foreground: "#070707" },
    },
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#d91e18" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#00a152" },
    },
    {
      scope: ["punctuation", "meta.brace"],
      settings: { foreground: "#84848A" },
    },
    {
      scope: ["constant.other.symbol"],
      settings: { foreground: "#9558e5" },
    },
    {
      scope: ["entity.other.inherited-class"],
      settings: { foreground: "#d91e18" },
    },
    {
      scope: ["meta.function-call"],
      settings: { foreground: "#0072bd" },
    },
    {
      scope: ["support.type.property-name"],
      settings: { foreground: "#00a152" },
    },
    {
      scope: ["variable.parameter"],
      settings: { foreground: "#9558e5" },
    },
    {
      scope: ["storage.type.annotation", "meta.annotation"],
      settings: { foreground: "#84848A" },
    },
    {
      scope: ["keyword.operator"],
      settings: { foreground: "#84848A" },
    },
  ],
};

export const pierreDark: ShikiTheme = {
  name: "pierre-dark",
  type: "dark",
  colors: {
    "editor.background": "#070707",
    "editor.foreground": "#fbfbfb",
    "editor.lineHighlightBackground": "#1a1a1a",
    "editor.selectionBackground": "#009fff33",
    "editorCursor.foreground": "#009fff",
    "editorLineNumber.foreground": "#84848A",
    "editorLineNumber.activeForeground": "#adadb1",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#84848A", fontStyle: "italic" },
    },
    {
      scope: ["string", "string.quoted"],
      settings: { foreground: "#00d68f" },
    },
    {
      scope: ["constant.numeric", "constant.language"],
      settings: { foreground: "#c39aff" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier"],
      settings: { foreground: "#ff8080" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#66b3ff" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.class"],
      settings: { foreground: "#ff8080" },
    },
    {
      scope: ["variable", "variable.other"],
      settings: { foreground: "#fbfbfb" },
    },
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#ff8080" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#00d68f" },
    },
    {
      scope: ["punctuation", "meta.brace"],
      settings: { foreground: "#84848A" },
    },
    {
      scope: ["constant.other.symbol"],
      settings: { foreground: "#c39aff" },
    },
    {
      scope: ["entity.other.inherited-class"],
      settings: { foreground: "#ff8080" },
    },
    {
      scope: ["meta.function-call"],
      settings: { foreground: "#66b3ff" },
    },
    {
      scope: ["support.type.property-name"],
      settings: { foreground: "#00d68f" },
    },
    {
      scope: ["variable.parameter"],
      settings: { foreground: "#c39aff" },
    },
    {
      scope: ["storage.type.annotation", "meta.annotation"],
      settings: { foreground: "#84848A" },
    },
    {
      scope: ["keyword.operator"],
      settings: { foreground: "#84848A" },
    },
  ],
};

// Re-export themes for easy import
export const themes = {
  light: pierreLight,
  dark: pierreDark,
};
