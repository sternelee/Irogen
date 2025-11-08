import { createStore, reconcile } from 'solid-js/store';

export interface TerminalSession {
  terminalId: string; // 以terminalId作为主要键
  sessionId: string;
  name?: string;
  shellType: string;
  currentDir: string;
  status: "Starting" | "Running" | "Paused" | "Stopped";
  createdAt: number;
  lastActivity: number;
  size: [number, number];
  processId?: number;
  // 会话恢复相关数据
  terminalContent?: string; // 终端内容缓存
  scrollback?: string[]; // 滚动历史
  workingDirectory?: string; // 当前工作目录
  environmentVars?: Record<string, string>; // 环境变量
  commandHistory?: string[]; // 命令历史
  lastCommand?: string; // 最后执行的命令
  connectionState?: 'connected' | 'disconnected' | 'reconnecting'; // 连接状态
}

export interface TerminalSessionState {
  sessions: Record<string, TerminalSession>; // terminalId -> TerminalSession
  activeTerminalId: string | null;
  recentlyUsed: string[]; // 最近使用的terminal IDs
  sessionSettings: {
    saveContent: boolean; // 是否保存终端内容
    maxScrollbackLines: number; // 最大滚动行数
    autoSaveInterval: number; // 自动保存间隔(毫秒)
  };
}

const TERMINAL_SESSIONS_KEY = 'riterm-terminal-sessions';
const RECENTLY_USED_KEY = 'riterm-recently-used-sessions';

const DEFAULT_STATE: TerminalSessionState = {
  sessions: {},
  activeTerminalId: null,
  recentlyUsed: [],
  sessionSettings: {
    saveContent: true,
    maxScrollbackLines: 1000,
    autoSaveInterval: 5000, // 5秒自动保存
  },
};

class TerminalSessionStore {
  private state: TerminalSessionState;
  private listeners: Set<() => void> = new Set();
  private autoSaveTimer?: NodeJS.Timeout;

  constructor() {
    this.state = this.loadFromStorage();
    this.startAutoSave();
  }

  // 从本地存储加载状态
  private loadFromStorage(): TerminalSessionState {
    try {
      const sessionsData = localStorage.getItem(TERMINAL_SESSIONS_KEY);
      const recentlyUsedData = localStorage.getItem(RECENTLY_USED_KEY);

      const sessions = sessionsData ? JSON.parse(sessionsData) : {};
      const recentlyUsed = recentlyUsedData ? JSON.parse(recentlyUsedData) : [];

      // 清理损坏的数据
      const cleanedSessions = this.cleanupCorruptedSessions(sessions);

      return {
        ...DEFAULT_STATE,
        sessions: cleanedSessions,
        recentlyUsed,
      };
    } catch (error) {
      console.error('Failed to load terminal sessions from storage:', error);
      return { ...DEFAULT_STATE };
    }
  }

  // 清理损坏的会话数据
  private cleanupCorruptedSessions(sessions: any): Record<string, TerminalSession> {
    const cleaned: Record<string, TerminalSession> = {};

    Object.entries(sessions).forEach(([sessionId, session]) => {
      if (this.isValidSession(session as TerminalSession)) {
        cleaned[sessionId] = session as TerminalSession;
      }
    });

    return cleaned;
  }

  // 验证会话数据是否有效
  private isValidSession(session: any): boolean {
    return (
      session &&
      typeof session.terminalId === 'string' &&
      typeof session.sessionId === 'string' &&
      typeof session.createdAt === 'number'
    );
  }

  // 保存到本地存储
  private saveToStorage() {
    try {
      localStorage.setItem(TERMINAL_SESSIONS_KEY, JSON.stringify(this.state.sessions));
      localStorage.setItem(RECENTLY_USED_KEY, JSON.stringify(this.state.recentlyUsed));
    } catch (error) {
      console.error('Failed to save terminal sessions to storage:', error);
    }
  }

  // 通知监听器
  private notify() {
    this.listeners.forEach(listener => listener());
  }

