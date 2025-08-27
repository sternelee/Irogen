// 电池优化工具 - 移动设备终端应用专用
// 监控电池状态并自动调整性能设置

export interface BatteryState {
  level: number; // 0-1
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

export interface PowerSaveConfig {
  enableAnimations: boolean;
  useWebGLRenderer: boolean;
  maxScrollback: number;
  refreshRate: number; // FPS
  enableCursorBlink: boolean;
  enableTransparency: boolean;
  fontSmoothing: boolean;
}

export class BatteryOptimizer {
  private batteryState: BatteryState = {
    level: 1,
    charging: true,
    chargingTime: 0,
    dischargingTime: 0,
  };

  private battery: any = null;
  private powerSaveMode = false;
  private callbacks: Array<(config: PowerSaveConfig) => void> = [];
  private updateInterval: number | null = null;

  async initialize(): Promise<void> {
    if (!this.isBatteryAPISupported()) {
      console.warn('Battery API not supported, using default power settings');
      return;
    }

    try {
      this.battery = await (navigator as any).getBattery();
      this.updateBatteryState();
      this.setupEventListeners();

      // 定期更新电池状态（低频率以节省电量）
      this.updateInterval = window.setInterval(() => {
        this.updateBatteryState();
      }, 30000); // 30秒更新一次

      console.log('🔋 Battery optimizer initialized');
    } catch (error) {
      console.error('Failed to initialize battery optimizer:', error);
    }
  }

  private isBatteryAPISupported(): boolean {
    return 'getBattery' in navigator;
  }

  private setupEventListeners(): void {
    if (!this.battery) return;

    // 电池电量变化
    this.battery.addEventListener('levelchange', () => {
      this.updateBatteryState();
    });

    // 充电状态变化
    this.battery.addEventListener('chargingchange', () => {
      this.updateBatteryState();
    });

    // 充电时间变化
    this.battery.addEventListener('chargingtimechange', () => {
      this.updateBatteryState();
    });

    // 放电时间变化
    this.battery.addEventListener('dischargingtimechange', () => {
      this.updateBatteryState();
    });
  }

  private updateBatteryState(): void {
    if (!this.battery) return;

    const previousPowerSaveMode = this.powerSaveMode;

    this.batteryState = {
      level: this.battery.level,
      charging: this.battery.charging,
      chargingTime: this.battery.chargingTime,
      dischargingTime: this.battery.dischargingTime,
    };

    // 更新全局电池状态（供其他模块使用）
    (window as any).__batteryLevel = this.batteryState.level;

    // 判断是否需要启用省电模式
    const shouldEnablePowerSave = this.shouldEnablePowerSaveMode();

    if (shouldEnablePowerSave !== previousPowerSaveMode) {
      this.powerSaveMode = shouldEnablePowerSave;
      const config = this.getPowerSaveConfig();

      console.log(`🔋 Power save mode ${shouldEnablePowerSave ? 'enabled' : 'disabled'} (battery: ${(this.batteryState.level * 100).toFixed(1)}%)`);

      // 通知所有监听器
      this.callbacks.forEach(callback => callback(config));

      // 更新DOM类
      this.updateDOMClasses();
    }
  }

  private shouldEnablePowerSaveMode(): boolean {
    const { level, charging } = this.batteryState;

    // 电池电量低于30%且未充电时启用省电模式
    if (level < 0.3 && !charging) return true;

    // 电池电量低于15%时无论是否充电都启用省电模式
    if (level < 0.15) return true;

    return false;
  }

  private getPowerSaveConfig(): PowerSaveConfig {
    const { level, charging } = this.batteryState;

    if (this.powerSaveMode) {
      // 省电模式配置
      const isLowBattery = level < 0.15;

      return {
        enableAnimations: false,
        useWebGLRenderer: false, // 强制使用DOM渲染器
        maxScrollback: isLowBattery ? 1000 : 2000,
        refreshRate: isLowBattery ? 15 : 30,
        enableCursorBlink: false,
        enableTransparency: false,
        fontSmoothing: false,
      };
    } else {
      // 正常模式配置
      return {
        enableAnimations: true,
        useWebGLRenderer: level > 0.5, // 电量充足时才使用WebGL
        maxScrollback: 10000,
        refreshRate: 60,
        enableCursorBlink: true,
        enableTransparency: true,
        fontSmoothing: true,
      };
    }
  }

