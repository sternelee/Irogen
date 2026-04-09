# UI Theme Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Irogen's color system to Superset's oklch-based CSS variables while preserving DaisyUI theme switching.

**Architecture:** Add Superset-style CSS variables via `@theme inline` in Tailwind v4, override DaisyUI theme colors with oklch values, standardize focus rings and border radius.

**Tech Stack:** TailwindCSS v4, DaisyUI 5, oklch color space

---

## Chunk 1: CSS Variables Definition

**Files:**

- Modify: `src/index.css`

### Task 1: Add Superset CSS Variables

- [ ] **Step 1: Read current index.css structure**

Read: `src/index.css` lines 1-20

- [ ] **Step 2: Add @theme inline block after @import "tailwindcss"**

Insert after line 1:

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
  --color-ring: oklch(0.205 0 0);

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

- [ ] **Step 3: Verify Tailwind v4 theme syntax works**

Run: `pnpm build 2>&1 | head -50`
Expected: No errors related to @theme inline

---

## Chunk 2: DaisyUI Theme Override

**Files:**

- Modify: `src/index.css`

### Task 2: Override Sunset Theme with oklch

- [ ] **Step 1: Find current sunset theme block**

Read: `src/index.css` lines 1-15 (daisyui theme config)

- [ ] **Step 2: Update daisyui plugin config with oklch colors**

Replace:

```css
@plugin "daisyui" {
  themes:
    light --default,
    sunset --default,
    dracula,
    synthwave,
    forest,
    luxury;
}
```

With:

```css
@plugin "daisyui" {
  themes:
    light --default,
    sunset --default,
    dracula,
    synthwave,
    forest,
    luxury;

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
  --color-info: oklch(0.54 0.18 245);
  --color-success: oklch(0.62 0.19 150);
  --color-warning: oklch(0.75 0.18 85);
  --color-error: oklch(0.577 0.245 27.325);
}
```

### Task 3: Override Dark Theme with oklch

- [ ] **Step 1: Add dark theme override after @layer base**

Insert in `@layer base`:

```css
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
  --color-info: oklch(0.7 0.15 245);
  --color-success: oklch(0.7 0.15 150);
  --color-warning: oklch(0.8 0.15 85);
  --color-error: oklch(0.65 0.2 27.325);
}
```

---

## Chunk 3: Focus Ring & Border Radius

**Files:**

- Modify: `src/index.css`

### Task 4: Standardize Focus Ring

- [ ] **Step 1: Add focus ring styles to @layer base**

Insert in `@layer base`:

```css
:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-base-100),
    0 0 0 4px var(--color-primary);
}
```

### Task 5: Add Border Radius Variables

- [ ] **Step 1: Add radius utilities to @layer utilities**

Insert in `@layer utilities`:

```css
.radius-sm {
  border-radius: var(--radius-sm);
}
.radius-md {
  border-radius: var(--radius-md);
}
.radius-lg {
  border-radius: var(--radius-lg);
}
.radius-xl {
  border-radius: var(--radius-xl);
}
```

---

## Chunk 4: Verification

**Files:**

- Modify: `src/index.css`

### Task 6: Test Theme Switching

- [ ] **Step 1: Run dev server and verify**

Run: `cd /Users/sternelee/www/github/Irogen && pnpm dev`
Expected: Dev server starts without CSS errors

- [ ] **Step 2: Test theme switcher functionality**

Manual: Click theme switcher, verify light/dark themes apply correctly

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: Build completes without errors

- [ ] **Step 4: Commit changes**

```bash
git add src/index.css
git commit -m "feat(ui): migrate to Superset oklch color system"
```

---

## Files Modified Summary

| File            | Action                                                                |
| --------------- | --------------------------------------------------------------------- |
| `src/index.css` | Modify - add CSS variables, override themes, standardize focus/radius |

## Testing Checklist

- [ ] Light theme (sunset) displays correctly
- [ ] Dark theme displays correctly
- [ ] Theme switching via ThemeSwitcher works
- [ ] Focus states visible on interactive elements
- [ ] Border radius consistent across components
- [ ] No regression in existing component styles
