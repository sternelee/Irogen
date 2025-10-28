import { createSignal, createEffect, batch } from "solid-js";

// 终端会话数据接口
export interface TerminalSession {
  id: string;
  ticket: string;
  title: string;
  terminalType: string;
  workingDirectory: string;
  status: "connecting" | "connected" | "disconnected" | "failed" | "reconnecting";
  createdAt: Date;
  lastActiveAt: Date;
  // 终端上下文数据
  context: {
    // 终端历史记录
    history: string[];
    // 当前目录
    currentDirectory: string;
    // 环境变量
    environment: Record<string, string>;
    // 终端状态（光标位置等）
    cursorPosition: { row: number; col: number };
    // 字体大小
    fontSize: number;
    // 滚动位置
    scrollPosition: number;
    // 选择的渲染器
    renderer: "webgl" | "canvas" | "dom";
  };
  // 统计信息
  stats: {
    totalCommands: number;
    charactersTyped: number;
    sessionDuration: number; // 分钟
    dataTransferred: number; // 字节
  };
}

// 全局终端状态管理接口
interface TerminalStore {
  // 当前活动会话
  activeSessionId: string | null;
  // 所有会话
  sessions: Map<string, TerminalSession>;
  // 按最后活动时间排序的会话ID列表
  sessionOrder: string[];
}

// 创建全局状态
const [terminalStore, setTerminalStore] = createSignal<TerminalStore>({
  activeSessionId: null,
  sessions: new Map(),
  sessionOrder: [],
});

// 动作类型
type TerminalAction =
  | { type: "CREATE_SESSION"; payload: Omit<TerminalSession, "createdAt" | "lastActiveAt"> }
  | { type: "UPDATE_SESSION"; payload: { id: string; updates: Partial<TerminalSession> } }
  | { type: "DELETE_SESSION"; payload: string }
  | { type: "SET_ACTIVE_SESSION"; payload: string | null }
  | { type: "APPEND_HISTORY"; payload: { id: string; content: string } }
  | { type: "UPDATE_CONTEXT"; payload: { id: string; context: Partial<TerminalSession["context"]> } }
  | { type: "UPDATE_STATS"; payload: { id: string; stats: Partial<TerminalSession["stats"]> } }
  | { type: "REORDER_SESSIONS"; payload: string[] };

// 状态管理器
class TerminalStateManager {
  // 获取当前状态
  getState() {
    return terminalStore();
  }

  // 获取特定会话
  getSession(id: string): TerminalSession | undefined {
    return this.getState().sessions.get(id);
  }

  // 获取活动会话
  getActiveSession(): TerminalSession | undefined {
    const state = this.getState();
    if (!state.activeSessionId) return undefined;
    return state.sessions.get(state.activeSessionId);
  }

  // 获取所有会话
  getAllSessions(): TerminalSession[] {
    const state = this.getState();
    return state.sessionOrder
      .map(id => state.sessions.get(id))
      .filter(Boolean) as TerminalSession[];
  }

  // 创建新会话
  createSession(sessionData: Omit<TerminalSession, "createdAt" | "lastActiveAt">) {
    const now = new Date();
    const newSession: TerminalSession = {
      ...sessionData,
      createdAt: now,
      lastActiveAt: now,
      context: {
        history: [],
        currentDirectory: sessionData.workingDirectory || "~",
        environment: {},
        cursorPosition: { row: 0, col: 0 },
        fontSize: 14,
        scrollPosition: 0,
        renderer: "dom",
        ...sessionData.context,
      },
      stats: {
        totalCommands: 0,
        charactersTyped: 0,
        sessionDuration: 0,
        dataTransferred: 0,
        ...sessionData.stats,
      },
    };

    this.dispatch({
      type: "CREATE_SESSION",
      payload: sessionData,
    });

    return newSession;
  }

  // 更新会话
  updateSession(id: string, updates: Partial<TerminalSession>) {
    this.dispatch({
      type: "UPDATE_SESSION",
      payload: { id, updates },
    });
  }

  // 删除会话
  deleteSession(id: string) {
    this.dispatch({
      type: "DELETE_SESSION",
      payload: id,
    });
  }

  // 设置活动会话
  setActiveSession(id: string | null) {
    if (id) {
      this.updateSession(id, { lastActiveAt: new Date() });
    }
    this.dispatch({
      type: "SET_ACTIVE_SESSION",
      payload: id,
    });
  }

  // 添加历史记录
  appendHistory(id: string, content: string) {
    const session = this.getSession(id);
    if (session) {
      const updatedHistory = [...session.context.history, content];
      // 限制历史记录长度，避免内存溢出
      const maxHistoryLength = 10000;
      if (updatedHistory.length > maxHistoryLength) {
        updatedHistory.splice(0, updatedHistory.length - maxHistoryLength);
      }

      this.updateContext(id, { history: updatedHistory });
      this.updateStats(id, {
        dataTransferred: session.stats.dataTransferred + content.length
      });
    }
  }

