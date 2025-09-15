/**
 * 高级 Promise.race() 超时处理示例
 * 展示各种使用场景和最佳实践
 */

import { withTimeout, withTimeoutAndRetry, ConnectionManager } from "./utils/timeout";

// 示例1: 基本的 Promise.race() 超时处理（当前App.tsx中的方式）
export function basicTimeoutExample() {
  async function connectWithBasicTimeout(ticket: string): Promise<string> {
    const connectPromise = invoke<string>("connect_to_peer", {
      sessionTicket: ticket,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Connection timed out after 5 seconds")),
        5000,
      ),
    );

    return Promise.race([connectPromise, timeoutPromise]);
  }
}

// 示例2: 使用 AbortController 的可取消超时
export function cancellableTimeoutExample() {
  async function connectWithCancellation(
    ticket: string,
    signal?: AbortSignal
  ): Promise<string> {
    const controller = new AbortController();
    const combinedSignal = signal ?
      AbortSignal.any([signal, controller.signal]) :
      controller.signal;

    const connectPromise = invoke<string>("connect_to_peer", {
      sessionTicket: ticket,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("Connection timed out"));
      }, 10000);

      combinedSignal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new Error('Operation cancelled'));
      });
    });

    try {
      return await Promise.race([connectPromise, timeoutPromise]);
    } finally {
      controller.abort(); // 清理资源
    }
  }

  // 使用示例
  async function useExample() {
    const controller = new AbortController();

    try {
      const result = await connectWithCancellation("ticket123", controller.signal);
      console.log("Connected:", result);
    } catch (error) {
      console.error("Connection failed:", error);
    }

    // 可以随时取消
    // controller.abort();
  }
}

// 示例3: 带进度报告的超时处理
export function progressTimeoutExample() {
  async function connectWithProgress(
    ticket: string,
    onProgress: (elapsed: number, percentage: number) => void
  ): Promise<string> {
    const timeout = 15000; // 15秒
    const startTime = Date.now();

    const connectPromise = invoke<string>("connect_to_peer", {
      sessionTicket: ticket,
    });

    // 进度报告
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const percentage = Math.min((elapsed / timeout) * 100, 99);
      onProgress(elapsed, percentage);
    }, 500);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`Connection timed out after ${timeout}ms`));
      }, timeout)
    );

    try {
      const result = await Promise.race([connectPromise, timeoutPromise]);
      onProgress(Date.now() - startTime, 100);
      return result;
    } finally {
      clearInterval(progressInterval);
    }
  }
}

