/**
 * Typed Tauri Command API Adapter
 *
 * Wraps the auto-generated tyzen bindings with an ergonomic API that:
 * - Unwraps Result<T, E> responses (returns data on ok, throws on error)
 * - Re-exports all generated types for convenience
 * - Provides drop-in replacements for direct `invoke` calls
 *
 * Generated bindings live in `src/generated/tauri-bindings.ts`.
 */

import { commands } from "../generated/tauri-bindings";
import type {
  Result,
  AgentType,
  AgentHistoryEntry,
  AgentSessionMetadata,
  CompletedPermissionDto,
  DirEntry,
  DirectedMessageRequest,
  FileBrowserEntry,
  FileBrowserListResponse,
  FileBrowserReadResponse,
  GitDiffResponse,
  GitStatusResponse,
  LoadAverage,
  MentionCandidate,
  NetworkStats,
  PendingPermissionDto,
  PermissionStateDto,
  SystemStats,
  TcpForwardingSession,
} from "../generated/tauri-bindings";

export type {
  Result,
  AgentType,
  AgentHistoryEntry,
  AgentSessionMetadata,
  CompletedPermissionDto,
  DirEntry,
  DirectedMessageRequest,
  FileBrowserEntry,
  FileBrowserListResponse,
  FileBrowserReadResponse,
  GitDiffResponse,
  GitStatusResponse,
  LoadAverage,
  MentionCandidate,
  NetworkStats,
  PendingPermissionDto,
  PermissionStateDto,
  SystemStats,
  TcpForwardingSession,
};

/** Unwrap a Promise<Result<T, E>>, returning T or throwing the error. */
async function unwrap<T>(resultPromise: Promise<Result<T>>): Promise<T> {
  const result = await resultPromise;
  if (result.status === "ok") {
    return result.data;
  }
  throw new Error(String(result.error));
}

// ============================================================================
// Connection & Network
// ============================================================================

export const initializeNetwork = () => unwrap(commands.initializeNetwork());
export const initializeNetworkWithRelay = (relayUrl: string | null) =>
  unwrap(commands.initializeNetworkWithRelay(relayUrl));
export const getNodeInfo = () => unwrap(commands.getNodeInfo());
export const connectToHost = (sessionTicket: string) =>
  unwrap(commands.connectToHost(sessionTicket));
export const connectToPeer = (sessionTicket: string) =>
  unwrap(commands.connectToPeer(sessionTicket));
export const parseSessionTicket = (ticket: string) =>
  unwrap(commands.parseSessionTicket(ticket));

// ============================================================================
// Session Management
// ============================================================================

export const getActiveSessions = () => unwrap(commands.getActiveSessions());
export const disconnectSession = (sessionId: string) =>
  unwrap(commands.disconnectSession(sessionId));
export const showPanel = () => unwrap(commands.showPanel());
export const hidePanel = () => unwrap(commands.hidePanel());

// ============================================================================
// Local Agent Commands
// ============================================================================

export const localStartAgent = (
  agentTypeStr: string,
  projectPath: string,
  sessionId: string | null,
  extraArgs: string[] | null,
  mcpServers: unknown | null,
  additionalProjectPaths: string[] | null,
) =>
  unwrap(
    commands.localStartAgent(
      agentTypeStr,
      projectPath,
      sessionId,
      extraArgs,
      mcpServers,
      additionalProjectPaths,
    ),
  );

export const localStopAgent = (sessionId: string) =>
  unwrap(commands.localStopAgent(sessionId));
export const localAbortAgentAction = (sessionId: string) =>
  unwrap(commands.localAbortAgentAction(sessionId));
export const localSendAgentMessage = (
  sessionId: string,
  content: string,
  attachments: string[],
) => unwrap(commands.localSendAgentMessage(sessionId, content, attachments));
export const localSetPermissionMode = (sessionId: string, mode: string) =>
  unwrap(commands.localSetPermissionMode(sessionId, mode));
