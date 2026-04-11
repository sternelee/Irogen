# ChatView Refactoring & Mobile Optimization Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Split the monolithic ChatView (2700+ lines) into modular components with responsive mobile-first design using Tailwind CSS media queries, improved empty states, and enhanced message display.

**Architecture:** 
- Split ChatView into focused components: ChatHeader, MessageListView, ChatInputView, PermissionPanel, UserQuestionPanel
- Use Tailwind responsive prefixes (sm:, md:, lg:) for adaptive layouts
- Enhance message cards with better syntax highlighting, tool call displays, and inline permission/question cards
- Improve Dashboard with better card layouts and mobile responsiveness

**Tech Stack:** SolidJS, TailwindCSS v4, DaisyUI, Kobalte, solid-markdown, virtua/solid (virtualization)

---

## Chunk 1: Component Extraction

### Task 1.1: Create ChatHeader Component

**Files:**
- Create: `src/components/chat/ChatHeader.tsx`

```tsx
// src/components/chat/ChatHeader.tsx
import { type Component, Show, createMemo } from "solid-js";
import { FiMenu, FiTerminal, FiSettings } from "solid-icons/fi";
import { sessionStore } from "../../stores/sessionStore";
import { navigationStore } from "../../stores/navigationStore";
import { Button } from "../ui/primitives";

interface ChatHeaderProps {
  onToggleSidebar: () => void;
  sessionId: string;
  agentType?: string;
  sessionMode?: "remote" | "local";
}

export const ChatHeader: Component<ChatHeaderProps> = (props) => {
  const session = createMemo(() => sessionStore.getSession(props.sessionId));
  
  return (
    <header class="compact-mobile-controls z-20 flex min-h-14 sm:min-h-16 shrink-0 items-center justify-between gap-2 sm:gap-4 border-b border-base-content/10 bg-base-100/80 px-3 sm:px-4 py-2 backdrop-blur-lg">
      {/* Left: Menu button (mobile) + Session info */}
      <div class="flex items-center gap-2 sm:gap-3 min-w-0">
        <label
          for="drawer"
          aria-label="Open menu"
          class="btn btn-square btn-ghost drawer-button lg:hidden shrink-0"
        >
          <FiMenu size={20} />
        </label>
        <Show when={props.agentType}>
          <div class="hidden sm:flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FiTerminal size={16} class="text-primary" />
            </div>
            <div class="min-w-0">
              <span class="font-mono text-xs font-medium block truncate">
                {props.agentType}
              </span>
              <span class="text-[10px] opacity-50">
                {props.sessionMode === "local" ? "Local" : "Remote"}
              </span>
            </div>
          </div>
        </Show>
      </div>

      {/* Right: Action buttons */}
      <div class="flex items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="icon"
          class="rounded-lg sm:rounded-xl"
          onClick={() => navigationStore.setActiveView("settings")}
        >
          <FiSettings size={18} />
        </Button>
      </div>
    </header>
  );
};
```

- [ ] **Step 1: Create ChatHeader.tsx with session info and navigation**
- [ ] **Step 2: Export from new index.ts**
- [ ] **Step 3: Test in ChatView**

---

### Task 1.2: Create MessageListView Component

**Files:**
- Create: `src/components/chat/MessageListView.tsx`

This component will wrap the virtualized message list with:
- Date separators
- Auto-scroll management
- Scroll-to-bottom button
- Empty state

```tsx
// src/components/chat/MessageListView.tsx
import { type Component, Show, For, createMemo, createSignal, onMount } from "solid-js";
import { Virtualizer } from "virtua/solid";
import { cn } from "~/lib/utils";
import type { ChatMessage } from "~/stores/chatStore";
import { MessageBubble } from "../ui/MessageBubble";
import { EmptyState } from "../ui/EnhancedMessageComponents";
import { FiMessageSquare } from "solid-icons/fi";

// ... implementation with date grouping, auto-scroll, scroll-to-bottom button
```

- [ ] **Step 1: Create MessageListView.tsx with virtualized scrolling**
- [ ] **Step 2: Add date separators and grouping**
- [ ] **Step 3: Implement scroll-to-bottom button**
- [ ] **Step 4: Add empty state component**

