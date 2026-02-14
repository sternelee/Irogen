import { For } from "solid-js";

// 网络状态指示器组件
export function NetworkIndicator(props: {
  strength: number; // 0-4
  connected: boolean;
  class?: string;
}) {
  const getBars = () => {
    const bars = [];
    for (let i = 1; i <= 4; i++) {
      bars.push({
        height: `${i * 25}%`,
        active: props.connected && i <= props.strength,
      });
    }
    return bars;
  };

  return (
    <div class={`network-indicator ${props.class || ""}`}>
      <For each={getBars()}>
        {(bar) => (
          <div
            class="network-bar"
            classList={{
              "text-primary": bar.active,
              "text-base-300 opacity-40": !bar.active,
            }}
            style={{ height: bar.height }}
          />
        )}
      </For>
    </div>
  );
}

// DaisyUI 5 标准按钮组件
export function ModernButton(props: {
  children: any;
  onClick?: () => void;
  variant?:
    | "primary"
    | "secondary"
    | "accent"
    | "ghost"
    | "outline"
    | "neutral";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  disabled?: boolean;
  class?: string;
}) {
  const getButtonClasses = () => {
    const baseClass = "btn";
    const variantClass = props.variant ? `btn-${props.variant}` : "";
    const sizeClass = props.size ? `btn-${props.size}` : "";
    return `${baseClass} ${variantClass} ${sizeClass} ${props.class || ""}`;
  };

  return (
    <button
      class={getButtonClasses()}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

// DaisyUI 5 标准输入框组件
export function ModernInput(props: {
  value?: string;
  onInput?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "search";
  disabled?: boolean;
  class?: string;
}) {
  return (
    <input
      type={props.type || "text"}
      class={`input input-bordered ${props.class || ""}`}
      value={props.value || ""}
      onInput={(e) => props.onInput?.(e.currentTarget.value)}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  );
}

// DaisyUI 5 标准卡片组件
export function ModernCard(props: {
  children: any;
  title?: string;
  class?: string;
  variant?: "bordered" | "compact";
}) {
  const getCardClasses = () => {
    const baseClass = "card bg-base-100 shadow-xl";
    const variantClass =
      props.variant === "bordered"
        ? "card-bordered"
        : props.variant === "compact"
          ? "card-compact"
          : "";
    return `${baseClass} ${variantClass} ${props.class || ""}`;
  };

  return (
    <div class={getCardClasses()}>
      <div class="card-body">
        {props.title && <h2 class="card-title">{props.title}</h2>}
        {props.children}
      </div>
    </div>
  );
}

// DaisyUI 5 标准模态框组件
export function ModernModal(props: {
  children: any;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}) {
  return (
    <>
      {props.isOpen && (
        <>
          <div class="modal modal-open">
            <div class="modal-box">
              {props.title && <h3 class="font-bold text-lg">{props.title}</h3>}
              <div class="py-4">{props.children}</div>
              <div class="modal-action">
                <ModernButton variant="ghost" onClick={props.onClose}>
                  关闭
                </ModernButton>
              </div>
            </div>
            <div class="modal-backdrop" onClick={props.onClose} />
          </div>
        </>
      )}
    </>
  );
}

// DaisyUI 5 标准选择框组件
export function ModernSelect(props: {
  value?: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  class?: string;
}) {
  return (
    <select
      class={`select select-bordered ${props.class || ""}`}
      value={props.value}
      onChange={(e) => props.onChange?.(e.currentTarget.value)}
    >
      {props.placeholder && (
        <option disabled selected>
          {props.placeholder}
        </option>
      )}
      {props.options.map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

// DaisyUI 5 标准切换组件
export function ModernToggle(props: {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  class?: string;
}) {
  return (
    <div class="form-control">
      <label class="cursor-pointer label">
        {props.label && <span class="label-text">{props.label}</span>}
        <input
          type="checkbox"
          class={`toggle toggle-primary ${props.class || ""}`}
          checked={props.checked}
          onChange={(e) => props.onChange?.(e.currentTarget.checked)}
        />
      </label>
    </div>
  );
}

// 简单的背景组件
export function SubtleBackground() {
  return <div class="fixed inset-0 pointer-events-none z-0 bg-base-100" />;
}

// 组合背景组件
export function ModernBackground() {
  return <SubtleBackground />;
}

// 兼容性别名
export const CyberBackground = ModernBackground;
