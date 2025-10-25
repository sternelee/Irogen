import { createSignal, onCleanup } from "solid-js";
import { ConnectionManager, ConnectionProgress, DumbPipeConnectionManager } from "../utils/timeout";

/**
 * 创建增强的连接处理 Hook
 */
export function createConnectionHandler() {
  const [connecting, setConnecting] = createSignal(false);
  const [connectionProgress, setConnectionProgress] = createSignal<ConnectionProgress | null>(null);
  const [connectionError, setConnectionError] = createSignal<string | null>(null);
  const [activeNodeTicket, setActiveNodeTicket] = createSignal<string | null>(null);

  // 创建连接管理器
  const connectionManager = new ConnectionManager(10000); // 10秒默认超时
  const dumbPipeManager = new DumbPipeConnectionManager(10000);

  // 设置进度监听
  connectionManager.onProgress((progress) => {
    setConnectionProgress(progress);
  });

  dumbPipeManager.onProgress((progress) => {
    setConnectionProgress(progress);
  });

  // 清理资源
  onCleanup(() => {
    connectionManager.abort();
    dumbPipeManager.abort();
  });

  const connect = async (ticket: string, options: {
    timeout?: number;
    retries?: number;
    onProgressUpdate?: (progress: ConnectionProgress) => void;
  } = {}) => {
    const {
      timeout = 10000,
      retries = 2,
      onProgressUpdate
    } = options;

    setConnecting(true);
    setConnectionError(null);
    setConnectionProgress(null);

    // 可选的进度回调
    if (onProgressUpdate) {
      connectionManager.onProgress((progress) => {
        setConnectionProgress(progress);
        onProgressUpdate(progress);
      });
    }

    try {
      // First try the traditional connection manager
      const sessionId = await connectionManager.connect(ticket, {
        timeout,
        retries,
        progressInterval: 500, // 每500ms更新一次进度
      });

      return sessionId;
    } catch (error) {
      // If traditional connection fails, try dumbpipe
      console.log("Traditional connection failed, trying dumbpipe:", error);

      try {
        // Set progress callback for dumbpipe
        if (onProgressUpdate) {
          dumbPipeManager.onProgress((progress) => {
            setConnectionProgress(progress);
            onProgressUpdate(progress);
          });
        }

        const sessionId = await dumbPipeManager.connect(ticket, {
          timeout,
          retries,
          progressInterval: 500
        });

        setActiveNodeTicket(ticket);
        return sessionId;
      } catch (dumbpipeError) {
        const errorMessage = dumbpipeError instanceof Error ? dumbpipeError.message : String(dumbpipeError);
        setConnectionError(errorMessage);
        throw dumbpipeError;
      }
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async (sessionId?: string, nodeTicket?: string) => {
    // If we have an active dumbpipe connection, disconnect it
    if (activeNodeTicket() || nodeTicket) {
      const ticketToDisconnect = nodeTicket || activeNodeTicket();
      dumbPipeManager.disconnect(ticketToDisconnect);
      setActiveNodeTicket(null);
    }

    // If we have a sessionId, use traditional disconnect
    if (sessionId) {
      try {
        const { ConnectionApi } = await import("../utils/api");
        await ConnectionApi.disconnect(sessionId);
      } catch (error) {
        console.warn("Failed to disconnect session:", error);
      }
    }
  };

  const abort = () => {
    connectionManager.abort();
    setConnecting(false);
    setConnectionProgress(null);
  };

  const isConnecting = () => connectionManager.isConnecting();

  return {
    connect,
    abort,
    connecting,
    isConnecting,
    connectionProgress,
    connectionError,
    setConnectionError,
    activeNodeTicket
  };
}