  // 更新上下文
  updateContext(id: string, context: Partial<TerminalSession["context"]>) {
    this.dispatch({
      type: "UPDATE_CONTEXT",
      payload: { id, context },
    });
  }

  // 更新统计信息
  updateStats(id: string, stats: Partial<TerminalSession["stats"]>) {
    this.dispatch({
      type: "UPDATE_STATS",
      payload: { id, stats },
    });
  }

  // 记录用户输入
  recordUserInput(id: string, input: string) {
    const session = this.getSession(id);
    if (session) {
      this.updateStats(id, {
        charactersTyped: session.stats.charactersTyped + input.length,
      });

      // 检测是否是命令（以换行结尾）
      if (input.includes('\n') || input.includes('\r')) {
        this.updateStats(id, {
          totalCommands: session.stats.totalCommands + 1,
        });
      }
    }
  }

  // 重新排序会话
  reorderSessions(newOrder: string[]) {
    this.dispatch({
      type: "REORDER_SESSIONS",
      payload: newOrder,
    });
  }

  // 持久化状态到 localStorage
  saveToStorage() {
    try {
      const state = this.getState();
      const serializableState = {
        activeSessionId: state.activeSessionId,
        sessions: Array.from(state.sessions.entries()),
        sessionOrder: state.sessionOrder,
      };
      localStorage.setItem('terminal-sessions', JSON.stringify(serializableState));
    } catch (error) {
      console.warn('Failed to save terminal sessions to storage:', error);
    }
  }

  // 从 localStorage 恢复状态
  loadFromStorage() {
    try {
      const stored = localStorage.getItem('terminal-sessions');
      if (stored) {
        const data = JSON.parse(stored);
        const sessions = new Map(data.sessions.map(([id, session]: [string, any]) => [
          id,
          {
            ...session,
            createdAt: new Date(session.createdAt),
            lastActiveAt: new Date(session.lastActiveAt),
          },
        ]));

        batch(() => {
          setTerminalStore({
            activeSessionId: data.activeSessionId,
            sessions,
            sessionOrder: data.sessionOrder,
          });
        });
      }
    } catch (error) {
      console.warn('Failed to load terminal sessions from storage:', error);
    }
  }

  // 清理过期的会话
  cleanupOldSessions(maxAge: number = 7 * 24 * 60 * 60 * 1000) { // 默认7天
    const now = Date.now();
    const state = this.getState();
    const expiredSessions: string[] = [];

    state.sessions.forEach((session, id) => {
      if (now - session.lastActiveAt.getTime() > maxAge) {
        expiredSessions.push(id);
      }
    });

    expiredSessions.forEach(id => this.deleteSession(id));

    if (expiredSessions.length > 0) {
      console.log(`Cleaned up ${expiredSessions.length} expired terminal sessions`);
    }
  }

  // 导出会话数据
  exportSessions() {
    const state = this.getState();
    return {
      version: "1.0",
      exportDate: new Date().toISOString(),
      sessions: Array.from(state.sessions.entries()).map(([id, session]) => ({
        id,
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
      })),
      activeSessionId: state.activeSessionId,
    };
  }

  // 导入会话数据
  importSessions(data: any) {
    try {
      if (data.version && data.sessions) {
        const sessions = new Map(
          data.sessions.map((sessionData: any) => [
            sessionData.id,
            {
              ...sessionData,
              createdAt: new Date(sessionData.createdAt),
              lastActiveAt: new Date(sessionData.lastActiveAt),
            },
          ])
        );

        const sessionOrder = sessions.size > 0 ? Array.from(sessions.keys()) : [];

        batch(() => {
          setTerminalStore({
            activeSessionId: data.activeSessionId || sessionOrder[0] || null,
            sessions,
            sessionOrder,
          });
        });

        return true;
      }
    } catch (error) {
      console.error('Failed to import sessions:', error);
    }
    return false;
  }

