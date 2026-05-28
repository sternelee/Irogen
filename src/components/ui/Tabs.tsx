/**
 * Tabs Component
 *
 * Tab navigation with animations
 */

import { type Component, Show, For, createSignal, type JSX } from "solid-js";
import { cn } from "~/lib/utils";

// ============================================================================
// Types
// ============================================================================

type IconComponent = Component<{ size?: number; class?: string }>;

export interface Tab {
  id: string;
  label: string;
  icon?: IconComponent;
  content: JSX.Element;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  onChange?: (tabId: string) => void;
  class?: string;
}

export interface TabListProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  class?: string;
}

// ============================================================================
// Tabs Component
// ============================================================================

export const Tabs: Component<TabsProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal(props.defaultTab || props.tabs[0]?.id);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    props.onChange?.(tabId);
  };

  const activeContent = () => {
    const tab = props.tabs.find((t) => t.id === activeTab());
    return tab?.content;
  };

  return (
    <div class={cn("w-full", props.class)}>
      <TabList
        tabs={props.tabs}
        activeTab={activeTab()}
        onChange={handleTabChange}
      />
      <div class="mt-4">
        {activeContent()}
      </div>
    </div>
  );
};

// ============================================================================
// Tab List Component
// ============================================================================

export const TabList: Component<TabListProps> = (props) => {
  return (
    <div
      class={cn(
        "flex items-center gap-1 p-1 bg-base-200/50 rounded-xl",
        "overflow-x-auto",
        props.class
      )}
    >
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => props.activeTab === tab.id;

          return (
            <button
              type="button"
              onClick={() => !tab.disabled && props.onChange(tab.id)}
              disabled={tab.disabled}
              class={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "text-sm font-medium transition-all duration-200",
                "whitespace-nowrap",
                isActive()
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/50 hover:text-base-content",
                tab.disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <Show when={tab.icon}>
                {tab.icon!({ size: 16 })}
              </Show>
              {tab.label}
            </button>
          );
        }}
      </For>
    </div>
  );
};

// ============================================================================
// Tab Panel Component
// ============================================================================

export interface TabPanelProps {
  children: JSX.Element;
  tabId: string;
  activeTab: string;
  class?: string;
}

export const TabPanel: Component<TabPanelProps> = (props) => {
  return (
    <Show when={props.tabId === props.activeTab}>
      <div class={cn("animate-fade-in", props.class)}>
        {props.children}
      </div>
    </Show>
  );
};

// ============================================================================
// Pill Tabs (alternative style)
// ============================================================================

export interface PillTabsProps {
  tabs: { id: string; label: string; count?: number }[];
  activeTab: string;
  onChange: (tabId: string) => void;
  class?: string;
}

export const PillTabs: Component<PillTabsProps> = (props) => {
  return (
    <div class={cn("flex flex-wrap gap-2", props.class)}>
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => props.activeTab === tab.id;

          return (
            <button
              type="button"
              onClick={() => props.onChange(tab.id)}
              class={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full",
                "text-sm font-medium transition-all duration-200",
                isActive()
                  ? "bg-primary text-primary-foreground"
                  : "bg-base-200 text-base-content/50 hover:bg-base-200/80"
              )}
            >
              {tab.label}
              <Show when={tab.count !== undefined}>
                <span
                  class={cn(
                    "px-1.5 py-0.5 text-xs rounded-full",
                    isActive()
                      ? "bg-primary-foreground/20"
                      : "bg-base-200-foreground/20"
                  )}
                >
                  {tab.count}
                </span>
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
};
