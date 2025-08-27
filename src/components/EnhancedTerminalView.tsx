import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import {
  SwipeGesture,
  EnhancedButton,
  FloatingActionButton,
} from "./ui/EnhancedComponents";
import {
  getDeviceCapabilities,
  MobileKeyboard,
  KeyboardManager,
  InputFocusManager,
} from "../utils/mobile";
import {
  globalBatteryOptimizer,
  injectBatteryOptimizationStyles,
  type PowerSaveConfig,
} from "../utils/batteryOptimizer";

interface SessionTab {
  id: string;
  ticket: string;
  title: string;
  terminalType: string;
  workingDirectory: string;
  isActive: boolean;
}

interface EnhancedTerminalViewProps {
  onReady: (terminal: Terminal, fitAddon: FitAddon) => void;
  onInput: (data: string) => void;
  isConnected?: boolean;
  onDisconnect?: () => void;
  onShowKeyboard?: () => void;
  sessionTitle?: string;
  terminalType?: string;
  workingDirectory?: string;
  // 新增移动端适配属性
  keyboardVisible?: boolean;
  safeViewportHeight?: number;
  onKeyboardToggle?: (visible: boolean) => void;
  // 新增渲染性能选项
  preferredRenderer?: "webgl" | "canvas" | "dom";
  enablePerformanceMonitoring?: boolean;
  // 新增多标签页支持
  sessionTabs?: SessionTab[];
  currentSessionId?: string;
  onTabSwitch?: (sessionId: string) => void;
  onTabClose?: (sessionId: string) => void;
  enableTabSwitching?: boolean;
}

// 渲染器类型枚举
type RendererType = "webgl" | "canvas" | "dom";

// 性能监控数据
interface PerformanceStats {
  fps: number;
  frameTime: number;
  renderTime: number;
  activeRenderer: RendererType;
  fallbackCount: number;
}

// Terminal debugging utility
const debugTerminal = (message: string, terminal?: Terminal | null) => {
  if (
    typeof window !== "undefined" &&
    window.location.hostname === "localhost"
  ) {
    console.log(`[EnhancedTerminalView] ${message}`, {
      terminalExists: !!terminal,
      terminalElement: terminal?.element,
      isDisposed: terminal && !(terminal as any)._core,
    });
  }
};