---

### Task 1.3: Create PermissionPanel Component

**Files:**
- Create: `src/components/chat/PermissionPanel.tsx`

Inline permission display within message flow.

```tsx
// src/components/chat/PermissionPanel.tsx
import { type Component, For, Show, createMemo } from "solid-js";
import { PermissionMessage } from "../ui/PermissionCard";
import type { PermissionRequest } from "~/stores/chatStore";

interface PermissionPanelProps {
  permissions: PermissionRequest[];
  permissionMode: "AlwaysAsk" | "AcceptEdits" | "Plan" | "AutoApprove";
  disabled?: boolean;
  onApprove: (requestId: string, decision?: string) => void;
  onDeny: (requestId: string) => void;
}
```

- [ ] **Step 1: Create PermissionPanel with inline permission cards**
- [ ] **Step 2: Add responsive styling**
- [ ] **Step 3: Integrate with ChatView**

---

### Task 1.4: Create UserQuestionPanel Component

**Files:**
- Create: `src/components/chat/UserQuestionPanel.tsx`

```tsx
// src/components/chat/UserQuestionPanel.tsx
import { type Component, Show, For, createMemo } from "solid-js";
import { UserQuestionMessage } from "../ui/PermissionCard";
import type { UserQuestion } from "~/stores/chatStore";

interface UserQuestionPanelProps {
  questions: UserQuestion[];
  disabled?: boolean;
  onSelect: (questionId: string, option: string) => void;
}
```

- [ ] **Step 1: Create UserQuestionPanel with inline question display**
- [ ] **Step 2: Add responsive styling**
- [ ] **Step 3: Integrate with ChatView**

---

### Task 1.5: Create ChatInputView Component (Wrapper)

**Files:**
- Create: `src/components/chat/ChatInputView.tsx`

This is a thin wrapper that passes callbacks from ChatView to ChatInput.

```tsx
// src/components/chat/ChatInputView.tsx
import { type Component, Show } from "solid-js";
import { ChatInput } from "../ui/ChatInput";

interface ChatInputViewProps {
  // All ChatInput props passed through
  value: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  // ... rest of ChatInput props
}
```

- [ ] **Step 1: Create ChatInputView wrapper**
- [ ] **Step 2: Add responsive container styling**
- [ ] **Step 3: Integrate with ChatView**

---

### Task 1.6: Create ChatView Index

**Files:**
- Create: `src/components/chat/index.ts`

```ts
export { ChatHeader } from "./ChatHeader";
export { MessageListView } from "./MessageListView";
export { PermissionPanel } from "./PermissionPanel";
export { UserQuestionPanel } from "./UserQuestionPanel";
export { ChatInputView } from "./ChatInputView";
```

- [ ] **Step 1: Create index.ts exports**
- [ ] **Step 2: Verify all components export correctly**

---

## Chunk 2: Message Display Optimization

### Task 2.1: Enhance CodeBlock with Syntax Highlighting

**Files:**
- Modify: `src/components/ui/MessageBubble.tsx`

Add Prism.js or highlight.js for syntax highlighting in code blocks.

- [ ] **Step 1: Add syntax highlighting library (prism-react-renderer or highlight.js)**
- [ ] **Step 2: Update CodeBlockWithCopy component**
- [ ] **Step 3: Add language-specific styling**

---

### Task 2.2: Improve ToolCall Display

**Files:**
- Modify: `src/components/ui/EnhancedMessageComponents.tsx`

Enhance ToolCallItem with:
- Better progress indication
- Streaming output
- Expandable JSON viewer

- [ ] **Step 1: Add progress bar for in_progress status**
- [ ] **Step 2: Add streaming output animation**
- [ ] **Step 3: Add JSON tree viewer for structured output**

---

### Task 2.3: Enhance PermissionCard Mobile Display

**Files:**
- Modify: `src/components/ui/PermissionCard.tsx`

Improve mobile layout:
- Full-width buttons
- Better touch targets
- Bottom sheet on mobile

- [ ] **Step 1: Update PermissionMessage layout for mobile**
- [ ] **Step 2: Add bottom sheet modal for mobile**
- [ ] **Step 3: Improve touch target sizes (min 44px)**

---