export const localRespondToAgentPermission = (
  sessionId: string,
  permissionId: string,
  approved: boolean,
  approveForSession: boolean,
) =>
  unwrap(
    commands.localRespondToAgentPermission(
      sessionId,
      permissionId,
      approved,
      approveForSession,
    ),
  );
export const localGetPermissionState = (sessionId: string) =>
  unwrap(commands.localGetPermissionState(sessionId));
export const localGetPendingPermissions = (sessionId: string) =>
  unwrap(commands.localGetPendingPermissions(sessionId));
export const localListAgents = () => unwrap(commands.localListAgents());
export const localListAgentHistory = (
  agentTypeStr: string,
  projectPath: string,
) => unwrap(commands.localListAgentHistory(agentTypeStr, projectPath));
export const localLoadAgentHistory = (
  agentTypeStr: string,
  historySessionId: string,
  projectPath: string,
  resume: boolean,
  extraArgs: string[] | null,
  targetSessionId: string | null,
) =>
  unwrap(
    commands.localLoadAgentHistory(
      agentTypeStr,
      historySessionId,
      projectPath,
      resume,
      extraArgs,
      targetSessionId,
    ),
  );

// ============================================================================
// Remote Agent Commands
// ============================================================================

export const remoteSpawnSession = (
  connectionSessionId: string,
  agentType: string,
  projectPath: string,
  args: string[],
  mcpServers: unknown | null,
) =>
  unwrap(
    commands.remoteSpawnSession(
      connectionSessionId,
      agentType,
      projectPath,
      args,
      mcpServers,
    ),
  );

export const remoteStopAgent = (
  sessionId: string,
  controlSessionId: string | null,
) => unwrap(commands.remoteStopAgent(sessionId, controlSessionId));
export const remoteListAgents = (controlSessionId: string | null) =>
  unwrap(commands.remoteListAgents(controlSessionId));
export const sendAgentMessage = (
  sessionId: string,
  content: string,
  attachments: string[],
  controlSessionId: string | null,
) =>
  unwrap(
    commands.sendAgentMessage(
      sessionId,
      content,
      attachments,
      controlSessionId,
    ),
  );
export const sendAgentControl = (
  connectionSessionId: string,
  agentSessionId: string,
  actionStr: string,
  actionParams: unknown | null,
) =>
  unwrap(
    commands.sendAgentControl(
      connectionSessionId,
      agentSessionId,
      actionStr,
      actionParams,
    ),
  );
export const sendSlashCommand = (
  sessionId: string,
  command: string,
  controlSessionId: string | null,
) =>
  unwrap(commands.sendSlashCommand(sessionId, command, controlSessionId));
export const abortAgentAction = (
  sessionId: string,
  controlSessionId: string | null,
) => unwrap(commands.abortAgentAction(sessionId, controlSessionId));
export const respondToAgentPermission = (
  sessionId: string,
  permissionId: string,
  approved: boolean,
  approveForSession: boolean,
  controlSessionId: string | null,
) =>
  unwrap(
    commands.respondToAgentPermission(
      sessionId,
      permissionId,
      approved,
      approveForSession,
      controlSessionId,
    ),
  );
export const respondPermission = (
  sessionId: string,
  requestId: string,
  approved: boolean,
  approveForSession: boolean,
  reason: string | null,
) =>
  unwrap(
    commands.respondPermission(
      sessionId,
      requestId,
      approved,
      approveForSession,
      reason,
    ),
  );
export const getPermissionMode = (
  sessionId: string,
  controlSessionId: string | null,
) => unwrap(commands.getPermissionMode(sessionId, controlSessionId));
export const remoteSetPermissionMode = (
  sessionId: string,
  mode: string,
  controlSessionId: string | null,
) =>
  unwrap(commands.remoteSetPermissionMode(sessionId, mode, controlSessionId));