export function EnhancedTerminalView(props: EnhancedTerminalViewProps) {
  const [terminal, setTerminal] = createSignal<Terminal | null>(null);
  const [fitAddon, setFitAddon] = createSignal<FitAddon | null>(null);
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  const [webglAddon, setWebglAddon] = createSignal<WebglAddon | null>(null);
  const [canvasAddon, setCanvasAddon] = createSignal<CanvasAddon | null>(null);
  const [activeRenderer, setActiveRenderer] = createSignal<RendererType>("dom");
  const [performanceStats, setPerformanceStats] = createSignal<PerformanceStats>({
    fps: 0,
    frameTime: 0,
    renderTime: 0,
    activeRenderer: "dom",
    fallbackCount: 0,
  });
  const [showMobileKeyboard, setShowMobileKeyboard] = createSignal(false);
  const [showTerminalActions, setShowTerminalActions] = createSignal(false);
  const [showSearchBar, setShowSearchBar] = createSignal(false);
  const [showPerformanceStats, setShowPerformanceStats] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [fontSize, setFontSize] = createSignal(getDeviceCapabilities().isMobile ? 10 : 14);
  const [opacity, setOpacity] = createSignal(1);
  const [deviceCapabilities] = createSignal(getDeviceCapabilities());
  const [terminalHeight, setTerminalHeight] = createSignal<number | null>(null);
  const [lastResizeTime, setLastResizeTime] = createSignal(0);
  // 新增标签页相关状态
  const [showTabSwitcher, setShowTabSwitcher] = createSignal(false);
  const [tabKeySequence, setTabKeySequence] = createSignal("");
  // 电池优化状态
  const [powerSaveConfig, setPowerSaveConfig] = createSignal<PowerSaveConfig>({
    enableAnimations: true,
    useWebGLRenderer: true,
    maxScrollback: 10000,
    refreshRate: 60,
    enableCursorBlink: true,
    enableTransparency: true,
    fontSmoothing: true,
  });
  const [batteryOptimized, setBatteryOptimized] = createSignal(false);

  // Enhanced mobile keyboard and input management
  const [keyboardCleanup, setKeyboardCleanup] = createSignal<
    (() => void) | null
  >(null);
  const [inputCleanup, setInputCleanup] = createSignal<(() => void) | null>(
    null,
  );
  const [fixedElementCleanup, setFixedElementCleanup] = createSignal<
    (() => void) | null
  >(null);
  const [batteryOptimizerCleanup, setBatteryOptimizerCleanup] = createSignal<
    (() => void) | null
  >(null);

  // 响应外部键盘状态变化
  createEffect(() => {
    const isExternalKeyboardVisible = props.keyboardVisible;
    if (isExternalKeyboardVisible !== undefined) {
      // 外部键盘显示时，隐藏内部移动键盘以节省空间
      if (isExternalKeyboardVisible && showMobileKeyboard()) {
        setShowMobileKeyboard(false);
      }

      // 调整终端尺寸以适应键盘
      const fit = fitAddon();
      if (fit && terminalInstance) {
        setTimeout(() => {
          try {
            fit.fit();
            terminalInstance?.focus();
            setLastResizeTime(Date.now());
          } catch (error) {
            console.warn(
              "Failed to fit terminal after keyboard change:",
              error,
            );
          }
        }, 100);
      }
    }
  });

  // 计算最佳终端高度
  const calculateTerminalHeight = () => {
    if (!props.safeViewportHeight) return null;

    const baseHeight = props.safeViewportHeight;
    let availableHeight = baseHeight;

    // 减去固定UI元素的高度
    availableHeight -= 60; // 终端头部

    // 考虑标签页高度
    if (props.sessionTabs && props.sessionTabs.length > 1) {
      availableHeight -= 40; // 标签页条高度
    }

    if (showSearchBar()) {
      availableHeight -= 50; // 搜索栏
    }

    if (showTerminalActions()) {
      availableHeight -= 120; // 操作面板
    }

    if (showMobileKeyboard()) {
      availableHeight -= 160; // 移动键盘
    }

    return Math.max(availableHeight, 200); // 最小高度200px
  };

  // 标签页切换快捷键处理
  const handleTabSwitching = (keySequence: string) => {
    if (!props.enableTabSwitching || !props.sessionTabs || props.sessionTabs.length <= 1) {
      return false;
    }

    const tabs = props.sessionTabs;
    const currentIndex = tabs.findIndex(tab => tab.id === props.currentSessionId);

    if (currentIndex === -1) return false;

    let newIndex = currentIndex;

    switch (keySequence) {
      case "Ctrl+Tab":
      case "Cmd+]":
        // 下一个标签页
        newIndex = (currentIndex + 1) % tabs.length;
        break;
      case "Ctrl+Shift+Tab":
      case "Cmd+[":
        // 上一个标签页
        newIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
        break;
      case "Ctrl+1":
      case "Ctrl+2":
      case "Ctrl+3":
      case "Ctrl+4":
      case "Ctrl+5":
      case "Ctrl+6":
      case "Ctrl+7":
      case "Ctrl+8":
      case "Ctrl+9":
        // 直接切换到指定标签页
        const tabNumber = parseInt(keySequence.slice(-1));
        if (tabNumber <= tabs.length) {
          newIndex = tabNumber - 1;
        }
        break;
      default:
        return false;
    }

    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < tabs.length) {
      props.onTabSwitch?.(tabs[newIndex].id);

      // 显示标签页切换提示
      setShowTabSwitcher(true);
      setTimeout(() => setShowTabSwitcher(false), 1000);

      return true;
    }

    return false;
  };

  // Optimized terminal height monitoring with better debouncing
  createEffect(() => {
    const calculatedHeight = calculateTerminalHeight();
    if (calculatedHeight && calculatedHeight !== terminalHeight()) {
      setTerminalHeight(calculatedHeight);

      // Enhanced debouncing for smoother terminal resizing
      const now = Date.now();
      const timeSinceLastResize = now - lastResizeTime();

      if (timeSinceLastResize > 200) {
        // Increased threshold for better stability
        const fit = fitAddon();
        if (fit && terminalInstance) {
          // Use requestAnimationFrame for smooth resizing
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                fit.fit();
                terminalInstance?.focus();
                setLastResizeTime(now);
                debugTerminal(
                  `Terminal height adjusted to ${calculatedHeight}px`,
                );
              } catch (error) {
                console.warn(
                  "Failed to fit terminal after height change:",
                  error,
                );
              }
            }, 50); // Reduced timeout for responsiveness
          });
        }
      }
    }
  });

  // Touch gesture state
  const [isPinching, setIsPinching] = createSignal(false);
  const [lastPinchDistance, setLastPinchDistance] = createSignal(0);

  let terminalInstance: Terminal | null = null;
  let onDataDispose: { dispose: () => void } | null = null;
  let terminalElement: HTMLDivElement | undefined;
  let mobileKeyboardRef: HTMLDivElement | undefined;
  let resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let performanceMonitorId: ReturnType<typeof setInterval> | null = null;
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let fallbackCount = 0;

  // 移动端渲染器优化 - 电池感知增强版本
  const getMobileOptimizedRenderer = (): RendererType => {
    const caps = deviceCapabilities();
    const config = powerSaveConfig();

    if (caps.isMobile) {
      // 电池优化：省电模式时强制使用DOM渲染器
      if (!config.useWebGLRenderer) {
        console.log(`🔋 Battery optimization: using DOM renderer`);
        return "dom";
      }

      // 检查电池状态和性能指标
      const batteryLevel = getBatteryLevel();
      const isLowBattery = batteryLevel > 0 && batteryLevel < 0.3;
      const isLowEndDevice = caps.screenSize === "xs" || caps.screenSize === "sm";

      // 移动设备渲染器选择策略：
      // 1. 低电量时强制使用DOM渲染器
      if (isLowBattery) {
        console.log(`🔋 Low battery (${(batteryLevel * 100).toFixed(1)}%), using DOM renderer`);
        return "dom";
      }

      // 2. 低端设备使用Canvas
      if (isLowEndDevice) {
        return "canvas";
      }

      // 3. 高端移动设备根据用户偏好选择，但默认使用Canvas以省电
      return props.preferredRenderer === "webgl" && config.useWebGLRenderer ? "webgl" : "canvas";
    }

    // 桌面设备使用首选渲染器
    return props.preferredRenderer || "webgl";
  };

  // 获取电池电量的辅助函数
  const getBatteryLevel = (): number => {
    // 从全局电池优化器获取电池信息
    return globalBatteryOptimizer.getBatteryState().level;
  };

  // WebGL 渲染器管理 - 防闪烁优化版本
  const enableWebglRenderer = async () => {
    if (!terminalInstance) return false;

    try {
      debugTerminal("Attempting to enable WebGL renderer...");

      // 预创建WebGL渲染器以测试兼容性
      const testWebgl = new WebglAddon();

      // 先隐藏终端以防止闪烁
      if (terminalElement) {
        terminalElement.style.opacity = "0.5";
        terminalElement.style.transition = "opacity 0.2s ease";
      }

      // 清理现有Canvas渲染器（延迟处理以减少闪烁）
      const currentCanvasAddon = canvasAddon();

      // 设置WebGL上下文丢失回调
      testWebgl.onContextLoss(() => {
        debugTerminal("WebGL context lost, falling back to Canvas renderer");
        setActiveRenderer("canvas");
        fallbackCount++;
        setPerformanceStats(prev => ({ ...prev, fallbackCount, activeRenderer: "canvas" }));
        // 延迟回退以避免竞态条件
        setTimeout(() => enableCanvasRenderer(), 200);
      });

      // 加载WebGL渲染器
      terminalInstance.loadAddon(testWebgl);

      // 等待渲染器初始化
      await new Promise(resolve => setTimeout(resolve, 100));

      // 现在安全地清理旧渲染器
      if (currentCanvasAddon) {
        try {
          currentCanvasAddon.dispose();
          setCanvasAddon(null);
        } catch (error) {
          console.warn("Error disposing canvas addon:", error);
        }
      }

      setWebglAddon(testWebgl);
      setActiveRenderer("webgl");

      // 恢复终端显示
      if (terminalElement) {
        terminalElement.style.opacity = "1";
      }

      debugTerminal("WebGL renderer enabled successfully");
      return true;
    } catch (error) {
      debugTerminal(`WebGL renderer failed: ${error}`);
      fallbackCount++;
      setPerformanceStats(prev => ({ ...prev, fallbackCount }));

      // 恢复终端显示
      if (terminalElement) {
        terminalElement.style.opacity = "1";
      }

      return false;
    }
  };

  // Canvas 渲染器管理 - 移动端优化和防闪烁版本
  const enableCanvasRenderer = async () => {
    if (!terminalInstance) return false;

    try {
      debugTerminal("Attempting to enable Canvas renderer...");

      // 先隐藏终端以防止闪烁
      if (terminalElement) {
        terminalElement.style.opacity = "0.5";
        terminalElement.style.transition = "opacity 0.2s ease";
      }

      // 清理现有WebGL渲染器（延迟处理）
      const currentWebglAddon = webglAddon();

      // 创建新的Canvas渲染器
      const canvas = new CanvasAddon();

      // 加载Canvas渲染器
      terminalInstance.loadAddon(canvas);

      // 等待渲染器初始化
      await new Promise(resolve => setTimeout(resolve, 100));

      // 现在安全地清理旧渲染器
      if (currentWebglAddon) {
        try {
          currentWebglAddon.dispose();
          setWebglAddon(null);
        } catch (error) {
          console.warn("Error disposing WebGL addon:", error);
        }
      }

      setCanvasAddon(canvas);
      setActiveRenderer("canvas");

      // 移动端 Canvas 优化
      if (deviceCapabilities().isMobile) {
        // 使用requestAnimationFrame确保DOM更新完成
        requestAnimationFrame(() => {
          const canvasEl = terminalElement?.querySelector("canvas");
          if (canvasEl) {
            // 移动设备优化设置
            canvasEl.style.imageRendering = "optimizeSpeed";
            canvasEl.style.willChange = "transform";
            canvasEl.style.touchAction = "pan-y";

            // 优化移动设备的渲染精度
            const ctx = canvasEl.getContext("2d");
            if (ctx) {
              ctx.imageSmoothingEnabled = false;
              // 设置低功耗渲染选项
              if ('desynchronized' in ctx.canvas) {
                (ctx.canvas as any).desynchronized = true;
              }
            }

            debugTerminal("Canvas renderer optimized for mobile device");
          }
        });
      }

      // 恢复终端显示
      if (terminalElement) {
        terminalElement.style.opacity = "1";
      }

      debugTerminal("Canvas renderer enabled successfully");
      return true;
    } catch (error) {
      debugTerminal(`Canvas renderer failed: ${error}`);
      fallbackCount++;
      setPerformanceStats(prev => ({ ...prev, fallbackCount }));

      // 恢复终端显示
      if (terminalElement) {
        terminalElement.style.opacity = "1";
      }

      return false;
    }
  };

  // 渲染器切换函数 - 无闪烁优化版本
  const switchRenderer = async (renderer: RendererType) => {
    if (!terminalInstance || activeRenderer() === renderer) return;

    debugTerminal(`Switching renderer from ${activeRenderer()} to ${renderer}`);

    // 显示切换指示器
    const showSwitchingIndicator = () => {
      if (terminalElement) {
        const indicator = document.createElement('div');
        indicator.className = 'renderer-switching-indicator';
        indicator.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 12px;
          z-index: 1000;
          pointer-events: none;
        `;
        indicator.textContent = `切换到 ${renderer.toUpperCase()} 渲染器...`;
        terminalElement.appendChild(indicator);

        return () => {
          if (indicator.parentNode) {
            indicator.parentNode.removeChild(indicator);
          }
        };
      }
      return () => { };
    };

    const removeIndicator = showSwitchingIndicator();

    try {
      switch (renderer) {
        case "webgl":
          const webglSuccess = await enableWebglRenderer();
          if (!webglSuccess) {
            debugTerminal("WebGL fallback to Canvas");
            await enableCanvasRenderer();
          }
          break;
        case "canvas":
          await enableCanvasRenderer();
          break;
        case "dom":
          // 平滑切换到DOM渲染器
          if (terminalElement) {
            terminalElement.style.opacity = "0.5";
            terminalElement.style.transition = "opacity 0.2s ease";
          }

          // 延迟清理以避免闪烁
          setTimeout(() => {
            const currentWebgl = webglAddon();
            const currentCanvas = canvasAddon();
            if (currentWebgl) {
              try {
                currentWebgl.dispose();
                setWebglAddon(null);
              } catch (error) {
                console.warn("Error disposing WebGL addon:", error);
              }
            }
            if (currentCanvas) {
              try {
                currentCanvas.dispose();
                setCanvasAddon(null);
              } catch (error) {
                console.warn("Error disposing Canvas addon:", error);
              }
            }
            setActiveRenderer("dom");

            // 恢复显示
            if (terminalElement) {
              terminalElement.style.opacity = "1";
            }

            debugTerminal("Switched to DOM renderer");
          }, 100);
          break;
      }
    } finally {
      // 移除切换指示器
      setTimeout(removeIndicator, 300);
    }

    // 更新性能统计
    setPerformanceStats(prev => ({ ...prev, activeRenderer: activeRenderer(), fallbackCount }));
  };

  // 性能监控 - 增强多会话支持版本
  const startPerformanceMonitoring = () => {
    if (!props.enablePerformanceMonitoring) return;

    frameCount = 0;
    lastFrameTime = performance.now();

    // 智能性能监控，根据会话数量调整监控频率
    const sessionCount = props.sessionTabs?.length || 1;
    const monitoringInterval = Math.max(1000, sessionCount * 200); // 更多会话时降低监控频率

    performanceMonitorId = setInterval(() => {
      const currentTime = performance.now();
      const deltaTime = currentTime - lastFrameTime;
      const fps = Math.round((frameCount * 1000) / deltaTime);
      const frameTime = deltaTime / frameCount;

      // 检测性能下降并自动优化
      if (fps < 30 && sessionCount > 1) {
        console.warn(`🐌 Performance degradation detected (${fps} FPS) with ${sessionCount} sessions`);
        // 自动降级渲染器
        if (activeRenderer() === "webgl") {
          debugTerminal("Auto-switching to Canvas renderer due to performance");
          switchRenderer("canvas");
        } else if (activeRenderer() === "canvas" && sessionCount > 3) {
          debugTerminal("Auto-switching to DOM renderer due to performance");
          switchRenderer("dom");
        }
      }

      setPerformanceStats(prev => ({
        ...prev,
        fps: isFinite(fps) ? fps : 0,
        frameTime: isFinite(frameTime) ? frameTime : 0,
        renderTime: performance.now() - currentTime,
        sessionCount, // 添加会话数量到性能统计
      }));

      frameCount = 0;
      lastFrameTime = currentTime;
    }, monitoringInterval);
  };

  const stopPerformanceMonitoring = () => {
    if (performanceMonitorId) {
      clearInterval(performanceMonitorId);
      performanceMonitorId = null;
    }
  };

  // Get terminal theme similar to original TerminalView
  const getTerminalTheme = () => ({
    background: "rgba(17, 24, 39, 0.95)",
    foreground: "#F9FAFB",
    cursor: "#4F46E5",
    cursorAccent: "#1F2937",
    selectionBackground: "rgba(79, 70, 229, 0.3)",
    black: "#374151",
    red: "#EF4444",
    green: "#10B981",
    yellow: "#F59E0B",
    blue: "#3B82F6",
    magenta: "#8B5CF6",
    cyan: "#06B6D4",
    white: "#F9FAFB",
    brightBlack: "#6B7280",
    brightRed: "#F87171",
    brightGreen: "#34D399",
    brightYellow: "#FBBF24",
    brightBlue: "#60A5FA",
    brightMagenta: "#A78BFA",
    brightCyan: "#67E8F9",
    brightWhite: "#FFFFFF",
  });

  const initializeTerminal = async () => {
    if (terminalElement && !terminalInstance) {
      debugTerminal("Initializing new terminal...");

      // 根据会话数量优化终端配置
      const sessionCount = props.sessionTabs?.length || 1;
      const isMultiSession = sessionCount > 1;

      // 多会话优化策略：减少资源消耗
      const optimizedScrollback = isMultiSession ? Math.min(5000, 10000 / sessionCount) : 10000;
      const optimizedFontSize = isMultiSession && deviceCapabilities().isMobile ? Math.max(fontSize() - 1, 10) : fontSize();

      const term = new Terminal({
        cursorBlink: !isMultiSession || !deviceCapabilities().isMobile, // 多会话时在移动设备上禁用光标闪烁
        cursorStyle: "block",
        scrollback: optimizedScrollback, // 动态调整滚动缓存
        theme: getTerminalTheme(),
        fontSize: optimizedFontSize,
        fontFamily:
          '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "Monaco", "Inconsolata", "Roboto Mono", "Source Code Pro", "Menlo", "Consolas", "DejaVu Sans Mono", monospace',
        letterSpacing: 0.5,
        lineHeight: 1.2,
        allowTransparency: true,
        convertEol: true,
        rightClickSelectsWord: true,
        macOptionIsMeta: true,
        // 增强滚动性能设置（多会话优化）
        fastScrollModifier: "alt",
        fastScrollSensitivity: isMultiSession ? 5 : 3, // 多会话时加快滚动
        scrollSensitivity: isMultiSession ? 2 : 1, // 多会话时降低敏感度
        minimumContrastRatio: 4.5,
        fontWeight: "normal",
        fontWeightBold: "bold",
        drawBoldTextInBrightColors: true,
        // 移动端优化设置
        cols: deviceCapabilities().isMobile ? 80 : undefined,
        wordSeparator: deviceCapabilities().isMobile ? " \t\n\r\f" : undefined,
        // 性能优化（多会话增强）
        disableStdin: false,
        allowProposedApi: true,
        // 多会话优化：禁用不必要的窗口操作
        windowOptions: isMultiSession ? {
          restoreWin: false,
          minimizeWin: false,
          setWinPosition: false,
          setWinSizePixels: false,
          raiseWin: false,
          lowerWin: false,
          refreshWin: false,
          setWinSizeChars: false,
          maximizeWin: false,
          fullscreenWin: false,
        } : {
          restoreWin: true,
          minimizeWin: true,
          setWinPosition: true,
          setWinSizePixels: true,
          raiseWin: true,
          lowerWin: true,
          refreshWin: true,
          setWinSizeChars: true,
          maximizeWin: true,
          fullscreenWin: true,
        },
      });

      debugTerminal(`Terminal initialized with session count: ${sessionCount}, scrollback: ${optimizedScrollback}`);

      // 余下的初始化逻辑保持不变...
      // Load basic addons
      const fit = new FitAddon();
      const webLinks = new WebLinksAddon();
      const search = new SearchAddon();

      term.loadAddon(fit);
      term.loadAddon(webLinks);
      term.loadAddon(search);

      // Store references
      terminalInstance = term;
      setTerminal(term);
      setFitAddon(fit);
      setSearchAddon(search);

      // Open terminal
      term.open(terminalElement);

      // 初始化渲染器系统 - 移动端优化
      const optimizedRenderer = getMobileOptimizedRenderer();

      // 尝试启用优化后的渲染器
      let rendererInitialized = false;

      if (optimizedRenderer === "webgl" && !deviceCapabilities().isMobile) {
        rendererInitialized = await enableWebglRenderer();
        debugTerminal(`WebGL renderer initialization: ${rendererInitialized ? "success" : "failed"}`);
      }

      if (!rendererInitialized && (optimizedRenderer === "canvas" || optimizedRenderer === "webgl")) {
        rendererInitialized = await enableCanvasRenderer();
        debugTerminal(`Canvas renderer initialization: ${rendererInitialized ? "success" : "failed"}`);
      }

      if (!rendererInitialized) {
        setActiveRenderer("dom");
        debugTerminal("Using DOM renderer (fallback)");
      }

      // 移动设备的渲染器特定优化 - 多会话增强
      if (deviceCapabilities().isMobile && activeRenderer() !== "dom") {
        // 多会话优化：进一步减少移动设备的资源消耗
        const currentScrollback = term.options.scrollback || 1000;
        const optimizedScrollback = isMultiSession ? Math.min(currentScrollback, 2000) : Math.min(currentScrollback, 3000);

        term.options.scrollback = optimizedScrollback;
        term.options.fastScrollSensitivity = isMultiSession ? 7 : 5; // 多会话时更加快速的滚动

        // 多会话时禁用一些耗资源的特性
        if (isMultiSession && sessionCount > 2) {
          term.options.cursorBlink = false; // 禁用光标闪烁
          term.options.allowTransparency = false; // 禁用透明度
        }

        debugTerminal(`Applied multi-session mobile optimizations: sessions=${sessionCount}, scrollback=${optimizedScrollback}`);
      }

      // 设置初始字体大小
      const initialFontSize = fontSize();
      term.options.fontSize = initialFontSize;
      debugTerminal(`Initial font size set to ${initialFontSize}px`);

      // 适配终端尺寸
      fit.fit();

      // 启动性能监控
      if (props.enablePerformanceMonitoring) {
        startPerformanceMonitoring();
      }

      // 强制刷新以应用所有设置
      setTimeout(() => {
        try {
          term.refresh(0, term.rows - 1);
          fit.fit();
          debugTerminal(
            `Terminal refreshed with font size ${term.options.fontSize}px, renderer: ${activeRenderer()}`,
          );
        } catch (error) {
          console.warn(
            "Failed to refresh terminal after initialization:",
            error,
          );
        }
      }, 100);

      // 增强终端样式以实现流畅滚动
      if (terminalElement) {
        terminalElement.style.background = "transparent";
        // 硬件加速容器
        terminalElement.style.transform = "translateZ(0)";
        terminalElement.style.backfaceVisibility = "hidden";
        terminalElement.style.willChange = "scroll-position, transform";

        const terminalEl = terminalElement.querySelector(".terminal");
        if (terminalEl) {
          const el = terminalEl as HTMLElement;
          el.style.background = "transparent";
          // 增强xterm容器滚动
          el.style.transform = "translateZ(0)";
          el.style.backfaceVisibility = "hidden";
          el.style.willChange = "scroll-position";
        }

        // 优化xterm viewport
        const viewport = terminalElement.querySelector(".xterm-viewport");
        if (viewport) {
          const el = viewport as HTMLElement;
          (el.style as any).webkitOverflowScrolling = "touch";
          el.style.scrollBehavior = "smooth";
          el.style.overscrollBehavior = "contain";
          // viewport硬件加速
          el.style.transform = "translateZ(0)";
          el.style.willChange = "scroll-position";
        }

        // 优化xterm screen
        const screen = terminalElement.querySelector(".xterm-screen");
        if (screen) {
          const el = screen as HTMLElement;
          el.style.transform = "translateZ(0)";
          el.style.backfaceVisibility = "hidden";
        }

        // 为WebGL/Canvas渲染器优化样式 - 移动端增强
        const canvas = terminalElement.querySelector("canvas");
        if (canvas) {
          canvas.style.transform = "translateZ(0)";
          canvas.style.backfaceVisibility = "hidden";

          if (deviceCapabilities().isMobile) {
            // 移动设备特定优化
            canvas.style.imageRendering = "optimizeSpeed"; // 优先考虑性能
            canvas.style.touchAction = "pan-y"; // 只允许垂直平移
            canvas.style.userSelect = "none"; // 防止意外选中
            (canvas.style as any).webkitUserSelect = "none";
            (canvas.style as any).webkitTouchCallout = "none"; // iOS Safari 优化

            // 低端设备上降低渲染精度以提高性能
            const isLowEndDevice = deviceCapabilities().screenSize === "xs" || deviceCapabilities().screenSize === "sm";
            if (isLowEndDevice) {
              canvas.style.imageRendering = "pixelated";
            }
          } else {
            // 桌面设备优化
            canvas.style.imageRendering = "auto"; // 高质量渲染
          }

          debugTerminal(`Canvas optimized for ${deviceCapabilities().isMobile ? "mobile" : "desktop"} device`);
        }
      }

      // Welcome message with renderer info
      const welcomeMessage = [
        "\x1b[1;32m╔══════════════════════════════════════════════════════════════╗\x1b[0m",
        "\x1b[1;32m║\x1b[0m                    \x1b[1;36mRiTerm P2P Terminal\x1b[0m                     \x1b[1;32m║\x1b[0m",
        "\x1b[1;32m║\x1b[0m                  \x1b[36mSecure • Fast • Decentralized\x1b[0m                \x1b[1;32m║\x1b[0m",
        `\x1b[1;32m║\x1b[0m                    \x1b[35mRenderer: ${activeRenderer().toUpperCase()}\x1b[0m                        \x1b[1;32m║\x1b[0m`,
        "\x1b[1;32m╚══════════════════════════════════════════════════════════════╝\x1b[0m",
        "",
        "\x1b[33m[INFO]\x1b[0m Terminal initialized with enhanced theme",
        "\x1b[33m[INFO]\x1b[0m P2P network stack ready",
        `\x1b[33m[INFO]\x1b[0m Hardware acceleration: ${activeRenderer() !== "dom" ? "enabled" : "disabled"} (${activeRenderer()})`,
        "\x1b[32m[READY]\x1b[0m Awaiting connection...",
        "",
      ].join("\r\n");

      term.write(welcomeMessage);
      term.focus();

      // Setup callbacks
      props.onReady(term, fit);

      onDataDispose = term.onData((data) => {
        debugTerminal(`Terminal input: ${data}`);
        props.onInput(data);

        // 性能监控：计算帧数
        if (props.enablePerformanceMonitoring) {
          frameCount++;
        }
      });

      // 添加键盘事件监听器以支持标签页切换
      const handleKeyDown = (e: KeyboardEvent) => {
        // 检查标签页切换快捷键
        let keySequence = "";
        if (e.ctrlKey && e.key === "Tab") {
          keySequence = e.shiftKey ? "Ctrl+Shift+Tab" : "Ctrl+Tab";
        } else if (e.metaKey && (e.key === "[" || e.key === "]")) {
          keySequence = e.key === "[" ? "Cmd+[" : "Cmd+]";
        } else if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
          keySequence = `Ctrl+${e.key}`;
        }

        if (keySequence && handleTabSwitching(keySequence)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // 传统的终端快捷键处理
        if (e.ctrlKey || e.metaKey) {
          switch (e.key) {
            case "=":
            case "+":
              e.preventDefault();
              const newSizeUp = Math.min(fontSize() + 1, 24);
              if (newSizeUp !== fontSize()) {
                setFontSize(newSizeUp);
                debugTerminal(`Font size increased to ${newSizeUp}px via keyboard`);
              }
              break;
            case "-":
              e.preventDefault();
              const newSizeDown = Math.max(fontSize() - 1, 8);
              if (newSizeDown !== fontSize()) {
                setFontSize(newSizeDown);
                debugTerminal(`Font size decreased to ${newSizeDown}px via keyboard`);
              }
              break;
            case "0":
              e.preventDefault();
              setFontSize(14); // 重置为默认字体大小
              debugTerminal("Font size reset to 14px via keyboard");
              break;
            case "f":
              if (!e.shiftKey) {
                e.preventDefault();
                setShowSearchBar(!showSearchBar());
              }
              break;
            case "k":
              if (!e.shiftKey) {
                e.preventDefault();
                term.clear();
              }
              break;
          }
        }
      };

      // 添加全局键盘监听器
      document.addEventListener("keydown", handleKeyDown);

      // 增强的缩放处理和防抖动
      let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
      const handleResize = () => {
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }

        resizeTimeout = setTimeout(() => {
          if (fit && terminalInstance) {
            try {
              fit.fit();
              terminalInstance?.focus();
              debugTerminal(`Terminal resized and refitted successfully (${activeRenderer()} renderer)`);
            } catch (error) {
              console.warn("Failed to fit terminal:", error);
            }
          }
        }, 150); // 增加防抖动时间以获得更流畅的性能
      };

      window.addEventListener("resize", handleResize);
      debugTerminal(`Terminal initialized successfully with ${activeRenderer()} renderer`, term);

      onCleanup(() => {
        debugTerminal("Starting terminal cleanup...");

        // 停止性能监控
        stopPerformanceMonitoring();

        // 移除键盘监听器
        document.removeEventListener("keydown", handleKeyDown);

        // Clear resize timeout
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }

        window.removeEventListener("resize", handleResize);

        if (onDataDispose) {
          onDataDispose.dispose();
          onDataDispose = null;
        }

        // 清理渲染器插件
        const currentWebgl = webglAddon();
        const currentCanvas = canvasAddon();
        if (currentWebgl) {
          try {
            currentWebgl.dispose();
          } catch (error) {
            console.warn("Error disposing WebGL addon:", error);
          }
          setWebglAddon(null);
        }
        if (currentCanvas) {
          try {
            currentCanvas.dispose();
          } catch (error) {
            console.warn("Error disposing Canvas addon:", error);
          }
          setCanvasAddon(null);
        }

        if (terminalInstance) {
          try {
            terminalInstance.dispose();
          } catch (error) {
            console.warn("Error disposing terminal:", error);
          }
          terminalInstance = null;
        }

        setTerminal(null);
        setFitAddon(null);
        setSearchAddon(null);
        setActiveRenderer("dom");
        debugTerminal("Terminal cleanup completed");
      });
    }
  };

  // Enhanced terminal initialization with mobile support
  onMount(async () => {
    // 初始化电池优化
    injectBatteryOptimizationStyles();
    await globalBatteryOptimizer.initialize();

    // 设置电池优化监听器
    const batteryCleanup = globalBatteryOptimizer.onConfigChange((config) => {
      setPowerSaveConfig(config);
      setBatteryOptimized(globalBatteryOptimizer.isPowerSaveMode());

      // 电池优化时自动调整渲染器
      if (terminalInstance) {
        const recommendedRenderer = globalBatteryOptimizer.getRecommendedRenderer();
        if (recommendedRenderer !== activeRenderer()) {
          console.log(`🔋 Battery optimization: switching to ${recommendedRenderer} renderer`);
          switchRenderer(recommendedRenderer);
        }

        // 应用终端优化
        const terminalOpts = globalBatteryOptimizer.getTerminalOptimizations();
        terminalInstance.options.cursorBlink = terminalOpts.cursorBlink;
        terminalInstance.options.allowTransparency = terminalOpts.transparency;

        // 调整滚动缓存
        if (terminalInstance.options.scrollback !== terminalOpts.scrollback) {
          terminalInstance.options.scrollback = terminalOpts.scrollback;
          console.log(`🔋 Scrollback adjusted to ${terminalOpts.scrollback} for battery optimization`);
        }

        terminalInstance.refresh(0, terminalInstance.rows - 1);
      }
    });
    setBatteryOptimizerCleanup(() => batteryCleanup);

    // Delay initialization slightly to ensure DOM is ready
    setTimeout(async () => {
      await initializeTerminal();
    }, 50);

    // Enhanced mobile keyboard and input management setup
    if (deviceCapabilities().isMobile) {
      // Register terminal element for input focus management
      if (terminalElement) {
        const cleanup = InputFocusManager.trackInput(terminalElement);
        setInputCleanup(() => cleanup);
      }

      // Set up keyboard scroll adjustment callback
      const keyboardCleanupFn = MobileKeyboard.onScrollAdjustment(() => {
        // Force terminal to adjust when keyboard triggers scroll adjustments
        const fit = fitAddon();
        if (fit && terminalInstance) {
          setTimeout(() => {
            try {
              fit.fit();
              terminalInstance?.focus();
            } catch (error) {
              console.warn(
                "Failed to adjust terminal for keyboard scroll:",
                error,
              );
            }
          }, 100);
        }
      });
      setKeyboardCleanup(() => keyboardCleanupFn);

      // Register mobile keyboard as fixed element if it exists
      setTimeout(() => {
        if (mobileKeyboardRef) {
          const fixedCleanup = KeyboardManager.registerFixedElement(
            mobileKeyboardRef,
            {
              adjustWithKeyboard: true,
              onKeyboardShow: (keyboardHeight) => {
                console.log(
                  `Mobile keyboard adjusted for keyboard height: ${keyboardHeight}px`,
                );
              },
              onKeyboardHide: () => {
                console.log("Mobile keyboard restored to normal position");
              },
            },
          );
          setFixedElementCleanup(() => fixedCleanup);
        }
      }, 100);
    }

    // Enhanced cleanup
    onCleanup(() => {
      // 清理电池优化器
      const batteryCleanup = batteryOptimizerCleanup();
      if (batteryCleanup) {
        batteryCleanup();
        setBatteryOptimizerCleanup(null);
      }

      const inputCleanupFn = inputCleanup();
      if (inputCleanupFn) {
        inputCleanupFn();
        setInputCleanup(null);
      }

      const keyboardCleanupFn = keyboardCleanup();
      if (keyboardCleanupFn) {
        keyboardCleanupFn();
        setKeyboardCleanup(null);
      }

      const fixedCleanupFn = fixedElementCleanup();
      if (fixedCleanupFn) {
        fixedCleanupFn();
        setFixedElementCleanup(null);
      }
    });
  });

  // Enhanced font size and theme updates with performance optimization
  createEffect(() => {
    const currentFontSize = fontSize();
    const currentTerminal = terminal();

    if (currentTerminal && terminalInstance) {
      debugTerminal(`Updating font size to ${currentFontSize}px`);

      // Update terminal options
      currentTerminal.options.fontSize = currentFontSize;
      currentTerminal.options.theme = getTerminalTheme();

      // Use requestAnimationFrame for smoother updates
      requestAnimationFrame(() => {
        const fit = fitAddon();
        if (fit && terminalInstance) {
          // Use a timeout to ensure font changes are applied
          setTimeout(() => {
            try {
              // Refresh the terminal to apply font changes
              currentTerminal.refresh(0, currentTerminal.rows - 1);
              // Then fit the terminal
              fit.fit();
              currentTerminal.focus();

              debugTerminal(
                `Font size updated successfully to ${currentFontSize}px`,
              );
            } catch (error) {
              console.warn("Failed to update terminal font size:", error);
            }
          }, 100); // Reduced timeout for better responsiveness
        }
      });
    }
  });

  // 移动端触摸优化手势处理器
  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      // 只处理双指手势
      setIsPinching(true);
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      setLastPinchDistance(distance);

      // 移动设备优化：禁用页面缩放
      e.preventDefault();
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isPinching() && e.touches.length === 2) {
      // 只防止双指手势的默认行为，允许正常滚动
      e.preventDefault();
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      const scale = distance / lastPinchDistance();

      // 移动设备上使用更保守的阈值防止意外缩放
      const zoomThreshold = deviceCapabilities().isMobile ? 1.15 : 1.1;
      const zoomOutThreshold = deviceCapabilities().isMobile ? 0.85 : 0.9;

      if (scale > zoomThreshold) {
        // 放大 - 移动设备上增加阈值以提高稳定性
        const newSize = Math.min(fontSize() + 1, deviceCapabilities().isMobile ? 20 : 24);
        if (newSize !== fontSize()) {
          setFontSize(newSize);
          setLastPinchDistance(distance);
          debugTerminal(`Pinch zoom in: font size ${newSize}px`);

          // 移动设备上的触觉反馈
          if (window.navigator?.vibrate) {
            window.navigator.vibrate(deviceCapabilities().isMobile ? 15 : 10);
          }
        }
      } else if (scale < zoomOutThreshold) {
        // 缩小 - 移动设备上增加阈值以提高稳定性
        const newSize = Math.max(fontSize() - 1, deviceCapabilities().isMobile ? 10 : 8);
        if (newSize !== fontSize()) {
          setFontSize(newSize);
          setLastPinchDistance(distance);
          debugTerminal(`Pinch zoom out: font size ${newSize}px`);

          // 移动设备上的触觉反馈
          if (window.navigator?.vibrate) {
            window.navigator.vibrate(deviceCapabilities().isMobile ? 15 : 10);
          }
        }
      }
    }
    // 单指滚动通过不阻止默认行为正常工作
  };

  const handleTouchEnd = () => {
    setIsPinching(false);
    setLastPinchDistance(0);
  };

  const getTouchDistance = (touch1: Touch, touch2: Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Mobile keyboard actions - 优化移动端按键布局
  const commonKeys = [
    { label: "Tab", key: "\t" },
    { label: "Ctrl+C", key: "\x03" },
    { label: "Ctrl+D", key: "\x04" },
    { label: "Ctrl+L", key: "\x0c" },
    { label: "Esc", key: "\x1b" },
    { label: "Enter", key: "\r" },
    { label: "←", key: "\x1b[D" },
    { label: "→", key: "\x1b[C" },
    { label: "↑", key: "\x1b[A" },
    { label: "↓", key: "\x1b[B" },
    // 移动端额外按键
    ...(deviceCapabilities().isMobile
      ? [
        { label: "Home", key: "\x1b[H" },
        { label: "End", key: "\x1b[F" },
        { label: "PgUp", key: "\x1b[5~" },
        { label: "PgDn", key: "\x1b[6~" },
        { label: "Ctrl+Z", key: "\x1a" },
        { label: "Ctrl+X", key: "\x18" },
      ]
      : []),
  ];

  // 标签页切换快捷键（移动端）
  const tabSwitchKeys = props.sessionTabs && props.sessionTabs.length > 1 ? [
    {
      label: "下一个标签页",
      action: () => {
        const tabs = props.sessionTabs!;
        const currentIndex = tabs.findIndex(tab => tab.id === props.currentSessionId);
        if (currentIndex !== -1) {
          const nextIndex = (currentIndex + 1) % tabs.length;
          props.onTabSwitch?.(tabs[nextIndex].id);
        }
      }
    },
    {
      label: "上一个标签页",
      action: () => {
        const tabs = props.sessionTabs!;
        const currentIndex = tabs.findIndex(tab => tab.id === props.currentSessionId);
        if (currentIndex !== -1) {
          const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
          props.onTabSwitch?.(tabs[prevIndex].id);
        }
      }
    },
  ] : [];

  const sendKey = (key: string) => {
    if (key) {
      debugTerminal(`Sending key: "${key}"`);
      props.onInput(key);

      // Haptic feedback
      if (window.navigator?.vibrate) {
        window.navigator.vibrate(5);
      }
    }
  };

  // Search functionality
  const handleSearch = (
    query: string,
    direction: "next" | "previous" = "next",
  ) => {
    const search = searchAddon();
    if (search && query) {
      if (direction === "next") {
        search.findNext(query);
      } else {
        search.findPrevious(query);
      }
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen());
    // Add fullscreen API call if supported
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      terminalElement?.requestFullscreen?.();
    }
  };

  return (
    <div
      class={`relative w-full h-full flex flex-col ${isFullscreen() ? "fixed inset-0 z-50 bg-black" : ""}`}
    >
      {/* Terminal Header - 显示标题和终端信息 */}
      <div class="flex items-center justify-between p-3 bg-base-100 border-b border-base-300 shrink-0">
        <div class="flex items-center space-x-3">
          {/* 终端状态指示器 */}
          <div class="flex items-center space-x-2">
            <div
              class={`w-2 h-2 rounded-full ${props.isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
            ></div>
            <div class="font-medium text-sm">
              {props.isConnected ? "已连接" : "未连接"}
            </div>
          </div>

          {/* 分隔线 */}
          <div class="w-px h-4 bg-base-300"></div>

          {/* 会话信息 */}
          <div class="flex items-center space-x-2 text-sm">
            <Show when={props.sessionTitle} fallback="RiTerm">
              <span class="font-medium">{props.sessionTitle}</span>
            </Show>
            <Show when={props.terminalType}>
              <span class="opacity-60">({props.terminalType})</span>
            </Show>
          </div>

          {/* 工作目录 */}
          <Show when={props.workingDirectory}>
            <>
              <div class="w-px h-4 bg-base-300"></div>
              <div class="text-xs opacity-50 font-mono hidden sm:block">
                {props.workingDirectory}
              </div>
            </>
          </Show>
        </div>

        <div class="flex items-center space-x-2">
          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowTerminalActions(!showTerminalActions())}
            icon="⚙️"
          >
            <span class="hidden sm:inline">操作</span>
          </EnhancedButton>

          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowSearchBar(!showSearchBar())}
            icon="🔍"
          >
            <span class="hidden sm:inline">搜索</span>
          </EnhancedButton>

          <Show when={props.enablePerformanceMonitoring}>
            <EnhancedButton
              variant="ghost"
              size="sm"
              onClick={() => setShowPerformanceStats(!showPerformanceStats())}
              icon="📊"
            >
              <span class="hidden sm:inline">性能</span>
            </EnhancedButton>
          </Show>

          {/* 显示电池状态 */}
          <Show when={batteryOptimized()}>
            <div class="text-xs opacity-70 hidden sm:block">
              🔋 省电模式
            </div>
          </Show>

          <div class="text-xs opacity-70 hidden sm:block">
            字体: {fontSize()}px
          </div>

          <Show when={props.enablePerformanceMonitoring}>
            <div class="text-xs opacity-70 hidden md:block">
              渲染器: {activeRenderer()}{batteryOptimized() ? " (省电)" : ""}
            </div>
          </Show>

          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            icon={isFullscreen() ? "🗗" : "⛶"}
          >
            <span class="hidden sm:inline">
              {isFullscreen() ? "退出" : "全屏"}
            </span>
          </EnhancedButton>
        </div>
      </div>

      {/* Performance Stats Panel */}
      <Show when={showPerformanceStats() && props.enablePerformanceMonitoring}>
        <div class="p-3 bg-base-200 border-b border-base-300">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">性能统计</span>
            <EnhancedButton
              variant="ghost"
              size="xs"
              onClick={() => setShowPerformanceStats(false)}
              icon="✕"
            >
              关闭
            </EnhancedButton>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div class="bg-base-100 p-2 rounded">
              <div class="text-xs opacity-60">帧率 (FPS)</div>
              <div class="font-mono font-bold text-primary">{performanceStats().fps}</div>
            </div>

            <div class="bg-base-100 p-2 rounded">
              <div class="text-xs opacity-60">帧时间 (ms)</div>
              <div class="font-mono font-bold text-secondary">{performanceStats().frameTime.toFixed(1)}</div>
            </div>

            <div class="bg-base-100 p-2 rounded">
              <div class="text-xs opacity-60">渲染器</div>
              <div class={`font-mono font-bold capitalize ${activeRenderer() === "webgl" ? "text-green-600" :
                activeRenderer() === "canvas" ? "text-blue-600" : "text-orange-600"
                }`}>
                {activeRenderer()}
              </div>
            </div>

            <div class="bg-base-100 p-2 rounded">
              <div class="text-xs opacity-60">电池状态</div>
              <div class={`font-mono font-bold ${globalBatteryOptimizer.isPowerSaveMode() ? "text-warning" : "text-success"}`}>
                {globalBatteryOptimizer.isPowerSaveMode() ? "🔋 省电" : "⚙️ 正常"}
              </div>
            </div>
          </div>

          {/* 渲染器切换 */}
          <div class="mt-3">
            <div class="text-sm mb-2">渲染器切换：</div>
            <div class="flex space-x-2">
              <EnhancedButton
                variant={activeRenderer() === "webgl" ? "primary" : "outline"}
                size="xs"
                onClick={() => switchRenderer("webgl")}
                disabled={deviceCapabilities().isMobile}
              >
                WebGL
              </EnhancedButton>
              <EnhancedButton
                variant={activeRenderer() === "canvas" ? "primary" : "outline"}
                size="xs"
                onClick={() => switchRenderer("canvas")}
              >
                Canvas
              </EnhancedButton>
              <EnhancedButton
                variant={activeRenderer() === "dom" ? "primary" : "outline"}
                size="xs"
                onClick={() => switchRenderer("dom")}
              >
                DOM
              </EnhancedButton>
            </div>
            <Show when={deviceCapabilities().isMobile}>
              <div class="text-xs opacity-60 mt-1">
                注意：移动设备上禁用WebGL以省电
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Search Bar */}
      <Show when={showSearchBar()}>
        <div class="flex items-center space-x-2 p-2 bg-base-200 border-b border-base-300">
          <div class="flex-1 flex space-x-2">
            <input
              type="text"
              placeholder="Search terminal..."
              class="input input-sm input-bordered flex-1"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSearch(searchQuery());
                }
              }}
            />
            <EnhancedButton
              variant="primary"
              size="sm"
              onClick={() => handleSearch(searchQuery())}
              icon="⬇️"
            >
              Next
            </EnhancedButton>
            <EnhancedButton
              variant="secondary"
              size="sm"
              onClick={() => handleSearch(searchQuery(), "previous")}
              icon="⬆️"
            >
              Prev
            </EnhancedButton>
          </div>
          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowSearchBar(false)}
            icon="✕"
          >
            Close
          </EnhancedButton>
        </div>
      </Show>

      {/* Terminal Actions Panel */}
      <Show when={showTerminalActions()}>
        <div class="p-3 bg-base-200 border-b border-base-300">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <EnhancedButton
              variant="outline"
              size="sm"
              onClick={() => terminal()?.clear()}
              icon="🗑️"
            >
              Clear
            </EnhancedButton>

            <EnhancedButton
              variant="outline"
              size="sm"
              onClick={() => terminal()?.selectAll()}
              icon="📋"
            >
              Select All
            </EnhancedButton>

            <EnhancedButton
              variant="outline"
              size="sm"
              onClick={() => setShowMobileKeyboard(!showMobileKeyboard())}
              icon="⌨️"
            >
              Keyboard
            </EnhancedButton>

            <EnhancedButton
              variant="outline"
              size="sm"
              onClick={() => {
                const currentTerminal = terminal();
                if (currentTerminal) {
                  currentTerminal.reset();
                  // Also reset font size to default
                  setFontSize(14);
                  // Reset renderer to preferred
                  const preferredRenderer = props.preferredRenderer || "webgl";
                  if (preferredRenderer !== activeRenderer()) {
                    switchRenderer(preferredRenderer);
                  }
                  debugTerminal("Terminal reset with default font size 14px and preferred renderer");
                }
              }}
              icon="🔄"
            >
              Reset
            </EnhancedButton>
          </div>

          {/* Font Size Control */}
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm">Font Size:</span>
            <div class="flex items-center space-x-2">
              <EnhancedButton
                variant="ghost"
                size="xs"
                onClick={() => {
                  const newSize = Math.max(fontSize() - 1, 8);
                  if (newSize !== fontSize()) {
                    setFontSize(newSize);
                    debugTerminal(
                      `Font size decreased to ${newSize}px via button`,
                    );
                  }
                }}
                disabled={fontSize() <= 8}
              >
                A-
              </EnhancedButton>
              <span class="text-sm w-12 text-center font-mono bg-base-300 px-2 py-1 rounded">
                {fontSize()}px
              </span>
              <EnhancedButton
                variant="ghost"
                size="xs"
                onClick={() => {
                  const newSize = Math.min(fontSize() + 1, 24);
                  if (newSize !== fontSize()) {
                    setFontSize(newSize);
                    debugTerminal(
                      `Font size increased to ${newSize}px via button`,
                    );
                  }
                }}
                disabled={fontSize() >= 24}
              >
                A+
              </EnhancedButton>
            </div>
          </div>

          {/* 渲染器优化控制 */}
          <Show when={props.enablePerformanceMonitoring}>
            <div class="border-t border-base-300 pt-3">
              <div class="text-sm mb-2">渲染器优化：</div>
              <div class="grid grid-cols-2 gap-2">
                <EnhancedButton
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    // 强制重新初始化渲染器
                    const currentRenderer = activeRenderer();
                    switchRenderer("dom"); // 先切换到DOM
                    setTimeout(() => {
                      switchRenderer(currentRenderer); // 再切换回来
                    }, 100);
                    debugTerminal("Renderer reinitialized");
                  }}
                  icon="🔄"
                >
                  重新初始化
                </EnhancedButton>
                <EnhancedButton
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    // 清理WebGL上下文缓存
                    const canvas = terminalElement?.querySelector("canvas");
                    if (canvas) {
                      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl") as WebGLRenderingContext | null;
                      if (gl) {
                        const ext = gl.getExtension("WEBGL_lose_context");
                        if (ext) {
                          ext.loseContext();
                          setTimeout(() => ext.restoreContext(), 100);
                        }
                      }
                    }
                    debugTerminal("GPU cache cleared");
                  }}
                  icon="🧹"
                >
                  清理GPU缓存
                </EnhancedButton>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* Tab Switcher Indicator - 标签页切换提示 */}
      <Show when={showTabSwitcher() && props.sessionTabs && props.sessionTabs.length > 1}>
        <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-black bg-opacity-80 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <div class="flex items-center space-x-2">
            <span class="text-blue-400">⚙️</span>
            <span>标签页切换</span>
          </div>
          <div class="text-xs opacity-75 mt-1">
            {props.sessionTabs?.find(tab => tab.id === props.currentSessionId)?.title || "未知会话"}
          </div>
        </div>
      </Show>

      {/* Session Tabs - 标签页切换条 */}
      <Show when={props.sessionTabs && props.sessionTabs.length > 1 && props.enableTabSwitching}>
        <div class="bg-base-200 border-b border-base-300 px-2 py-1 shrink-0">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium">会话标签页</span>
            <div class="text-xs opacity-60">
              Ctrl+Tab 切换 | Ctrl+1-9 直接跳转
            </div>
          </div>

          <div class="flex space-x-1 overflow-x-auto">
            <For each={props.sessionTabs}>
              {(tab, index) => (
                <EnhancedButton
                  variant={tab.id === props.currentSessionId ? "primary" : "outline"}
                  size="sm"
                  onClick={() => props.onTabSwitch?.(tab.id)}
                  class={`min-w-0 max-w-48 flex items-center space-x-2 ${tab.id === props.currentSessionId
                    ? "ring-2 ring-primary ring-opacity-50"
                    : ""
                    }`}
                >
                  <div class="flex items-center space-x-2 min-w-0">
                    <span class="text-xs opacity-60 shrink-0">{index() + 1}</span>
                    <div class="min-w-0">
                      <div class="text-xs font-medium truncate">{tab.title}</div>
                      <div class="text-xs opacity-50 truncate">{tab.terminalType} | {tab.workingDirectory}</div>
                    </div>
                  </div>
                  <Show when={props.sessionTabs!.length > 1}>
                    <button
                      class="text-red-400 hover:text-red-300 ml-1 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onTabClose?.(tab.id);
                      }}
                    >
                      ×
                    </button>
                  </Show>
                </EnhancedButton>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Terminal Container with Touch Support and Mobile Optimizations */}
      <div
        class="flex-1 relative overflow-hidden terminal-container"
        style={{
          height: terminalHeight() ? `${terminalHeight()}px` : "100%",
          "max-height": terminalHeight() ? `${terminalHeight()}px` : "100%",
          transition:
            "height 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <SwipeGesture
          onSwipeDown={() => {
            if (!props.keyboardVisible) {
              setShowMobileKeyboard(true);
              props.onKeyboardToggle?.(true);
            }
          }}
          onSwipeUp={() => {
            setShowMobileKeyboard(false);
            props.onKeyboardToggle?.(false);
          }}
          class="w-full h-full"
        >
          <div
            ref={terminalElement}
            id="enhanced-terminal-container"
            class={`terminal-content w-full ${deviceCapabilities().isMobile ? "mobile-terminal" : ""}`}
            style={{
              height: "100%",
              opacity: opacity(),
              background: "transparent",
              // Enhanced scrolling optimizations
              "overflow-x": deviceCapabilities().isMobile ? "auto" : "hidden",
              "overflow-y": "hidden",
              "min-width": deviceCapabilities().isMobile ? "640px" : "auto",
              // Hardware acceleration for smooth scrolling
              transform: "translateZ(0)",
              "will-change": "scroll-position, transform",
              "backface-visibility": "hidden",
              // iOS Safari smooth scrolling optimization
              "-webkit-overflow-scrolling": "touch",
              "scroll-behavior": "smooth",
              // Prevent scroll bouncing
              "overscroll-behavior": "contain",
              // Force GPU layer for better performance
              contain: "layout style paint",
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </SwipeGesture>
      </div>

      {/* Mobile Keyboard */}
      <Show when={showMobileKeyboard() && !props.keyboardVisible}>
        <div
          ref={mobileKeyboardRef}
          class="bg-base-100 border-t border-base-300 p-3 shrink-0 mobile-keyboard fixed-bottom"
          style={{
            animation: "slideUpKeyboard 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">Terminal Keys</span>
            <EnhancedButton
              variant="ghost"
              size="xs"
              onClick={() => setShowMobileKeyboard(false)}
              icon="✕"
            >
              Close
            </EnhancedButton>
          </div>

          <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {commonKeys.map((keyDef) => (
              <EnhancedButton
                variant="outline"
                size="sm"
                onClick={() => sendKey(keyDef.key)}
                haptic
                class={`text-xs ${deviceCapabilities().isMobile ? "min-h-[40px]" : ""}`}
              >
                {keyDef.label}
              </EnhancedButton>
            ))}
          </div>

          {/* 标签页切换按钮（移动端） */}
          <Show when={tabSwitchKeys.length > 0}>
            <div class="mt-3 pt-3 border-t border-base-300">
              <div class="text-xs opacity-60 mb-2">标签页切换</div>
              <div class="grid grid-cols-2 gap-2">
                {tabSwitchKeys.map((tabKey) => (
                  <EnhancedButton
                    variant="secondary"
                    size="sm"
                    onClick={tabKey.action}
                    haptic
                    class="text-xs"
                  >
                    {tabKey.label}
                  </EnhancedButton>
                ))}
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* Floating Action Buttons */}
      <Show
        when={
          !showMobileKeyboard() && !isFullscreen() && !props.keyboardVisible
        }
      >
        <FloatingActionButton
          icon="⌨️"
          onClick={() => {
            setShowMobileKeyboard(true);
            props.onKeyboardToggle?.(true);
          }}
          position="bottom-right"
          variant="primary"
        />
      </Show>
    </div>
  );
}
