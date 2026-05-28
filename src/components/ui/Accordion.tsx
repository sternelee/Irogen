/**
 * Accordion Component
 *
 * Collapsible sections with animations
 */

import { type Component, Show, createSignal, type JSX } from "solid-js";
import { cn } from "~/lib/utils";
import {
  FiChevronDown,
} from "solid-icons/fi";

// ============================================================================
// Types
// ============================================================================

export interface AccordionItem {
  id: string;
  title: string;
  content: JSX.Element;
  disabled?: boolean;
}

export interface AccordionProps {
  items: AccordionItem[];
  allowMultiple?: boolean;
  defaultOpen?: string[];
  class?: string;
}

// ============================================================================
// Accordion Component
// ============================================================================

export const Accordion: Component<AccordionProps> = (props) => {
  const [openItems, setOpenItems] = createSignal<Set<string>>(
    new Set(props.defaultOpen || [])
  );

  const toggleItem = (id: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!props.allowMultiple) {
          next.clear();
        }
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div class={cn("space-y-2", props.class)}>
      {props.items.map((item) => {
        const isOpen = () => openItems().has(item.id);

        return (
          <div class="rounded-xl border border-base-300 overflow-hidden">
            {/* Header */}
            <button
              type="button"
              onClick={() => !item.disabled && toggleItem(item.id)}
              disabled={item.disabled}
              class={cn(
                "w-full flex items-center justify-between px-4 py-3",
                "bg-base-200/30 hover:bg-base-200/50 transition-colors",
                "text-left text-sm font-medium",
                item.disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <span>{item.title}</span>
              <FiChevronDown
                size={16}
                class={cn(
                  "text-base-content/50 transition-transform duration-200",
                  isOpen() && "rotate-180"
                )}
              />
            </button>

            {/* Content */}
            <Show when={isOpen()}>
              <div class="px-4 py-3 border-t border-base-300 bg-base-100/50 animate-fade-in">
                {item.content}
              </div>
            </Show>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// Accordion Group (multiple accordions)
// ============================================================================

export interface AccordionGroupProps {
  children: JSX.Element;
  class?: string;
}

export const AccordionGroup: Component<AccordionGroupProps> = (props) => {
  return <div class={cn("space-y-4", props.class)}>{props.children}</div>;
};

// ============================================================================
// Collapsible Component
// ============================================================================

export interface CollapsibleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: JSX.Element;
  children: JSX.Element;
  class?: string;
}

export const Collapsible: Component<CollapsibleProps> = (props) => {
  return (
    <div class={cn("rounded-xl border border-base-300 overflow-hidden", props.class)}>
      {/* Header */}
      <button
        type="button"
        onClick={() => props.onOpenChange(!props.open)}
        class={cn(
          "w-full flex items-center justify-between px-4 py-3",
          "bg-base-200/30 hover:bg-base-200/50 transition-colors",
          "text-left"
        )}
      >
        {props.title}
        <FiChevronDown
          size={16}
          class={cn(
            "text-base-content/50 transition-transform duration-200",
            props.open && "rotate-180"
          )}
        />
      </button>

      {/* Content */}
      <Show when={props.open}>
        <div class="px-4 py-3 border-t border-base-300 bg-base-100/50 animate-fade-in">
          {props.children}
        </div>
      </Show>
    </div>
  );
};
