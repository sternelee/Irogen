/**
 * Enhanced Promise Timeout Utilities
 * 提供更强大的 Promise 超时处理功能
 */

export interface TimeoutOptions {
  timeout: number;
  message?: string;
  signal?: AbortSignal;
  onTimeout?: () => void;
  onProgress?: (elapsed: number) => void;
  progressInterval?: number;
}

export interface RetryOptions extends TimeoutOptions {
  retries: number;
  retryDelay?: number;
  exponentialBackoff?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * 为 Promise 添加超时功能
 */
export function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const {
    timeout,
    message = `Operation timed out after ${timeout}ms`,
    signal,
    onTimeout,
    onProgress,
    progressInterval = 1000
  } = options;

  return new Promise<T>((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;
    let progressIntervalId: NodeJS.Timeout | null = null;
    let isResolved = false;
    const startTime = Date.now();

    // 创建超时处理
    const timeoutPromise = new Promise<never>((_, timeoutReject) => {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          onTimeout?.();
          timeoutReject(new Error(message));
        }
      }, timeout);
    });

    // 处理进度报告
    if (onProgress) {
      progressIntervalId = setInterval(() => {
        if (!isResolved) {
          const elapsed = Date.now() - startTime;
          onProgress(elapsed);
        }
      }, progressInterval);
    }

    // 处理 AbortSignal
    if (signal) {
      const abortHandler = () => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(new Error('Operation aborted'));
        }
      };

      if (signal.aborted) {
        abortHandler();
        return;
      }

      signal.addEventListener('abort', abortHandler);
    }

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (progressIntervalId) {
        clearInterval(progressIntervalId);
      }
    };

    // 等待原始 Promise 或超时
    Promise.race([promise, timeoutPromise])
      .then((result) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          resolve(result);
        }
      })
      .catch((error) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(error);
        }
      });
  });
}

/**
 * 带重试机制的 Promise 超时处理
 */
export async function withTimeoutAndRetry<T>(
  promiseFactory: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    retries,
    retryDelay = 1000,
    exponentialBackoff = false,
    onRetry,
    ...timeoutOptions
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const promise = promiseFactory();
      return await withTimeout(promise, timeoutOptions);
    } catch (error) {
      lastError = error as Error;

      if (attempt < retries) {
        onRetry?.(attempt + 1, lastError);

        const delay = exponentialBackoff
          ? retryDelay * Math.pow(2, attempt)
          : retryDelay;

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

/**
 * 连接状态管理类
 */
export class ConnectionManager {
  private abortController: AbortController | null = null;
  private connectionPromise: Promise<string> | null = null;
  private progressCallback: ((progress: ConnectionProgress) => void) | null = null;

  constructor(private defaultTimeout: number = 10000) { }

  async connect(
    ticket: string,
    options: Partial<TimeoutOptions & { retries?: number }> = {}
  ): Promise<string> {
    // 取消之前的连接尝试
    this.abort();

    this.abortController = new AbortController();

    const {
      timeout = this.defaultTimeout,
      retries = 2,
      ...otherOptions
    } = options;

    const connectOptions: RetryOptions = {
      timeout,
      retries,
      retryDelay: 2000,
      exponentialBackoff: true,
      signal: this.abortController.signal,
      message: `Connection to session timed out after ${timeout}ms`,
      onProgress: (elapsed) => {
        this.progressCallback?.({
          phase: 'connecting',
          elapsed,
          total: timeout,
          percentage: Math.min((elapsed / timeout) * 100, 99)
        });
      },
      onTimeout: () => {
        this.progressCallback?.({
          phase: 'timeout',
          elapsed: timeout,
          total: timeout,
          percentage: 100
        });
      },
      onRetry: (attempt, error) => {
        console.warn(`Connection attempt ${attempt} failed:`, error.message);
        this.progressCallback?.({
          phase: 'retrying',
          elapsed: 0,
          total: timeout,
          percentage: 0,
          attempt,
          error: error.message
        });
      },
      ...otherOptions
    };

    this.connectionPromise = withTimeoutAndRetry(
      () => this.createConnectionPromise(ticket),
      connectOptions
    );

    try {
      const result = await this.connectionPromise;
      this.progressCallback?.({
        phase: 'connected',
        elapsed: 0,
        total: timeout,
        percentage: 100
      });
      return result;
    } catch (error) {
      this.progressCallback?.({
        phase: 'failed',
        elapsed: 0,
        total: timeout,
        percentage: 100,
        error: (error as Error).message
      });
      throw error;
    } finally {
      this.connectionPromise = null;
      this.abortController = null;
    }
  }

  private async createConnectionPromise(ticket: string): Promise<string> {
    // Use the enhanced connection API
    const { ConnectionApi } = await import("./api");

    return ConnectionApi.connectToPeer(ticket);
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.connectionPromise = null;
  }

  onProgress(callback: (progress: ConnectionProgress) => void): void {
    this.progressCallback = callback;
  }

  isConnecting(): boolean {
    return this.connectionPromise !== null;
  }
}

export interface ConnectionProgress {
  phase: 'connecting' | 'retrying' | 'connected' | 'failed' | 'timeout';
  elapsed: number;
  total: number;
  percentage: number;
  attempt?: number;
  error?: string;
}

/**
 * 创建可取消的延迟
 */
export function createCancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Cancelled'));
      return;
    }

    const timeoutId = setTimeout(() => {
      resolve();
    }, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(new Error('Cancelled'));
    });
  });
}

/**
 * 批量超时处理
 */
export async function promiseAllWithTimeout<T>(
  promises: Promise<T>[],
  timeout: number,
  options: {
    failFast?: boolean;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<T[]> {
  const { failFast = true, onProgress } = options;

  const wrappedPromises = promises.map((promise, index) =>
    withTimeout(promise, {
      timeout,
      message: `Promise ${index} timed out after ${timeout}ms`
    }).then(result => {
      onProgress?.(index + 1, promises.length);
      return result;
    })
  );

  if (failFast) {
    return Promise.all(wrappedPromises);
  } else {
    const results = await Promise.allSettled(wrappedPromises);
    const values: T[] = [];
    const errors: Error[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        values[index] = result.value;
      } else {
        errors.push(new Error(`Promise ${index}: ${result.reason}`));
      }
    });

    if (errors.length > 0) {
      // Use a custom error if AggregateError is not available
      const error = new Error(`${errors.length} promises failed: ${errors.map(e => e.message).join(', ')}`) as any;
      error.errors = errors;
      throw error;
    }

    return values;
  }
}
