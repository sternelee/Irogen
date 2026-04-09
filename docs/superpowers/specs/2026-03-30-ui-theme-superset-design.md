# UI Theme Refactor Design - Superset Style

**Date**: 2026-03-30
**Status**: Approved
**Type**: Frontend Refactor

## Overview

Migrate Irogen's color system to Superset's oklch-based CSS variable theme while preserving the DaisyUI theme switching mechanism.

## Goals

- Adopt Superset's modern `oklch()` color space for perceptually uniform colors
- Preserve DaisyUI's `[data-theme]` attribute-based theme switching
- Align visual style with Superset's design language
- Maintain dark mode support via existing theme system

## Design Changes

### 1. Color System (`src/index.css`)

Add Superset-style CSS variables using `@theme inline`:

```css
@theme inline {
  /* Superset Light Theme Colors */
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.205 0 0);
  --color-secondary: oklch(0.97 0 0);
  --color-muted: oklch(0.97 0 0);
  --color-accent: oklch(0.97 0 0);
  --color-destructive: oklch(0.577 0.245 27.325);
  --color-border: oklch(0.922 0 0);

  /* Superset Dark Theme Colors */
  --color-background-dark: oklch(0.178 0 0);
  --color-foreground-dark: oklch(0.922 0 0);
  --color-primary-dark: oklch(0.922 0 0);
  --color-sidebar-dark: oklch(0.205 0 0);

  /* Radius variables */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}
```

### 2. DaisyUI Theme Override

Override DaisyUI theme colors using oklch values:

```css
/* Sunset theme override with oklch */
[data-theme="sunset"] {
  --color-base-100: oklch(1 0 0);
  --color-base-200: oklch(0.98 0 0);
  --color-base-300: oklch(0.95 0 0);
  --color-base-content: oklch(0.145 0 0);
  --color-primary: oklch(0.205 0 0);
  --color-secondary: oklch(0.97 0 0);
  --color-accent: oklch(0.97 0 0);
  --color-neutral: oklch(0.22 0 0);
  --color-neutral-content: oklch(0.98 0 0);
  --color-border: oklch(0.922 0 0);
}

/* Dark theme override with oklch */
[data-theme="dark"] {
  --color-base-100: oklch(0.178 0 0);
  --color-base-200: oklch(0.205 0 0);
  --color-base-300: oklch(0.25 0 0);
  --color-base-content: oklch(0.922 0 0);
  --color-primary: oklch(0.922 0 0);
  --color-secondary: oklch(0.25 0 0);
  --color-accent: oklch(0.35 0 0);
  --color-neutral: oklch(0.15 0 0);
  --color-neutral-content: oklch(0.92 0 0);
  --color-border: oklch(0.28 0 0);
}
```

### 3. Focus Ring Standardization

Unify focus states using Superset pattern:

```css
:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-background),
    0 0 0 4px var(--color-primary);
}
```

### 4. Border Radius Consistency

Use Superset radius variables:

```css
.card {
  border-radius: var(--radius-lg);
}
.btn {
  border-radius: var(--radius-md);
}
.input {
  border-radius: var(--radius-md);
}
.modal {
  border-radius: var(--radius-xl);
}
```

## Implementation Plan

1. **Update `src/index.css`**: Add `@theme inline` block with Superset CSS variables
2. **Override DaisyUI themes**: Replace hex colors with oklch equivalents in theme blocks
3. **Standardize border-radius**: Apply radius variables consistently
4. **Update focus styles**: Apply Superset focus ring pattern
5. **Verify theme switching**: Confirm light/dark themes work correctly

## Files to Modify

- `src/index.css` - Main stylesheet with theme variables

## Testing Checklist

- [ ] Light theme (sunset) displays correctly
- [ ] Dark theme displays correctly
- [ ] Theme switching via ThemeSwitcher works
- [ ] Focus states visible on interactive elements
- [ ] Border radius consistent across components
- [ ] No regression in existing component styles