## Chunk 3: Empty States

### Task 3.1: Create ChatEmptyState Component

**Files:**
- Create: `src/components/chat/ChatEmptyState.tsx`

```tsx
export const ChatEmptyState: Component<{
  agentType?: string;
  onStartChat?: () => void;
}> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center min-h-[400px] sm:min-h-[500px] px-6 text-center">
      {/* Animated icon */}
      <div class="relative mb-6">
        <div class="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
          <FiMessageSquare size={36} class="text-primary" />
        </div>
        {/* Decorative rings */}
        <div class="absolute inset-0 rounded-2xl border-2 border-primary/20 scale-110 animate-ping" />
      </div>
      
      <h3 class="text-lg sm:text-xl font-bold mb-2">
        Start a conversation
      </h3>
      <p class="text-sm text-base-content/60 max-w-sm mb-6">
        Send a message to begin chatting with {props.agentType || 'your AI agent'}
      </p>
      
      {/* Quick suggestions */}
      <div class="flex flex-wrap gap-2 justify-center">
        {/* ... quick action buttons */}
      </div>
    </div>
  );
};
```

- [ ] **Step 1: Create ChatEmptyState with animations**
- [ ] **Step 2: Add quick suggestion buttons**
- [ ] **Step 3: Integrate into MessageListView**

---

### Task 3.2: Improve Dashboard Empty States

**Files:**
- Modify: `src/components/Dashboard.tsx`

Enhance DashboardEmptyState with:
- Better icons
- Action buttons
- Contextual help

- [ ] **Step 1: Enhance DashboardEmptyState styling**
- [ ] **Step 2: Add "Add Host" button to empty topology**
- [ ] **Step 3: Add "Connect" button to empty hosts**

---

## Chunk 4: Responsive Design

### Task 4.1: Add Responsive Breakpoints to ChatView

**Files:**
- Modify: `src/components/AppLayout.tsx`

Use Tailwind responsive prefixes:
- `sm:` (640px+) - Small tablets
- `md:` (768px+) - Tablets
- `lg:` (1024px+) - Desktop

- [ ] **Step 1: Review ChatView layout with responsive classes**
- [ ] **Step 2: Add sm:/md:/lg: variants for spacing**
- [ ] **Step 3: Test on different viewport sizes**

---

### Task 4.2: Improve Mobile Panel Behavior

**Files:**
- Modify: `src/components/AppLayout.tsx`

Change right panel (File Browser/Git) on mobile:
- Bottom sheet instead of side panel
- Full-screen option
- Swipe to dismiss

- [ ] **Step 1: Add bottom sheet styling for mobile**
- [ ] **Step 2: Add swipe gesture support**
- [ ] **Step 3: Update panel transition animations**

---

### Task 4.3: Dashboard Responsive Cards

**Files:**
- Modify: `src/components/Dashboard.tsx`

Improve card layouts:
- Grid to stack on mobile
- Full-width cards
- Better touch targets

- [ ] **Step 1: Change topology list to stacked cards on mobile**
- [ ] **Step 2: Improve HostCard touch targets**
- [ ] **Step 3: Add pull-to-refresh gesture**

---

## Chunk 5: Dashboard Display Effects

### Task 5.1: Add Dashboard Animations

**Files:**
- Modify: `src/components/Dashboard.tsx`

Add:
- Staggered card entrance animations
- Hover effects with subtle scaling
- Status indicator animations

- [ ] **Step 1: Add CSS animations for card entrance**
- [ ] **Step 2: Add hover lift effect to cards**
- [ ] **Step 3: Add animated status indicators**

---

### Task 5.2: Improve Host Card Design

**Files:**
- Modify: `src/components/Dashboard.tsx`

Enhance HostCard:
- Better visual hierarchy
- Status badges with glow effects
- Quick action buttons

- [ ] **Step 1: Redesign HostCard header layout**
- [ ] **Step 2: Add animated status badges**
- [ ] **Step 3: Improve session list styling**

---

## Verification

- [ ] Run `lsp_diagnostics` on all modified files
- [ ] Run `pnpm tsc` to check TypeScript
- [ ] Test responsive breakpoints in browser devtools
- [ ] Verify mobile touch interactions work correctly
