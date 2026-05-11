import { invoke } from "@tauri-apps/api/core";
import type { AgentType, PermissionMode, SessionMode } from "@/types/api";

// ============================================================================
// Network / Connection
// ============================================================================

export async function initializeNetwork(relayUrl?: string): Promise<string> {
  if (relayUrl) {
    return invoke("initialize_network_with_relay", { relayUrl });
  }
  return invoke("initialize_network");
}

export async function connectToHost(sessionTicket: string): Promise<string> {
  return invoke("connect_to_host", { sessionTicket });
}

export async function disconnectSession(sessionId: string): Promise<void> {
  return invoke("disconnect_session", { sessionId });
}

export async function getActiveSessions(): Promise<string[]> {
  return invoke("get_active_sessions");
}

export async function getNodeInfo(): Promise<string> {
  return invoke("get_node_info");
}

// ============================================================================
// Local Agent Session Creation
// ============================================================================

export interface StartLocalAgentOptions {
  agentType: AgentType;
  projectPath: string;
  sessionId?: string;
  extraArgs?: string[];
  mcpServers?: Record<string, unknown>;
  additionalProjectPaths?: string[];
}

export async function localStartAgent(
  opts: StartLocalAgentOptions
): Promise<string> {
  return invoke("local_start_agent", {
    agentTypeStr: opts.agentType,
    projectPath: opts.projectPath,
    sessionId: opts.sessionId,
    extraArgs: opts.extraArgs ?? [],
    mcpServers: opts.mcpServers,
    additionalProjectPaths: opts.additionalProjectPaths,
  });
}

// ============================================================================
// Remote Agent Session Creation
// ============================================================================

export interface SpawnRemoteAgentOptions {
  connectionSessionId: string;
  agentType: string;
  projectPath: string;
  args?: string[];
  mcpServers?: Record<string, unknown>;
}

export async function remoteSpawnSession(
  opts: SpawnRemoteAgentOptions
): Promise<string> {
  return invoke("remote_spawn_session", {
    connectionSessionId: opts.connectionSessionId,
    agentType: opts.agentType,
    projectPath: opts.projectPath,
    args: opts.args ?? [],
    mcpServers: opts.mcpServers,
  });
}

// ============================================================================
// Agent Messaging
// ============================================================================

export async function sendAgentMessage(
  sessionId: string,
  content: string,
  attachments: string[] = [],
  controlSessionId?: string
): Promise<void> {
  return invoke("send_agent_message", {
    sessionId,
    content,
    attachments,
    controlSessionId,
  });
}

export async function localSendAgentMessage(
  sessionId: string,
  content: string,
  attachments: string[] = []
): Promise<void> {
  return invoke("local_send_agent_message", {
    sessionId,
    content,
    attachments,
  });
}

// ============================================================================
// Agent Control (Abort / Interrupt)
// ============================================================================

export async function abortAgentAction(
  sessionId: string,
  controlSessionId?: string
): Promise<void> {
  return invoke("abort_agent_action", { sessionId, controlSessionId });
}

export async function localAbortAgentAction(sessionId: string): Promise<void> {
  return invoke("local_abort_agent_action", { sessionId });
}

// ============================================================================
// Session Lifecycle (Stop / Close)
// ============================================================================

export async function localStopAgent(sessionId: string): Promise<void> {
  return invoke("local_stop_agent", { sessionId });
}

export async function remoteStopAgent(sessionId: string): Promise<void> {
  return invoke("remote_stop_agent", { sessionId });
}

export async function closeAgentSession(
  sessionId: string,
  controlSessionId?: string
): Promise<void> {
  return invoke("close_agent_session", { sessionId, controlSessionId });
}

export async function localCloseAgentSession(sessionId: string): Promise<void> {
  return invoke("local_close_agent_session", { sessionId });
}

// ============================================================================
// ACP 0.11 Session Control (Mode / Config / Model / Status)
// ============================================================================

