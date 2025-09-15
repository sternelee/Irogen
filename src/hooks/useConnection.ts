import { createSignal, onCleanup } from "solid-js";
import { ConnectionManager, ConnectionProgress } from "../utils/timeout";

/**
 * 创建增强的连接处理 Hook
 */
export function createConnectionHandler() {
  const [connecting, setConnecting] = createSignal(false);
  const [connectionProgress, setConnectionProgress] = createSignal<ConnectionProgress | null>(null);
  const [connectionError, setConnectionError] = createSignal<string | null>(null);

  // 创建连接管理器
  const connectionManager = new ConnectionManager(10000); // 10秒默认超时

  // 设置进度监听
  connectionManager.onProgress((progress) => {
    setConnectionProgress(progress);
  });

  // 清理资源
  onCleanup(() => {
    connectionManager.abort();
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
      const sessionId = await connectionManager.connect(ticket, {
        timeout,
        retries,
        progressInterval: 500, // 每500ms更新一次进度
      });

      return sessionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setConnectionError(errorMessage);
      throw error;
    } finally {
      setConnecting(false);
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
    setConnectionError
  };
}