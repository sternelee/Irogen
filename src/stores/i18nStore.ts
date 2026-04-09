import { createSignal } from "solid-js";
import { flatten, resolveTemplate, translator } from "@solid-primitives/i18n";

export type Locale = "en" | "zh-CN";

const LOCALE_STORAGE_KEY = "irogen.locale";

const dictionaries = {
  en: flatten({
    common: {
      language: "Language",
      english: "English",
      chinese: "中文",
      close: "Close",
      local: "Local",
      remote: "Remote",
      onlineCount: "{{ count }} Online",
      new: "New",
      loadingHistory: "Loading history…",
    },
    home: {
      welcomeTitle: "Welcome to Irogen",
      welcomeDescription:
        "Manage multiple AI agent sessions in one place. Create a new session to get started.",
      createSession: "Create Session",
      setupGuide: "Setup Guide",
      features: {
        aiAgentsTitle: "AI Agents",
        aiAgentsDesc: "Claude, Codex & more",
        secureTitle: "P2P Secure",
        secureDesc: "End-to-end encrypted",
        agentTitle: "Agent",
        agentDesc: "Real-time sharing",
      },
    },
    sidebar: {
      platform: "AI Platform",
      sessions: "Sessions",
      activeSessionsEmpty: "No active sessions",
      activeSessionsHint: "Connect to a remote CLI or create a local session",
      sessionActions: "Session actions",
      closeSession: "Close session",
      showHistory: "Show history",
      hideHistory: "Hide history",
      history: "History",
      refreshHistory: "Refresh history",
      noHistoryFound: "No history found",
      refreshSessionsSuccess: "Sessions refreshed",
      refreshSessionsTitle: "Session List",
      refreshSessionsFailed: "Failed to refresh sessions",
      historyUnavailableTitle: "History Unavailable",
      cursorHistoryUnavailable:
        "Cursor CLI does not expose ACP history listing",
      historyLoadedTitle: "History",
      historyLoadedSuccess: "History session loaded",
      historyLoadFailed: "Failed to load agent history",
      historySessionLoadFailed: "Failed to load history session",
      noRemoteConnection: "No remote connection selected",
      errorTitle: "Error",
      failedStopLocalAgent: "Failed to stop local agent",
      failedStopRemoteAgent: "Failed to stop remote agent",
      failedSpawnRemoteSession: "Failed to spawn remote session",
      pullToRefresh: "Pull to refresh",
      releaseToRefresh: "Release to refresh",
      refreshing: "Refreshing...",
      thinking: "Thinking",
    },
  }),
  "zh-CN": flatten({
    common: {
      language: "语言",
      english: "English",
      chinese: "中文",
      close: "关闭",
      local: "本地",
      remote: "远程",
      onlineCount: "{{ count }} 在线",
      new: "新建",
      loadingHistory: "正在加载历史会话…",
    },
    home: {
      welcomeTitle: "欢迎使用 Irogen",
      welcomeDescription:
        "在一个地方管理多个 AI Agent 会话。创建一个新会话即可开始。",
      createSession: "创建会话",
      setupGuide: "安装指南",
      features: {
        aiAgentsTitle: "AI Agents",
        aiAgentsDesc: "Claude、Codex 等",
        secureTitle: "P2P 安全",
        secureDesc: "端到端加密",
        agentTitle: "Agent",
        agentDesc: "实时协作共享",
      },
    },
    sidebar: {
      platform: "AI 平台",
      sessions: "会话",
      activeSessionsEmpty: "暂无活跃会话",
      activeSessionsHint: "连接远程 CLI 或创建本地会话",
      sessionActions: "会话操作",
      closeSession: "关闭会话",
      showHistory: "显示历史",
      hideHistory: "隐藏历史",
      history: "历史",
      refreshHistory: "刷新历史",
      noHistoryFound: "未找到历史会话",
      refreshSessionsSuccess: "会话已刷新",
      refreshSessionsTitle: "会话列表",
      refreshSessionsFailed: "刷新会话失败",
      historyUnavailableTitle: "历史不可用",
      cursorHistoryUnavailable: "Cursor CLI 不支持列出 ACP 历史会话",
      historyLoadedTitle: "历史会话",
      historyLoadedSuccess: "历史会话已加载",
      historyLoadFailed: "加载历史会话失败",
      historySessionLoadFailed: "恢复历史会话失败",
      noRemoteConnection: "未选择远程连接",
      errorTitle: "错误",
      failedStopLocalAgent: "停止本地 Agent 失败",
      failedStopRemoteAgent: "停止远程 Agent 失败",
      failedSpawnRemoteSession: "创建远程会话失败",
      pullToRefresh: "下拉刷新",
      releaseToRefresh: "松开刷新",
      refreshing: "正在刷新...",
      thinking: "思考中",
    },
  }),
} as const;

const getStoredLocale = (): Locale => {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "zh-CN" ? "zh-CN" : "en";
};

const [locale, setLocaleSignal] = createSignal<Locale>(getStoredLocale());

if (typeof document !== "undefined") {
  document.documentElement.lang = locale();
}

export const t = translator(() => dictionaries[locale()], resolveTemplate);

export const i18nStore = {
  locale,
  setLocale: (next: Locale) => {
    setLocaleSignal(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
  },
  t,
};
