/**
 * Dropdown Menu Component
 *
 * Accessible dropdown menu with animations
 */

import {
  type Component,
  Show,
  For,
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "~/lib/utils";
import { FiChevronDown, FiCheck } from "solid-icons/fi";

// ============================================================================
// Types
// ============================================================================

export interface DropdownOption {
  id: string;
  label: string;
  description?: string;
  icon?: Component<{ size?: number; class?: string }>;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

export interface DropdownProps {
  options: DropdownOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  class?: string;
  trigger?: JSX.Element;
  compact?: boolean;
}

// ============================================================================
// Dropdown Component
// ============================================================================

export const Dropdown: Component<DropdownProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [fixedMenuStyle, setFixedMenuStyle] = createSignal<
    Record<string, string>
  >({});
  let containerRef: HTMLDivElement | undefined;
  let triggerRef: HTMLDivElement | undefined;
  const hasCustomTrigger = () => !!props.trigger;

  // Get selected option
  const selectedOption = () =>
    props.options.find((opt) => opt.id === props.value);

  // Close on click outside
  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    onCleanup(() => document.removeEventListener("click", handleClickOutside));
  });

  const handleSelect = (option: DropdownOption) => {
    if (option.disabled || option.divider) return;
    props.onChange(option.id);
    setIsOpen(false);
  };

  const updateFixedMenuPosition = () => {
    if (!hasCustomTrigger() || !triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    setFixedMenuStyle({
      top: `${rect.bottom + 6}px`,
      right: `${Math.max(window.innerWidth - rect.right, 8)}px`,
      left: "auto",
    });
  };

  createEffect(() => {
    if (isOpen() && hasCustomTrigger()) {
      updateFixedMenuPosition();
    }
  });

  onMount(() => {
    const handleViewportChange = () => {
      if (isOpen() && hasCustomTrigger()) {
        updateFixedMenuPosition();
      }
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    onCleanup(() => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    });
  });

  return (
    <div ref={containerRef} class={cn("relative", props.class)}>
      {/* Trigger */}
      <Show
        when={hasCustomTrigger()}
        fallback={
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen())}
            class={cn(
              "flex items-center justify-between gap-2",
              "bg-background border border-border rounded-lg",
              "hover:border-muted-foreground/30 transition-colors",
              "px-3 py-2 text-sm min-w-[120px]",
            )}
          >
            <Show
              when={selectedOption()}
              fallback={
                <span class="text-muted-foreground">
                  {props.placeholder || "Select..."}
                </span>
              }
            >
              <span>{selectedOption()!.label}</span>
            </Show>
            <FiChevronDown
              size={14}
              class={cn(
                "text-muted-foreground transition-transform",
                isOpen() && "rotate-180",
              )}
            />
          </button>
        }
      >
        <div
          ref={triggerRef}
          class="inline-flex"
          onClick={() => setIsOpen(!isOpen())}
        >
          {props.trigger}
        </div>
      </Show>

      {/* Dropdown Menu */}
      <Show when={isOpen() && !hasCustomTrigger()}>
        <div
          class={cn(
            "absolute z-50 mt-1 min-w-[180px] w-full",
            "bg-base-100 border border-border rounded-xl shadow-xl",
            "animate-fade-in origin-top-right overflow-hidden",
          )}
        >
          <div class="p-1 max-h-[300px] overflow-y-auto">
            <For each={props.options}>
              {(option) => (
                <Show
                  when={!option.divider}
                  fallback={<div class="h-px bg-border my-1" />}
                >
                  <button
                    type="button"
                    onClick={() => handleSelect(option)}
                    disabled={option.disabled}
                    class={cn(
                      "w-full flex items-center rounded-lg text-left transition-colors",
                      props.compact
                        ? "gap-1 px-2 py-0 text-xs h-8"
                        : "gap-2 px-3 py-2 text-sm",
                      option.disabled && "opacity-50 cursor-not-allowed",
                      !option.disabled && "hover:bg-muted",
                      option.danger && "text-error hover:bg-error/10",
                    )}
                  >
                    <Show when={option.icon}>
                      <div class="text-muted-foreground shrink-0">
                        {option.icon!({ size: 16 })}
                      </div>
                    </Show>
                    <div class="flex-1 min-w-0">
                      <div class={cn(option.danger && "text-error")}>
                        {option.label}
                      </div>
                      <Show when={option.description}>
                        <div
                          class={cn(
                            "text-muted-foreground truncate",
                            props.compact ? "text-[10px]" : "text-xs",
                          )}
                        >
                          {option.description}
                        </div>
                      </Show>
                    </div>
                    <Show when={option.id === props.value}>
                      <FiCheck size={14} class="text-primary shrink-0" />
                    </Show>
                  </button>
                </Show>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={isOpen() && hasCustomTrigger()}>
        <Portal>
          <div
            class={cn(
              "fixed z-[100] min-w-[180px]",
              "bg-base-100 border border-border rounded-xl shadow-xl",
              "animate-fade-in origin-top-right overflow-hidden",
            )}
            style={fixedMenuStyle()}
          >
            <div class="p-1 max-h-[300px] overflow-y-auto">
              <For each={props.options}>
                {(option) => (
                  <Show
                    when={!option.divider}
                    fallback={<div class="h-px bg-border my-1" />}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(option)}
                      disabled={option.disabled}
                      class={cn(
                        "w-full flex items-center rounded-lg text-left transition-colors",
                        props.compact
                          ? "gap-1 px-2 py-0 text-xs h-8"
                          : "gap-2 px-3 py-2 text-sm",
                        option.disabled && "opacity-50 cursor-not-allowed",
                        !option.disabled && "hover:bg-muted",
                        option.danger && "text-error hover:bg-error/10",
                      )}
                    >
                      <Show when={option.icon}>
                        <div class="text-muted-foreground shrink-0">
                          {option.icon!({ size: 16 })}
                        </div>
                      </Show>
                      <div class="flex-1 min-w-0">
                        <div class={cn(option.danger && "text-error")}>
                          {option.label}
                        </div>
                        <Show when={option.description}>
                          <div
                            class={cn(
                              "text-muted-foreground truncate",
                              props.compact ? "text-[10px]" : "text-xs",
                            )}
                          >
                            {option.description}
                          </div>
                        </Show>
                      </div>
                      <Show when={option.id === props.value}>
                        <FiCheck size={14} class="text-primary shrink-0" />
                      </Show>
                    </button>
                  </Show>
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};

// ============================================================================
// Select Component (simpler version)
// ============================================================================

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  class?: string;
  label?: string;
}

export const Select: Component<SelectProps> = (props) => {
  const options: DropdownOption[] = props.options.map((opt) => ({
    id: opt.value,
    label: opt.label,
  }));

  return (
    <Dropdown
      options={options}
      value={props.value}
      onChange={props.onChange}
      placeholder={props.placeholder}
      class={props.class}
    />
  );
};
