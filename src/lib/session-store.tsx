import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { reduceAcpEvents } from "@/lib/chat-reducer";
import type {
  AgentSession,
  ConnectedHost,
  ChatMessage,
  PermissionRequest,
  AcpEvent,
} from "@/types/api";

interface SessionStore {
  // Sessions
  sessions: AgentSession[];
  addSession: (session: AgentSession) => void;
  removeSession: (sessionId: string) => void;
  updateSession: (sessionId: string, updates: Partial<AgentSession>) => void;

  // Connection
  connectedHosts: Record<string, ConnectedHost>;
  connectionState: "connected" | "disconnected" | "reconnecting" | "connecting";
  activeSessionId: string | null;
  getConnectedHosts: () => ConnectedHost[];
  addConnectedHost: (host: ConnectedHost) => void;
  removeConnectedHost: (controlSessionId: string) => void;
  updateConnectedHost: (controlSessionId: string, updates: Partial<ConnectedHost>) => void;
  setConnectionState: (state: "connected" | "disconnected" | "reconnecting" | "connecting") => void;
  setActiveSession: (sessionId: string | null) => void;

  // Messages (per session)
  messagesBySession: Record<string, ChatMessage[]>;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  addMessages: (sessionId: string, messages: ChatMessage[]) => void;
  applyAcpEvents: (sessionId: string, events: AcpEvent[]) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  upsertMessage: (sessionId: string, message: ChatMessage) => void;
  clearMessages: (sessionId: string) => void;
  getMessages: (sessionId: string) => ChatMessage[];

  // Permissions (per session)
  permissionsBySession: Record<string, PermissionRequest[]>;
  addPermission: (sessionId: string, permission: PermissionRequest) => void;
  resolvePermission: (sessionId: string, requestId: string) => void;
  getPermissions: (sessionId: string) => PermissionRequest[];

  // Typing state
  typingBySession: Record<string, boolean>;
  setTyping: (sessionId: string, typing: boolean) => void;
}

const SessionStoreContext = createContext<SessionStore | null>(null);

export function SessionStoreProvider({ children }: { children: ReactNode }) {
  // Sessions
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [connectedHosts, setConnectedHosts] = useState<Record<string, ConnectedHost>>({});
  const [connectionState, setConnectionState] = useState<"connected" | "disconnected" | "reconnecting" | "connecting">("disconnected");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Messages — state for React reactivity
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});

  // Permissions
  const [permissionsBySession, setPermissionsBySession] = useState<Record<string, PermissionRequest[]>>({});

  // Typing
  const [typingBySession, setTypingBySession] = useState<Record<string, boolean>>({});

  // --- Session helpers ---
  const addSession = useCallback((session: AgentSession) => {
    setSessions((prev) => [...prev, session]);
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    setMessagesBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setPermissionsBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setTypingBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const updateSession = useCallback((sessionId: string, updates: Partial<AgentSession>) => {
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, ...updates } : s))
    );
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    setActiveSessionId(sessionId);
  }, []);

  const getConnectedHosts = useCallback(() => Object.values(connectedHosts), [connectedHosts]);

  const addConnectedHost = useCallback((host: ConnectedHost) => {
    setConnectedHosts((prev) => ({ ...prev, [host.controlSessionId]: host }));
  }, []);

  const removeConnectedHost = useCallback((controlSessionId: string) => {
    setConnectedHosts((prev) => {
      const next = { ...prev };
      delete next[controlSessionId];
      return next;
    });
  }, []);

  const updateConnectedHost = useCallback((controlSessionId: string, updates: Partial<ConnectedHost>) => {
    setConnectedHosts((prev) => {
      const existing = prev[controlSessionId];
      if (!existing) return prev;
      return { ...prev, [controlSessionId]: { ...existing, ...updates } };
    });
  }, []);

  // --- Message helpers ---
  const addMessage = useCallback((sessionId: string, message: ChatMessage) => {
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), message],
    }));
  }, []);

  const addMessages = useCallback((sessionId: string, messages: ChatMessage[]) => {
    if (messages.length === 0) return;
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), ...messages],
    }));
  }, []);

  const applyAcpEvents = useCallback((sessionId: string, events: AcpEvent[]) => {
    if (events.length === 0) return;
    setMessagesBySession((prev) => {
      const existing = prev[sessionId] ?? [];
      const next = reduceAcpEvents(existing, events);
      return { ...prev, [sessionId]: next };
    });
  }, []);

  const updateMessage = useCallback((sessionId: string, messageId: string, updates: Partial<ChatMessage>) => {
    setMessagesBySession((prev) => {
      const current = prev[sessionId] ?? [];
      return {
        ...prev,
        [sessionId]: current.map((m) =>
          m.id === messageId ? ({ ...m, ...updates } as ChatMessage) : m
        ),
      };
    });
  }, []);

  const upsertMessage = useCallback((sessionId: string, message: ChatMessage) => {
    setMessagesBySession((prev) => {
      const current = [...(prev[sessionId] ?? [])];
      const index = current.findIndex((m) => m.id === message.id);
      if (index >= 0) {
        current[index] = { ...current[index], ...message } as ChatMessage;
      } else {
        current.push(message);
      }
      return { ...prev, [sessionId]: current };
    });
  }, []);

  const clearMessages = useCallback((sessionId: string) => {
    setMessagesBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const getMessages = useCallback((sessionId: string) => {
    return messagesBySession[sessionId] ?? [];
  }, [messagesBySession]);

  // --- Permission helpers ---
  const addPermission = useCallback((sessionId: string, permission: PermissionRequest) => {
    setPermissionsBySession((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), permission],
    }));
  }, []);

  const resolvePermission = useCallback((sessionId: string, requestId: string) => {
    setPermissionsBySession((prev) => ({
      ...prev,
      [sessionId]: (prev[sessionId] ?? []).filter((p) => p.requestId !== requestId),
    }));
  }, []);

  const getPermissions = useCallback((sessionId: string) => {
    return permissionsBySession[sessionId] ?? [];
  }, [permissionsBySession]);

  // --- Typing ---
  const setTyping = useCallback((sessionId: string, typing: boolean) => {
    setTypingBySession((prev) => ({ ...prev, [sessionId]: typing }));
  }, []);

  return (
    <SessionStoreContext.Provider
      value={{
        sessions,
        connectedHosts,
        connectionState,
        activeSessionId,
        messagesBySession,
        permissionsBySession,
        typingBySession,
        addSession,
        removeSession,
        updateSession,
        setActiveSession,
        getConnectedHosts,
        addConnectedHost,
        removeConnectedHost,
        updateConnectedHost,
        setConnectionState,
        addMessage,
        addMessages,
        applyAcpEvents,
        updateMessage,
        upsertMessage,
        clearMessages,
        getMessages,
        addPermission,
        resolvePermission,
        getPermissions,
        setTyping,
      }}
    >
      {children}
    </SessionStoreContext.Provider>
  );
}

export function useSessionStore(): SessionStore {
  const context = useContext(SessionStoreContext);
  if (!context) {
    throw new Error("useSessionStore must be used within SessionStoreProvider");
  }
  return context;
}
