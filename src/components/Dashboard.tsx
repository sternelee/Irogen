/**
 * Dashboard Component
 *
 * Main dashboard view with different modes:
 * - topology: Tree structure showing hosts and agents
 * - hosts: Connected hosts with inline TCP forwarding lists
 * - proxies: TCP forwarding preview
 */

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import {
  sessionStore,
  type AgentSessionMetadata,
  type ConnectedHostMetadata,
} from "../stores/sessionStore";
import { sessionEventRouter } from "../stores/sessionEventRouter";
import { i18nStore } from "../stores/i18nStore";
import { notificationStore } from "../stores/notificationStore";
import { isMobile } from "../stores/deviceStore";
import { navigationStore } from "../stores/navigationStore";
import { invoke } from "@tauri-apps/api/core";
import {
  FiRefreshCw,
  FiPlus,
  FiActivity,
  FiServer,
  FiTerminal,
  FiBox,
  FiWifi,
  FiGlobe,
  FiChevronUp,
  FiChevronDown,
  FiTrash2,
  FiExternalLink,
  FiClock,
} from "solid-icons/fi";
import { Button, Input, Label } from "./ui/primitives";
import { ConnectHostModal } from "./ConnectHostModal";
import { SetupGuide } from "./mobile/SetupGuide";
import {
  tcpForwardingStore,
  type TcpForwardingSession,
} from "../stores/tcpForwardingStore";
import { cn } from "../lib/utils";
import { HistorySelectionModal } from "./HistorySelectionModal";

// ============================================================================
// Types
// ============================================================================

type DashboardView = "topology" | "hosts" | "proxies";

interface DashboardProps {
  view?: DashboardView;
}

interface HostNode {
  id: string;
  controlSessionId?: string;
  hostname: string;
  os: string;
  machineId: string;
  ip?: string;
  status: "online" | "offline" | "reconnecting";
  sessions: AgentSessionMetadata[];
  systemStats?: SystemStats;
}

interface SystemStats {
  cpu_usage: number;
  memory_usage: number;
  total_memory: number;
  used_memory: number;
  disk_usage: number;
  total_disk: number;
  used_disk: number;
  uptime: number;
  load_avg?: LoadAverage;
  network_stats?: NetworkStats;
  timestamp: number;
}

interface LoadAverage {
  one: number;
  five: number;
  fifteen: number;
}

interface NetworkStats {
  bytes_received: number;
  bytes_sent: number;
  packets_received: number;
  packets_sent: number;
}

