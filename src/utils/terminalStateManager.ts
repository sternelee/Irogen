import { Terminal } from "@xterm/xterm";
import { terminalStateManager, useTerminalStore } from "../stores/terminalStore";

// 终端状态快照接口
export interface TerminalSnapshot {
  // 终端内容
  buffer: string;
  // 光标位置
  cursorX: number;
  cursorY: number;
  // 滚动位置
  scrollTop: number;
  // 选择区域
  selection?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  // 终端设置
  options: {
    fontSize: number;
    fontFamily: string;
    theme: any;
  };
  // 时间戳
  timestamp: Date;
}

// 终端会话管理器
export class TerminalSessionManager {
  // 创建终端快照
  static createSnapshot(terminal: Terminal): TerminalSnapshot | null {
    try {
      if (!terminal || !terminal.buffer) {
        return null;
      }

      const buffer = terminal.buffer;
      const activeBuffer = buffer.active;

      // 获取终端内容
      const lines: string[] = [];
      for (let i = 0; i < activeBuffer.length; i++) {
        lines.push(activeBuffer.getLine(i)?.translateToString(true) || '');
      }

      // 获取选择区域
      let selection;
      if (terminal.hasSelection()) {
        const selectionText = terminal.getSelection();
        if (selectionText) {
          // 尝试解析选择区域的坐标
          selection = this.parseSelection(terminal);
        }
      }

      return {
        buffer: lines.join('\n'),
        cursorX: activeBuffer.cursorX,
        cursorY: activeBuffer.cursorY,
        scrollTop: activeBuffer.viewportY,
        selection,
        options: {
          fontSize: terminal.options.fontSize,
          fontFamily: terminal.options.fontFamily || 'monospace',
          theme: terminal.options.theme,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      console.warn('Failed to create terminal snapshot:', error);
      return null;
    }
  }

  // 恢复终端快照
  static restoreSnapshot(terminal: Terminal, snapshot: TerminalSnapshot): boolean {
    try {
      if (!terminal || !snapshot) {
        return false;
      }

      // 恢复选项
      if (snapshot.options) {
        terminal.options.fontSize = snapshot.options.fontSize;
        terminal.options.fontFamily = snapshot.options.fontFamily;
        if (snapshot.options.theme) {
          terminal.options.theme = snapshot.options.theme;
        }
      }

      // 恢复内容
      terminal.clear();
      if (snapshot.buffer) {
        terminal.write(snapshot.buffer);
      }

      // 恢复光标位置（在下一个事件循环中执行）
      setTimeout(() => {
        try {
          if (snapshot.cursorX !== undefined && snapshot.cursorY !== undefined) {
            // 尝试恢复光标位置
            terminal.write(`\x1b[${snapshot.cursorY + 1};${snapshot.cursorX + 1}H`);
          }

          // 恢复滚动位置
          if (snapshot.scrollTop !== undefined && terminal.buffer) {
            terminal.buffer.active.viewportY = snapshot.scrollTop;
          }

          // 恢复选择区域
          if (snapshot.selection && terminal.hasSelection()) {
            this.restoreSelection(terminal, snapshot.selection);
          }
        } catch (error) {
          console.warn('Failed to restore cursor/scroll position:', error);
        }
      }, 100);

      return true;
    } catch (error) {
      console.error('Failed to restore terminal snapshot:', error);
      return false;
    }
  }

  // 保存终端状态到全局存储
  static saveTerminalState(sessionId: string, terminal: Terminal): void {
    const snapshot = this.createSnapshot(terminal);
    if (snapshot) {
      const { updateContext } = useTerminalStore();

      updateContext(sessionId, {
        cursorPosition: {
          row: snapshot.cursorY,
          col: snapshot.cursorX,
        },
        scrollPosition: snapshot.scrollTop,
        fontSize: snapshot.options.fontSize,
      });

      // 同时将终端内容添加到历史记录
      const { appendHistory } = useTerminalStore();
      if (snapshot.buffer) {
        appendHistory(sessionId, snapshot.buffer);
      }
    }
  }

  // 从全局存储恢复终端状态
  static restoreTerminalState(sessionId: string, terminal: Terminal): boolean {
    const session = terminalStateManager.getSession(sessionId);
    if (!session) {
      return false;
    }

    const { context } = session;
    let success = false;

    // 恢复终端选项
    if (context.fontSize) {
      terminal.options.fontSize = context.fontSize;
    }

    // 恢复历史记录
    if (context.history && context.history.length > 0) {
      // 获取最新的历史记录内容
      const latestHistory = context.history[context.history.length - 1];
      if (latestHistory) {
        terminal.clear();
        terminal.write(latestHistory);
        success = true;
      }
    }

    // 恢复光标和滚动位置
    setTimeout(() => {
      try {
        if (context.cursorPosition) {
          terminal.write(`\x1b[${context.cursorPosition.row + 1};${context.cursorPosition.col + 1}H`);
        }

        if (context.scrollPosition !== undefined && terminal.buffer) {
          terminal.buffer.active.viewportY = context.scrollPosition;
        }
      } catch (error) {
        console.warn('Failed to restore terminal position:', error);
      }
    }, 100);

    return success;
  }

  // 监听终端变化并自动保存
  static createAutoSaver(sessionId: string, terminal: Terminal): () => void {
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleSave = () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      saveTimeout = setTimeout(() => {
        this.saveTerminalState(sessionId, terminal);
      }, 2000); // 2秒后保存，避免频繁保存
    };

    // 监听各种终端事件
    const disposers = [
      terminal.onData(scheduleSave),
      terminal.onWrite(scheduleSave),
      terminal.onResize(scheduleSave),
      terminal.onScroll(scheduleSave),
      terminal.onTitleChange(scheduleSave),
      terminal.onKey(scheduleSave),
    ];

    // 监听选择变化
    const selectionDisposer = {
      dispose: () => {
        // xterm.js 没有直接的选择事件监听器，我们用轮询方式
      }
    };

    // 定期检查选择状态变化
    let lastSelection = '';
    const selectionInterval = setInterval(() => {
      const currentSelection = terminal.getSelection() || '';
      if (currentSelection !== lastSelection) {
        lastSelection = currentSelection;
        scheduleSave();
      }
    }, 1000);

    // 返回清理函数
    return () => {
      disposers.forEach(disposer => disposer.dispose());
      clearInterval(selectionInterval);
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }
      // 最终保存
      this.saveTerminalState(sessionId, terminal);
    };
  }

