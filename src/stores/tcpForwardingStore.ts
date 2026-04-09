import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { notificationStore } from "./notificationStore";

export interface TcpForwardingSession {
  id: string;
  local_addr: string;
  remote_host: string;
  remote_port: number;
  status: "pending" | "running" | "stopped" | "starting";
}

export interface TcpForwardingEvent {
  action: string;
  request_id?: string;
  session_id?: string;
  local_addr?: string;
  remote_host?: string;
  remote_port?: number;
}

interface TcpForwardingState {
  sessions: Record<string, TcpForwardingSession[]>; // session_id -> sessions
  loading: boolean;
}

const [state, setState] = createStore<TcpForwardingState>({
  sessions: {},
  loading: false,
});

export const tcpForwardingStore = {
  state,

  async init(session_id: string) {
    // Listen for TCP forwarding events for this agent session
    const unlisten = await listen(`tcp-forwarding-${session_id}`, (event) => {
      const payload = event.payload as TcpForwardingEvent;
      console.log("TCP Forwarding event:", payload);

      // Refresh session list on any relevant action
      this.listSessions(session_id);

      if (payload.action === "SessionCreated") {
        notificationStore.success("TCP Forwarding session created", "TCP");
      } else if (payload.action === "SessionStopped") {
        notificationStore.info("TCP Forwarding session stopped", "TCP");
      }
    });

    // Initial list
    await this.listSessions(session_id);

    return unlisten;
  },

  async createSession(
    session_id: string,
    local_addr: string,
    remote_host: string,
    remote_port: number,
  ) {
    try {
      setState("loading", true);
      const result = await invoke<string>("create_tcp_forwarding_session", {
        sessionId: session_id,
        localAddr: local_addr,
        remoteHost: remote_host,
        remotePort: remote_port,
        forwardingType: "ListenToRemote",
      });

      await this.listSessions(session_id);
      return result;
    } catch (err) {
      notificationStore.error(String(err), "TCP Error");
      throw err;
    } finally {
      setState("loading", false);
    }
  },

  async listSessions(session_id: string) {
    try {
      // 1. Tell CLI to list sessions (to update our local manager with remote info)
      // and get local sessions from manager in ONE call
      const sessions = await invoke<TcpForwardingSession[]>(
        "list_tcp_forwarding_sessions",
        { sessionId: session_id }
      );

      setState("sessions", session_id, sessions);
    } catch (err) {
      console.error("Failed to list TCP sessions:", err);
    }
  },

  async stopSession(session_id: string, tcp_session_id: string) {
    try {
      setState("loading", true);
      await invoke("stop_tcp_forwarding_session", {
        sessionId: session_id,
        tcpSessionId: tcp_session_id,
      });
      await this.listSessions(session_id);
    } catch (err) {
      notificationStore.error(String(err), "TCP Error");
    } finally {
      setState("loading", false);
    }
  },

  // Manual update from event data if needed
  updateSessions(session_id: string, sessions: TcpForwardingSession[]) {
    setState("sessions", session_id, sessions);
  },
};