interface HostBuildOptions {
  includeDesktopLocal?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

const getAgentIcon = (agentType: string) => {
  const normalizedType = agentType?.toLowerCase() || "";
  const iconClass = "w-5 h-5 rounded-lg flex items-center justify-center";

  const iconPaths: Record<string, string> = {
    claude: "/claude-ai.svg",
    claudecode: "/claude-ai.svg",
    "claude-code": "/claude-ai.svg",
    codex: "/openai-light.svg",
    cursor: "/cursor.svg",
    opencode: "/opencode-wordmark-dark.svg",
    open: "/openai-light.svg",
    openai: "/openai-light.svg",
    gemini: "/google-gemini.svg",
    "gemini-cli": "/google-gemini.svg",
    openclaw: "/openclaw.svg",
    "open-claw": "/openclaw.svg",
  };

  const iconPath = iconPaths[normalizedType];

  if (iconPath) {
    return (
      <div class={iconClass}>
        <img src={iconPath} alt={normalizedType} class="w-4 h-4" />
      </div>
    );
  }

  return (
    <div class={`${iconClass} bg-base-300`}>
      <span class="text-sm">🤖</span>
    </div>
  );
};

const buildHostNodes = (
  sessions: AgentSessionMetadata[],
  connectedHosts: ConnectedHostMetadata[],
  options: HostBuildOptions = {},
): HostNode[] => {
  const hostMap = new Map<string, HostNode>();

  if (options.includeDesktopLocal && !isMobile()) {
    hostMap.set("local", {
      id: "local",
      hostname: "Local",
      os: navigator.platform,
      machineId: "local",
      status: "online",
      sessions: [],
    });
  }

  connectedHosts.forEach((connectedHost) => {
    hostMap.set(`control:${connectedHost.controlSessionId}`, {
      id: `control:${connectedHost.controlSessionId}`,
      controlSessionId: connectedHost.controlSessionId,
      hostname: connectedHost.hostname,
      os: connectedHost.os,
      machineId: connectedHost.machineId,
      status: connectedHost.status,
      sessions: [],
    });
  });

  sessions.forEach((session) => {
    const hostKey = session.controlSessionId
      ? `control:${session.controlSessionId}`
      : session.machineId || session.hostname;

    if (!hostMap.has(hostKey)) {
      hostMap.set(hostKey, {
        id: hostKey,
        controlSessionId: session.controlSessionId,
        hostname: session.hostname,
        os: session.os,
        machineId: session.machineId,
        status: session.active ? "online" : "offline",
        sessions: [],
      });
    }

    const host = hostMap.get(hostKey)!;
    host.controlSessionId = host.controlSessionId || session.controlSessionId;
    host.hostname = session.hostname || host.hostname;
    host.os = session.os || host.os;
    host.machineId = session.machineId || host.machineId;
    host.sessions.push(session);

    if (session.active) {
      host.status = "online";
    }
  });

  return Array.from(hostMap.values());
};

const getRemoteHostControlSessionId = (host: HostNode): string | null => {
  return (
    host.controlSessionId ||
    host.sessions.find(
      (session) => session.mode === "remote" && session.controlSessionId,
    )?.controlSessionId ||
    null
  );
};

const getProxyPreviewUrl = (localAddr: string): string => {
  return `http://${localAddr.startsWith(":") ? `127.0.0.1${localAddr}` : localAddr}`;
};

const DashboardEmptyState: Component<{
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center px-6 py-16 text-center md:py-24">
      <h3 class="text-lg font-semibold text-base-content/80 mb-2">{props.title}</h3>
      <Show when={props.description}>
        <p class="text-sm text-base-content/50 max-w-xs mb-6">{props.description}</p>
      </Show>
      <Show when={props.action}>
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-xl bg-primary text-primary-content font-medium shadow-lg shadow-primary/20 hover:shadow-xl transition-shadow"
          onClick={props.action?.onClick}
        >
          {props.action?.label}
        </button>
      </Show>
    </div>
  );
};

const DashboardToolbar: Component = () => {
  return (
    <div class="flex flex-wrap items-center justify-end gap-2">
      {/* Theme and language switchers moved to Settings page */}
    </div>
  );
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "streaming":
      return "bg-info/20 text-info border-info/30";
    case "thinking":
      return "bg-secondary/20 text-secondary border-secondary/30";
    case "tool_calling":
      return "bg-warning/20 text-warning border-warning/30";
    case "idle":
    default:
      return "bg-base-300 text-base-content/60 border-base-content/30";
  }
};

const getStatusGlow = (status: string) => {
  switch (status) {
    case "streaming":
      return "shadow-[0_0_12px_rgba(59,130,246,0.3)]";
    case "thinking":
      return "shadow-[0_0_12px_rgba(173,198,255,0.3)]";
    case "tool_calling":
      return "shadow-[0_0_12px_rgba(255,183,134,0.3)]";
    default:
      return "";
  }
};

// ============================================================================
// Reusable Components
// ============================================================================

interface PageHeaderProps {
  icon: typeof FiActivity;
  section: string;
}

const PageHeader: Component<PageHeaderProps> = (props) => {
  const Icon = props.icon;

  return (
    <header class="compact-mobile-controls z-20 flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-base-content/10 bg-base-100/80 px-4 py-3 backdrop-blur-lg md:px-6">
      <div class="flex items-center gap-3">
        {/* Hamburger menu - only visible on mobile */}
        <label
          for="drawer"
          aria-label="Open menu"
          class="btn btn-square btn-ghost drawer-button lg:hidden"
        >
          <svg
            width="20"
            height="20"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="inline-block h-5 w-5 stroke-current"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            ></path>
          </svg>
        </label>
        <div class="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
          <Icon class="w-5 h-5 text-primary-content" />
        </div>
        <div>
          <h1 class="font-headline text-xl font-bold tracking-widest text-primary">
            Irogen
          </h1>
          <p class="text-[9px] opacity-40 mt-0.5 font-bold uppercase tracking-wider">
            {props.section}
          </p>
        </div>
      </div>
      <DashboardToolbar />
    </header>
  );
};