// ============================================================================
// File Browser
// ============================================================================

export const fileBrowserList = (path: string) =>
  unwrap(commands.fileBrowserList(path));
export const fileBrowserRead = (path: string) =>
  unwrap(commands.fileBrowserRead(path));
export const remoteFileBrowserList = (controlSessionId: string, path: string) =>
  unwrap(commands.remoteFileBrowserList(controlSessionId, path));
export const remoteFileBrowserRead = (controlSessionId: string, path: string) =>
  unwrap(commands.remoteFileBrowserRead(controlSessionId, path));
export const listDirectory = (path: string) =>
  unwrap(commands.listDirectory(path));
export const listRemoteDirectory = (sessionId: string, path: string) =>
  unwrap(commands.listRemoteDirectory(sessionId, path));

// ============================================================================
// Git
// ============================================================================

export const gitStatus = (path: string) => unwrap(commands.gitStatus(path));
export const gitDiff = (path: string, file: string) =>
  unwrap(commands.gitDiff(path, file));
export const remoteGitStatus = (controlSessionId: string, path: string) =>
  unwrap(commands.remoteGitStatus(controlSessionId, path));
export const remoteGitDiff = (
  controlSessionId: string,
  path: string,
  file: string,
) => unwrap(commands.remoteGitDiff(controlSessionId, path, file));

// ============================================================================
// Mention / Search
// ============================================================================

export const listMentionCandidates = (
  basePath: string,
  query: string,
  limit: number | null,
) => unwrap(commands.listMentionCandidates(basePath, query, limit));
export const listRemoteMentionCandidates = (
  sessionId: string,
  basePath: string,
  query: string,
  limit: number | null,
) =>
  unwrap(
    commands.listRemoteMentionCandidates(sessionId, basePath, query, limit),
  );

// ============================================================================
// TCP Forwarding
// ============================================================================

export const createTcpForwardingSession = (
  sessionId: string,
  localAddr: string,
  remoteHost: string | null,
  remotePort: number | null,
  forwardingType: string,
) =>
  unwrap(
    commands.createTcpForwardingSession(
      sessionId,
      localAddr,
      remoteHost,
      remotePort,
      forwardingType,
    ),
  );

export const listTcpForwardingSessions = (sessionId: string | null) =>
  unwrap(commands.listTcpForwardingSessions(sessionId));
export const getTcpForwardingSessionInfo = (
  sessionId: string,
  tcpSessionId: string,
) => unwrap(commands.getTcpForwardingSessionInfo(sessionId, tcpSessionId));
export const stopTcpForwardingSession = (
  sessionId: string,
  tcpSessionId: string,
) => unwrap(commands.stopTcpForwardingSession(sessionId, tcpSessionId));
export const sendTcpData = (
  sessionId: string,
  tcpSessionId: string,
  connectionId: string,
  data: number[],
  dataType: string,
) =>
  unwrap(
    commands.sendTcpData(sessionId, tcpSessionId, connectionId, data, dataType),
  );

// ============================================================================
// System Stats
// ============================================================================

export const getLocalSystemStats = () => unwrap(commands.getLocalSystemStats());
export const getRemoteSystemStats = (controlSessionId: string) =>
  unwrap(commands.getRemoteSystemStats(controlSessionId));

// ============================================================================
// ACP / Package Management
// ============================================================================

export const installAcpPackageLocal = (agentType: string) =>
  unwrap(commands.installAcpPackageLocal(agentType));
export const installAcpPackageRemote = (sessionId: string, agentType: string) =>
  unwrap(commands.installAcpPackageRemote(sessionId, agentType));
export const subscribeAcpInspector = (sessionId: string) =>
  unwrap(commands.subscribeAcpInspector(sessionId));

// ============================================================================
// Messaging
// ============================================================================

export const sendDirectedMessage = (request: DirectedMessageRequest) =>
  unwrap(commands.sendDirectedMessage(request));
