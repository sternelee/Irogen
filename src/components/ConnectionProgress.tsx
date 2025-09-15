import { Show, createMemo } from "solid-js";
import { ConnectionProgress } from "../utils/timeout";

interface ConnectionProgressProps {
  progress: ConnectionProgress | null;
  show: boolean;
}

export function ConnectionProgressModal(props: ConnectionProgressProps) {
  const progressPercentage = createMemo(() => {
    return props.progress?.percentage ?? 0;
  });

  const phaseText = createMemo(() => {
    if (!props.progress) return "";

    switch (props.progress.phase) {
      case "connecting":
        return "正在连接...";
      case "retrying":
        return `重试中 (第 ${props.progress.attempt} 次)`;
      case "connected":
        return "连接成功!";
      case "failed":
        return "连接失败";
      case "timeout":
        return "连接超时";
      default:
        return "";
    }
  });

  const progressColor = createMemo(() => {
    if (!props.progress) return "bg-blue-500";

    switch (props.progress.phase) {
      case "connecting":
        return "bg-blue-500";
      case "retrying":
        return "bg-yellow-500";
      case "connected":
        return "bg-green-500";
      case "failed":
      case "timeout":
        return "bg-red-500";
      default:
        return "bg-blue-500";
    }
  });

  return (
    <Show when={props.show && props.progress}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
        <div class="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-2xl">
          {/* 标题 */}
          <div class="text-center mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              连接状态
            </h3>
          </div>

          {/* 进度条容器 */}
          <div class="mb-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-medium text-gray-700">
                {phaseText()}
              </span>
              <span class="text-sm text-gray-500">
                {Math.round(progressPercentage())}%
              </span>
            </div>

            {/* 进度条 */}
            <div class="w-full bg-gray-200 rounded-full h-2">
              <div
                class={`h-2 rounded-full transition-all duration-300 ${progressColor()}`}
                style={{
                  width: `${progressPercentage()}%`,
                }}
              />
            </div>
          </div>

          {/* 详细信息 */}
          <Show when={props.progress}>
            <div class="text-xs text-gray-600 space-y-1">
              <div class="flex justify-between">
                <span>已用时间:</span>
                <span>{Math.round((props.progress!.elapsed || 0) / 1000)}s</span>
              </div>
              <div class="flex justify-between">
                <span>超时时间:</span>
                <span>{Math.round((props.progress!.total || 0) / 1000)}s</span>
              </div>
              <Show when={props.progress!.attempt}>
                <div class="flex justify-between">
                  <span>重试次数:</span>
                  <span>{props.progress!.attempt}</span>
                </div>
              </Show>
              <Show when={props.progress!.error}>
                <div class="mt-2 p-2 bg-red-50 rounded text-red-600 text-xs">
                  {props.progress!.error}
                </div>
              </Show>
            </div>
          </Show>

          {/* 动画指示器 */}
          <Show when={props.progress?.phase === "connecting" || props.progress?.phase === "retrying"}>
            <div class="flex justify-center mt-4">
              <div class="flex space-x-1">
                <div class="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <div class="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style="animation-delay: 0.1s" />
                <div class="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style="animation-delay: 0.2s" />
              </div>
            </div>
          </Show>

          {/* 成功/失败图标 */}
          <Show when={props.progress?.phase === "connected"}>
            <div class="flex justify-center mt-4">
              <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          </Show>

          <Show when={props.progress?.phase === "failed" || props.progress?.phase === "timeout"}>
            <div class="flex justify-center mt-4">
              <div class="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}

/**
 * 简化的内联进度显示组件
 */
interface InlineConnectionProgressProps {
  progress: ConnectionProgress | null;
  class?: string;
}

export function InlineConnectionProgress(props: InlineConnectionProgressProps) {
  const progressPercentage = createMemo(() => {
    return props.progress?.percentage ?? 0;
  });

  const statusIcon = createMemo(() => {
    if (!props.progress) return "🔄";

    switch (props.progress.phase) {
      case "connecting":
        return "🔄";
      case "retrying":
        return "🔄";
      case "connected":
        return "✅";
      case "failed":
        return "❌";
      case "timeout":
        return "⏰";
      default:
        return "🔄";
    }
  });

  const statusText = createMemo(() => {
    if (!props.progress) return "";

    switch (props.progress.phase) {
      case "connecting":
        return "连接中...";
      case "retrying":
        return `重试 ${props.progress.attempt}`;
      case "connected":
        return "已连接";
      case "failed":
        return "连接失败";
      case "timeout":
        return "连接超时";
      default:
        return "";
    }
  });

  return (
    <Show when={props.progress}>
      <div class={`flex items-center space-x-2 ${props.class || ""}`}>
        <span class="text-lg">{statusIcon()}</span>
        <div class="flex-1">
          <div class="flex items-center justify-between text-sm">
            <span>{statusText()}</span>
            <span class="text-gray-500">{Math.round(progressPercentage())}%</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-1 mt-1">
            <div
              class="h-1 bg-blue-500 rounded-full transition-all duration-300"
              style={{
                width: `${progressPercentage()}%`,
              }}
            />
          </div>
        </div>
      </div>
    </Show>
  );
}