// 示例4: 带重试机制的超时处理
export function retryTimeoutExample() {
  async function connectWithRetry(
    ticket: string,
    maxRetries: number = 3
  ): Promise<string> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Connection attempt ${attempt}/${maxRetries}`);

        const result = await withTimeout(
          invoke<string>("connect_to_peer", { sessionTicket: ticket }),
          {
            timeout: 10000,
            message: `Connection attempt ${attempt} timed out`,
            onProgress: (elapsed) => {
              console.log(`Attempt ${attempt}: ${elapsed}ms elapsed`);
            }
          }
        );

        console.log(`Connection successful on attempt ${attempt}`);
        return result;

      } catch (error) {
        lastError = error as Error;
        console.error(`Attempt ${attempt} failed:`, error);

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 指数退避
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`All ${maxRetries} connection attempts failed. Last error: ${lastError.message}`);
  }
}

// 示例5: 使用新的 ConnectionManager
export function connectionManagerExample() {
  async function advancedConnectionHandling(ticket: string) {
    const manager = new ConnectionManager(15000); // 15秒默认超时

    // 设置进度监听
    manager.onProgress((progress) => {
      console.log(`Connection progress: ${progress.phase} - ${progress.percentage}%`);

      if (progress.phase === 'retrying') {
        console.log(`Retry attempt ${progress.attempt}`);
      }

      if (progress.error) {
        console.error('Progress error:', progress.error);
      }
    });

    try {
      const sessionId = await manager.connect(ticket, {
        timeout: 20000,  // 20秒超时
        retries: 3,      // 3次重试
      });

      console.log('Connection successful:', sessionId);
      return sessionId;

    } catch (error) {
      console.error('Connection completely failed:', error);
      throw error;
    }
  }
}

// 示例6: 多个并发连接的超时处理
export function concurrentTimeoutExample() {
  async function connectMultipleSessions(tickets: string[]): Promise<string[]> {
    const timeout = 10000;

    // 为每个连接创建超时Promise
    const connectionPromises = tickets.map(async (ticket, index) => {
      try {
        const result = await withTimeout(
          invoke<string>("connect_to_peer", { sessionTicket: ticket }),
          {
            timeout,
            message: `Connection ${index} timed out`,
            onProgress: (elapsed) => {
              console.log(`Connection ${index}: ${elapsed}ms`);
            }
          }
        );
        return { index, sessionId: result, error: null };
      } catch (error) {
        return { index, sessionId: null, error: error as Error };
      }
    });

    const results = await Promise.allSettled(connectionPromises);

    const successful: string[] = [];
    const failed: Array<{ index: number; error: Error }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { sessionId, error } = result.value;
        if (sessionId) {
          successful.push(sessionId);
        } else if (error) {
          failed.push({ index, error });
        }
      }
    });

    if (failed.length > 0) {
      console.warn(`${failed.length} connections failed:`, failed);
    }

    return successful;
  }
}

// 示例7: 自适应超时（根据网络条件调整）
export function adaptiveTimeoutExample() {
  class AdaptiveConnectionManager {
    private baseTimeout = 10000;
    private recentLatencies: number[] = [];
    private maxLatencyHistory = 10;

    async connect(ticket: string): Promise<string> {
      const adaptiveTimeout = this.calculateAdaptiveTimeout();
      const startTime = Date.now();

      try {
        const result = await withTimeout(
          invoke<string>("connect_to_peer", { sessionTicket: ticket }),
          {
            timeout: adaptiveTimeout,
            message: `Adaptive connection timed out after ${adaptiveTimeout}ms`
          }
        );

        // 记录成功连接的延迟
        const latency = Date.now() - startTime;
        this.recordLatency(latency);

        return result;
      } catch (error) {
        // 如果是超时错误，增加下次的超时时间
        if (error instanceof Error && error.message.includes('timed out')) {
          this.recordLatency(adaptiveTimeout); // 记录超时作为高延迟
        }
        throw error;
      }
    }

    private calculateAdaptiveTimeout(): number {
      if (this.recentLatencies.length === 0) {
        return this.baseTimeout;
      }

      const avgLatency = this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length;
      const maxLatency = Math.max(...this.recentLatencies);

      // 使用平均延迟的3倍作为超时时间，但不少于基础超时时间
      return Math.max(this.baseTimeout, Math.ceil(avgLatency * 3), maxLatency * 1.5);
    }

    private recordLatency(latency: number): void {
      this.recentLatencies.push(latency);
      if (this.recentLatencies.length > this.maxLatencyHistory) {
        this.recentLatencies.shift();
      }
    }

    getAverageLatency(): number {
      return this.recentLatencies.length > 0
        ? this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length
        : 0;
    }
  }

  // 使用示例
  async function useAdaptiveManager() {
    const manager = new AdaptiveConnectionManager();

    try {
      const sessionId = await manager.connect("ticket123");
      console.log("Connected with adaptive timeout:", sessionId);
      console.log("Average latency:", manager.getAverageLatency());
    } catch (error) {
      console.error("Adaptive connection failed:", error);
    }
  }
}

// 在 App.tsx 中的最佳实践整合
export function bestPracticeIntegration() {
  // 这是推荐在 App.tsx 中使用的方式
  async function handleConnectBestPractice(ticket: string) {
    const manager = new ConnectionManager(15000);

    // 设置进度回调
    manager.onProgress((progress) => {
      setConnectionProgress(progress);

      // 在终端显示进度（如果需要）
      if (terminalInstance && progress.phase === 'connecting') {
        const dots = '.'.repeat(Math.floor(progress.percentage / 25) + 1);
        terminalInstance.write(`\r\x1b[K🔄 Connecting${dots} ${progress.percentage.toFixed(0)}%`);
      }
    });

    try {
      setConnecting(true);
      setConnectionError(null);

      const sessionId = await manager.connect(ticket, {
        timeout: 20000,
        retries: 2,
        progressInterval: 500
      });

      // 连接成功的处理
      sessionIdRef = sessionId;
      setIsConnected(true);
      setCurrentView("terminal");

      terminalInstance?.writeln(
        "\r\n\x1b[1;32m✅ Connection established!\x1b[0m"
      );

      return sessionId;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setConnectionError(errorMessage);

      terminalInstance?.writeln(
        `\r\n\x1b[1;31m❌ Connection failed: ${errorMessage}\x1b[0m`
      );

      throw error;
    } finally {
      setConnecting(false);
    }
  }
}