  // 解析选择区域
  private static parseSelection(terminal: Terminal) {
    try {
      const selection = terminal.getSelection();
      if (!selection) return undefined;

      // 这是一个简化的实现，实际可能需要更复杂的解析
      const buffer = terminal.buffer?.active;
      if (!buffer) return undefined;

      // 尝试通过查找文本来确定选择区域
      const lines = selection.split('\n');
      if (lines.length === 0) return undefined;

      // 这里可以实现更精确的选择区域解析
      return {
        start: { x: 0, y: 0 },
        end: { x: lines[0].length, y: lines.length - 1 }
      };
    } catch {
      return undefined;
    }
  }

  // 恢复选择区域
  private static restoreSelection(terminal: Terminal, selection: any) {
    try {
      // xterm.js 不直接支持程序化设置选择区域
      // 这里可以实现一个基础的恢复逻辑
      const { start, end } = selection;
      if (start && end) {
        // 暂时跳过选择区域恢复，因为 xterm.js 限制
        console.log('Selection restoration not fully implemented');
      }
    } catch (error) {
      console.warn('Failed to restore selection:', error);
    }
  }

  // 获取会话统计信息
  static getSessionStats(sessionId: string) {
    const session = terminalStateManager.getSession(sessionId);
    if (!session) return null;

    const { stats, createdAt, lastActiveAt } = session;
    const now = new Date();
    const sessionDuration = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60)); // 分钟

    return {
      ...stats,
      sessionDuration,
      isActive: session.status === "connected",
      lastActive: lastActiveAt,
    };
  }

  // 导出会话数据为文件
  static exportSessionToFile(sessionId: string): string | null {
    const session = terminalStateManager.getSession(sessionId);
    if (!session) return null;

    const exportData = {
      session: {
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
      },
      exportDate: new Date().toISOString(),
      version: "1.0",
    };

    return JSON.stringify(exportData, null, 2);
  }

  // 从文件导入会话数据
  static importSessionFromFile(fileContent: string): boolean {
    try {
      const data = JSON.parse(fileContent);
      if (data.session) {
        return terminalStateManager.importSessions({
          version: data.version,
          sessions: [data.session],
          activeSessionId: data.session.id,
        });
      }
    } catch (error) {
      console.error('Failed to import session from file:', error);
    }
    return false;
  }

  // 清理会话历史
  static cleanupSessionHistory(sessionId: string, keepRecent: number = 1000): void {
    const session = terminalStateManager.getSession(sessionId);
    if (!session) return;

    const { context } = session;
    if (context.history && context.history.length > keepRecent) {
      const { updateContext } = useTerminalStore();
      updateContext(sessionId, {
        history: context.history.slice(-keepRecent),
      });
    }
  }

  // 压缩会话数据
  static compressSessionData(sessionId: string): void {
    const session = terminalStateManager.getSession(sessionId);
    if (!session) return;

    // 合并连续的相同内容
    const { context } = session;
    if (context.history) {
      const compressedHistory = this.compressHistory(context.history);
      const { updateContext } = useTerminalStore();
      updateContext(sessionId, {
        history: compressedHistory,
      });
    }
  }

  // 压缩历史记录算法
  private static compressHistory(history: string[]): string[] {
    const compressed: string[] = [];

    for (const entry of history) {
      // 移除空行和重复的命令提示符
      if (entry.trim() === '' || entry.startsWith('$ ') && entry.length <= 10) {
        continue;
      }

      // 检查是否与上一个条目相似
      const lastEntry = compressed[compressed.length - 1];
      if (lastEntry && this.isSimilarEntry(lastEntry, entry)) {
        // 合并相似条目
        compressed[compressed.length - 1] = this.mergeEntries(lastEntry, entry);
      } else {
        compressed.push(entry);
      }
    }

    return compressed;
  }

  // 检查两个条目是否相似
  private static isSimilarEntry(entry1: string, entry2: string): boolean {
    // 简单的相似性检测
    const similarityThreshold = 0.8;
    const shorter = Math.min(entry1.length, entry2.length);
    const longer = Math.max(entry1.length, entry2.length);

    if (shorter === 0) return false;

    let matches = 0;
    for (let i = 0; i < shorter; i++) {
      if (entry1[i] === entry2[i]) matches++;
    }

    return matches / longer >= similarityThreshold;
  }

  // 合并两个相似的条目
  private static mergeEntries(entry1: string, entry2: string): string {
    // 简单的合并策略：保留更长的条目
    return entry1.length >= entry2.length ? entry1 : entry2;
  }
}