  // 分发动作
  private dispatch(action: TerminalAction) {
    const currentState = this.getState();
    let newState = { ...currentState };

    switch (action.type) {
      case "CREATE_SESSION": {
        const now = new Date();
        const newSession: TerminalSession = {
          ...action.payload,
          createdAt: now,
          lastActiveAt: now,
          context: {
            history: [],
            currentDirectory: action.payload.workingDirectory || "~",
            environment: {},
            cursorPosition: { row: 0, col: 0 },
            fontSize: 14,
            scrollPosition: 0,
            renderer: "dom",
            ...action.payload.context,
          },
          stats: {
            totalCommands: 0,
            charactersTyped: 0,
            sessionDuration: 0,
            dataTransferred: 0,
            ...action.payload.stats,
          },
        };

        newState.sessions = new Map(currentState.sessions);
        newState.sessions.set(action.payload.id, newSession);
        newState.sessionOrder = [...currentState.sessionOrder, action.payload.id];
        break;
      }

      case "UPDATE_SESSION": {
        const { id, updates } = action.payload;
        const session = currentState.sessions.get(id);
        if (session) {
          newState.sessions = new Map(currentState.sessions);
          newState.sessions.set(id, { ...session, ...updates, lastActiveAt: new Date() });
        }
        break;
      }

      case "DELETE_SESSION": {
        const id = action.payload;
        newState.sessions = new Map(currentState.sessions);
        newState.sessions.delete(id);
        newState.sessionOrder = currentState.sessionOrder.filter(sid => sid !== id);
        if (newState.activeSessionId === id) {
          newState.activeSessionId = newState.sessionOrder[0] || null;
        }
        break;
      }

      case "SET_ACTIVE_SESSION": {
        newState.activeSessionId = action.payload;
        break;
      }

      case "APPEND_HISTORY": {
        const { id, content } = action.payload;
        const session = currentState.sessions.get(id);
        if (session) {
          const updatedHistory = [...session.context.history, content];
          const maxHistoryLength = 10000;
          if (updatedHistory.length > maxHistoryLength) {
            updatedHistory.splice(0, updatedHistory.length - maxHistoryLength);
          }

          newState.sessions = new Map(currentState.sessions);
          newState.sessions.set(id, {
            ...session,
            context: { ...session.context, history: updatedHistory },
            stats: { ...session.stats, dataTransferred: session.stats.dataTransferred + content.length },
            lastActiveAt: new Date(),
          });
        }
        break;
      }

      case "UPDATE_CONTEXT": {
        const { id, context } = action.payload;
        const session = currentState.sessions.get(id);
        if (session) {
          newState.sessions = new Map(currentState.sessions);
          newState.sessions.set(id, {
            ...session,
            context: { ...session.context, ...context },
            lastActiveAt: new Date(),
          });
        }
        break;
      }

      case "UPDATE_STATS": {
        const { id, stats } = action.payload;
        const session = currentState.sessions.get(id);
        if (session) {
          newState.sessions = new Map(currentState.sessions);
          newState.sessions.set(id, {
            ...session,
            stats: { ...session.stats, ...stats },
            lastActiveAt: new Date(),
          });
        }
        break;
      }

      case "REORDER_SESSIONS": {
        newState.sessionOrder = action.payload;
        break;
      }
    }

    batch(() => {
      setTerminalStore(newState);
    });
  }
}

// 创建全局状态管理器实例
export const terminalStateManager = new TerminalStateManager();

// 响应式钩子
export function useTerminalStore() {
  const state = terminalStore();

  return {
    // 状态
    sessions: () => terminalStateManager.getAllSessions(),
    activeSession: () => terminalStateManager.getActiveSession(),
    activeSessionId: () => state.activeSessionId,

    // 动作
    createSession: terminalStateManager.createSession.bind(terminalStateManager),
    updateSession: terminalStateManager.updateSession.bind(terminalStateManager),
    deleteSession: terminalStateManager.deleteSession.bind(terminalStateManager),
    setActiveSession: terminalStateManager.setActiveSession.bind(terminalStateManager),
    appendHistory: terminalStateManager.appendHistory.bind(terminalStateManager),
    updateContext: terminalStateManager.updateContext.bind(terminalStateManager),
    updateStats: terminalStateManager.updateStats.bind(terminalStateManager),
    recordUserInput: terminalStateManager.recordUserInput.bind(terminalStateManager),
    reorderSessions: terminalStateManager.reorderSessions.bind(terminalStateManager),

    // 持久化
    saveToStorage: terminalStateManager.saveToStorage.bind(terminalStateManager),
    loadFromStorage: terminalStateManager.loadFromStorage.bind(terminalStateManager),
    cleanupOldSessions: terminalStateManager.cleanupOldSessions.bind(terminalStateManager),

    // 导入导出
    exportSessions: terminalStateManager.exportSessions.bind(terminalStateManager),
    importSessions: terminalStateManager.importSessions.bind(terminalStateManager),
  };
}

// 自动保存效果
createEffect(() => {
  const state = terminalStore();
  // 防抖保存
  const timeoutId = setTimeout(() => {
    terminalStateManager.saveToStorage();
  }, 1000);

  return () => clearTimeout(timeoutId);
});

// 页面加载时恢复状态
if (typeof window !== 'undefined') {
  terminalStateManager.loadFromStorage();

  // 定期清理过期会话
  setInterval(() => {
    terminalStateManager.cleanupOldSessions();
  }, 24 * 60 * 60 * 1000); // 每天清理一次
}