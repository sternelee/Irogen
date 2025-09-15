# Promise.race() 超时处理最佳实践指南

## 概述

在前端应用中，特别是涉及网络连接的场景下，超时处理是确保用户体验的关键。本指南总结了在 RiTerm 项目中使用 `Promise.race()` 实现超时处理的各种方法和最佳实践。

## 当前实现分析

### App.tsx 中的基础实现

```typescript
const connectPromise = invoke<string>("connect_to_peer", {
  sessionTicket: ticket,
});

const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(
    () => reject(new Error("Connection timed out after 5 seconds")),
    5000,
  ),
);

const actualSessionId = await Promise.race([
  connectPromise,
  timeoutPromise,
]);
```

**优点：**
- 简单直接
- 容易理解
- 满足基本超时需求

**缺点：**
- 没有进度反馈
- 不支持取消操作
- 没有重试机制
- 资源可能泄漏

## 改进方案

### 1. 基础增强版本

```typescript
function createTimeoutPromise<T>(
  promise: Promise<T>,
  timeout: number,
  message?: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message || `Operation timed out after ${timeout}ms`));
    }, timeout);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise
  ]);
}
```

### 2. 支持取消的版本

```typescript
function createCancellableTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;
    let isSettled = false;

    const settle = (fn: () => void) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timeoutId);
        fn();
      }
    };

    // 处理超时
    timeoutId = setTimeout(() => {
      settle(() => reject(new Error('Operation timed out')));
    }, timeout);

    // 处理取消
    if (signal) {
      if (signal.aborted) {
        settle(() => reject(new Error('Operation aborted')));
        return;
      }

      signal.addEventListener('abort', () => {
        settle(() => reject(new Error('Operation aborted')));
      });
    }

    // 处理原始 Promise
    promise
      .then(result => settle(() => resolve(result)))
      .catch(error => settle(() => reject(error)));
  });
}
```

### 3. 带进度的版本

```typescript
interface ProgressOptions {
  timeout: number;
  onProgress?: (elapsed: number, percentage: number) => void;
  progressInterval?: number;
}

function withProgress<T>(
  promise: Promise<T>,
  options: ProgressOptions
): Promise<T> {
  const { timeout, onProgress, progressInterval = 500 } = options;
  const startTime = Date.now();

  let progressTimer: NodeJS.Timeout | null = null;

  if (onProgress) {
    progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const percentage = Math.min((elapsed / timeout) * 100, 99);
      onProgress(elapsed, percentage);
    }, progressInterval);
  }

  const cleanup = () => {
    if (progressTimer) {
      clearInterval(progressTimer);
    }
  };

  return createTimeoutPromise(promise, timeout)
    .then(result => {
      cleanup();
      onProgress?.(Date.now() - startTime, 100);
      return result;
    })
    .catch(error => {
      cleanup();
      throw error;
    });
}
```

### 4. 完整的连接管理器

使用我们创建的 `ConnectionManager` 类：

```typescript
const manager = new ConnectionManager(15000);

manager.onProgress((progress) => {
  console.log(`${progress.phase}: ${progress.percentage}%`);
});

try {
  const sessionId = await manager.connect(ticket, {
    timeout: 20000,
    retries: 2,
  });
  console.log('Connected:', sessionId);
} catch (error) {
  console.error('Failed:', error);
}
```

## 在 App.tsx 中的集成

### 推荐的集成方式

```typescript
import { createConnectionHandler } from "./hooks/useConnection";
import { ConnectionProgressModal } from "./components/ConnectionProgress";

function App() {
  const {
    connect,
    abort,
    connecting,
    connectionProgress,
    connectionError
  } = createConnectionHandler();

  const handleConnect = async (ticket: string) => {
    try {
      const sessionId = await connect(ticket, {
        timeout: 15000,
        retries: 2,
        onProgressUpdate: (progress) => {
          // 可选的进度处理
          if (terminalInstance && progress.phase === 'retrying') {
            terminalInstance.writeln(`🔄 Retrying... (${progress.attempt})`);
          }
        }
      });

      // 连接成功的处理
      setupTerminalListeners(sessionId);

    } catch (error) {
      // 错误处理
      handleConnectionError(error);
    }
  };

  return (
    <div>
      {/* 其他组件 */}

      <ConnectionProgressModal
        progress={connectionProgress()}
        show={connecting()}
      />

      {/* 其他组件 */}
    </div>
  );
}
```

## 最佳实践

### 1. 超时时间选择

```typescript
const TIMEOUT_CONFIG = {
  // 本地连接
  LOCAL: 3000,
  // P2P 连接
  P2P: 15000,
  // 慢速网络
  SLOW_NETWORK: 30000,
  // 文件传输
  FILE_TRANSFER: 60000,
};
```

### 2. 错误处理策略

```typescript
function handleConnectionError(error: Error) {
  if (error.message.includes('timed out')) {
    // 超时错误
    setConnectionError('连接超时，请检查网络状况');
    showRetryOption();
  } else if (error.message.includes('aborted')) {
    // 用户取消
    setConnectionError('连接已取消');
  } else {
    // 其他错误
    setConnectionError(`连接失败: ${error.message}`);
  }
}
```

### 3. 资源清理

```typescript
onCleanup(() => {
  // 组件卸载时清理资源
  connectionManager.abort();
  clearAllTimeouts();
});
```

### 4. 用户体验优化

```typescript
// 显示连接进度
const showConnectionProgress = (progress: ConnectionProgress) => {
  switch (progress.phase) {
    case 'connecting':
      setStatus('正在连接...');
      break;
    case 'retrying':
      setStatus(`重试中 (${progress.attempt}/${maxRetries})`);
      break;
    case 'connected':
      setStatus('连接成功');
      break;
    case 'failed':
      setStatus('连接失败');
      break;
  }
};
```

### 5. 性能考虑

```typescript
// 避免内存泄漏
const timeoutPromise = new Promise<never>((_, reject) => {
  const timeoutId = setTimeout(() => {
    reject(new Error('Timeout'));
  }, timeout);

  // 确保清理定时器
  promise.finally(() => clearTimeout(timeoutId));
});
```

## 测试策略

### 1. 超时测试

```typescript
test('should timeout after specified duration', async () => {
  const slowPromise = new Promise(resolve =>
    setTimeout(resolve, 10000)
  );

  await expect(
    withTimeout(slowPromise, { timeout: 1000 })
  ).rejects.toThrow('timed out');
});
```

### 2. 取消测试

```typescript
test('should be cancellable', async () => {
  const controller = new AbortController();
  const promise = connect('ticket', { signal: controller.signal });

  setTimeout(() => controller.abort(), 100);

  await expect(promise).rejects.toThrow('aborted');
});
```

### 3. 重试测试

```typescript
test('should retry on failure', async () => {
  let attempts = 0;
  const mockConnect = jest.fn().mockImplementation(() => {
    attempts++;
    if (attempts < 3) {
      throw new Error('Connection failed');
    }
    return Promise.resolve('success');
  });

  const result = await withRetry(mockConnect, { retries: 3 });
  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```

## 总结

通过使用这些改进的超时处理方法，你的应用将能够：

1. **提供更好的用户体验**：通过进度反馈和清晰的错误信息
2. **提高可靠性**：通过重试机制和错误恢复
3. **防止资源泄漏**：通过正确的清理机制
4. **支持用户控制**：通过取消操作
5. **适应不同网络条件**：通过自适应超时

建议在你的项目中逐步采用这些改进，从基础的 `withTimeout` 工具函数开始，然后根据需要集成更高级的功能。