export async function getAgentStatus(
  sessionId: string,
  controlSessionId?: string
): Promise<unknown> {
  return invoke("get_agent_status", { sessionId, controlSessionId });
}

export async function localGetAgentStatus(
  sessionId: string
): Promise<unknown> {
  return invoke("local_get_agent_status", { sessionId });
}

export async function setAgentMode(
  sessionId: string,
  mode: string,
  controlSessionId?: string
): Promise<void> {
  return invoke("set_agent_mode", { sessionId, mode, controlSessionId });
}

export async function localSetAgentMode(
  sessionId: string,
  mode: string
): Promise<void> {
  return invoke("local_set_agent_mode", { sessionId, mode });
}

export async function setAgentConfig(
  sessionId: string,
  key: string,
  value: string,
  controlSessionId?: string
): Promise<unknown> {
  return invoke("set_agent_config", {
    sessionId,
    key,
    value,
    controlSessionId,
  });
}

export async function localSetAgentConfig(
  sessionId: string,
  key: string,
  value: string
): Promise<unknown> {
  return invoke("local_set_agent_config", { sessionId, key, value });
}

export async function setAgentModel(
  sessionId: string,
  model: string,
  controlSessionId?: string
): Promise<void> {
  return invoke("set_agent_model", { sessionId, model, controlSessionId });
}

export async function localSetAgentModel(
  sessionId: string,
  model: string
): Promise<void> {
  return invoke("local_set_agent_model", { sessionId, model });
}

export async function getAgentLifecycle(
  sessionId: string,
  controlSessionId?: string
): Promise<unknown> {
  return invoke("get_agent_lifecycle", { sessionId, controlSessionId });
}

export async function localGetAgentLifecycle(
  sessionId: string
): Promise<unknown> {
  return invoke("local_get_agent_lifecycle", { sessionId });
}

// ============================================================================
// Permission Management
// ============================================================================

export async function respondToAgentPermission(
  sessionId: string,
  permissionId: string,
  approved: boolean,
  approveForSession: boolean,
  controlSessionId?: string
): Promise<void> {
  return invoke("respond_to_agent_permission", {
    sessionId,
    permissionId,
    approved,
    approveForSession,
    controlSessionId,
  });
}

export async function localRespondToAgentPermission(
  sessionId: string,
  permissionId: string,
  approved: boolean,
  approveForSession: boolean
): Promise<void> {
  return invoke("local_respond_to_agent_permission", {
    sessionId,
    permissionId,
    approved,
    approveForSession,
  });
}

export async function setPermissionMode(
  sessionId: string,
  mode: PermissionMode,
  controlSessionId?: string
): Promise<void> {
  return invoke("remote_set_permission_mode", {
    sessionId,
    mode: mode === "alwaysAsk"
      ? "AlwaysAsk"
      : mode === "acceptEdits"
        ? "AcceptEdits"
        : mode === "autoApprove"
          ? "AutoApprove"
          : mode === "plan"
            ? "Plan"
            : "AlwaysAsk",
    controlSessionId,
  });
}

export async function localSetPermissionMode(
  sessionId: string,
  mode: PermissionMode
): Promise<void> {
  return invoke("local_set_permission_mode", {
    sessionId,
    mode: mode === "alwaysAsk"
      ? "AlwaysAsk"
      : mode === "acceptEdits"
        ? "AcceptEdits"
        : mode === "autoApprove"
          ? "AutoApprove"
          : mode === "plan"
            ? "Plan"
            : "AlwaysAsk",
  });
}

export async function getPermissionMode(
  sessionId: string,
  controlSessionId?: string
): Promise<string> {
  return invoke("get_permission_mode", { sessionId, controlSessionId });
}

// ============================================================================
// File Browser
// ============================================================================

export interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

export async function listDirectory(path: string): Promise<DirEntry[]> {
  return invoke("list_directory", { path });
}