  // 开始自动保存
  private startAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      this.saveToStorage();
    }, this.state.sessionSettings.autoSaveInterval);
  }

  // 停止自动保存
  private stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  // 获取当前状态
  getState(): TerminalSessionState {
    return this.state;
  }

  // 添加新会话
  addSession(session: Omit<TerminalSession, 'lastActivity'>): void {
    const fullSession: TerminalSession = {
      ...session,
      lastActivity: Date.now(),
    };

    this.state.sessions[session.terminalId] = fullSession;
    this.updateRecentlyUsed(session.terminalId);
    this.notify();
    this.saveToStorage();
  }

  // 更新会话
  updateSession(terminalId: string, updates: Partial<TerminalSession>): void {
    const session = this.state.sessions[terminalId];
    if (!session) return;

    this.state.sessions[terminalId] = {
      ...session,
      ...updates,
      lastActivity: Date.now(),
    };

    this.updateRecentlyUsed(terminalId);
    this.notify();
  }

  // 删除会话
  removeSession(terminalId: string): void {
    delete this.state.sessions[terminalId];
    this.state.recentlyUsed = this.state.recentlyUsed.filter(id => id !== terminalId);

    if (this.state.activeTerminalId === terminalId) {
      this.state.activeTerminalId = null;
    }

    this.notify();
    this.saveToStorage();
  }

  // 获取会话
  getSession(terminalId: string): TerminalSession | undefined {
    return this.state.sessions[terminalId];
  }

  // 设置活动终端
  setActiveTerminal(terminalId: string | null): void {
    if (terminalId && !this.state.sessions[terminalId]) return;

    this.state.activeTerminalId = terminalId;
    if (terminalId) {
      this.updateRecentlyUsed(terminalId);
    }
    this.notify();
  }

  // 获取活动终端（保持向后兼容）
  setActiveSession(sessionId: string | null): void {
    this.setActiveTerminal(sessionId);
  }

  // 更新最近使用列表
  private updateRecentlyUsed(sessionId: string): void {
    const recentlyUsed = this.state.recentlyUsed.filter(id => id !== sessionId);
    recentlyUsed.unshift(sessionId);

    // 最多保存10个最近使用的会话
    this.state.recentlyUsed = recentlyUsed.slice(0, 10);
  }

  // 保存终端内容
  saveTerminalContent(terminalId: string, content: string, scrollback?: string[]): void {
    const session = this.state.sessions[terminalId];
    if (!session || !this.state.sessionSettings.saveContent) return;

    const limitedScrollback = scrollback
      ? scrollback.slice(-this.state.sessionSettings.maxScrollbackLines)
      : [];

    this.updateSession(terminalId, {
      terminalContent: content,
      scrollback: limitedScrollback,
    });
  }

  // 保存命令历史
  saveCommandHistory(terminalId: string, commands: string[]): void {
    const session = this.state.sessions[terminalId];
    if (!session) return;

    this.updateSession(terminalId, {
      commandHistory: commands.slice(-100), // 最多保存100条命令历史
    });
  }

  // 保存工作目录
  saveWorkingDirectory(terminalId: string, directory: string): void {
    const session = this.state.sessions[terminalId];
    if (!session) return;

    this.updateSession(terminalId, {
      currentDir: directory,
      workingDirectory: directory,
    });
  }

  // 保存最后执行的命令
  saveLastCommand(terminalId: string, command: string): void {
    const session = this.state.sessions[terminalId];
    if (!session) return;

    this.updateSession(terminalId, {
      lastCommand: command,
    });
  }

  // 更新连接状态
  updateConnectionState(terminalId: string, state: 'connected' | 'disconnected' | 'reconnecting'): void {
    const session = this.state.sessions[terminalId];
    if (!session) return;

    this.updateSession(terminalId, {
      connectionState: state,
    });
  }

  // 更新设置
  updateSettings(settings: Partial<TerminalSessionState['sessionSettings']>): void {
    this.state.sessionSettings = {
      ...this.state.sessionSettings,
      ...settings,
    };

    this.stopAutoSave();
    this.startAutoSave();
    this.notify();
    this.saveToStorage();
  }

  // 清理过期会话
  cleanupExpiredSessions(maxAge: number = 7 * 24 * 60 * 60 * 1000): void { // 默认7天
    const now = Date.now();
    const expiredSessions: string[] = [];

    Object.entries(this.state.sessions).forEach(([sessionId, session]) => {
      if (now - session.lastActivity > maxAge) {
        expiredSessions.push(sessionId);
      }
    });

    expiredSessions.forEach(sessionId => this.removeSession(sessionId));
  }

  // 获取会话统计信息
  getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    runningSessions: number;
    totalContent: number;
  } {
    const sessions = Object.values(this.state.sessions);

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.connectionState === 'connected').length,
      runningSessions: sessions.filter(s => s.status === 'Running').length,
      totalContent: sessions.reduce((sum, s) => sum + (s.terminalContent?.length || 0), 0),
    };
  }

  // 导出会话数据
  exportSessions(): string {
    return JSON.stringify(this.state.sessions, null, 2);
  }

  // 导入会话数据
  importSessions(data: string): boolean {
    try {
      const sessions = JSON.parse(data);
      if (typeof sessions === 'object') {
        this.state.sessions = this.cleanupCorruptedSessions(sessions);
        this.notify();
        this.saveToStorage();
        return true;
      }
    } catch (error) {
      console.error('Failed to import sessions:', error);
    }
    return false;
  }

  // 清除所有会话
  clearAllSessions(): void {
    this.state.sessions = {};
    this.state.activeTerminalId = null;
    this.state.recentlyUsed = [];
    this.notify();
    this.saveToStorage();
  }

  // 订阅状态变化
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // 销毁store
  destroy(): void {
    this.stopAutoSave();
    this.saveToStorage();
    this.listeners.clear();
  }
}

