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
    setupGuide: {
      title: "Setup Guide",
      skip: "Skip",
      continue: "Continue",
      start: "Start Now",
      copySuccess: "Copied to clipboard",
      copySuccessTitle: "Success",
      back: "Back",
      step1: {
        title: "What is Irogen?",
        desc: "Securely control computer-side AI assistants (Claude, Codex, Gemini, etc.) on your phone through P2P encrypted direct connection.",
        howItWorks: "HOW IT WORKS",
        mobile: "Mobile",
        p2p: "P2P Direct",
        localCli: "Local CLI",
        footer:
          "After starting the service on your computer, achieve point-to-point secure access through a P2P tunnel.",
      },
      step2: {
        title: "Install CLI Tool",
        desc: "First, install the Irogen CLI on your computer. Open a terminal and run:",
        windowsNote:
          "Windows users please refer to the GitHub documentation for installation",
      },
      step3: {
        title: "Enable P2P Connection",
        desc: "After installation, run the following command to open the P2P connection tunnel and get a ticket:",
      },
      step4: {
        title: "Get Started",
        desc: "Click 'Scan QR Code' on your phone to scan the QR code output by the CLI, or manually enter the ticket.",
        remoteControl: "Remote Control CLI",
        realtimeSync: "Real-time Sync Preview",
      },
    },
    tcpForwarding: {
      title: "TCP Forwarding",
      addPort: "Add Port",
      refresh: "Refresh",
      createNew: "Create New Forwarding",
      localAddr: "Local Address",
      localAddrDesc: "Local port to listen on",
      remoteHost: "Remote Host",
      remoteHostDesc: "Address on the remote CLI",
      remotePort: "Remote Port",
      remotePortDesc: "Port on the remote CLI",
      create: "Create Session",
      cancel: "Cancel",
      noSessions: "No active TCP forwarding sessions",
      noSessionsDesc: "Add a port to access remote services locally",
      openInBrowser: "Open in Browser",
      status: {
        pending: "Pending",
        running: "Running",
        stopped: "Stopped",
        starting: "Starting",
      },
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
    setupGuide: {
      title: "设置指南",
      skip: "跳过",
      continue: "继续下一步",
      start: "立即开始",
      copySuccess: "已复制到剪贴板",
      copySuccessTitle: "成功",
      back: "返回",
      step1: {
        title: "什么是 Irogen?",
        desc: "通过 P2P 加密直连，在手机上安全地控制电脑端的 AI 助理 (Claude, Codex, Gemini 等)。",
        howItWorks: "工作原理",
        mobile: "手机端",
        p2p: "P2P 直连",
        localCli: "本地 CLI",
        footer: "在电脑上启动服务后，通过 P2P 隧道实现点对点安全访问。",
      },
      step2: {
        title: "安装 CLI 工具",
        desc: "首先，在你的电脑上安装 Irogen CLI。打开终端并运行：",
        windowsNote: "Windows 用户请参考 GitHub 文档进行安装",
      },
      step3: {
        title: "开启 P2P 连接",
        desc: "安装完成后，运行以下指令开启 P2P 连接隧道并获取票据：",
      },
      step4: {
        title: "即刻开始",
        desc: "在手机上点击“扫描二维码”直接扫描 CLI 输出的二维码，或者手动输入票据。",
        remoteControl: "远程控制 CLI",
        realtimeSync: "实时同步预览",
      },
    },
    tcpForwarding: {
      title: "TCP 端口转发",
      addPort: "添加端口",
      refresh: "刷新",
      createNew: "创建新转发",
      localAddr: "本地地址",
      localAddrDesc: "本地监听的端口",
      remoteHost: "远程主机",
      remoteHostDesc: "远程 CLI 上的地址",
      remotePort: "远程端口",
      remotePortDesc: "远程 CLI 上的端口",
      create: "创建会话",
      cancel: "取消",
      noSessions: "暂无活跃的 TCP 转发会话",
      noSessionsDesc: "添加端口以在本地访问远程服务",
      openInBrowser: "在浏览器中打开",
      status: {
        pending: "排队中",
        running: "运行中",
        stopped: "已停止",
        starting: "启动中",
      },
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