export async function fileBrowserList(path: string): Promise<{
  success: boolean;
  entries: { name: string; is_dir?: boolean; isDir?: boolean; size?: number }[];
  error?: string;
}> {
  return invoke("file_browser_list", { path });
}

export async function fileBrowserRead(path: string): Promise<{
  success: boolean;
  path: string;
  content?: string;
  error?: string;
}> {
  return invoke("file_browser_read", { path });
}

// ============================================================================
// Git
// ============================================================================

export async function gitStatus(path: string): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  return invoke("git_status", { path });
}

export async function gitDiff(
  path: string,
  file: string
): Promise<{
  success: boolean;
  file?: string;
  diff?: string;
  error?: string;
}> {
  return invoke("git_diff", { path, file });
}

// ============================================================================
// ACP Package Installation
// ============================================================================

export async function installAcpPackageLocal(agentType: string): Promise<string> {
  return invoke("install_acp_package_local", { agentType });
}

export async function installAcpPackageRemote(
  sessionId: string,
  agentType: string
): Promise<string> {
  return invoke("install_acp_package_remote", { sessionId, agentType });
}

// ============================================================================
// System Stats
// ============================================================================

// ============================================================================
// Session List
// ============================================================================

export async function localListAgents(): Promise<{
  sessionId: string;
  agentType: string;
  projectPath: string;
  startedAt: number;
  active: boolean;
  controlledByRemote: boolean;
  hostname: string;
  os: string;
  agentVersion?: string;
  currentDir: string;
}[]> {
  return invoke("local_list_agents");
}

export async function remoteListAgents(
  controlSessionId?: string
): Promise<{
  sessionId: string;
  agentType: string;
  projectPath: string;
  startedAt: number;
  active: boolean;
  controlledByRemote: boolean;
  hostname: string;
  os: string;
  agentVersion?: string;
  currentDir: string;
}[]> {
  return invoke("remote_list_agents", { controlSessionId: controlSessionId ?? null });
}

// ============================================================================
// Remote File Browser
// ============================================================================

export async function remoteFileBrowserList(
  controlSessionId: string,
  path: string
): Promise<{
  success: boolean;
  entries: { name: string; is_dir?: boolean; isDir?: boolean; size?: number }[];
  error?: string;
}> {
  return invoke("remote_file_browser_list", { controlSessionId, path });
}

export async function listRemoteDirectory(
  sessionId: string,
  path: string
): Promise<DirEntry[]> {
  const result = await remoteFileBrowserList(sessionId, path);
  if (!result.success) {
    throw new Error(result.error ?? "Failed to list remote directory");
  }
  const dirs: DirEntry[] = [];
  for (const entry of result.entries) {
    const isDir = entry.is_dir ?? entry.isDir ?? false;
    dirs.push({
      name: entry.name,
      is_dir: isDir,
      size: entry.size ?? 0,
    });
  }
  return dirs;
}

export async function remoteFileBrowserRead(
  controlSessionId: string,
  path: string
): Promise<{
  success: boolean;
  path: string;
  content?: string;
  error?: string;
}> {
  return invoke("remote_file_browser_read", { controlSessionId, path });
}

// ============================================================================
// Remote Git
// ============================================================================

export async function remoteGitStatus(
  controlSessionId: string,
  path: string
): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  return invoke("remote_git_status", { controlSessionId, path });
}

export async function remoteGitDiff(
  controlSessionId: string,
  path: string,
  file: string
): Promise<{
  success: boolean;
  file?: string;
  diff?: string;
  error?: string;
}> {
  return invoke("remote_git_diff", { controlSessionId, path, file });
}

// ============================================================================
// System Stats
// ============================================================================

export async function getLocalSystemStats(): Promise<unknown> {
  return invoke("get_local_system_stats");
}

export async function getRemoteSystemStats(
  controlSessionId: string
): Promise<unknown> {
  return invoke("get_remote_system_stats", { controlSessionId });
}