// ============================================================================
// Tree Line Components
// ============================================================================

const TreeLineVertical: Component<{ height?: string }> = (props) => (
  <div
    class="absolute left-0 top-0 tree-line-v"
    style={{ height: props.height || "100%" }}
  />
);

// ============================================================================
// Agent Node Component
// ============================================================================

interface AgentNodeProps {
  session: AgentSessionMetadata;
  isStreaming: boolean;
  onClick: () => void;
}

const AgentNode: Component<AgentNodeProps> = (props) => {
  const statusText = () => {
    if (props.isStreaming) {
      return "STREAMING";
    }
    return "IDLE";
  };

  return (
    <button
      type="button"
      class="relative flex w-full items-center py-3 px-4 text-left transition-colors rounded-lg mx-1.5 my-1 hover:bg-secondary/15 bg-secondary/8 border border-secondary/20"
      onClick={props.onClick}
    >
      <div class="flex flex-1 items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          {getAgentIcon(props.session.agentType)}
          <div class="min-w-0">
            <span class="font-mono text-xs font-medium block truncate">
              {props.session.agentType.charAt(0).toUpperCase() +
                props.session.agentType.slice(1)}
            </span>
            <span class="text-[9px] opacity-40 font-mono">
              {props.session.projectPath?.split("/").pop() || "No project"}
            </span>
          </div>
        </div>
        <div
          class={`px-3 py-0.5 rounded-full text-[9px] font-bold tracking-widest border ${getStatusColor(statusText())} ${getStatusGlow(statusText())}`}
        >
          {statusText()}
        </div>
      </div>
    </button>
  );
};

// ============================================================================
// Host Card Component
// ============================================================================

interface HostCardProps {
  host: HostNode;
  onRefresh: () => void;
  onShowStats: () => void;
  onAgentClick: (sessionId: string) => void;
  onAddAgent: (host: HostNode) => void;
  onLoadHistory: () => void;
}