// 创建全局store实例
export const terminalSessionStore = new TerminalSessionStore();

// SolidJS store wrapper
export const useTerminalSessions = () => {
  const [state, setState] = createStore(terminalSessionStore.getState());

  // 订阅store变化
  terminalSessionStore.subscribe(() => {
    setState(reconcile(terminalSessionStore.getState()));
  });

  return {
    // 状态
    state,
    sessions: () => state.sessions,
    activeTerminal: () => state.activeTerminalId ? state.sessions[state.activeTerminalId] : null,
    activeSession: () => state.activeTerminalId ? state.sessions[state.activeTerminalId] : null, // 向后兼容
    recentlyUsed: () => state.recentlyUsed,
    settings: () => state.sessionSettings,

    // 方法
    addSession: terminalSessionStore.addSession.bind(terminalSessionStore),
    updateSession: terminalSessionStore.updateSession.bind(terminalSessionStore),
    removeSession: terminalSessionStore.removeSession.bind(terminalSessionStore),
    getSession: terminalSessionStore.getSession.bind(terminalSessionStore),
    setActiveTerminal: terminalSessionStore.setActiveTerminal.bind(terminalSessionStore),
    setActiveSession: terminalSessionStore.setActiveSession.bind(terminalSessionStore), // 向后兼容
    saveTerminalContent: terminalSessionStore.saveTerminalContent.bind(terminalSessionStore),
    saveCommandHistory: terminalSessionStore.saveCommandHistory.bind(terminalSessionStore),
    saveWorkingDirectory: terminalSessionStore.saveWorkingDirectory.bind(terminalSessionStore),
    saveLastCommand: terminalSessionStore.saveLastCommand.bind(terminalSessionStore),
    updateConnectionState: terminalSessionStore.updateConnectionState.bind(terminalSessionStore),
    updateSettings: terminalSessionStore.updateSettings.bind(terminalSessionStore),
    cleanupExpiredSessions: terminalSessionStore.cleanupExpiredSessions.bind(terminalSessionStore),
    getSessionStats: terminalSessionStore.getSessionStats.bind(terminalSessionStore),
    exportSessions: terminalSessionStore.exportSessions.bind(terminalSessionStore),
    importSessions: terminalSessionStore.importSessions.bind(terminalSessionStore),
    clearAllSessions: terminalSessionStore.clearAllSessions.bind(terminalSessionStore),
  };
};