// ============================================================================
// Connection (additional)
// ============================================================================

/**
 * Validate a session ticket without connecting. Returns a parsed node id string
 * on success, or rejects with an error describing why the ticket is invalid.
 */
export async function parseSessionTicket(ticket: string): Promise<string> {
  return invoke("parse_session_ticket", { ticket });
}

/**
 * Connect to a peer using a session ticket. Mirrors `connectToHost` but uses the
 * separate `connect_to_peer` backend command (works without a fully-initialized
 * communication manager in some flows).
 */
export async function connectToPeer(sessionTicket: string): Promise<string> {
  return invoke("connect_to_peer", { session_ticket: sessionTicket });
}

// ============================================================================
// Slash commands & mention candidates
// ============================================================================

export interface MentionCandidate {
  name: string;
  path: string;
}

export async function sendSlashCommand(
  sessionId: string,
  command: string,
  controlSessionId?: string
): Promise<string> {
  return invoke("send_slash_command", {
    sessionId,
    command,
    controlSessionId,
  });
}

export async function listMentionCandidates(
  basePath: string,
  query: string,
  limit?: number
): Promise<MentionCandidate[]> {
  return invoke("list_mention_candidates", { basePath, query, limit });
}

export async function listRemoteMentionCandidates(
  sessionId: string,
  basePath: string,
  query: string,
  limit?: number
): Promise<MentionCandidate[]> {
  return invoke("list_remote_mention_candidates", {
    sessionId,
    basePath,
    query,
    limit,
  });
}

// ============================================================================
// Local Agent History
// ============================================================================

export interface AgentHistoryEntry {
  session_id: string;
  project_path: string;
  started_at?: number;
  summary?: string;
  [key: string]: unknown;
}

export async function localListAgentHistory(
  agentType: AgentType,
  projectPath: string
): Promise<AgentHistoryEntry[]> {
  return invoke("local_list_agent_history", {
    agentTypeStr: agentType,
    projectPath,
  });
}

export async function localLoadAgentHistory(opts: {
  agentType: AgentType;
  historySessionId: string;
  projectPath: string;
  resume: boolean;
  extraArgs?: string[];
  targetSessionId?: string;
}): Promise<string> {
  return invoke("local_load_agent_history", {
    agentTypeStr: opts.agentType,
    historySessionId: opts.historySessionId,
    projectPath: opts.projectPath,
    resume: opts.resume,
    extraArgs: opts.extraArgs,
    targetSessionId: opts.targetSessionId,
  });
}

// ============================================================================
// Local Permission State
// ============================================================================

export interface LocalPendingPermission {
  request_id: string;
  tool_name: string;
  tool_params: unknown;
  message?: string;
  created_at: number;
}

export interface LocalPermissionState {
  mode: string;
  allowed_tools: string[];
  pending_requests: LocalPendingPermission[];
  completed_requests: Array<{
    request_id: string;
    tool_name: string;
    tool_params?: unknown;
    status: string;
    decision?: string;
    reason?: string;
    allowed_tools?: string[];
    created_at: number;
    completed_at: number;
  }>;
}

export async function localGetPendingPermissions(
  sessionId: string
): Promise<LocalPendingPermission[]> {
  return invoke("local_get_pending_permissions", { sessionId });
}

export async function localGetPermissionState(
  sessionId: string
): Promise<LocalPermissionState> {
  return invoke("local_get_permission_state", { sessionId });
}

// ============================================================================
// Remote Agent Control (low-level passthrough)
// ============================================================================

export async function sendAgentControl(opts: {
  connectionSessionId: string;
  agentSessionId: string;
  actionStr: string;
  actionParams?: unknown;
}): Promise<string> {
  return invoke("send_agent_control", {
    connectionSessionId: opts.connectionSessionId,
    agentSessionId: opts.agentSessionId,
    actionStr: opts.actionStr,
    actionParams: opts.actionParams,
  });
}