const HostCard: Component<HostCardProps> = (props) => {
  const [expanded, setExpanded] = createSignal(true);

  return (
    <div class="group">
      {/* Host Header - Clickable to expand/collapse */}
      <div
        class="flex items-center justify-between bg-primary/8 p-4 rounded-lg border-l-4 border-primary transition-all hover:bg-primary/12 cursor-pointer"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="flex items-center gap-4">
          <FiServer class="w-5 h-5 text-base-content/60" />
          <div class="min-w-0">
            <h3 class="font-mono text-sm font-medium tracking-tight truncate">
              {props.host.hostname}
            </h3>
            <p
              class={cn(
                props.host.controlSessionId
                  ? "text-[10px] font-label uppercase text-base-content/60 tracking-tighter"
                  : "hidden",
              )}
            >
              {props.host.os}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          {/* Add Agent Button */}
          <Button
            variant="default"
            size="sm"
            class="h-7 px-2 text-[10px] font-bold rounded-lg shadow-lg shadow-primary/20"
            onClick={(e) => {
              e.stopPropagation();
              props.onAddAgent(props.host);
            }}
          >
            <FiPlus size={12} class="mr-1" />
            Agent
          </Button>
          <Show when={props.host.machineId === "local"}>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-[10px] font-label uppercase tracking-widest border border-base-content/10"
              onClick={(e) => {
                e.stopPropagation();
                props.onLoadHistory();
              }}
            >
              <FiClock size={12} class="mr-1" />
              History
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-[10px] font-label uppercase tracking-widest border border-base-content/10"
            onClick={(e) => {
              e.stopPropagation();
              props.onShowStats();
            }}
          >
            STATS
          </Button>
          {/* Expand/Collapse Icon */}
          <div class="text-base-content/40">
            <Show when={expanded()} fallback={<FiChevronDown size={18} />}>
              <FiChevronUp size={18} />
            </Show>
          </div>
        </div>
      </div>

      <Show when={expanded()}>
        <div class="ml-4 mt-2 relative">
          <TreeLineVertical
            height={`${props.host.sessions.length * 56 + 16}px`}
          />
          <For each={props.host.sessions}>
            {(session) => (
              <AgentNode
                session={session}
                isStreaming={
                  sessionEventRouter.getStreamingState(session.sessionId)
                    .isStreaming
                }
                onClick={() => props.onAgentClick(session.sessionId)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Dashboard Component
// ============================================================================

export const Dashboard: Component<DashboardProps> = (props) => {
  const view = () => props.view || "topology";

  // Determine what to render based on view prop
  const renderContent = () => {
    switch (view()) {
      case "hosts":
        return <HostsView />;
      case "proxies":
        return <ProxiesView />;
      case "topology":
      default:
        return <TopologyView />;
    }
  };

  return renderContent();
};

// ============================================================================
// Topology View (Tree Structure)
// ============================================================================

const TopologyView: Component = () => {
  const [isLoading, setIsLoading] = createSignal(false);
  const [connectModalOpen, setConnectModalOpen] = createSignal(false);
  const [showSetupGuide, setShowSetupGuide] = createSignal(false);
  const [historyModalOpen, setHistoryModalOpen] = createSignal(false);
  const [historyHost, setHistoryHost] = createSignal<HostNode | null>(null);

  // Group sessions by host machine
  const hosts = createMemo(() => {
    return buildHostNodes(
      sessionStore.getSessions(),
      sessionStore.getConnectedHosts(),
      {
        includeDesktopLocal: true,
      },
    );
  });

  const handleRefresh = async () => {
    if (isLoading()) return;
    setIsLoading(true);

    try {
      // Refresh local sessions
      await invoke("local_list_agents");

      // Refresh remote sessions if connected
      const controlSessionId = sessionStore.state.targetControlSessionId;
      if (controlSessionId) {
        await invoke("remote_list_agents", { controlSessionId });
      }

      notificationStore.success(
        i18nStore.t("sidebar.refreshSessionsSuccess"),
        i18nStore.t("sidebar.refreshSessionsTitle"),
      );
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
      notificationStore.error(
        i18nStore.t("sidebar.refreshSessionsFailed"),
        i18nStore.t("sidebar.refreshSessionsTitle"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleShowStats = async (host: HostNode) => {
    try {
      // Determine if this is a local or remote host
      const isLocal =
        host.machineId === "local" ||
        host.sessions.some((s) => s.mode === "local");

      let stats: SystemStats;

      if (isLocal) {
        // Fetch local system stats
        stats = await invoke<SystemStats>("get_local_system_stats");
      } else {
        // Fetch remote system stats via P2P
        const controlSessionId = getRemoteHostControlSessionId(host);
        if (!controlSessionId) {
          notificationStore.error("No connection to remote host", "Error");
          return;
        }
        stats = await invoke<SystemStats>("get_remote_system_stats", {
          controlSessionId,
        });
      }

      // Show stats in a notification
      const statsInfo = `CPU: ${stats.cpu_usage.toFixed(1)}% | Memory: ${stats.memory_usage.toFixed(1)}% | Disk: ${stats.disk_usage.toFixed(1)}%`;
      notificationStore.info(statsInfo, `${host.hostname} Stats`);
    } catch (error) {
      console.error("Failed to fetch system stats:", error);
      notificationStore.error("Failed to fetch system stats", "Error");
    }
  };

  const handleAgentClick = (sessionId: string) => {
    sessionStore.setActiveSession(sessionId);
    navigationStore.setActiveView("chat");
  };

  const handleAddAgent = (host: HostNode) => {
    // Determine mode based on host
    const isLocal = host.machineId === "local";

    if (!isLocal) {
      // For remote hosts, set the control session ID
      const controlSessionId = getRemoteHostControlSessionId(host);
      if (controlSessionId) {
        sessionStore.setTargetControlSessionId(controlSessionId);
      }
    }

    // Open the session creation modal with fromHost=true
    sessionStore.openNewSessionModal(
      isLocal ? "local" : "remote",
      undefined,
      true,
    );
  };

  const handleLoadHistory = (host: HostNode) => {
    const isLocal = host.machineId === "local";
    if (!isLocal) {
      notificationStore.error(
        "History loading is only available for local agents",
        "Error",
      );
      return;
    }
    setHistoryHost(host);
    setHistoryModalOpen(true);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col bg-base-100 h-full">
      <PageHeader icon={FiTerminal} section="Topology" />

      {/* Main Dashboard Content */}
      <div class="flex-1 overflow-y-auto bg-base-100 px-4 py-6 md:px-8 md:py-8">
        {/* Dashboard Header */}
        <div class="mb-8 flex flex-col gap-4 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
          <div class="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              class="px-4 py-1.5 rounded text-[10px] font-label uppercase tracking-widest border border-base-content/10"
              onClick={handleRefresh}
              disabled={isLoading()}
            >
              <Show
                when={!isLoading()}
                fallback={<span class="loading loading-spinner loading-xs" />}
              >
                <FiRefreshCw size={14} class="mr-1" />
              </Show>
              Refresh
            </Button>
            <Button
              variant="default"
              size="sm"
              class="px-4 py-1.5 rounded text-[10px] font-label uppercase tracking-widest font-bold shadow-lg shadow-primary/20"
              onClick={() => setConnectModalOpen(true)}
            >
              <FiWifi size={14} class="mr-1" />
              Add Host
            </Button>
          </div>
        </div>

        {/* Connect Host Modal */}
        <ConnectHostModal
          isOpen={connectModalOpen()}
          onClose={() => setConnectModalOpen(false)}
        />

        {/* Setup Guide Modal */}
        <Show when={showSetupGuide()}>
          <div class="fixed inset-0 z-9999 bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div class="w-full h-full bg-base-100 rounded-t-3xl md:rounded-2xl md:max-w-2xl md:max-h-[90vh] flex flex-col">
              <SetupGuide
                onClose={() => setShowSetupGuide(false)}
                onSkip={() => setShowSetupGuide(false)}
              />
            </div>
          </div>
        </Show>

        {/* Topology List */}
        <div class="space-y-4">
          <Show
            when={hosts().length > 0}
            fallback={
              <DashboardEmptyState
                title="No active hosts"
                description="Add a host to start managing agents remotely"
                action={{ label: "Add Host", onClick: () => setConnectModalOpen(true) }}
              />
            }
          >
            <For each={hosts()}>
              {(host) => (
                <HostCard
                  host={host}
                  onRefresh={handleRefresh}
                  onShowStats={() => handleShowStats(host)}
                  onAgentClick={handleAgentClick}
                  onAddAgent={handleAddAgent}
                  onLoadHistory={() => handleLoadHistory(host)}
                />
              )}
            </For>
          </Show>
        </div>

        <HistorySelectionModal
          isOpen={historyModalOpen()}
          onClose={() => setHistoryModalOpen(false)}
          hostMachineId={historyHost()?.machineId}
          defaultProjectPath={historyHost()?.sessions[0]?.currentDir}
        />
      </div>
    </div>
  );
};

// ============================================================================
// Hosts View
// ============================================================================

const createTcpDraft = () => ({
  localAddr: "127.0.0.1:3000",
  remoteAddr: "127.0.0.1:3000",
});

const parseRemoteTcpAddress = (value: string) => {
  const addr = value.trim();
  const lastColonIndex = addr.lastIndexOf(":");

  if (lastColonIndex === -1) {
    return {
      error: "Remote address must include a port (e.g., 127.0.0.1:3000)",
    };
  }

  const host = addr.substring(0, lastColonIndex) || "127.0.0.1";
  const port = Number.parseInt(addr.substring(lastColonIndex + 1), 10);

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    return { error: "Invalid port number" };
  }

  return { host, port };
};

const HostProxyPanel: Component<{ host: HostNode }> = (props) => {
  const controlSessionId = createMemo(() =>
    getRemoteHostControlSessionId(props.host),
  );
  const [expanded, setExpanded] = createSignal(true);
  const [isAdding, setIsAdding] = createSignal(false);
  const [localAddr, setLocalAddr] = createSignal(createTcpDraft().localAddr);
  const [remoteAddr, setRemoteAddr] = createSignal(createTcpDraft().remoteAddr);
  let cleanupTcpListener: (() => void) | undefined;

  createEffect(() => {
    const sessionId = controlSessionId();
    const shouldListen = expanded() && Boolean(sessionId);

    void (async () => {
      cleanupTcpListener?.();
      cleanupTcpListener = undefined;

      if (!shouldListen || !sessionId) {
        return;
      }

      cleanupTcpListener = await tcpForwardingStore.init(sessionId);
    })();
  });

  onCleanup(() => {
    cleanupTcpListener?.();
  });

  const sessions = createMemo<TcpForwardingSession[]>(() => {
    const sessionId = controlSessionId();
    if (!sessionId) return [];
    return tcpForwardingStore.state.sessions[sessionId] || [];
  });

  const handleCreate = async () => {
    const sessionId = controlSessionId();
    if (!sessionId) {
      notificationStore.error("No remote connection to host", "TCP Proxy");
      return;
    }

    const parsed = parseRemoteTcpAddress(remoteAddr());
    if ("error" in parsed) {
      notificationStore.error(
        parsed.error ?? "Invalid remote address",
        "Format Error",
      );
      return;
    }

    await tcpForwardingStore.createSession(
      sessionId,
      localAddr().trim(),
      parsed.host,
      parsed.port,
    );

    setIsAdding(false);
    const defaults = createTcpDraft();
    setLocalAddr(defaults.localAddr);
    setRemoteAddr(defaults.remoteAddr);
  };

  const handlePreview = (tcpSessionId: string) => {
    const sessionId = controlSessionId();
    if (!sessionId) {
      notificationStore.error("No remote connection to host", "TCP Proxy");
      return;
    }

    sessionStore.setTargetControlSessionId(sessionId);
    navigationStore.setPreviewProxyId(tcpSessionId);
    navigationStore.setActiveView("proxies");
  };

  return (
    <div class="overflow-hidden rounded-2xl border border-base-content/5 bg-base-200/50">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-base-200/70"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="flex items-center gap-3">
          <FiServer class="h-5 w-5 text-primary" />
          <div>
            <h3 class="font-mono text-sm font-medium">{props.host.hostname}</h3>
            <p class="text-[10px] opacity-50">{props.host.os}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Show when={controlSessionId()}>
            <Button
              variant="ghost"
              size="sm"
              class="h-8 rounded-lg border border-base-content/10 px-2 text-[10px] font-label uppercase tracking-widest"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
                setIsAdding((value) => !value);
              }}
            >
              <FiPlus size={12} class="mr-1" />
              Create TCP
            </Button>
          </Show>
          <div class="text-base-content/40">
            <Show when={expanded()} fallback={<FiChevronDown size={18} />}>
              <FiChevronUp size={18} />
            </Show>
          </div>
        </div>
      </button>

      <Show when={expanded()}>
        <div class="border-t border-base-content/8 bg-base-100/80 px-4 py-4">
          <Show
            when={controlSessionId()}
            fallback={
              <div class="rounded-xl border border-base-content/8 bg-base-200/40 px-4 py-6 text-center text-sm text-base-content/50">
                TCP forwarding is available after this host establishes a remote
                control connection.
              </div>
            }
          >
            <div class="space-y-4">
              <Show when={isAdding()}>
                <div class="rounded-2xl border border-base-content/8 bg-base-200/40 p-4">
                  <div class="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p class="text-[10px] font-black uppercase tracking-[0.2em] text-primary/80">
                        New TCP Tunnel
                      </p>
                      <p class="mt-1 text-xs text-base-content/50">
                        Bind a local address to a remote host:port on this
                        machine.
                      </p>
                    </div>
                  </div>

                  <div class="grid gap-4 md:grid-cols-2">
                    <div class="space-y-2">
                      <Label class="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">
                        Local Address
                      </Label>
                      <Input
                        value={localAddr()}
                        onInput={(e) => setLocalAddr(e.currentTarget.value)}
                        placeholder="127.0.0.1:3000"
                        class="border-base-content/10 bg-base-100"
                      />
                    </div>
                    <div class="space-y-2">
                      <Label class="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">
                        Remote Address
                      </Label>
                      <Input
                        value={remoteAddr()}
                        onInput={(e) => setRemoteAddr(e.currentTarget.value)}
                        placeholder="127.0.0.1:3000"
                        class="border-base-content/10 bg-base-100"
                      />
                    </div>
                  </div>

                  <div class="mt-4 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="rounded-xl"
                      onClick={() => setIsAdding(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      class="rounded-xl px-4"
                      loading={tcpForwardingStore.state.loading}
                      onClick={handleCreate}
                    >
                      Create TCP
                    </Button>
                  </div>
                </div>
              </Show>

              <Show
                when={sessions().length > 0}
                fallback={
                  <div class="rounded-xl border border-dashed border-base-content/10 bg-base-200/20 px-4 py-8 text-center">
                    <FiGlobe size={26} class="mx-auto mb-3 opacity-20" />
                    <p class="text-sm font-bold opacity-50">
                      No TCP tunnels yet
                    </p>
                    <p class="mt-1 text-xs text-base-content/40">
                      Create a TCP tunnel for {props.host.hostname} to preview
                      it here.
                    </p>
                  </div>
                }
              >
                <div class="space-y-3">
                  <For each={sessions()}>
                    {(session) => (
                      <div class="flex items-center justify-between gap-3 rounded-2xl border border-base-content/5 bg-base-200/30 p-4">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="font-mono text-sm font-bold">
                              {session.local_addr}
                            </span>
                            <span class="text-xs opacity-20">→</span>
                            <span class="truncate text-xs opacity-60">
                              {session.remote_host}:{session.remote_port}
                            </span>
                          </div>
                          <div class="mt-2 flex items-center gap-2">
                            <span
                              class={`rounded-md px-2 py-0.5 text-[9px] font-black uppercase ${
                                session.status === "running"
                                  ? "bg-success/15 text-success"
                                  : "bg-base-300 text-base-content/40"
                              }`}
                            >
                              {session.status}
                            </span>
                            <Show when={session.status === "running"}>
                              <button
                                type="button"
                                class="flex items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                                onClick={() => handlePreview(session.id)}
                              >
                                Preview
                                <FiExternalLink size={10} />
                              </button>
                            </Show>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="h-10 w-10 rounded-full text-error/40 hover:bg-error/10 hover:text-error"
                          onClick={() => {
                            const sessionId = controlSessionId();
                            if (!sessionId) return;
                            void tcpForwardingStore.stopSession(
                              sessionId,
                              session.id,
                            );
                          }}
                        >
                          <FiTrash2 size={18} />
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

const HostSummaryCard: Component<{ host: HostNode }> = (props) => {
  return (
    <div class="overflow-hidden rounded-2xl border border-base-content/5 bg-base-200/50">
      <div class="flex items-center justify-between gap-3 p-4">
        <div class="flex items-center gap-3">
          <FiServer class="h-5 w-5 text-primary" />
          <div>
            <h3 class="font-mono text-sm font-medium">{props.host.hostname}</h3>
            <p class="text-[10px] opacity-50">{props.host.os}</p>
          </div>
        </div>
        <span class="rounded-md bg-base-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-base-content/50">
          {props.host.sessions.length} agent
          {props.host.sessions.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
};

const HostsView: Component = () => {
  const [connectModalOpen, setConnectModalOpen] = createSignal(false);
  const hosts = createMemo(() =>
    buildHostNodes(
      sessionStore.getSessions(),
      sessionStore.getConnectedHosts(),
    ),
  );

  return (
    <div class="flex min-h-0 flex-1 flex-col bg-base-100 h-full">
      <PageHeader icon={FiServer} section="Hosts" />

      <div class="flex-1 overflow-y-auto bg-base-100 px-4 py-6 md:px-8 md:py-8">
        <div class="mb-8 flex justify-between items-end">
          <div>
            <p class="font-label text-[10px] uppercase tracking-[0.3em] text-primary mb-1">
              Connected
            </p>
            <h2 class="font-headline text-3xl font-light tracking-tight">
              Hosts
            </h2>
          </div>
          <Button
            variant="default"
            size="sm"
            class="rounded-xl px-4 py-1.5 text-[10px] font-bold shadow-lg shadow-primary/20"
            onClick={() => setConnectModalOpen(true)}
          >
            <FiWifi size={14} class="mr-1" />
            Add Host
          </Button>
        </div>

        <ConnectHostModal
          isOpen={connectModalOpen()}
          onClose={() => setConnectModalOpen(false)}
        />

        <Show
          when={hosts().length > 0}
          fallback={
            <DashboardEmptyState
              title="No connected hosts"
              description="Connect to a remote host to manage agents"
              action={{ label: "Add Host", onClick: () => setConnectModalOpen(true) }}
            />
          }
        >
          <div class="space-y-3">
            <For each={hosts()}>
              {(host) =>
                host.machineId === "local" ||
                !getRemoteHostControlSessionId(host) ? (
                  <HostSummaryCard host={host} />
                ) : (
                  <HostProxyPanel host={host} />
                )
              }
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

// ============================================================================
// Proxies View
// ============================================================================

const ProxiesView: Component = () => {
  const activeSession = createMemo(() => sessionStore.getActiveSession());
  const currentControlSessionId = createMemo(
    () =>
      sessionStore.state.targetControlSessionId ||
      activeSession()?.controlSessionId ||
      sessionStore.getConnectedHosts()[0]?.controlSessionId ||
      null,
  );

  let cleanupTcpListener: (() => void) | undefined;

  createEffect(() => {
    const controlSessionId = currentControlSessionId();

    void (async () => {
      cleanupTcpListener?.();
      cleanupTcpListener = undefined;

      if (!controlSessionId) {
        return;
      }

      cleanupTcpListener = await tcpForwardingStore.init(controlSessionId);
    })();
  });

  onCleanup(() => {
    cleanupTcpListener?.();
  });

  const selectedHost = createMemo(() =>
    sessionStore
      .getConnectedHosts()
      .find((host) => host.controlSessionId === currentControlSessionId()),
  );
  const proxySessions = createMemo<TcpForwardingSession[]>(() => {
    const controlSessionId = currentControlSessionId();
    if (!controlSessionId) return [];
    return tcpForwardingStore.state.sessions[controlSessionId] || [];
  });
  const previewProxy = createMemo(
    () =>
      proxySessions().find(
        (session) => session.id === navigationStore.state.previewProxyId,
      ) || proxySessions().find((session) => session.status === "running"),
  );

  return (
    <div class="flex min-h-0 flex-1 flex-col bg-base-100 h-full">
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-base-100">
        <header class="flex items-center justify-between gap-3 border-b border-base-content/10 bg-base-100/80 px-4 py-3 backdrop-blur-lg md:px-6">
          <div class="flex items-center gap-3 min-w-0">
            {/* Hamburger menu - only visible on mobile */}
            <label
              for="drawer"
              aria-label="Open menu"
              class="btn btn-square btn-ghost drawer-button lg:hidden"
            >
              <svg
                width="20"
                height="20"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                class="inline-block h-5 w-5 stroke-current"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6h16M4 12h16M4 18h16"
                ></path>
              </svg>
            </label>
            <div class="min-w-0">
              <p class="text-[10px] font-black uppercase tracking-[0.3em] text-primary/80">
                TCP Preview
              </p>
              <h2 class="truncate text-sm font-bold md:text-base">
                {selectedHost()?.hostname || "TCP Proxies"}
              </h2>
            </div>
          </div>
          <Show when={previewProxy()?.status === "running"}>
            <a
              href={getProxyPreviewUrl(previewProxy()!.local_addr)}
              target="_blank"
              class="btn btn-ghost btn-sm rounded-lg"
            >
              Open in browser
            </a>
          </Show>
        </header>

        <Show
          when={currentControlSessionId()}
          fallback={
            <div class="flex flex-1 items-center justify-center px-6 text-center">
              <div>
                <FiBox size={40} class="mx-auto mb-4 opacity-20" />
                <p class="text-sm font-bold opacity-50">No preview selected</p>
              </div>
            </div>
          }
        >
          <Show
            when={previewProxy()?.status === "running"}
            fallback={
              <div class="flex flex-1 items-center justify-center px-6 text-center">
                <div>
                  <FiGlobe size={40} class="mx-auto mb-4 opacity-20" />
                  <p class="text-sm font-bold opacity-50">
                    No running tunnel selected
                  </p>
                </div>
              </div>
            }
          >
            <iframe
              title={`TCP preview ${previewProxy()?.local_addr || ""}`}
              src={getProxyPreviewUrl(previewProxy()!.local_addr)}
              class="h-full w-full flex-1 bg-base-100"
            />
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default Dashboard;