  private updateDOMClasses(): void {
    const root = document.documentElement;

    if (this.powerSaveMode) {
      root.classList.add('power-save-mode');
      root.classList.add('reduce-animations');
      root.classList.add('low-refresh-rate');
    } else {
      root.classList.remove('power-save-mode');
      root.classList.remove('reduce-animations');
      root.classList.remove('low-refresh-rate');
    }

    // 电池电量等级类
    root.classList.remove('battery-critical', 'battery-low', 'battery-normal', 'battery-high');

    if (this.batteryState.level < 0.15) {
      root.classList.add('battery-critical');
    } else if (this.batteryState.level < 0.3) {
      root.classList.add('battery-low');
    } else if (this.batteryState.level < 0.8) {
      root.classList.add('battery-normal');
    } else {
      root.classList.add('battery-high');
    }

    // 充电状态类
    root.classList.toggle('battery-charging', this.batteryState.charging);
  }

  // 公共API
  onConfigChange(callback: (config: PowerSaveConfig) => void): () => void {
    this.callbacks.push(callback);

    // 立即调用一次以获取当前配置
    callback(this.getPowerSaveConfig());

    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  getCurrentConfig(): PowerSaveConfig {
    return this.getPowerSaveConfig();
  }

  getBatteryState(): BatteryState {
    return { ...this.batteryState };
  }

  isPowerSaveMode(): boolean {
    return this.powerSaveMode;
  }

  // 手动设置省电模式（用于测试或用户强制设置）
  setPowerSaveMode(enabled: boolean): void {
    this.powerSaveMode = enabled;
    const config = this.getPowerSaveConfig();
    this.callbacks.forEach(callback => callback(config));
    this.updateDOMClasses();

    console.log(`🔋 Power save mode manually ${enabled ? 'enabled' : 'disabled'}`);
  }

  destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.callbacks = [];
    this.battery = null;

    // 清理DOM类
    const root = document.documentElement;
    root.classList.remove(
      'power-save-mode', 'reduce-animations', 'low-refresh-rate',
      'battery-critical', 'battery-low', 'battery-normal', 'battery-high',
      'battery-charging'
    );
  }

  // 获取电池信息的静态方法（供其他模块使用）
  static getBatteryLevel(): number {
    return (window as any).__batteryLevel || 1;
  }

  // 获取推荐的渲染器类型
  getRecommendedRenderer(): 'dom' | 'canvas' | 'webgl' {
    const config = this.getPowerSaveConfig();
    const { level, charging } = this.batteryState;

    if (!config.useWebGLRenderer || level < 0.3) {
      return level < 0.15 ? 'dom' : 'canvas';
    }

    return 'webgl';
  }

  // 获取建议的终端配置
  getTerminalOptimizations(): {
    scrollback: number;
    cursorBlink: boolean;
    transparency: boolean;
    animations: boolean;
  } {
    const config = this.getPowerSaveConfig();

    return {
      scrollback: config.maxScrollback,
      cursorBlink: config.enableCursorBlink,
      transparency: config.enableTransparency,
      animations: config.enableAnimations,
    };
  }
}

// 全局实例
export const globalBatteryOptimizer = new BatteryOptimizer();

// 初始化CSS样式以支持电池优化
export function injectBatteryOptimizationStyles(): void {
  if (document.getElementById('battery-optimization-styles')) return;

  const styles = document.createElement('style');
  styles.id = 'battery-optimization-styles';
  styles.textContent = `
    /* 省电模式样式 */
    .power-save-mode {
      --animation-duration: 0s !important;
      --transition-duration: 0s !important;
    }

    .power-save-mode * {
      animation-duration: 0s !important;
      transition-duration: 0s !important;
      animation-delay: 0s !important;
      transition-delay: 0s !important;
    }

    /* 减少动画 */
    .reduce-animations {
      --loading-spinner-duration: 2s;
    }

    .reduce-animations .loading-spinner {
      animation-duration: var(--loading-spinner-duration) !important;
    }

    /* 低刷新率模式 */
    .low-refresh-rate {
      --refresh-rate: 30fps;
    }

    /* 电池电量等级样式 */
    .battery-critical {
      --terminal-background: rgba(17, 24, 39, 1); /* 完全不透明以节省GPU */
      --animation-enabled: 0;
    }

    .battery-low {
      --terminal-background: rgba(17, 24, 39, 0.98);
      --animation-enabled: 0;
    }

    .battery-normal {
      --terminal-background: rgba(17, 24, 39, 0.95);
      --animation-enabled: 1;
    }

    .battery-high {
      --terminal-background: rgba(17, 24, 39, 0.95);
      --animation-enabled: 1;
    }

    /* 充电状态指示器 */
    .battery-charging::after {
      content: '⚡';
      position: fixed;
      top: 10px;
      right: 10px;
      color: #10B981;
      font-size: 12px;
      z-index: 9999;
      opacity: 0.7;
    }

    /* 终端电池优化 */
    .power-save-mode .terminal-content {
      image-rendering: pixelated;
      text-rendering: optimizeSpeed;
    }

    .power-save-mode .xterm-viewport {
      scroll-behavior: auto !important;
    }
  `;

  document.head.appendChild(styles);
}
